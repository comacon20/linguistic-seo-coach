from __future__ import annotations

import json
import os
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import pandas as pd
import streamlit as st
from dotenv import load_dotenv

from drive_auth import (
    build_drive_service,
    download_drive_file,
    get_latest_recording_if_changed,
    resolve_meet_recordings_folder_id,
)
from engine import LinguisticReport, analyze_audio_file, analyze_transcript_text

load_dotenv()

DATA_DIR = Path(os.getenv("APP_DATA_DIR", "data"))
DOWNLOADS_DIR = DATA_DIR / "recordings"
TRANSCRIPTS_DIR = DATA_DIR / "transcripts"
HISTORY_FILE = DATA_DIR / "fluency_history.csv"

HISTORY_COLUMNS = [
    "analyzed_at",
    "file_id",
    "file_name",
    "file_mime_type",
    "file_modified_time",
    "local_path",
    "leadership_clarity_score",
    "executive_summary",
    "words_to_practice_count",
    "professional_composition_count",
    "seo_context_count",
    "next_actions_json",
    "model_used",
]


def _bootstrap_dirs() -> None:
    DOWNLOADS_DIR.mkdir(parents=True, exist_ok=True)
    TRANSCRIPTS_DIR.mkdir(parents=True, exist_ok=True)
    HISTORY_FILE.parent.mkdir(parents=True, exist_ok=True)


def _sanitize_filename(name: str) -> str:
    sanitized = "".join(ch for ch in name if ch.isalnum() or ch in ("-", "_", "."))
    return sanitized or "recording.mp4"


def _ensure_media_extension(name: str, mime_type: str) -> str:
    if Path(name).suffix:
        return name

    mime = (mime_type or "").lower()
    extension_map = {
        "video/mp4": ".mp4",
        "audio/mp4": ".m4a",
        "audio/x-m4a": ".m4a",
        "audio/mpeg": ".mp3",
        "audio/wav": ".wav",
        "audio/wave": ".wav",
        "video/webm": ".webm",
        "video/quicktime": ".mov",
    }
    return f"{name}{extension_map.get(mime, '')}"


def _load_history() -> pd.DataFrame:
    if not HISTORY_FILE.exists():
        return pd.DataFrame(columns=HISTORY_COLUMNS)

    history = pd.read_csv(HISTORY_FILE)
    for column in HISTORY_COLUMNS:
        if column not in history.columns:
            history[column] = None
    return history[HISTORY_COLUMNS]


def _save_history(history: pd.DataFrame) -> None:
    history.to_csv(HISTORY_FILE, index=False)


def _append_history(
    report: LinguisticReport,
    source_id: str,
    source_name: str,
    source_mime_type: str,
    source_modified_time: str,
    local_path: str,
) -> None:
    history = _load_history()
    row = {
        "analyzed_at": datetime.now(timezone.utc).isoformat(),
        "file_id": source_id,
        "file_name": source_name,
        "file_mime_type": source_mime_type,
        "file_modified_time": source_modified_time,
        "local_path": local_path,
        "leadership_clarity_score": report.leadership_clarity_score,
        "executive_summary": report.executive_summary,
        "words_to_practice_count": len(report.words_to_practice),
        "professional_composition_count": len(report.professional_composition),
        "seo_context_count": len(report.seo_context),
        "next_actions_json": json.dumps(report.next_actions),
        "model_used": report.model_used,
    }
    history = pd.concat([history, pd.DataFrame([row])], ignore_index=True)
    _save_history(history)


