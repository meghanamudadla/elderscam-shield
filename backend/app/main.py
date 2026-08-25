"""Scam Shield API.

Run:  uvicorn app.main:app --reload   (from backend/)
"""

import datetime as dt
import io
import logging

from fastapi import FastAPI, HTTPException, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from pydantic import BaseModel, Field

from .langgraph_pipeline import run_pipeline
from .schemas import AnalyzeRequest, ReportIn, VerdictResponse
from .translate import TranslationError, translate_text

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Scam Shield", version="1.0.0")


def _ascii_safe(text: str) -> str:
    """Make a string safe for Windows consoles that cannot print Unicode."""
    return text.encode("ascii", "replace").decode("ascii")


@app.on_event("startup")
def translation_self_test() -> None:
    """Run a quick translation sanity check on server start.

    Logs a clear success/failure message so operators immediately know
    whether live translation is working in this environment.
    """
    test_text = "This is a scam message asking for money."
    try:
        translated = translate_text(test_text, "te")
        telugu_chars = sum(1 for ch in translated if 0x0C00 <= ord(ch) <= 0x0C7F)
        if telugu_chars > 0:
            logger.info(
                "Translation self-test PASSED: %r -> %s (%d Telugu chars)",
                test_text,
                _ascii_safe(translated[:80]),
                telugu_chars,
            )
        else:
            logger.warning(
                "Translation self-test returned NO Telugu characters: %r",
                _ascii_safe(translated[:120]),
            )
    except TranslationError as exc:
        logger.error(
            "Translation self-test FAILED - all backends unreachable. Telugu "
            "requests will show English until this is fixed (check GEMINI_API_KEY "
            "and network access). Detail: %s",
            exc,
        )
    except Exception as exc:  # noqa: BLE001 — never block startup on the probe
        logger.error("Translation self-test ERROR: %s", exc)

# Dev-only: allow any origin so the Vite dev server (localhost:5173) can call
# us. Tighten to an explicit origin allowlist before real deployment.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Community reports are stored in memory for now (dev/demo).
# TODO(prod): replace with PostgreSQL (or any durable store) before real
# deployment — in-memory data is lost on restart and not shared across workers.
REPORTS: list[dict] = []


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


@app.post("/analyze", response_model=VerdictResponse)
def analyze(req: AnalyzeRequest) -> dict:
    message = req.message.strip()
    if not message:
        raise HTTPException(status_code=400, detail="Message must not be empty")
    return run_pipeline(message, req.language)


class SpeakRequest(BaseModel):
    message: str = Field(..., description="The text to read aloud")
    language: str = Field("en", description='Spoken language: "en" or "te"')


@app.post("/speak")
def speak(req: SpeakRequest) -> Response:
    """Text-to-speech via gTTS (a Google-hosted endpoint).

    Returns the MP3 bytes so the frontend can play the written explanation
    aloud. gTTS requires internet access; on any failure (network blocked,
    quota, etc.) a 503 JSON body is returned so the frontend knows the
    service is *temporarily unavailable* rather than broken, and can fall
    back to browser speech synthesis.
    """
    text = req.message.strip()
    if not text:
        raise HTTPException(status_code=400, detail="Message must not be empty")
    try:
        from gtts import gTTS  # imported lazily so the server boots without it

        tts = gTTS(text=text[:500], lang=req.language or "en")
        buf = io.BytesIO()
        tts.write_to_fp(buf)
        return Response(content=buf.getvalue(), media_type="audio/mpeg")
    except Exception as exc:  # noqa: BLE001 — any gTTS/network failure → 503
        logger.warning("TTS failed (%s)", exc)
        raise HTTPException(
            status_code=503,
            detail=(
                "Speech synthesis is temporarily unavailable — this usually "
                "means a network connectivity issue. Please try again later."
            ),
        ) from exc


@app.post("/reports")
def create_report(report: ReportIn) -> dict:
    REPORTS.append(
        {
            "snippet": report.snippet,
            "verdict": report.verdict,
            "category": report.category,
            "reported_at": dt.datetime.now(dt.timezone.utc).isoformat(),
        }
    )
    return {"count": len(REPORTS)}


@app.get("/reports")
def list_reports(limit: int = Query(5, ge=1, le=50)) -> list[dict]:
    return REPORTS[-limit:][::-1]


@app.get("/reports/summary")
def reports_summary() -> dict:
    """Count reports grouped by category, most frequent first.

    Response shape: {"categories": [{"category": "...", "count": N}, ...], "total": M}
    """
    counts: dict[str, int] = {}
    for report in REPORTS:
        category = report.get("category") or "other"
        counts[category] = counts.get(category, 0) + 1
    categories = sorted(
        ({"category": category, "count": count} for category, count in counts.items()),
        key=lambda item: item["count"],
        reverse=True,
    )
    return {"categories": categories, "total": len(REPORTS)}