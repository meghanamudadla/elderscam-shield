"""
Deterministic translation layer. Content generation (LLM or mock)
always happens in English — see llm.py. This module is the ONLY place
non-English UI text gets produced, by translating the final English
strings through a chain of backends.

Backend chain (first success wins):
  Batched verdict path: Gemini -> Groq -> GoogleTranslator
  Single-string path:   Gemini -> GoogleTranslator -> MyMemory

Every failed attempt is logged at WARNING level with the backend name,
the exception, and the text that failed, so a broken environment is
diagnosable from the server console instead of failing silently. When
every backend fails, TranslationError is raised — the English source is
NEVER silently substituted (callers decide how to degrade gracefully).

There are intentionally NO hardcoded canned translations here: output
must always come from a live translator.
"""

import json
import logging
import os
import threading
import time

from deep_translator import GoogleTranslator, MyMemoryTranslator
from dotenv import load_dotenv

# Standalone use of this module (scripts, tests) must still see keys from
# backend/.env — llm.py loads it too, real env vars always win.
load_dotenv()

logger = logging.getLogger(__name__)


class TranslationError(Exception):
    """Raised when every translation backend fails."""


# Gemini translates far better when given the language NAME, not a bare code.
_LANGUAGE_NAMES = {
    "te": "Telugu",
}

# MyMemory rejects bare ISO codes ("en" -> "No support for the provided
# language"); it requires full locale codes on both sides.
_MYMEMORY_SOURCE = "en-GB"
_MYMEMORY_LOCALES = {
    "te": "te-IN",
}

_GEMINI_MODEL = "gemini-2.5-flash"
_GROQ_MODEL = "openai/gpt-oss-120b"
_GROQ_RATE_RETRY_DELAY_S = 1.5

# Free-tier quota is tiny (e.g. 5 requests/min/model). After a 429 we put the
# backend on a short cooldown so subsequent requests skip it INSTANTLY instead
# of burning seconds on doomed calls — /analyze stays fast during quota
# exhaustion, and the backend automatically re-enters rotation afterwards.
_GEMINI_COOLDOWN_S = 30.0

_gemini_lock = threading.Lock()
_gemini_model = None  # created lazily on first successful init
_gemini_cooldown_until = 0.0  # time.time() before which gemini should not be tried


def _is_rate_limit(exc: Exception) -> bool:
    msg = str(exc).lower()
    return "429" in msg or "quota" in msg or "rate limit" in msg


def _get_gemini_model():
    """Lazily create the shared Gemini model instance (thread-safe, once).

    Returns None when the library is missing or no API key is configured,
    letting the caller skip straight to the next backend.
    """
    global _gemini_model
    if _gemini_model is not None:
        return _gemini_model
    if not os.environ.get("GEMINI_API_KEY"):
        return None
    with _gemini_lock:
        if _gemini_model is None:
            try:
                import google.generativeai as genai

                genai.configure(api_key=os.environ["GEMINI_API_KEY"])
                _gemini_model = genai.GenerativeModel(_GEMINI_MODEL)
                logger.info("Gemini translation backend ready (%s).", _GEMINI_MODEL)
            except Exception as exc:
                logger.warning("Gemini init failed (%s); backend disabled.", exc)
                return None
    return _gemini_model


def _strip_wrapping_quotes(text: str) -> str:
    """Models occasionally wrap translations in quotes; remove one pair."""
    quotes = "\"'\u201c\u201d\u00ab\u00bb"
    if len(text) >= 2 and text[0] in quotes and text[-1] in quotes:
        return text[1:-1].strip()
    return text


def _extract_response_text(response) -> str:
    """Pull plain text out of a Gemini response, handling multi-part replies.

    `response.text` raises on multi-part responses ("quick accessor only
    works for simple text"), so prefer joining `response.parts` first.
    """
    parts = getattr(response, "parts", None)
    if parts:
        joined = "".join(getattr(p, "text", "") or "" for p in parts).strip()
        if joined:
            return joined
    try:
        return (response.text or "").strip()
    except Exception:
        return ""