def _render_report(report: LinguisticReport, source_name: str, source_modified_time: str) -> None:
    st.subheader("Latest Analysis")
    if source_modified_time:
        st.caption(f"Source: {source_name} ({source_modified_time})")
    else:
        st.caption(f"Source: {source_name}")

    top_left, top_mid, top_right = st.columns([1, 1, 2])
    top_left.metric("Leadership Clarity Score", f"{report.leadership_clarity_score}/100")
    top_mid.metric("Words to Practice", len(report.words_to_practice))
    top_right.markdown(f"**Executive Summary**\n\n{report.executive_summary or 'No summary returned.'}")

    st.progress(max(0, min(100, report.leadership_clarity_score)) / 100)

    st.subheader("Words to Practice")
    if report.words_to_practice:
        words_df = pd.DataFrame(
            [
                {
                    "Category": item.category,
                    "Term": item.term,
                    "Risk": item.risk,
                    "Phonetic Tip": item.phonetic_tip,
                    "Practice Sentence": item.practice_sentence,
                }
                for item in report.words_to_practice
            ]
        )
        for category in words_df["Category"].dropna().unique():
            st.markdown(f"**{category}**")
            st.dataframe(
                words_df[words_df["Category"] == category].drop(columns=["Category"]),
                use_container_width=True,
                hide_index=True,
            )
    else:
        st.info("No words-to-practice suggestions returned.")

    st.subheader("Professional Composition")
    if report.professional_composition:
        composition_df = pd.DataFrame(
            [
                {
                    "Issue": item.original_issue,
                    "Executive Rewrite": item.executive_rewrite,
                    "Why Better": item.reason,
                }
                for item in report.professional_composition
            ]
        )
        st.dataframe(composition_df, use_container_width=True, hide_index=True)
    else:
        st.info("No professional composition feedback returned.")

    st.subheader("SEO Context Clarity")
    if report.seo_context:
        seo_df = pd.DataFrame(
            [
                {
                    "Term": item.term,
                    "Clarity (1-5)": item.clarity_score,
                    "Feedback": item.feedback,
                    "Client-Friendly Version": item.client_friendly_version,
                }
                for item in report.seo_context
            ]
        )
        st.dataframe(seo_df, use_container_width=True, hide_index=True)
    else:
        st.info("No SEO context feedback returned.")

    st.subheader("Next Actions")
    if report.next_actions:
        for action in report.next_actions:
            st.write(f"- {action}")
    else:
        st.info("No next actions returned.")


def _render_trend_chart() -> None:
    history = _load_history()
    if history.empty:
        st.info("No historical data yet. Run your first analysis.")
        return

    trend = history.copy()
    trend["analyzed_at"] = pd.to_datetime(trend["analyzed_at"], errors="coerce", utc=True)
    numeric_columns = [
        "leadership_clarity_score",
        "words_to_practice_count",
        "professional_composition_count",
        "seo_context_count",
    ]
    for col in numeric_columns:
        trend[col] = pd.to_numeric(trend[col], errors="coerce")
    trend = trend.dropna(subset=["analyzed_at", "leadership_clarity_score"])
    trend = trend.sort_values("analyzed_at")
    if trend.empty:
        st.info("Historical rows exist but do not contain chartable score data.")
        return

    st.line_chart(
        trend.set_index("analyzed_at")[
            ["leadership_clarity_score", "words_to_practice_count", "seo_context_count"]
        ]
    )

    recent = trend.tail(10)[
        [
            "analyzed_at",
            "file_name",
            "leadership_clarity_score",
            "words_to_practice_count",
            "professional_composition_count",
            "seo_context_count",
        ]
    ]
    st.dataframe(recent, use_container_width=True, hide_index=True)


def _run_pipeline(folder_name: str, parent_folder_id: str, folder_id_override: str) -> None:
    with st.spinner("Connecting to Google Drive..."):
        drive_service = build_drive_service()
        folder_id = folder_id_override.strip() or resolve_meet_recordings_folder_id(
            drive_service=drive_service,
            folder_name=folder_name,
            parent_folder_id=parent_folder_id.strip() or None,
        )
        latest, is_new = get_latest_recording_if_changed(drive_service, folder_id)

    if latest is None:
        st.warning(
            "No supported media recording found in the configured folder "
            "(.mp4/.m4a/.webm/.mov/.mp3/.wav), including nested folders and shortcuts."
        )
        return

    if not is_new:
        st.info("No new recording detected since the previous check. Re-analyzing the latest file.")

    drive_name = _ensure_media_extension(latest.name, latest.mime_type)
    local_name = f"{latest.id}_{_sanitize_filename(drive_name)}"
    local_path = DOWNLOADS_DIR / local_name

    with st.spinner("Downloading latest recording..."):
        download_drive_file(drive_service, latest.id, local_path)

    with st.spinner("Running AI fluency analysis..."):
        report = analyze_audio_file(
            str(local_path),
            mime_type_hint=latest.mime_type,
            source_name=latest.name,
        )

    _append_history(
        report=report,
        source_id=latest.id,
        source_name=latest.name,
        source_mime_type=latest.mime_type,
        source_modified_time=latest.modified_time,
        local_path=str(local_path),
    )
    _set_latest_result(
        report=report,
        source_name=latest.name,
        source_modified_time=latest.modified_time,
    )
    st.success("Analysis complete and saved to history.")


def _decode_uploaded_text(uploaded: Any) -> str:
    payload = uploaded.getvalue()
    for encoding in ("utf-8-sig", "utf-16", "latin-1"):
        try:
            return payload.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise ValueError("Unable to decode uploaded transcript file. Use UTF-8 text.")


