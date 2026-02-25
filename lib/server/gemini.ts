import {GoogleGenAI} from '@google/genai';
import {randomUUID} from 'crypto';
import {promises as fs} from 'fs';
import os from 'os';
import path from 'path';

import type {LinguisticReport} from '@/lib/types';
import {AUDIO_ANALYSIS_PROMPT, SYSTEM_INSTRUCTION, TRANSCRIPT_ANALYSIS_PROMPT} from '@/lib/server/prompts';
import {parseModelJsonReport} from '@/lib/server/report-parser';

const DEFAULT_MODEL = process.env.GEMINI_MODEL || 'gemini-3-flash-preview';
const DEFAULT_INLINE_BYTES = Number(process.env.GEMINI_MAX_INLINE_BYTES || 18_000_000);

const FILE_WAIT_TIMEOUT_SECONDS = Number(process.env.GEMINI_FILE_PROCESS_TIMEOUT_SECONDS || 180);
const FILE_WAIT_POLL_SECONDS = Number(process.env.GEMINI_FILE_PROCESS_POLL_SECONDS || 2);
const ACTIVE_RETRY_ATTEMPTS = Number(process.env.GEMINI_ACTIVE_RETRY_ATTEMPTS || 5);
const ACTIVE_RETRY_DELAY_SECONDS = Number(process.env.GEMINI_ACTIVE_RETRY_DELAY_SECONDS || 2);

type GeminiFileState = {
  name?: string;
  uri?: string;
  mimeType?: string;
  state?: unknown;
  error?: {
    message?: string;
  };
};

export async function analyzeTranscriptWithGemini(input: {
  transcriptText: string;
  sourceName: string;
}): Promise<LinguisticReport> {
  const transcript = input.transcriptText.trim();
  if (!transcript) {
    throw new Error('Transcript is empty.');
  }

  const client = getGeminiClient();
  const response = await client.models.generateContent({
    model: DEFAULT_MODEL,
    contents: [`${TRANSCRIPT_ANALYSIS_PROMPT}\n\nTranscript:\n${transcript}`],
    config: generationConfig(),
  });

  return parseModelJsonReport(extractResponseText(response), {
    modelUsed: DEFAULT_MODEL,
    sourceFile: input.sourceName,
  });
}

export async function analyzeMediaWithGemini(input: {
  fileBuffer: Buffer;
  mimeType: string;
  sourceName: string;
}): Promise<LinguisticReport> {
  const client = getGeminiClient();
  const mimeType = normalizeMimeType(input.mimeType);

  if (input.fileBuffer.byteLength <= DEFAULT_INLINE_BYTES) {
    return generateAndParse(client, {
      prompt: AUDIO_ANALYSIS_PROMPT,
      sourceName: input.sourceName,
      mediaPart: {
        inlineData: {
          data: input.fileBuffer.toString('base64'),
          mimeType,
        },
      },
    });
  }

  const tempPath = path.join(os.tmpdir(), `linguistic-coach-${randomUUID()}`);
  await fs.writeFile(tempPath, input.fileBuffer);

  try {
    const uploaded = await client.files.upload({
      file: tempPath,
      config: {
        mimeType,
        displayName: input.sourceName,
      },
    });

    const uploadedName = String(uploaded.name || '').trim();
    if (!uploadedName) {
      throw new Error('Gemini upload did not return a file name.');
    }

    const activeFile = await waitForFileToBeActive(client, uploadedName);
    const fileUri = String(activeFile.uri || '').trim();
    const activeMime = normalizeMimeType(String(activeFile.mimeType || mimeType));

    if (!fileUri) {
      throw new Error('Gemini uploaded file did not return a file URI.');
    }

    return generateAndParse(client, {
      prompt: AUDIO_ANALYSIS_PROMPT,
      sourceName: input.sourceName,
      mediaPart: {
        fileData: {
          fileUri,
          mimeType: activeMime,
        },
      },
      uploadedFileName: uploadedName,
      uploadedMimeType: activeMime,
    });
  } finally {
    await fs.unlink(tempPath).catch(() => undefined);
  }
}

function getGeminiClient(): GoogleGenAI {
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('Missing GOOGLE_API_KEY (or GEMINI_API_KEY).');
  }

  return new GoogleGenAI({apiKey});
}

function generationConfig() {
  const budget = Number(process.env.GEMINI_THINKING_BUDGET || 1024);

  return {
    systemInstruction: SYSTEM_INSTRUCTION,
    responseMimeType: 'application/json',
    temperature: 0.1,
    ...(Number.isFinite(budget) && budget > 0
      ? {thinkingConfig: {thinkingBudget: Math.round(budget)}}
      : {}),
  };
}

