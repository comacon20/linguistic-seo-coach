export type PracticeCategory =
  | 'Phonetic Accuracy'
  | 'SEO Term Clarity'
  | 'Professional Diction'
  | string;

export interface WordPracticeItem {
  category: PracticeCategory;
  term: string;
  risk: string;
  phoneticTip: string;
  practiceSentence: string;
}

export interface CompositionItem {
  originalIssue: string;
  executiveRewrite: string;
  reason: string;
}

export interface SeoContextItem {
  term: string;
  clarityScore: number;
  feedback: string;
  clientFriendlyVersion: string;
}

export interface LinguisticReport {
  leadershipClarityScore: number;
  executiveSummary: string;
  wordsToPractice: WordPracticeItem[];
  professionalComposition: CompositionItem[];
  seoContext: SeoContextItem[];
  nextActions: string[];
  modelUsed: string;
  sourceFile: string;
}

export interface SourceMetadata {
  id: string;
  name: string;
  mimeType: string;
  modifiedTime: string;
  sizeBytes?: number;
  webViewLink?: string;
}

export interface AnalysisResponse {
  report: LinguisticReport;
  source: SourceMetadata;
}

export interface ApiErrorResponse {
  error: {
    message: string;
    details?: string;
  };
}

export interface HistoryPoint {
  analyzedAt: string;
  mode: 'Transcript' | 'Drive';
  sourceName: string;
  score: number;
  wordsCount: number;
  compositionCount: number;
  seoCount: number;
}