def _clean_transcript_text(raw_text: str) -> str:
    cleaned_lines: list[str] = []
    for line in raw_text.splitlines():
        value = line.strip()
        if not value:
            continue
        if value.upper() == "WEBVTT":
            continue
        if "-->" in value:
            continue
        if re.fullmatch(r"\d+", value):
            continue
        cleaned_lines.append(value)
    return "\n".join(cleaned_lines).strip()


def _set_latest_result(
    report: LinguisticReport,
    source_name: str,
    source_modified_time: str,
) -> None:
    st.session_state["latest_report"] = report
    st.session_state["latest_source"] = {
        "name": source_name,
        "modified_time": source_modified_time,
    }


def _run_transcript_pipeline(transcript_text: str, source_name: str) -> None:
    cleaned = _clean_transcript_text(transcript_text)
    if not cleaned:
        raise ValueError("Transcript is empty after removing timestamps/blank lines.")

    timestamp = datetime.now(timezone.utc).isoformat()
    transcript_path = TRANSCRIPTS_DIR / f"{int(datetime.now(timezone.utc).timestamp())}_{source_name}"
    transcript_path.write_text(cleaned, encoding="utf-8")

    with st.spinner("Running AI transcript analysis..."):
        report = analyze_transcript_text(cleaned, source_name=source_name)

    _append_history(
        report=report,
        source_id=f"transcript-{int(datetime.now(timezone.utc).timestamp())}",
        source_name=source_name,
        source_mime_type="text/plain",
        source_modified_time=timestamp,
        local_path=str(transcript_path),
    )
    _set_latest_result(report=report, source_name=source_name, source_modified_time=timestamp)
    st.success("Transcript analysis complete and saved to history.")


def main() -> None:
    _bootstrap_dirs()

    st.set_page_config(page_title="Linguistic SEO Coach", layout="wide")
    st.title("Linguistic SEO Coach")
    st.caption("Automated English fluency feedback for agency managers.")

    with st.sidebar:
        st.header("Analysis Source")
        analysis_mode = st.radio(
            "Input mode",
            options=("Transcript", "Latest Drive Recording"),
            index=0,
        )

        folder_name = ""
        parent_folder_id = ""
        folder_id_override = ""
        transcript_source_name = "pasted-transcript.txt"
        transcript_body = ""

        if analysis_mode == "Latest Drive Recording":
            folder_name = st.text_input(
                "Meet recordings folder name",
                value=os.getenv("MEET_RECORDINGS_FOLDER", "Meet Recordings"),
            )
            parent_folder_id = st.text_input(
                "Parent folder ID (optional)",
                value=os.getenv("GOOGLE_DRIVE_PARENT_FOLDER_ID", ""),
            )
            folder_id_override = st.text_input(
                "Folder ID override (optional)",
                value=os.getenv("MEET_RECORDINGS_FOLDER_ID", ""),
            )
            run_now = st.button(
                "Analyze Latest Recording", type="primary", use_container_width=True
            )
        else:
            uploaded = st.file_uploader(
                "Upload transcript file",
                type=["txt", "md", "srt", "vtt"],
                help="Plain text, markdown, SRT, or VTT supported.",
            )
            transcript_body = st.text_area(
                "Or paste transcript text",
                height=220,
                placeholder="Paste your meeting transcript here...",
            )
            if uploaded is not None:
                transcript_source_name = uploaded.name
                transcript_body = _decode_uploaded_text(uploaded)
            run_now = st.button("Analyze Transcript", type="primary", use_container_width=True)

    if run_now:
        try:
            if analysis_mode == "Latest Drive Recording":
                _run_pipeline(
                    folder_name=folder_name,
                    parent_folder_id=parent_folder_id,
                    folder_id_override=folder_id_override,
                )
            else:
                _run_transcript_pipeline(
                    transcript_text=transcript_body,
                    source_name=_sanitize_filename(transcript_source_name),
                )
        except Exception as exc:
            st.exception(exc)

    latest_report = st.session_state.get("latest_report")
    latest_source = st.session_state.get("latest_source")
    if isinstance(latest_report, LinguisticReport) and isinstance(latest_source, dict):
        _render_report(
            latest_report,
            source_name=str(latest_source.get("name", "unknown-source")),
            source_modified_time=str(latest_source.get("modified_time", "")),
        )
    else:
        st.info("Choose Transcript or Drive mode, then run an analysis.")

    st.subheader("Historical Fluency Trend")
    _render_trend_chart()


if __name__ == "__main__":
    main()
