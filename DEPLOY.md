# Deploying Scam Shield

The app is two pieces:

| Piece    | What it is                          | Where it runs                                |
|----------|-------------------------------------|----------------------------------------------|
| backend  | FastAPI (uvicorn) + LangGraph + Groq | any Python 3.11 host / container             |
| frontend | static React build (Vite `dist/`)   | any static host / nginx, with `/api` proxied to the backend |

There is **no database** — community reports live in backend memory (lost on
restart; see "Before production" below).

## Prerequisites

1. Put the project in a Git repo and push it to GitHub (all three options below
   consume the repo):
   ```bash
   cd scam-shield
   git init && git add . && git commit -m "Scam Shield"
   gh repo create scam-shield --private --source . --push   # or push manually
   ```
2. Have your Groq API key ready (https://console.groq.com). Without it the app
   still works in demo mode via the offline mock reasoner.

---

## Option A — Docker (any VPS / your own server)

Everything is already prepared (`backend/Dockerfile`, `frontend/Dockerfile`,
`frontend/nginx.conf`, `docker-compose.yml`). nginx serves the built SPA and
proxies `/api/*` → the backend container, exactly like the dev proxy.

```bash
cd scam-shield
echo "GROQ_API_KEY=gsk_..." > .env     # optional; needed for real LLM verdicts
docker compose up -d --build
```

Open `http://YOUR_SERVER:8080`. Logs: `docker compose logs -f`. Updates:
`git pull && docker compose up -d --build`.

> The tesseract.js OCR worker downloads its language data (~10–20 MB) from a
> CDN on first use in the browser — no server-side setup needed.

## Option B — Free cloud tiers (backend + frontend separately)

### 1. Backend → Render (or Railway / Fly.io)

1. [render.com](https://render.com) → **New → Web Service** → connect the GitHub repo.
2. Settings:
   - **Root directory**: `backend`
   - **Build command**: `pip install -r requirements.txt`
   - **Start command**: `uvicorn app.main:app --host 0.0.0.0 --port $PORT`
   - **Environment variables** (set both in the Render dashboard → Environment tab):
     - `GROQ_API_KEY` = your Groq key (https://console.groq.com) — needed for scam analysis verdicts
     - `GEMINI_API_KEY` = your Gemini key (https://aistudio.google.com/apikey) — needed for vision-based screenshot extraction; **without this, every image upload silently falls back to weak Tesseract OCR**
3. Deploy → note your URL, e.g. `https://scam-shield.onrender.com`.
   Verify: open `https://scam-shield.onrender.com/health` → `{"status":"ok"}`.

### 2a. Frontend → Netlify (same-origin `/api`, no extra config)

1. Netlify → **Add new site → Import from Git** → repo, root `frontend`.
2. Build command `npm run build`, publish dir `dist` — both are already set in
   `frontend/netlify.toml`.
3. Open `frontend/netlify.toml` and replace `YOUR-BACKEND-URL.example.com` with
   your Render URL, commit, redeploy. Netlify proxies `/api/*` to it, so no CORS
   or build-time env is needed.

### 2b. Frontend → Vercel (build-time env instead of a proxy)

1. [vercel.com](https://vercel.com) → **Import project** → repo, framework **Vite**,
   root `frontend` (build `npm run build`, output `dist`).
2. Add an environment variable **at build time**: `VITE_API_BASE` =
   `https://scam-shield.onrender.com` (the frontend prepends this to all API
   calls; the backend already allows all origins for dev).
3. Deploy. Redeploy after changing the URL.

---

## Environment variables

| Where                | Variable          | Required | Effect                                             |
|----------------------|-------------------|----------|----------------------------------------------------||
| Backend host (Render)| `GROQ_API_KEY`    | no       | Real LLM scam analysis; unset → offline mock reasoner |
| Backend host (Render)| `GEMINI_API_KEY`  | **yes**  | Vision-based screenshot text extraction; unset → silent fallback to Tesseract OCR (much weaker) |
| Frontend build (Vercel) | `VITE_API_BASE` | no     | Backend URL; unset → same-origin `/api`            |
| Docker compose `.env`| `GROQ_API_KEY`    | no       | Passed through to the backend container            |
| Docker compose `.env`| `GEMINI_API_KEY`  | **yes**  | Passed through to the backend container            |

## Before production (important)

- **Reports are in-memory** — they vanish on restart and don't scale across
  multiple backend instances. Swap `REPORTS` in `backend/app/main.py` for
  PostgreSQL before real deployment (the endpoint shapes stay the same).
- **CORS is allow-all** (`backend/app/main.py`). With same-origin proxies
  (Docker/Netlify) it's harmless, but tighten it to your frontend origin if you
  expose the API directly.
- **Rate limiting**: `/analyze` hits Groq (cost) and `/reports` is writable —
  add auth/rate limits before public launch.
- **TLS**: put the Docker setup behind Caddy/nginx with HTTPS (Certbot or
  Caddy's automatic HTTPS).