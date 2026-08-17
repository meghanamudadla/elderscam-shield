# Scam Shield — Backend

FastAPI backend for Scam Shield: retrieval-augmented scam verdicts, bilingual
(English/Telugu), with a LangGraph pipeline and community reports.

## Setup

```bash
cd backend
pip install -r requirements.txt
copy .env.example .env      # then optionally set GROQ_API_KEY
uvicorn app.main:app --reload
```

The app runs at <http://127.0.0.1:8000>. Docs (auto-generated): <http://127.0.0.1:8000/docs>.

## Environment

| Variable       | Required | Purpose                                                            |
|----------------|----------|--------------------------------------------------------------------|
| `GROQ_API_KEY` | optional | If set, verdicts come from Groq's `openai/gpt-oss-120b`. If unset, the deterministic offline mock reasoner is used (fully functional for demo/testing — no network needed). |

## Endpoints

| Method | Path             | Description                                                        |
|--------|------------------|--------------------------------------------------------------------|
| GET    | `/health`        | Liveness check → `{"status": "ok"}`                                |
| POST   | `/analyze`       | Body `{"message": "...", "language": "en"\|"te"}` → verdict JSON. 400 on empty message. |
| POST   | `/speak`         | Body `{"message": "...", "language": "en"\|"te"}` → MP3 audio of the message (gTTS). 503 on TTS failure. |
| POST   | `/reports`       | Body `{"snippet": "..." (≤200 chars), "verdict": "..."}` → `{"count": N}` |
| GET    | `/reports?limit=5` | Most recent community reports first.                              |

## Tests

```bash
cd backend
python tests/test_pipeline.py        # standalone
pytest tests/test_pipeline.py        # or via pytest
```

Runs 4 cases through the full pipeline: KYC-urgency scam, safe bill,
digital-arrest scam, and a Telugu scam message, plus two Telugu-conformance
checks.

## External network dependencies

Both `/speak` (gTTS) and Telugu translation (deep-translator) call external
Google-hosted endpoints over the internet. On a machine with no internet
access — or a network that blocks translate.google.com — they will fail.
This is expected behaviour, not a bug in the code; fallbacks exist for
exactly this case:

- Telugu translation fails safe: `translate.py` returns the English text
  unchanged on any error, so the app stays fully usable (English content
  instead of Telugu, never a crash).
- `/speak` returns HTTP 503 with a JSON body. The frontend then falls back
  to the browser's built-in speech synthesis, and if no matching-language
  voice exists, to a short inline note pointing at the written explanation.

## Real vs. placeholder

| Component             | What it actually is                                  | Production upgrade          |
|-----------------------|------------------------------------------------------|-----------------------------|
| Retrieval             | scikit-learn TF-IDF + cosine similarity over ~13 KB patterns | Vector DB (e.g. pgvector, Qdrant) with embeddings |
| Knowledge base        | Static in-code list of curated patterns              | Managed, versioned dataset with admin UI |
| Verdicts (no key set) | Deterministic keyword+TF-IDF heuristic mock reasoner | Groq LLM when `GROQ_API_KEY` is set |
| Community reports     | In-memory Python list (lost on restart)              | PostgreSQL + rate limiting  |
| CORS                  | Allow-all (dev only)                                 | Explicit origin allowlist   |