def _gemini_translate(text: str, target: str) -> str:
    global _gemini_cooldown_until
    if time.time() < _gemini_cooldown_until:
        raise RuntimeError("Gemini in rate-limit cooldown; skipping this attempt")
    model = _get_gemini_model()
    if model is None:
        raise RuntimeError("Gemini unavailable (missing library or GEMINI_API_KEY)")
    language = _LANGUAGE_NAMES.get(target, target)
    prompt = (
        f"Translate the following text into {language}. Reply with ONLY the "
        f"translated text - no quotes, no explanation:\n\n{text}"
    )
    try:
        response = model.generate_content(prompt)
    except Exception as exc:
        if _is_rate_limit(exc):
            # Open a cooldown window so the rest of this request (and near-term
            # requests) skip gemini immediately rather than piling up latency.
            _gemini_cooldown_until = time.time() + _GEMINI_COOLDOWN_S
        raise
    translated = _strip_wrapping_quotes(_extract_response_text(response))
    if not translated:
        raise ValueError("empty translation")
    return translated


def _google_translate(text: str, target: str) -> str:
    translated = GoogleTranslator(source="en", target=target).translate(text)
    if not translated or not translated.strip():
        raise ValueError("empty translation")
    return translated.strip()


# ---------------------------------------------------------------------------
# Batched verdict translation.
#
# A single analysis carries ~10 translatable strings (1 reasoning + up to 5
# red flags + up to 4 advice items). Translating them one-by-one burns the
# free Gemini quota (5 requests/min) almost instantly, so the whole verdict
# is translated in ONE Gemini request as a JSON payload instead.
# ---------------------------------------------------------------------------


def _strip_code_fences(text: str) -> str:
    text = text.strip()
    if text.startswith("```"):
        first_nl = text.find("\n")
        text = text[first_nl + 1:] if first_nl != -1 else text[3:]
    if text.endswith("```"):
        last_nl = text.rfind("\n")
        text = text[:last_nl] if last_nl != -1 else text[:-3]
    return text.strip()


def _gemini_translate_batch(fields: dict, target: str) -> dict:
    global _gemini_cooldown_until
    if time.time() < _gemini_cooldown_until:
        raise RuntimeError("Gemini in rate-limit cooldown; skipping this attempt")
    model = _get_gemini_model()
    if model is None:
        raise RuntimeError("Gemini unavailable (missing library or GEMINI_API_KEY)")
    language = _LANGUAGE_NAMES.get(target, target)
    prompt = (
        f"Translate every value inside this JSON into {language}. Keep the JSON "
        f"structure and keys exactly the same, translate only the string values. "
        f"Reply with ONLY the raw JSON - no markdown fences, no commentary:\n\n"
        f"{json.dumps(fields, ensure_ascii=False)}"
    )
    try:
        response = model.generate_content(prompt)
    except Exception as exc:
        if _is_rate_limit(exc):
            _gemini_cooldown_until = time.time() + _GEMINI_COOLDOWN_S
        raise
    raw = _strip_code_fences(_extract_response_text(response))
    parsed = json.loads(raw)

    n_flags = len(fields.get("red_flags", []))
    n_advice = len(fields.get("advice", []))
    out = {
        "reasoning": str(parsed.get("reasoning", "")).strip(),
        "red_flags": [str(item) for item in parsed.get("red_flags", [])],
        "advice": [str(item) for item in parsed.get("advice", [])],
    }
    # Structure-drift guard: the model must return the same shape it received.
    if (
        not out["reasoning"]
        or len(out["red_flags"]) != n_flags
        or len(out["advice"]) != n_advice
    ):
        raise ValueError("batch response shape does not match input")

    # Warm the per-string cache so identical lines never re-hit any backend.
    for flag_src, flag_dst in zip(fields["red_flags"], out["red_flags"]):
        _cache[(target, flag_src)] = flag_dst
    for adv_src, adv_dst in zip(fields["advice"], out["advice"]):
        _cache[(target, adv_src)] = adv_dst
    return out


