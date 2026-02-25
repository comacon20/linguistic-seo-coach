# Linguistic SEO Coach

Automates fluency feedback for agency managers by:
- monitoring Google Drive `Meet Recordings` for new `.mp4` / `.m4a` calls,
- accepting pasted or uploaded meeting transcripts (`.txt/.md/.srt/.vtt`),
- sending raw media directly to Gemini (google-genai SDK) in Thinking Mode,
- generating coaching on pronunciation, professional language, and SEO-term clarity,
- tracking progress over time in a Streamlit dashboard.

## Tech Stack
- Frontend: Streamlit + pandas
- AI Engine: `google-genai`
- Storage: CSV history (`data/fluency_history.csv`)
- Source Ingestion: Google Drive API v3

## Project Files
- `main.py`: Streamlit dashboard and orchestration pipeline
- `engine.py`: AI analysis logic and structured output parsing
- `drive_auth.py`: Google Drive auth + latest recording detection + download helpers
- `requirements.txt`: dependencies
- `.gitignore`: protects secrets and local credentials

## 1) Prerequisites
- Python 3.10+
- Google Cloud project with:
  - Drive API enabled
  - Gemini API enabled
- One auth method for Drive:
  - Service Account (recommended for server/GitHub), or
  - OAuth client (`credentials.json`) for local interactive login

## 2) Local Setup
```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Create `.env`:
```bash
GOOGLE_API_KEY=your_gemini_api_key
GEMINI_MODEL=gemini-2.5-pro
GEMINI_THINKING_BUDGET=1024
GEMINI_MAX_INLINE_BYTES=18000000

# Optional Drive targeting
MEET_RECORDINGS_FOLDER=Meet Recordings
MEET_RECORDINGS_FOLDER_ID=
GOOGLE_DRIVE_PARENT_FOLDER_ID=

# Drive auth option A: service account (recommended for CI/CD)
GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON=
# or:
# GOOGLE_DRIVE_SERVICE_ACCOUNT_FILE=service-account.json

# Drive auth option B: OAuth local flow
GOOGLE_DRIVE_OAUTH_CLIENT_SECRETS=credentials.json
GOOGLE_DRIVE_TOKEN_FILE=token.json

# Optional app data location
APP_DATA_DIR=data
```

Run the app:
```bash
streamlit run main.py
```

## 3) Dashboard Features
- **Transcript Mode**: paste text or upload transcript files for analysis
- **Drive Mode**: analyze latest recording from Drive folder
- **Leadership Clarity Score**: score out of 100 from the latest call
- **Words to Practice**: categorized phonetic/clarity coaching with practice lines
- **Professional Composition**: grammar and executive-level rewrites
- **SEO Context**: clarity checks for terms like Crawl Budget, Entity SEO, Core Web Vitals
- **Historical Trend**: score and coaching counts over time via pandas charting

## 4) GitHub Deployment and Secrets
Use repository secrets and expose them as environment variables in your runtime:
- `GOOGLE_API_KEY`
- `GEMINI_MODEL` (optional)
- `GEMINI_THINKING_BUDGET` (optional)
- `GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON` (recommended for GitHub-hosted deploys)
- `MEET_RECORDINGS_FOLDER` or `MEET_RECORDINGS_FOLDER_ID`
- `GOOGLE_DRIVE_PARENT_FOLDER_ID` (optional)

`python-dotenv` loads local `.env`; production uses `os.getenv(...)` seamlessly.

## 5) Security Notes
- Keep `.env`, `credentials.json`, `token.json`, and service-account files out of git.
- Use least-privilege service accounts and rotate keys regularly.
- Prefer read-only Drive scope for this app (`drive.readonly`).

## 6) Operational Notes
- The app keeps a lightweight watcher state at `.cache/drive_watch_state.json`.
- Downloaded media is stored in `data/recordings/`.
- Uploaded/pasted transcript snapshots are stored in `data/transcripts/`.
- Trend history is stored in `data/fluency_history.csv`.
