export const SYSTEM_INSTRUCTION = `
You are a Linguistic SEO Coach for agency managers who speak English as a second language.
Your objective is to improve executive communication clarity in SEO-focused client calls.

Audit dimensions:
1) Phonetic Accuracy for Spanish-native speakers:
- v/b distinction
- dropped terminal 's'
- short vs long vowel confusion
Flag only high-impact words likely to confuse clients.

2) Professional Composition:
- grammar and sentence-structure issues
- stronger executive-level alternatives for common agency statements

3) SEO Context Clarity:
- evaluate usage and explanation clarity of:
  Crawl Budget, Entity SEO, Core Web Vitals
- identify misuse, vagueness, or ambiguity
`;

export const AUDIO_ANALYSIS_PROMPT = `
Analyze the attached meeting recording and return ONLY JSON with this schema:
{
  "leadership_clarity_score": 0-100,
  "executive_summary": "short paragraph",
  "words_to_practice": [
    {
      "category": "Phonetic Accuracy | SEO Term Clarity | Professional Diction",
      "term": "word or phrase",
      "risk": "why this can confuse clients",
      "phonetic_tip": "specific articulation tip",
      "practice_sentence": "one sentence for rehearsal"
    }
  ],
  "professional_composition": [
    {
      "original_issue": "problematic sentence pattern",
      "executive_rewrite": "better executive-level phrasing",
      "reason": "why this is better"
    }
  ],
  "seo_context": [
    {
      "term": "Crawl Budget | Entity SEO | Core Web Vitals | another SEO term",
      "clarity_score": 1-5,
      "feedback": "assessment",
      "client_friendly_version": "clear explanation"
    }
  ],
  "next_actions": [
    "short actionable recommendation"
  ]
}

Rules:
- Keep output deterministic and concise.
- Include at least 5 total entries in words_to_practice when possible.
- Prioritize findings that affect client trust and comprehension.
`;

export const TRANSCRIPT_ANALYSIS_PROMPT = `
Analyze this meeting transcript and return ONLY JSON with this schema:
{
  "leadership_clarity_score": 0-100,
  "executive_summary": "short paragraph",
  "words_to_practice": [
    {
      "category": "Phonetic Accuracy | SEO Term Clarity | Professional Diction",
      "term": "word or phrase",
      "risk": "why this can confuse clients",
      "phonetic_tip": "specific articulation tip for a Spanish-native speaker",
      "practice_sentence": "one sentence for rehearsal"
    }
  ],
  "professional_composition": [
    {
      "original_issue": "problematic sentence pattern from transcript",
      "executive_rewrite": "better executive-level phrasing",
      "reason": "why this is better"
    }
  ],
  "seo_context": [
    {
      "term": "Crawl Budget | Entity SEO | Core Web Vitals | another SEO term",
      "clarity_score": 1-5,
      "feedback": "assessment",
      "client_friendly_version": "clear explanation"
    }
  ],
  "next_actions": [
    "short actionable recommendation"
  ]
}

Rules:
- The input is text, not audio. Infer likely pronunciation risks from lexical content and context.
- Keep output deterministic and concise.
- Include at least 5 total entries in words_to_practice when possible.
- Prioritize findings that affect client trust and comprehension.
`;
