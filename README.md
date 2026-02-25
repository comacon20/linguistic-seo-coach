# Linguistic SEO Coach (Vercel Edition)

Vercel-native app for fluency and SEO communication coaching.

## Architecture

- Frontend: Next.js 15 (React, TypeScript)
- API: Next.js Route Handlers (`/app/api/...`) running on Vercel Functions
- AI Engine: `@google/genai` (Gemini, Thinking Mode enabled)
- Data source: Google Drive API (`googleapis`) for latest meeting recording
- Trend storage: browser localStorage (client-side historical score tracking)

## Features

- Transcript analysis mode
  - Paste transcript or upload `.txt/.md/.srt/.vtt`
  - Leadership Clarity Score
  - Words to Practice with phonetic tips
  - Professional composition rewrites
  - SEO term clarity feedback
- Drive latest recording mode
  - Scans `Meet Recordings` (supports nested folders + shortcuts)
  - Pulls newest media file and analyzes via Gemini
- Modern UX dashboard
  - Responsive layout
  - Animated sections
  - Historical trend chart

## Project Structure

- `app/page.tsx`: main dashboard UI
- `app/api/analyze-transcript/route.ts`: transcript analysis endpoint
- `app/api/analyze-drive-latest/route.ts`: Drive latest recording endpoint
- `app/api/health/route.ts`: health check endpoint
- `lib/server/gemini.ts`: Gemini analysis + file ACTIVE-state retry handling
- `lib/server/drive.ts`: Drive auth, folder resolution, media discovery/download
- `lib/server/report-parser.ts`: robust JSON parsing/normalization
- `lib/types.ts`: shared app types

## Local Development

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000)

## Required Environment Variables

Set these in `.env.local` for local dev and in Vercel Project Settings for production.

```bash
# Gemini
GOOGLE_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-3-flash-preview
GEMINI_THINKING_BUDGET=1024
GEMINI_MAX_INLINE_BYTES=18000000

# Drive credentials (recommended for Vercel)
GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON={"type":"service_account",...}

# Optional local fallback (not recommended on Vercel)
# GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE=/absolute/path/service-account.json

# Optional Drive defaults for UI
MEET_RECORDINGS_FOLDER=Meet Recordings
MEET_RECORDINGS_FOLDER_ID=
GOOGLE_DRIVE_PARENT_FOLDER_ID=

# Optional Gemini file-processing tuning
GEMINI_FILE_PROCESS_TIMEOUT_SECONDS=300
GEMINI_FILE_PROCESS_POLL_SECONDS=2
GEMINI_ACTIVE_RETRY_ATTEMPTS=8
GEMINI_ACTIVE_RETRY_DELAY_SECONDS=2
```

## Google Drive Setup

1. Enable Google Drive API in your Google Cloud project.
2. Create a service account and JSON key.
3. Share your target Drive folder (`Meet Recordings`) with the service account email.
4. Add `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` in Vercel env vars.

## Deploy to Vercel

1. Push this repo to GitHub.
2. Import the repo in Vercel.
3. Add the environment variables above.
4. Deploy.

## Build Commands

```bash
npm run typecheck
npm run build
```

## API Endpoints

- `POST /api/analyze-transcript`
  - body: `{ transcriptText: string, sourceName?: string }`
- `POST /api/analyze-drive-latest`
  - body: `{ folderName?: string, parentFolderId?: string, folderIdOverride?: string }`
- `GET /api/health`

## Security Notes

- Never commit `.env.local` or service-account JSON files.
- Keep API keys and service account JSON in Vercel encrypted environment variables.
- Use least-privilege access and rotate credentials regularly.
