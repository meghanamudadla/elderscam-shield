# Scam Shield

A bilingual (English / తెలుగు) voice-first web app that tells you whether a
suspicious message is a **scam**, **suspicious**, or **safe** — grounded in a
curated scam-pattern knowledge base, with a spoken explanation and community
reporting.

- **Backend**: FastAPI + LangGraph pipeline (retrieve → reason → format),
  TF-IDF retrieval over a knowledge base of Indian scam patterns, optional
  Groq LLM verdicts (`llama-3.3-70b-versatile`), offline deterministic mock
  reasoner when no API key is set.
- **Frontend**: React + Vite single page ("Lantern in the Dusk" design),
  large touch targets for elderly users, voice input (Web Speech API) and
  spoken output (speechSynthesis), community report feed.

## Run both together

Two terminals. Python 3.10+ and Node 18+ required.

**Terminal 1 — backend** (http://127.0.0.1:8000):

```bash
cd backend
pip install -r requirements.txt
copy .env.example .env        # macOS/Linux: cp .env.example .env
uvicorn app.main:app --reload
```

**Terminal 2 — frontend** (http://localhost:5173):

```bash
cd frontend
npm install
npm run dev
```

Open <http://localhost:5173>. The Vite dev server proxies `/api/*` to the
backend automatically — no extra config.

> **About the API key:** if `GROQ_API_KEY` is not set in `backend/.env`,
> verdicts come from a deterministic offline mock reasoner (keyword urgency
> heuristic + top-matched pattern). Everything works and is fully testable
> without it. For real LLM verdicts, create a free key at
> <https://console.groq.com> and put it in `backend/.env`.

## What's real vs. placeholder

| Piece                    | Now                                                         | Production target                |
|--------------------------|-------------------------------------------------------------|----------------------------------|
| Retrieval                | TF-IDF + cosine similarity over ~13 in-code patterns        | Vector DB + embeddings           |
| Verdicts                 | Groq LLM (if key set) / deterministic mock reasoner offline | LLM + human-in-the-loop review   |
| Community reports        | In-memory list (lost on restart)                            | PostgreSQL + spam/rate limiting  |
| CORS                     | Allow-all (dev only)                                        | Explicit origin allowlist        |

## Layout

```
backend/    FastAPI app (app/main.py), pipeline (app/langgraph_pipeline.py),
            KB (app/knowledge_base.py), retriever, LLM wrapper, tests
frontend/   React + Vite app (src/App.jsx)
```

See `backend/README.md` for endpoints, env vars, and test commands.