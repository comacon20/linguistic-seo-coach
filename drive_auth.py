from __future__ import annotations

import json
import logging
import os
from collections import deque
from dataclasses import dataclass
from pathlib import Path
from typing import Any

from dotenv import load_dotenv
from google.auth.transport.requests import Request
from google.oauth2 import service_account
from google.oauth2.credentials import Credentials as UserCredentials
from googleapiclient.discovery import Resource, build
from googleapiclient.http import MediaIoBaseDownload
from google_auth_oauthlib.flow import InstalledAppFlow

SCOPES = ("https://www.googleapis.com/auth/drive.readonly",)
WATCH_STATE_FILE = Path(".cache/drive_watch_state.json")
SUPPORTED_RECORDING_EXTENSIONS = {".mp4", ".m4a", ".mp3", ".wav", ".webm", ".mov"}
EXPLICIT_SUPPORTED_MIME_TYPES = {"video/mp4", "audio/mp4", "audio/x-m4a"}
FOLDER_MIME_TYPE = "application/vnd.google-apps.folder"
SHORTCUT_MIME_TYPE = "application/vnd.google-apps.shortcut"

LOGGER = logging.getLogger(__name__)


@dataclass(frozen=True)
class DriveMediaFile:
    id: str
    name: str
    mime_type: str
    created_time: str
    modified_time: str
    size_bytes: int
    web_view_link: str

    @staticmethod
    def from_api_record(record: dict[str, Any]) -> "DriveMediaFile":
        raw_size = record.get("size", 0)
        try:
            size_bytes = int(raw_size)
        except (TypeError, ValueError):
            size_bytes = 0

        return DriveMediaFile(
            id=record["id"],
            name=record["name"],
            mime_type=record.get("mimeType", "application/octet-stream"),
            created_time=record.get("createdTime", ""),
            modified_time=record.get("modifiedTime", ""),
            size_bytes=size_bytes,
            web_view_link=record.get("webViewLink", ""),
        )


def build_drive_service() -> Resource:
    """Build a Google Drive API client using service account or OAuth credentials."""
    load_dotenv()
    credentials = _load_service_account_credentials()
    if credentials is None:
        credentials = _load_oauth_credentials()

    return build("drive", "v3", credentials=credentials, cache_discovery=False)


def resolve_meet_recordings_folder_id(
    drive_service: Resource,
    folder_name: str = "Meet Recordings",
    parent_folder_id: str | None = None,
) -> str:
    """Find the folder ID for the Meet Recordings folder."""
    sanitized_name = folder_name.replace("'", "\\'")
    query = [
        f"name = '{sanitized_name}'",
        f"mimeType = '{FOLDER_MIME_TYPE}'",
        "trashed = false",
    ]
    if parent_folder_id:
        query.append(f"'{parent_folder_id}' in parents")

    response = (
        drive_service.files()
        .list(
            q=" and ".join(query),
            spaces="drive",
            fields="files(id, name, modifiedTime)",
            orderBy="modifiedTime desc",
            pageSize=10,
            supportsAllDrives=True,
            includeItemsFromAllDrives=True,
        )
        .execute()
    )

    folders = response.get("files", [])
    if not folders:
        raise FileNotFoundError(f"Folder '{folder_name}' was not found in Google Drive.")

    if len(folders) > 1:
        LOGGER.warning(
            "Multiple folders named '%s' found. Using the most recently modified one: %s",
            folder_name,
            folders[0]["id"],
        )

    return folders[0]["id"]


def list_recordings(
    drive_service: Resource,
    folder_id: str,
    page_size: int = 200,
    recursive: bool = True,
) -> list[DriveMediaFile]:
    """List supported media files from a folder, including nested folders and shortcuts."""
    seen_file_ids: set[str] = set()
    visited_folders: set[str] = set()
    folders_to_visit = deque([folder_id])
    results: list[DriveMediaFile] = []

    while folders_to_visit:
        current_folder = folders_to_visit.popleft()
        if current_folder in visited_folders:
            continue
        visited_folders.add(current_folder)

        for record in _list_folder_children(
            drive_service=drive_service,
            folder_id=current_folder,
            page_size=page_size,
        ):
            mime_type = str(record.get("mimeType", "")).lower()
            if mime_type == FOLDER_MIME_TYPE:
                if recursive:
                    folders_to_visit.append(str(record.get("id", "")))
                continue

            resolved = _resolve_shortcut_target_record(drive_service, record)
            if resolved is None or not _is_supported_media_record(resolved):
                continue

            file_id = str(resolved.get("id", ""))
            if not file_id or file_id in seen_file_ids:
                continue
            seen_file_ids.add(file_id)
            results.append(DriveMediaFile.from_api_record(resolved))

        if not recursive:
            break

    results.sort(key=lambda item: item.modified_time or "", reverse=True)
    return results


def get_most_recent_recording(
    drive_service: Resource,
    folder_id: str,
) -> DriveMediaFile | None:
    files = list_recordings(drive_service=drive_service, folder_id=folder_id, page_size=200)
    return files[0] if files else None


def get_latest_recording_if_changed(
    drive_service: Resource,
    folder_id: str,
    state_file: Path = WATCH_STATE_FILE,
) -> tuple[DriveMediaFile | None, bool]:
    """
    Lightweight watcher behavior:
    - Reads previously processed file version from disk.
    - Returns (latest_file, is_new_since_last_check).
    """
    latest = get_most_recent_recording(drive_service=drive_service, folder_id=folder_id)
    if latest is None:
        return None, False

    state = _load_watch_state(state_file)
    previous = state.get(folder_id)
    current_version = f"{latest.id}:{latest.modified_time}"
    changed = previous != current_version

    if changed:
        state[folder_id] = current_version
        _save_watch_state(state_file, state)

    return latest, changed


