from __future__ import annotations

import json
import os
import time
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from google import genai
from google.genai import types

SUPPORTED_AUDIO_EXTENSIONS = {".m4a", ".mp4", ".mp3", ".wav"}

SYSTEM_INSTRUCTION = """
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
"""

ANALYSIS_PROMPT = """
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
"""

TRANSCRIPT_ANALYSIS_PROMPT = """
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
"""


@dataclass(frozen=True)
class WordPracticeItem:
    category: str
    term: str
    risk: str
    phonetic_tip: str
    practice_sentence: str


@dataclass(frozen=True)
class CompositionItem:
    original_issue: str
    executive_rewrite: str
    reason: str


@dataclass(frozen=True)
class SeoContextItem:
    term: str
    clarity_score: int
    feedback: str
    client_friendly_version: str


@dataclass(frozen=True)
class LinguisticReport:
    leadership_clarity_score: int
    executive_summary: str
    words_to_practice: list[WordPracticeItem] = field(default_factory=list)
    professional_composition: list[CompositionItem] = field(default_factory=list)
    seo_context: list[SeoContextItem] = field(default_factory=list)
    next_actions: list[str] = field(default_factory=list)
    model_used: str = ""
    source_file: str = ""

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def analyze_audio_file(
    file_path: str,
    mime_type_hint: str | None = None,
    source_name: str | None = None,
) -> LinguisticReport:
    """
    Send raw audio/video bytes to Gemini and return structured fluency feedback.
    """
    load_dotenv()
    target = Path(file_path)
    if not target.exists():
        raise FileNotFoundError(f"Audio file not found: {target}")

    suffix = target.suffix.lower()
    mime_type = _resolve_mime_type(suffix=suffix, mime_type_hint=mime_type_hint)

    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise EnvironmentError("Missing GOOGLE_API_KEY (or GEMINI_API_KEY) in environment.")

    model_name = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")
    thinking_budget = _parse_int_env("GEMINI_THINKING_BUDGET", default=1024)
    max_inline_bytes = int(os.getenv("GEMINI_MAX_INLINE_BYTES", "18000000"))

    client = genai.Client(api_key=api_key)
    file_size = target.stat().st_size
    uploaded_file_name = ""
    if file_size <= max_inline_bytes:
        payload = target.read_bytes()
        media_input: Any = types.Part.from_bytes(data=payload, mime_type=mime_type)
    else:
        uploaded = client.files.upload(file=str(target))
        uploaded_file_name = str(getattr(uploaded, "name", "") or "").strip()
        if not uploaded_file_name:
            raise ValueError("Upload succeeded but file name is missing; cannot continue.")
        active_file = _wait_for_file_active(client, file_name=uploaded_file_name)
        media_input = _to_media_part_from_uploaded_file(active_file, fallback_mime_type=mime_type)

    response = _generate_content_with_active_retry(
        client=client,
        model_name=model_name,
        prompt=ANALYSIS_PROMPT,
        media_input=media_input,
        thinking_budget=thinking_budget,
        uploaded_file_name=uploaded_file_name,
        mime_type=mime_type,
    )

    parsed = _extract_json(response)
    return _to_report(
        parsed,
        model_name=model_name,
        source_file=source_name or target.name,
    )


def analyze_transcript_text(
    transcript_text: str,
    source_name: str = "transcript.txt",
) -> LinguisticReport:
    """Analyze transcript text and return structured fluency feedback."""
    load_dotenv()
    cleaned = transcript_text.strip()
    if not cleaned:
        raise ValueError("Transcript text is empty.")

    api_key = os.getenv("GOOGLE_API_KEY") or os.getenv("GEMINI_API_KEY")
    if not api_key:
        raise EnvironmentError("Missing GOOGLE_API_KEY (or GEMINI_API_KEY) in environment.")

    model_name = os.getenv("GEMINI_MODEL", "gemini-3-flash-preview")
    thinking_budget = _parse_int_env("GEMINI_THINKING_BUDGET", default=1024)
    client = genai.Client(api_key=api_key)

    response = client.models.generate_content(
        model=model_name,
        contents=[TRANSCRIPT_ANALYSIS_PROMPT, cleaned],
        config=types.GenerateContentConfig(
            system_instruction=SYSTEM_INSTRUCTION,
            response_mime_type="application/json",
            temperature=0.1,
            thinking_config=types.ThinkingConfig(thinking_budget=thinking_budget),
        ),
    )

    parsed = _extract_json(response)
    return _to_report(parsed, model_name=model_name, source_file=source_name)


