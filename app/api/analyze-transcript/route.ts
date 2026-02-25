import {NextResponse} from 'next/server';
import {z} from 'zod';

import {analyzeTranscriptWithGemini} from '@/lib/server/gemini';
import type {AnalysisResponse, ApiErrorResponse} from '@/lib/types';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const requestSchema = z.object({
  transcriptText: z.string().min(1, 'Transcript text is required.'),
  sourceName: z.string().min(1).max(200).optional(),
});

export async function POST(request: Request) {
  try {
    const raw = await request.json();
    const parsed = requestSchema.parse(raw);

    const cleaned = cleanTranscriptText(parsed.transcriptText);
    if (!cleaned) {
      return NextResponse.json<ApiErrorResponse>(
        {
          error: {
            message:
              'Transcript was empty after removing timestamps and empty lines. Paste plain transcript text or upload a clean transcript file.',
          },
        },
        {status: 400},
      );
    }

    const sourceName = (parsed.sourceName || 'transcript.txt').trim() || 'transcript.txt';

    const report = await analyzeTranscriptWithGemini({
      transcriptText: cleaned,
      sourceName,
    });

    const payload: AnalysisResponse = {
      report,
      source: {
        id: `transcript-${Date.now()}`,
        name: sourceName,
        mimeType: 'text/plain',
        modifiedTime: new Date().toISOString(),
      },
    };

    return NextResponse.json(payload, {status: 200});
  } catch (error) {
    if (error instanceof z.ZodError) {
      return NextResponse.json<ApiErrorResponse>(
        {
          error: {
            message: 'Invalid request payload.',
            details: error.errors.map((entry) => entry.message).join(' '),
          },
        },
        {status: 400},
      );
    }

    return NextResponse.json<ApiErrorResponse>(
      {
        error: {
          message: 'Failed to analyze transcript.',
          details: error instanceof Error ? error.message : String(error),
        },
      },
      {status: 500},
    );
  }
}

function cleanTranscriptText(rawText: string): string {
  const lines = rawText.split(/\r?\n/);
  const kept: string[] = [];

  for (const line of lines) {
    const value = line.trim();
    if (!value || value.toUpperCase() === 'WEBVTT') {
      continue;
    }
    if (value.includes('-->')) {
      continue;
    }
    if (/^\d+$/.test(value)) {
      continue;
    }
    kept.push(value);
  }

  return kept.join('\n').trim();
}