def download_drive_file(
    drive_service: Resource,
    file_id: str,
    destination_path: Path,
) -> Path:
    destination_path.parent.mkdir(parents=True, exist_ok=True)
    request = drive_service.files().get_media(fileId=file_id, supportsAllDrives=True)

    with destination_path.open("wb") as output_file:
        downloader = MediaIoBaseDownload(output_file, request, chunksize=5 * 1024 * 1024)
        done = False
        while not done:
            _, done = downloader.next_chunk()

    return destination_path


def download_most_recent_recording(
    drive_service: Resource,
    folder_id: str,
    destination_dir: Path,
) -> tuple[DriveMediaFile, Path]:
    media_file = get_most_recent_recording(drive_service=drive_service, folder_id=folder_id)
    if media_file is None:
        raise FileNotFoundError(
            "No supported media files found in the configured folder. "
            "Expected common recording types like .mp4/.m4a/.webm/.mov."
        )

    safe_name = "".join(ch for ch in media_file.name if ch.isalnum() or ch in ("-", "_", "."))
    local_path = destination_dir / f"{media_file.id}_{safe_name}"
    downloaded = download_drive_file(drive_service, media_file.id, local_path)
    return media_file, downloaded


def _load_service_account_credentials():
    raw_service_json = os.getenv("GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON")
    if raw_service_json:
        try:
            service_info = json.loads(raw_service_json)
            return service_account.Credentials.from_service_account_info(
                service_info, scopes=SCOPES
            )
        except json.JSONDecodeError as exc:
            raise ValueError(
                "GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is set but is not valid JSON."
            ) from exc

    service_file = os.getenv("GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE")
    if service_file and Path(service_file).exists():
        return service_account.Credentials.from_service_account_file(
            service_file,
            scopes=SCOPES,
        )

    return None


def _load_oauth_credentials() -> UserCredentials:
    token_file = Path(os.getenv("GOOGLE_DRIVE_TOKEN_FILE", "token.json"))
    client_secrets_file = Path(
        os.getenv("GOOGLE_DRIVE_OAUTH_CLIENT_SECRETS", "credentials.json")
    )

    creds = None
    if token_file.exists():
        creds = UserCredentials.from_authorized_user_file(str(token_file), SCOPES)

    if creds and creds.valid:
        return creds

    if creds and creds.expired and creds.refresh_token:
        creds.refresh(Request())
        _persist_token(token_file, creds)
        return creds

    if not client_secrets_file.exists():
        raise FileNotFoundError(
            "Google Drive credentials not found. Provide service-account credentials via "
            "GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON / GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE, or add "
            "an OAuth client secrets file as credentials.json."
        )

    flow = InstalledAppFlow.from_client_secrets_file(str(client_secrets_file), SCOPES)
    try:
        creds = flow.run_local_server(port=0)
    except OSError:
        # Headless environments can use interactive console fallback.
        creds = flow.run_console()

    _persist_token(token_file, creds)
    return creds


def _persist_token(token_file: Path, creds: UserCredentials) -> None:
    token_file.parent.mkdir(parents=True, exist_ok=True)
    token_file.write_text(creds.to_json(), encoding="utf-8")


def _load_watch_state(state_file: Path) -> dict[str, str]:
    if not state_file.exists():
        return {}
    try:
        return json.loads(state_file.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        LOGGER.warning("Drive watcher state file was invalid JSON. Resetting state.")
        return {}


def _save_watch_state(state_file: Path, state: dict[str, str]) -> None:
    state_file.parent.mkdir(parents=True, exist_ok=True)
    state_file.write_text(json.dumps(state, indent=2), encoding="utf-8")


def _list_folder_children(
    drive_service: Resource,
    folder_id: str,
    page_size: int,
) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    next_page_token: str | None = None
    query = f"'{folder_id}' in parents and trashed = false"
    fields = (
        "nextPageToken, "
        "files(id, name, mimeType, createdTime, modifiedTime, size, webViewLink, "
        "shortcutDetails(targetId, targetMimeType))"
    )

    while True:
        response = (
            drive_service.files()
            .list(
                q=query,
                spaces="drive",
                fields=fields,
                orderBy="modifiedTime desc",
                pageSize=page_size,
                pageToken=next_page_token,
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
            )
            .execute()
        )
        records.extend(response.get("files", []))
        next_page_token = response.get("nextPageToken")
        if not next_page_token:
            break

    return records


def _resolve_shortcut_target_record(
    drive_service: Resource,
    record: dict[str, Any],
) -> dict[str, Any] | None:
    mime_type = str(record.get("mimeType", "")).lower()
    if mime_type != SHORTCUT_MIME_TYPE:
        return record

    shortcut = record.get("shortcutDetails") or {}
    target_id = str(shortcut.get("targetId", "")).strip()
    if not target_id:
        return None

    try:
        target = (
            drive_service.files()
            .get(
                fileId=target_id,
                fields="id, name, mimeType, createdTime, modifiedTime, size, webViewLink",
                supportsAllDrives=True,
            )
            .execute()
        )
    except Exception as exc:
        LOGGER.warning("Unable to resolve shortcut target %s: %s", target_id, exc)
        return None

    if not target.get("name"):
        target["name"] = record.get("name", "")

    return target


def _is_supported_media_record(record: dict[str, Any]) -> bool:
    name = str(record.get("name", "")).lower()
    mime_type = str(record.get("mimeType", "")).lower()

    if any(name.endswith(ext) for ext in SUPPORTED_RECORDING_EXTENSIONS):
        return True

    if mime_type in EXPLICIT_SUPPORTED_MIME_TYPES:
        return True

    if mime_type.startswith("video/") or mime_type.startswith("audio/"):
        return True

    return False