def _extract_json(response: Any) -> Any:
    text = getattr(response, "text", "") or ""
    if not text and getattr(response, "candidates", None):
        candidate = response.candidates[0]
        if getattr(candidate, "content", None) and getattr(candidate.content, "parts", None):
            text = "".join(
                getattr(part, "text", "") for part in candidate.content.parts if hasattr(part, "text")
            )

    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = cleaned.strip("`")
        if cleaned.startswith("json"):
            cleaned = cleaned[4:].strip()

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        obj_start = cleaned.find("{")
        obj_end = cleaned.rfind("}")
        if obj_start != -1 and obj_end != -1 and obj_start < obj_end:
            return json.loads(cleaned[obj_start : obj_end + 1])

        list_start = cleaned.find("[")
        list_end = cleaned.rfind("]")
        if list_start != -1 and list_end != -1 and list_start < list_end:
            return json.loads(cleaned[list_start : list_end + 1])

        raise ValueError("Model did not return valid JSON.")


def _to_report(payload: Any, model_name: str, source_file: str) -> LinguisticReport:
    normalized = _normalize_payload(payload)
    score = _clamp_int(normalized.get("leadership_clarity_score"), low=0, high=100, default=0)
    summary = str(normalized.get("executive_summary", "")).strip()

    words_payload = normalized.get("words_to_practice", []) or []
    composition_payload = normalized.get("professional_composition", []) or []
    seo_payload = normalized.get("seo_context", []) or []
    next_actions_payload = normalized.get("next_actions", []) or []

    words = []
    for item in words_payload if isinstance(words_payload, list) else []:
        if not isinstance(item, dict):
            continue
        words.append(
            WordPracticeItem(
                category=str(item.get("category", "Phonetic Accuracy")),
                term=str(item.get("term", "")),
                risk=str(item.get("risk", "")),
                phonetic_tip=str(item.get("phonetic_tip", "")),
                practice_sentence=str(item.get("practice_sentence", "")),
            )
        )

    composition = []
    for item in composition_payload if isinstance(composition_payload, list) else []:
        if not isinstance(item, dict):
            continue
        composition.append(
            CompositionItem(
                original_issue=str(item.get("original_issue", "")),
                executive_rewrite=str(item.get("executive_rewrite", "")),
                reason=str(item.get("reason", "")),
            )
        )

    seo_items = []
    for item in seo_payload if isinstance(seo_payload, list) else []:
        if not isinstance(item, dict):
            continue
        seo_items.append(
            SeoContextItem(
                term=str(item.get("term", "")),
                clarity_score=_clamp_int(item.get("clarity_score"), low=1, high=5, default=3),
                feedback=str(item.get("feedback", "")),
                client_friendly_version=str(item.get("client_friendly_version", "")),
            )
        )

    actions: list[str] = []
    for action in next_actions_payload if isinstance(next_actions_payload, list) else []:
        if isinstance(action, str):
            cleaned = action.strip()
            if cleaned:
                actions.append(cleaned)

    return LinguisticReport(
        leadership_clarity_score=score,
        executive_summary=summary,
        words_to_practice=words,
        professional_composition=composition,
        seo_context=seo_items,
        next_actions=actions,
        model_used=model_name,
        source_file=source_file,
    )


def _normalize_payload(payload: Any) -> dict[str, Any]:
    expected_keys = {
        "leadership_clarity_score",
        "executive_summary",
        "words_to_practice",
        "professional_composition",
        "seo_context",
        "next_actions",
    }

    def _extract_dict(value: Any) -> dict[str, Any] | None:
        if not isinstance(value, dict):
            return None
        if expected_keys.intersection(value.keys()):
            return value
        for container_key in ("report", "analysis", "result", "data", "output"):
            nested = value.get(container_key)
            if isinstance(nested, dict) and expected_keys.intersection(nested.keys()):
                return nested
        return value

    if isinstance(payload, dict):
        extracted = _extract_dict(payload)
        return extracted if extracted is not None else {}

    if isinstance(payload, list):
        for item in payload:
            extracted = _extract_dict(item)
            if extracted is not None and expected_keys.intersection(extracted.keys()):
                return extracted
        if payload and isinstance(payload[0], dict):
            return payload[0]
        return {}

    return {}


def _guess_mime_type(suffix: str) -> str:
    if suffix == ".m4a":
        return "audio/mp4"
    if suffix == ".mp4":
        return "video/mp4"
    if suffix == ".mp3":
        return "audio/mpeg"
    if suffix == ".wav":
        return "audio/wav"
    return "application/octet-stream"


