import {promises as fs} from 'fs';

import {google, type drive_v3} from 'googleapis';

import type {SourceMetadata} from '@/lib/types';

const DRIVE_SCOPE = ['https://www.googleapis.com/auth/drive.readonly'];
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const SHORTCUT_MIME = 'application/vnd.google-apps.shortcut';
const SUPPORTED_EXTENSIONS = ['.mp4', '.m4a', '.mp3', '.wav', '.mov', '.webm'];
const EXPLICIT_MIMES = ['video/mp4', 'audio/mp4', 'audio/x-m4a', 'audio/mpeg', 'audio/wav'];

export interface LatestDriveMediaResult {
  source: SourceMetadata;
  mimeType: string;
  data: Buffer;
}

export async function getLatestMediaFromDrive(params: {
  folderName?: string;
  parentFolderId?: string;
  folderIdOverride?: string;
}): Promise<LatestDriveMediaResult> {
  const drive = await createDriveClient();
  const folderId =
    params.folderIdOverride?.trim() ||
    (await resolveMeetRecordingsFolderId(drive, {
      folderName: params.folderName || 'Meet Recordings',
      parentFolderId: params.parentFolderId,
    }));

  const latest = await findMostRecentSupportedMedia(drive, folderId);
  if (!latest) {
    throw new Error(
      'No supported recording found in the configured Drive folder (.mp4/.m4a/.mp3/.wav/.mov/.webm).',
    );
  }

  const mediaResponse = await drive.files.get(
    {
      fileId: latest.id,
      alt: 'media',
      supportsAllDrives: true,
    },
    {
      responseType: 'arraybuffer',
    },
  );

  const bytes = toBuffer(mediaResponse.data);

  return {
    source: latest,
    mimeType: latest.mimeType || 'application/octet-stream',
    data: bytes,
  };
}

async function createDriveClient(): Promise<drive_v3.Drive> {
  const credentials = await loadDriveCredentials();

  const auth = new google.auth.GoogleAuth({
    credentials,
    scopes: DRIVE_SCOPE,
  });

  return google.drive({version: 'v3', auth});
}

async function loadDriveCredentials(): Promise<Record<string, unknown>> {
  const rawJson = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  if (rawJson?.trim()) {
    try {
      return JSON.parse(rawJson);
    } catch {
      throw new Error('GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON is not valid JSON.');
    }
  }

  const credentialsPath = process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE;
  if (credentialsPath?.trim()) {
    const content = await fs.readFile(credentialsPath, 'utf8');
    return JSON.parse(content);
  }

  throw new Error(
    'Missing Drive credentials. Set GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON (recommended for Vercel) or GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE.',
  );
}

async function resolveMeetRecordingsFolderId(
  drive: drive_v3.Drive,
  options: {folderName: string; parentFolderId?: string},
): Promise<string> {
  const escaped = options.folderName.replace(/'/g, "\\'");
  const queryParts = [
    `name = '${escaped}'`,
    `mimeType = '${FOLDER_MIME}'`,
    'trashed = false',
  ];

  if (options.parentFolderId?.trim()) {
    queryParts.push(`'${options.parentFolderId.trim()}' in parents`);
  }

  const result = await drive.files.list({
    q: queryParts.join(' and '),
    orderBy: 'modifiedTime desc',
    pageSize: 10,
    fields: 'files(id, name, modifiedTime)',
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  const folder = result.data.files?.[0];
  if (!folder?.id) {
    throw new Error(`Folder '${options.folderName}' was not found in Google Drive.`);
  }

  return folder.id;
}

async function findMostRecentSupportedMedia(
  drive: drive_v3.Drive,
  folderId: string,
): Promise<SourceMetadata | null> {
  const seen = new Set<string>();
  const queue: string[] = [folderId];
  const candidates: SourceMetadata[] = [];

  while (queue.length > 0) {
    const currentFolder = queue.shift();
    if (!currentFolder) {
      continue;
    }

    const children = await listFolderChildren(drive, currentFolder);
    for (const child of children) {
      const mimeType = String(child.mimeType || '').toLowerCase();

      if (mimeType === FOLDER_MIME && child.id) {
        queue.push(child.id);
        continue;
      }

      const resolved = await resolveShortcutIfNeeded(drive, child);
      if (!resolved?.id || seen.has(resolved.id)) {
        continue;
      }

      if (!isSupportedMedia(resolved)) {
        continue;
      }

      seen.add(resolved.id);
      candidates.push(toSourceMetadata(resolved));
    }
  }

  if (!candidates.length) {
    return null;
  }

  candidates.sort((a, b) => b.modifiedTime.localeCompare(a.modifiedTime));
  return candidates[0] || null;
}

async function listFolderChildren(
  drive: drive_v3.Drive,
  folderId: string,
): Promise<drive_v3.Schema$File[]> {
  const files: drive_v3.Schema$File[] = [];
  let pageToken: string | undefined;

  do {
    const response = await drive.files.list({
      q: `'${folderId}' in parents and trashed = false`,
      pageSize: 200,
      pageToken,
      fields:
        'nextPageToken, files(id, name, mimeType, size, modifiedTime, webViewLink, shortcutDetails(targetId, targetMimeType))',
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
      orderBy: 'modifiedTime desc',
    });

    files.push(...(response.data.files || []));
    pageToken = response.data.nextPageToken || undefined;
  } while (pageToken);

  return files;
}

async function resolveShortcutIfNeeded(
  drive: drive_v3.Drive,
  file: drive_v3.Schema$File,
): Promise<drive_v3.Schema$File | null> {
  const mimeType = String(file.mimeType || '').toLowerCase();
  if (mimeType !== SHORTCUT_MIME) {
    return file;
  }

  const targetId = file.shortcutDetails?.targetId;
  if (!targetId) {
    return null;
  }

  try {
    const target = await drive.files.get({
      fileId: targetId,
      fields: 'id, name, mimeType, size, modifiedTime, webViewLink',
      supportsAllDrives: true,
    });

    return target.data || null;
  } catch {
    return null;
  }
}

function isSupportedMedia(file: drive_v3.Schema$File): boolean {
  const mimeType = String(file.mimeType || '').toLowerCase();
  const fileName = String(file.name || '').toLowerCase();

  if (mimeType.startsWith('video/') || mimeType.startsWith('audio/')) {
    return true;
  }

  if (EXPLICIT_MIMES.includes(mimeType)) {
    return true;
  }

  return SUPPORTED_EXTENSIONS.some((ext) => fileName.endsWith(ext));
}

function toSourceMetadata(file: drive_v3.Schema$File): SourceMetadata {
  return {
    id: String(file.id || ''),
    name: String(file.name || 'meeting-recording'),
    mimeType: String(file.mimeType || 'application/octet-stream'),
    modifiedTime: String(file.modifiedTime || new Date().toISOString()),
    sizeBytes: Number(file.size || 0),
    webViewLink: String(file.webViewLink || ''),
  };
}

function toBuffer(value: unknown): Buffer {
  if (Buffer.isBuffer(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return Buffer.from(value);
  }
  return Buffer.from(value as ArrayBuffer);
}
