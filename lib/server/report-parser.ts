import type {
  CompositionItem,
  LinguisticReport,
  SeoContextItem,
  WordPracticeItem,
} from '@/lib/types';

const WRAPPED_KEYS = ['report', 'analysis', 'result', 'data', 'output'] as const;

export function parseModelJsonReport(
  rawText: string,
  options: {modelUsed: string; sourceFile: string},
): LinguisticReport {
  const parsed = parseJsonLenient(rawText);
  const normalized = normalizePayload(parsed);

  return {
    leadershipClarityScore: clampInt(normalized.leadership_clarity_score, 0, 100, 0),
    executiveSummary: toText(normalized.executive_summary),
    wordsToPractice: parseWords(normalized.words_to_practice),
    professionalComposition: parseComposition(normalized.professional_composition),
    seoContext: parseSeoContext(normalized.seo_context),
    nextActions: parseActions(normalized.next_actions),
    modelUsed: options.modelUsed,
    sourceFile: options.sourceFile,
  };
}

function parseJsonLenient(raw: string): unknown {
  const text = raw.trim();
  if (!text) {
    throw new Error('Model returned an empty response.');
  }

  try {
    return JSON.parse(text);
  } catch {
    const objectStart = text.indexOf('{');
    const objectEnd = text.lastIndexOf('}');
    if (objectStart >= 0 && objectEnd > objectStart) {
      return JSON.parse(text.slice(objectStart, objectEnd + 1));
    }

    const arrayStart = text.indexOf('[');
    const arrayEnd = text.lastIndexOf(']');
    if (arrayStart >= 0 && arrayEnd > arrayStart) {
      return JSON.parse(text.slice(arrayStart, arrayEnd + 1));
    }

    throw new Error('Model did not return valid JSON.');
  }
}

function normalizePayload(payload: unknown): Record<string, unknown> {
  if (isRecord(payload)) {
    const nested = unwrapRecord(payload);
    return nested ?? payload;
  }

  if (Array.isArray(payload)) {
    for (const item of payload) {
      if (!isRecord(item)) {
        continue;
      }
      const nested = unwrapRecord(item);
      if (nested) {
        return nested;
      }
      return item;
    }
  }

  return {};
}

function unwrapRecord(value: Record<string, unknown>): Record<string, unknown> | null {
  if (hasReportLikeKey(value)) {
    return value;
  }

  for (const key of WRAPPED_KEYS) {
    const nested = value[key];
    if (isRecord(nested) && hasReportLikeKey(nested)) {
      return nested;
    }
  }

  return null;
}

function hasReportLikeKey(value: Record<string, unknown>): boolean {
  return (
    'leadership_clarity_score' in value ||
    'executive_summary' in value ||
    'words_to_practice' in value ||
    'professional_composition' in value ||
    'seo_context' in value ||
    'next_actions' in value
  );
}

function parseWords(value: unknown): WordPracticeItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((item) => ({
      category: toText(item.category) || 'Phonetic Accuracy',
      term: toText(item.term),
      risk: toText(item.risk),
      phoneticTip: toText(item.phonetic_tip),
      practiceSentence: toText(item.practice_sentence),
    }))
    .filter((item) => item.term.length > 0);
}

function parseComposition(value: unknown): CompositionItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((item) => ({
      originalIssue: toText(item.original_issue),
      executiveRewrite: toText(item.executive_rewrite),
      reason: toText(item.reason),
    }))
    .filter((item) => item.originalIssue.length > 0 || item.executiveRewrite.length > 0);
}

function parseSeoContext(value: unknown): SeoContextItem[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter(isRecord)
    .map((item) => ({
      term: toText(item.term),
      clarityScore: clampInt(item.clarity_score, 1, 5, 3),
      feedback: toText(item.feedback),
      clientFriendlyVersion: toText(item.client_friendly_version),
    }))
    .filter((item) => item.term.length > 0);
}

function parseActions(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .filter((entry): entry is string => typeof entry === 'string')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const numeric = Number(value);
  if (Number.isNaN(numeric)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, Math.round(numeric)));
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