async function generateAndParse(
  client: GoogleGenAI,
  input: {
    prompt: string;
    sourceName: string;
    mediaPart: Record<string, unknown>;
    uploadedFileName?: string;
    uploadedMimeType?: string;
  },
): Promise<LinguisticReport> {
  let part = input.mediaPart;

  for (let attempt = 1; attempt <= Math.max(1, ACTIVE_RETRY_ATTEMPTS); attempt += 1) {
    try {
      const response = await client.models.generateContent({
        model: DEFAULT_MODEL,
        contents: [
          {
            role: 'user',
            parts: [{text: input.prompt}, part],
          },
        ],
        config: generationConfig(),
      });

      return parseModelJsonReport(extractResponseText(response), {
        modelUsed: DEFAULT_MODEL,
        sourceFile: input.sourceName,
      });
    } catch (error) {
      if (!shouldRetryForActiveState(error) || !input.uploadedFileName || attempt === ACTIVE_RETRY_ATTEMPTS) {
        throw error;
      }

      await sleepSeconds(Math.max(1, ACTIVE_RETRY_DELAY_SECONDS) * attempt);
      const refreshed = await waitForFileToBeActive(
        client,
        input.uploadedFileName,
        Math.max(30, ACTIVE_RETRY_DELAY_SECONDS * 10),
      );

      const refreshedUri = String(refreshed.uri || '').trim();
      if (refreshedUri) {
        part = {
          fileData: {
            fileUri: refreshedUri,
            mimeType: normalizeMimeType(String(refreshed.mimeType || input.uploadedMimeType || '')),
          },
        };
      }
    }
  }

  throw new Error('Gemini analysis retry loop ended unexpectedly.');
}

async function waitForFileToBeActive(
  client: GoogleGenAI,
  fileName: string,
  timeoutSeconds = FILE_WAIT_TIMEOUT_SECONDS,
) {
  const deadline = Date.now() + Math.max(5, timeoutSeconds) * 1000;
  let current: GeminiFileState | null = null;

  while (Date.now() < deadline) {
    current = (await client.files.get({name: fileName})) as GeminiFileState;
    const state = normalizeState(current.state);

    if (state === 'ACTIVE') {
      return current;
    }

    if (state === 'FAILED') {
      const reason = current.error?.message || 'unknown processing error';
      throw new Error(`Gemini Files processing failed: ${reason}`);
    }

    await sleepSeconds(Math.max(1, FILE_WAIT_POLL_SECONDS));
  }

  const finalState = normalizeState(current?.state) || 'UNKNOWN';
  throw new Error(
    `Gemini Files upload timed out before ACTIVE state (state=${finalState}). ` +
      'Increase GEMINI_FILE_PROCESS_TIMEOUT_SECONDS if needed.',
  );
}

function extractResponseText(response: unknown): string {
  const record = response as {
    text?: string | (() => string);
    candidates?: Array<{content?: {parts?: Array<{text?: string}>}}>;
  };

  if (typeof record.text === 'string' && record.text.trim()) {
    return stripCodeFence(record.text);
  }

  if (typeof record.text === 'function') {
    const fromFunction = record.text();
    if (typeof fromFunction === 'string' && fromFunction.trim()) {
      return stripCodeFence(fromFunction);
    }
  }

  const firstCandidate = record.candidates?.[0];
  const parts = firstCandidate?.content?.parts || [];
  const merged = parts
    .map((part) => (typeof part.text === 'string' ? part.text : ''))
    .join('')
    .trim();

  if (merged) {
    return stripCodeFence(merged);
  }

  throw new Error('Gemini returned no usable text payload.');
}

function stripCodeFence(value: string): string {
  const trimmed = value.trim();
  if (!trimmed.startsWith('```')) {
    return trimmed;
  }

  return trimmed
    .replace(/^```json/i, '')
    .replace(/^```/, '')
    .replace(/```$/, '')
    .trim();
}

function normalizeState(state: unknown): string {
  if (!state) {
    return '';
  }

  if (typeof state === 'string') {
    return state.toUpperCase();
  }

  if (typeof state === 'object' && state !== null && 'value' in state) {
    const raw = (state as {value?: unknown}).value;
    if (typeof raw === 'string') {
      return raw.toUpperCase();
    }
  }

  const text = String(state).toUpperCase();
  return text.startsWith('FILESTATE.') ? text.split('.')[1] || text : text;
}

function shouldRetryForActiveState(error: unknown): boolean {
  const message = String(error || '').toLowerCase();
  return message.includes('failed_precondition') && message.includes('not in an active state');
}

function normalizeMimeType(input: string): string {
  if (!input) {
    return 'application/octet-stream';
  }
  return input.trim().toLowerCase();
}

async function sleepSeconds(seconds: number): Promise<void> {
  await new Promise((resolve) => {
    setTimeout(resolve, seconds * 1000);
  });
}
