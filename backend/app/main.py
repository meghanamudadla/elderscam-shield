"""Scam Shield API.

Run:  uvicorn app.main:app --reload   (from backend/)
"""

import base64
import datetime as dt
import io
import logging
import os

from fastapi import FastAPI, File, HTTPException, Query, UploadFile
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


# ---------------------------------------------------------------------------
# Vision-based message extraction from a screenshot (primary path).
#
# OCR (Tesseract) only recognizes pixel patterns, so it cannot tell a chat
# bubble apart from a fraud-warning banner or status-bar chrome, and it keeps
# polluting the extracted text with app UI noise. A vision-capable LLM
# understands layout and context, so it extracts ONLY the real message.
#
# This endpoint is meant to be tried FIRST by the frontend; if it fails (no
# API key, no network, or any API error) it returns a clear non-OK error so
# the frontend can fall back to the existing client-side Tesseract pipeline.
#
# Retry logic: transient failures (503, timeout, connection error, 429) are
# retried up to 3 times with exponential backoff (1s, 2s). Non-transient
# errors (400, 401, 403, 404) fail immediately.
# ---------------------------------------------------------------------------

# Vision model: Groq (llama-4-scout multimodal). Reuses the same GROQ_API_KEY
# already required for the reasoning step — no additional secret needed.
VISION_MODEL = "meta-llama/llama-4-scout-17b-16e-instruct"

VISION_SYSTEM_PROMPT = (
    "You are a text extractor for a scam-detection app. "
    "This is a screenshot from a phone — it could be an SMS app, WhatsApp, "
    "a missed-call screen, a caller-ID app (like Truecaller), or any other "
    "messaging or telephony app on Android or iOS.\n\n"
    "Your job: extract ALL text that was actually communicated to the phone "
    "owner — the real message body. This INCLUDES:\n"
    "- The full body text of every SMS or chat bubble, top to bottom\n"
    "- The sender's phone number or name if it is shown (it could be an "
    "unknown number like +91-XXXXXXXXXX, which IS relevant for scam detection)\n"
    "- Any URL or link text visible in the message\n"
    "- Any amount, account number, OTP, or reference number in the message\n\n"
    "EXCLUDE (do NOT copy these):\n"
    "- App UI chrome: navigation bars, back buttons, menu icons\n"
    "- Encryption/security banners (e.g. 'Messages are end-to-end encrypted')\n"
    "- Truecaller/caller-ID fraud warnings or 'Reported as spam' banners "
    "(these are app-generated, NOT the message content)\n"
    "- Delivery/read receipts (Delivered, Read, Seen)\n"
    "- Timestamps and dates\n"
    "- Phone status bar (battery, signal, time)\n"
    "- Your own outgoing message bubbles\n\n"
    "If there are multiple incoming message bubbles, join them in reading order "
    "(top to bottom) with a blank line between each bubble.\n\n"
    "Return ONLY the extracted text — no commentary, no quotation marks, "
    "no explanation of what you included or excluded. "
    "If you cannot find any message text at all, return exactly: [NO_TEXT_FOUND]"
)

# Groq OpenAI-compatible endpoint
VISION_API_URL = "https://api.groq.com/openai/v1/chat/completions"

# Retry configuration
VISION_MAX_ATTEMPTS = 3
VISION_BASE_DELAY_S = 1.0
# 429 (rate limit) is transient — retry after backoff
VISION_TRANSIENT_STATUSES = {429, 500, 502, 503, 504}


def _is_transient_failure(exc: Exception) -> bool:
    """Check if an exception represents a transient, retryable failure."""
    exc_type = type(exc).__name__
    if exc_type in ("Timeout", "ConnectionError", "ChunkedEncodingError", "ContentDecodingError"):
        return True
    exc_str = str(exc)
    for status in VISION_TRANSIENT_STATUSES:
        if str(status) in exc_str:
            return True
    return False


@app.post("/extract-message-from-image")
async def extract_message_from_image(file: UploadFile = File(...)) -> dict:
    """Extract just the actual message text from a screenshot via a vision LLM.

    Uses Groq's llama-4-scout vision model (reuses GROQ_API_KEY).
    Returns {"text": "..."} on success.
    On transient failure (429, 503, timeout), retries up to 3 times with
    exponential backoff (1s, 2s). Only after all retries are exhausted does
    it raise a 503 so the caller can fall back to the offline OCR pipeline.
    """
    if not file.content_type or not file.content_type.startswith("image/"):
        raise HTTPException(status_code=400, detail="Please upload an image file.")

    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        raise HTTPException(
            status_code=503,
            detail=(
                "Vision extraction is unavailable (no GROQ_API_KEY configured on "
                "the server). The app will fall back to on-device OCR."
            ),
        )

    raw_bytes = await file.read()
    if not raw_bytes:
        raise HTTPException(status_code=400, detail="The uploaded image was empty.")

    mime = file.content_type or "image/png"
    b64 = base64.b64encode(raw_bytes).decode("ascii")
    data_url = f"data:{mime};base64,{b64}"

    import requests  # already a dependency; imported lazily

    payload = {
        "model": VISION_MODEL,
        "messages": [
            {"role": "system", "content": VISION_SYSTEM_PROMPT},
            {
                "role": "user",
                "content": [
                    {
                        "type": "image_url",
                        "image_url": {"url": data_url},
                    },
                    {
                        "type": "text",
                        "text": "Extract only the message text from this screenshot.",
                    },
                ],
            },
        ],
        "temperature": 0.1,
        "max_tokens": 1024,
    }

    last_exc: Exception | None = None
    for attempt in range(1, VISION_MAX_ATTEMPTS + 1):
        try:
            resp = requests.post(
                VISION_API_URL,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json=payload,
                timeout=60,
            )
            resp.raise_for_status()
            data = resp.json()

            text = (
                data.get("choices", [{}])[0]
                .get("message", {})
                .get("content", "")
                or ""
            ).strip()

            if not text:
                raise RuntimeError("Groq vision returned no extractable text")

            # Honour the [NO_TEXT_FOUND] sentinel — fall back to OCR
            if text.strip() == "[NO_TEXT_FOUND]":
                raise RuntimeError("Vision model found no message text in the screenshot")

            logger.info("Vision extraction succeeded on attempt %d/%d", attempt, VISION_MAX_ATTEMPTS)
            return {"text": text}

        except Exception as exc:  # noqa: BLE001
            last_exc = exc
            is_transient = _is_transient_failure(exc)
            logger.warning(
                "Vision attempt %d/%d failed (%s)%s",
                attempt,
                VISION_MAX_ATTEMPTS,
                exc,
                " — retrying" if (is_transient and attempt < VISION_MAX_ATTEMPTS) else " — not retryable" if not is_transient else " — max attempts reached",
            )
            if not is_transient or attempt >= VISION_MAX_ATTEMPTS:
                break
            delay = VISION_BASE_DELAY_S * attempt
            logger.info("Waiting %.1fs before retry...", delay)
            import time
            time.sleep(delay)

    # All retries exhausted or non-transient failure
    logger.error(
        "Vision extraction failed after %d attempt(s) (%s); frontend will use OCR.",
        VISION_MAX_ATTEMPTS,
        last_exc,
    )
    raise HTTPException(
        status_code=503,
        detail=(
            "Vision extraction failed (network or API error). The app will "
            "fall back to on-device OCR."
        ),
    ) from last_exc