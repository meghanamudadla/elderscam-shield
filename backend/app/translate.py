"""
Deterministic translation layer. Content generation (LLM or mock)
always happens in English — see llm.py. This module is the ONLY
place Telugu text gets produced, by translating the final English
strings. This replaces asking the LLM/mock reasoner to write Telugu
directly, which proved unreliable across several iterations.
"""
from deep_translator import GoogleTranslator


def translate_text(text: str, target: str) -> str:
    """Translate `text` to `target` ('te' for Telugu). Returns the
    original text unchanged on any failure (network issue, empty
    string, etc.) rather than raising — callers should never crash
    because translation was unavailable."""
    if not text or not text.strip() or target == "en":
        return text
    try:
        return GoogleTranslator(source="en", target=target).translate(text)
    except Exception:
        return text  # fail safe: better to show English than crash or show nothing