def _resolve_mime_type(suffix: str, mime_type_hint: str | None) -> str:
    if suffix in SUPPORTED_AUDIO_EXTENSIONS:
        return _guess_mime_type(suffix)

    if mime_type_hint:
        normalized = mime_type_hint.strip().lower()
        if normalized.startswith("audio/") or normalized.startswith("video/"):
            return normalized

    raise ValueError(
        f"Unsupported file extension '{suffix}'. Supported: {sorted(SUPPORTED_AUDIO_EXTENSIONS)}"
    )


def _clamp_int(value: Any, low: int, high: int, default: int) -> int:
    try:
        num = int(value)
    except (TypeError, ValueError):
        return default
    return max(low, min(high, num))


def _parse_int_env(name: str, default: int) -> int:
    try:
        return int(os.getenv(name, str(default)))
    except (TypeError, ValueError):
        return default


def _wait_for_file_active(
    client: genai.Client,
    file_name: str,
    timeout_seconds: int | None = None,
) -> Any:
    timeout = (
        timeout_seconds
        if timeout_seconds is not None
        else _parse_int_env("GEMINI_FILE_PROCESS_TIMEOUT_SECONDS", default=180)
    )
    timeout = max(timeout, 5)
    poll_interval_seconds = _parse_int_env("GEMINI_FILE_PROCESS_POLL_SECONDS", default=2)
    poll_interval_seconds = max(poll_interval_seconds, 1)

    deadline = time.time() + timeout
    latest = None
    while time.time() < deadline:
        latest = client.files.get(name=file_name)
        state = _normalize_file_state(getattr(latest, "state", None))
        if state == "ACTIVE":
            return latest
        if state == "FAILED":
            error_obj = getattr(latest, "error", None)
            error_message = getattr(error_obj, "message", "") if error_obj else ""
            raise RuntimeError(
                "Gemini file processing failed before analysis. "
                f"File: {file_name}. {error_message}".strip()
            )
        time.sleep(poll_interval_seconds)

    state = _normalize_file_state(getattr(latest, "state", None))
    raise TimeoutError(
        "Timed out waiting for uploaded media to become ACTIVE in Gemini Files API. "
        f"File: {file_name}, last state: {state or 'unknown'}. "
        "Try again or increase GEMINI_FILE_PROCESS_TIMEOUT_SECONDS."
    )


def _to_media_part_from_uploaded_file(
    file_obj: Any,
    fallback_mime_type: str,
) -> Any:
    file_uri = str(getattr(file_obj, "uri", "") or "").strip()
    file_mime = str(getattr(file_obj, "mime_type", "") or "").strip().lower()
    if file_uri:
        return types.Part.from_uri(file_uri=file_uri, mime_type=file_mime or fallback_mime_type)
    return file_obj


def _generate_content_with_active_retry(
    client: genai.Client,
    model_name: str,
    prompt: str,
    media_input: Any,
    thinking_budget: int,
    uploaded_file_name: str,
    mime_type: str,
) -> Any:
    retry_attempts = _parse_int_env("GEMINI_ACTIVE_RETRY_ATTEMPTS", default=5)
    retry_delay_seconds = _parse_int_env("GEMINI_ACTIVE_RETRY_DELAY_SECONDS", default=2)
    retry_attempts = max(retry_attempts, 1)
    retry_delay_seconds = max(retry_delay_seconds, 1)

    current_media_input = media_input
    for attempt in range(1, retry_attempts + 1):
        try:
            return client.models.generate_content(
                model=model_name,
                contents=[prompt, current_media_input],
                config=types.GenerateContentConfig(
                    system_instruction=SYSTEM_INSTRUCTION,
                    response_mime_type="application/json",
                    temperature=0.1,
                    thinking_config=types.ThinkingConfig(thinking_budget=thinking_budget),
                ),
            )
        except Exception as exc:
            if (
                not uploaded_file_name
                or not _is_not_active_precondition_error(exc)
                or attempt >= retry_attempts
            ):
                raise

            time.sleep(retry_delay_seconds * attempt)
            active_file = _wait_for_file_active(
                client,
                file_name=uploaded_file_name,
                timeout_seconds=max(30, retry_delay_seconds * 10),
            )
            current_media_input = _to_media_part_from_uploaded_file(
                active_file,
                fallback_mime_type=mime_type,
            )

    raise RuntimeError("Unreachable retry state while generating content.")


def _is_not_active_precondition_error(exc: Exception) -> bool:
    text = str(exc)
    lowered = text.lower()
    return "failed_precondition" in lowered and "not in an active state" in lowered


def _normalize_file_state(state: Any) -> str:
    if state is None:
        return ""
    value = getattr(state, "value", None)
    if value:
        return str(value).upper()
    text = str(state).upper().strip()
    if text.startswith("FILESTATE."):
        text = text.split(".", 1)[1]
    return text