def _google_translate_batch(fields: dict, target: str) -> dict:
    return {
        "reasoning": _google_translate(fields["reasoning"], target),
        "red_flags": [_google_translate(f, target) for f in fields["red_flags"]],
        "advice": [_google_translate(a, target) for a in fields["advice"]],
    }


# Shared Groq client, created lazily and reused across calls.
_groq_lock = threading.Lock()
_groq_client = None


def _get_groq_client():
    """Lazily create the shared Groq client (thread-safe, once).

    Returns None when the library/key is missing so the caller can skip to
    the next backend without crashing.
    """
    global _groq_client
    if _groq_client is not None:
        return _groq_client
    api_key = os.environ.get("GROQ_API_KEY")
    if not api_key:
        return None
    with _groq_lock:
        if _groq_client is None:
            try:
                from groq import Groq  # lazy: module works without the dep

                _groq_client = Groq(api_key=api_key)
                logger.info("Groq translation backend ready (%s).", _GROQ_MODEL)
            except Exception as exc:
                logger.warning("Groq init failed (%s); backend disabled.", exc)
                return None
    return _groq_client


def _groq_translate_batch(fields: dict, target: str) -> dict:
    client = _get_groq_client()
    if client is None:
        raise RuntimeError("Groq unavailable (missing library or GROQ_API_KEY)")
    language = _LANGUAGE_NAMES.get(target, target)
    payload = {
        "reasoning": fields["reasoning"],
        "red_flags": fields["red_flags"],
        "advice": fields["advice"],
    }
    prompt = (
        f"Translate every value inside this JSON into {language}. Keep the JSON "
        f"structure and keys exactly the same, translate only the string values. "
        f"Reply with ONLY the raw JSON - no markdown fences, no commentary:\n\n"
        f"{json.dumps(payload, ensure_ascii=False)}"
    )
    kwargs = dict(
        model=_GROQ_MODEL,
        messages=[{"role": "user", "content": prompt}],
        temperature=0.0,
        # Telugu consumes ~3-4 tokens per character, so a full translated
        # verdict easily exceeds 1500 tokens — give generous headroom or the
        # JSON comes back truncated ("Unterminated string").
        max_tokens=4096,
    )
    attempt = 0
    while True:
        try:
            response = client.chat.completions.create(**kwargs)
            break
        except Exception as exc:
            # One retry on rate limits — matches llm.py's Groq policy.
            if attempt == 0 and _is_rate_limit(exc):
                logger.warning(
                    "Groq rate limited; retrying once after %.1fs.",
                    _GROQ_RATE_RETRY_DELAY_S,
                )
                time.sleep(_GROQ_RATE_RETRY_DELAY_S)
                attempt += 1
                continue
            raise

    raw = response.choices[0].message.content or ""
    n_flags = len(payload["red_flags"])
    n_advice = len(payload["advice"])
    parsed = json.loads(_strip_code_fences(raw.strip()))
    out = {
        "reasoning": str(parsed.get("reasoning", "")).strip(),
        "red_flags": [str(item) for item in parsed.get("red_flags", [])],
        "advice": [str(item) for item in parsed.get("advice", [])],
    }
    if (
        not out["reasoning"]
        or len(out["red_flags"]) != n_flags
        or len(out["advice"]) != n_advice
    ):
        raise ValueError("batch response shape does not match input")

    # Warm the per-string cache so identical lines never re-hit any backend.
    for flag_src, flag_dst in zip(payload["red_flags"], out["red_flags"]):
        _cache[(target, flag_src)] = flag_dst
    for adv_src, adv_dst in zip(payload["advice"], out["advice"]):
        _cache[(target, adv_src)] = adv_dst
    return out


def _mymemory_translate(text: str, target: str) -> str:
    locale = _MYMEMORY_LOCALES.get(target)
    if locale is None:
        raise ValueError(f"MyMemory has no configured locale for {target!r}")
    translated = MyMemoryTranslator(source=_MYMEMORY_SOURCE, target=locale).translate(text)
    if not translated or not translated.strip():
        raise ValueError("empty translation")
    return translated.strip()


# Resolved BY NAME at call time so tests can patch the underlying functions.
_PAYLOAD_BACKEND_NAMES = ("gemini-batch", "groq-batch", "google-batch")


def _resolve_payload_backend(name: str):
    return {
        "gemini-batch": _gemini_translate_batch,
        "groq-batch": _groq_translate_batch,
        "google-batch": _google_translate_batch,
    }[name]


def translate_verdict_payload(
    fields: dict,
    target: str,
    verdict: str | None = None,
) -> dict:
    """Translate {reasoning, red_flags[], advice[]} in one backend call.

    Raises:
        TranslationError: when every backend fails (shape-validated output
        guaranteed on success — same keys, same list lengths).
    """
    failures = []
    for name in _PAYLOAD_BACKEND_NAMES:
        try:
            return _resolve_payload_backend(name)(fields, target)
        except Exception as exc:
            logger.warning(
                "Batch translation backend %r failed (verdict=%r): %s",
                name,
                verdict,
                exc,
            )
            failures.append(f"{name}: {exc}")
    raise TranslationError(
        f"all batch backends failed for target={target!r} [{'; '.join(failures)}]"
    )


# Backend registry — resolved BY NAME at call time so tests can patch
# the underlying functions and have translate_text pick up patched versions.
_BACKEND_NAMES = ("gemini", "google-translate", "mymemory")


def _resolve_backend(name: str):
    return {
        "gemini": _gemini_translate,
        "google-translate": _google_translate,
        "mymemory": _mymemory_translate,
    }[name]

# Process-wide cache: scam advice/red-flag lines repeat verbatim across
# analyses and the free Gemini tier is rate limited, so identical strings
# are answered from memory. FIFO eviction keeps it bounded.
_cache: dict[tuple[str, str], str] = {}
_CACHE_MAX = 512


def translate_text(
    text: str,
    target: str,
    verdict: str | None = None,
    kind: str = "reasoning",
) -> str:
    """Translate `text` into `target` via the backend chain.

    Args:
        text: source (English) text; empty/whitespace input returns as-is.
        target: ISO code of the target language ('te' for Telugu).
        verdict/kind: purely diagnostic — recorded in failure logs so operators
            can tell WHICH field (reasoning vs red_flag vs advice) broke.

    Raises:
        TranslationError: when every backend fails. Never silently returns the
        English source for a non-English target.
    """
    if not text or not text.strip() or target == "en":
        return text

    cache_key = (target, text)
    cached = _cache.get(cache_key)
    if cached is not None:
        return cached

    failures = []
    for name in _BACKEND_NAMES:
        try:
            translated = _resolve_backend(name)(text, target)
            if len(_cache) >= _CACHE_MAX:
                _cache.pop(next(iter(_cache)))
            _cache[cache_key] = translated
            return translated
        except Exception as exc:
            logger.warning(
                "Translation backend %r failed (verdict=%r kind=%r): %s | text=%r",
                name,
                verdict,
                kind,
                exc,
                text[:120],
            )
            failures.append(f"{name}: {exc}")

    raise TranslationError(f"all backends failed for target={target!r} [{'; '.join(failures)}]")


def translate_list(
    texts: list[str],
    target: str,
    verdict: str | None = None,
    kind: str = "advice",
) -> list[str]:
    """Translate a list of strings, preserving order."""
    return [translate_text(t, target, verdict, kind) for t in texts]
