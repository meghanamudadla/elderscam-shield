"""Pipeline tests — runnable two ways:

    python tests/test_pipeline.py     (standalone, from backend/)
    pytest backend/tests/test_pipeline.py

Four cases exercise the full retrieve->reason->format LangGraph pipeline:
  1. KYC-urgency scam message      -> verdict in {scam, suspicious}
  2. ordinary safe bill message    -> verdict == safe
  3. "digital arrest" scam message -> verdict == scam
  4. Telugu-language scam message  -> verdict in {scam, suspicious}
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.langgraph_pipeline import run_pipeline  # noqa: E402

CASES = [
    (
        "kyc-urgency",
        "Your bank account will be blocked in 24 hours! Your KYC has expired. "
        "Click this link immediately to update your KYC details and avoid penalty.",
        "en",
        {"scam", "suspicious"},
    ),
    (
        "safe-bill",
        "Your mobile bill of 299 rupees has been generated. Please pay the "
        "amount before the due date through the official app to avoid disconnection.",
        "en",
        {"safe"},
    ),
    (
        "digital-arrest",
        "This is CBI officer Sharma. A parcel with drugs was found in your name. "
        "You are under digital arrest. Stay on this call, do not hang up, do not "
        "tell anyone. Pay the fine immediately or you will be arrested.",
        "en",
        {"scam"},
    ),
    (
        "telugu-scam",
        "మీ బ్యాంక్ ఖాతా 24 గంటల్లో బ్లాక్ అవుతుంది! మీ KYC గడువు ముగిసింది. "
        "వెంటనే ఈ లింక్ పై క్లిక్ చేసి మీ KYC నవీకరించండి, లేదా మీ ఖాతా స్తంభింపజేయబడుతుంది.",
        "te",
        {"scam", "suspicious"},
    ),
]


def test_pipeline_cases():
    results = []
    for name, message, language, allowed in CASES:
        result = run_pipeline(message, language)
        assert result["verdict"] in allowed, (
            f"[{name}] expected verdict in {allowed}, got {result['verdict']!r}"
        )
        assert 0 <= result["confidence"] <= 100
        assert isinstance(result["reasoning"], str) and result["reasoning"]
        assert isinstance(result["red_flags"], list)
        assert isinstance(result["advice"], list) and result["advice"]
        assert result["matched_patterns"], "expected at least one matched pattern"
        results.append((name, result))
        print(f"[{name}] verdict={result['verdict']} confidence={result['confidence']}")

    # Detail sanity: the digital-arrest case must actually be classified scam
    # (not merely suspicious), and matched patterns should include the
    # digital-arrest KB entry.
    arrest = next(r for n, r in results if n == "digital-arrest")
    assert arrest["verdict"] == "scam"
    assert "digital-arrest" in arrest["matched_patterns"]
    print("All pipeline tests passed.")


def _is_telugu(text: str) -> bool:
    return any(0x0C00 <= ord(ch) <= 0x0C7F for ch in text)


def test_telugu_response_is_actually_telugu():
    msg = "మీకు నెలకు 60,000 జీతంతో వర్క్ ఫ్రమ్ హోమ్ జాబ్ ఇస్తున్నాము. నమోదు చేయడానికి మీ వివరాలు నిర్ధారించండి."
    result = run_pipeline(msg, "te")
    # Tiny quotas (e.g. 20 req/day free tier) can die between the probe and
    # this call; if the verdict degraded to English AND no backend is
    # reachable anymore, degrade this test to a SKIP instead of a false fail.
    if not _is_telugu(result["reasoning"]) and not _translation_backend_available():
        print("SKIP: translation quota/backends died mid-run — live-Telugu test skipped.")
        return
    result = run_pipeline(msg, "te")
    telugu_chars = sum(1 for ch in result["reasoning"] if 0x0C00 <= ord(ch) <= 0x0C7F)
    assert telugu_chars > 10, f"reasoning is not actually in Telugu: {result['reasoning']}"
    assert "Closest match" not in result["reasoning"]
    assert '"' not in result["reasoning"] or "—" not in result["reasoning"]  # no leaked raw-quote-plus-dash pattern
    print("Telugu language-conformance test passed.")


def test_telugu_all_fields_are_telugu():
    msg = "మీ బ్యాంక్ ఖాతా బ్లాక్ అవుతుంది, వెంటనే ఈ లింక్‌పై క్లిక్ చేయండి"
    result = run_pipeline(msg, "te")
    if not _is_telugu(result["reasoning"]) and not _translation_backend_available():
        print("SKIP: translation quota/backends died mid-run — live-Telugu test skipped.")
        return
    result = run_pipeline(msg, "te")

    def has_telugu(s):
        return any(0x0C00 <= ord(ch) <= 0x0C7F for ch in s)

    assert has_telugu(result["reasoning"]), f"reasoning not Telugu: {result['reasoning']}"
    for flag in result["red_flags"]:
        assert has_telugu(flag), f"red flag not Telugu: {flag}"
    for step in result["advice"]:
        assert has_telugu(step), f"advice not Telugu: {step}"
    print("All-fields Telugu test passed.")


def _translation_backend_available() -> bool:
    """Probe whether at least one translation backend is reachable.

    Used by the live end-to-end Telugu tests so they degrade to a clear
    SKIP notice (instead of a confusing failure) when neither Gemini nor
    Google Translate can be reached from this machine.
    """
    import logging

    from app.translate import TranslationError, translate_text

    logging.disable(logging.WARNING)  # keep the probe output clean
    try:
        return bool(translate_text("This is a routine bill.", "te"))
    except TranslationError:
        return False
    finally:
        logging.disable(logging.NOTSET)


def test_translation_backend_chain():
    """Unit tests for the translate backend chains — no live network needed:

      1. Gemini string backend succeeding -> its Telugu output used verbatim.
      2. Gemini batch backend succeeding  -> whole verdict translated in one call.
      3. Groq batch backend succeeding    -> used when Gemini is down (quota etc).
      4. Every backend down               -> TranslationError raised; English is
         NEVER silently substituted for a non-English target.
    """
    from unittest.mock import patch

    from app import translate as tr
    from app.translate import TranslationError

    # 1) single-string chain: Gemini's output passes straight through.
    # Patch the cache lookup so a real-network entry can't mask the mock.
    with patch.object(tr, "_cache", {}), patch.object(
        tr, "_gemini_translate", return_value="ఈ లింక్ నొక్కవద్దు"
    ):
        out = tr.translate_text("Do not click this link", "te")
    assert any(0x0C00 <= ord(ch) <= 0x0C7F for ch in out), (
        f"expected Telugu from mocked Gemini, got: {out!r}"
    )

    # 2) batched verdict payload: one call covers reasoning + flags + advice.
    en_fields = {
        "reasoning": "This message pressures you to act fast.",
        "red_flags": ["Urgent threat", "Link"],
        "advice": ["Do not click", "Verify with bank"],
    }
    te_fields = {
        "reasoning": "ఈ సందేశం వేగంగా చర్య తీసుకోవాలని ఒత్తిడి చేస్తుంది.",
        "red_flags": ["అత్యవసర బెదిరింపు", "లింక్"],
        "advice": ["క్లిక్ చేయవద్దు", "బ్యాంక్‌తో ధృవీకరించండి"],
    }
    with patch.object(tr, "_gemini_translate_batch", return_value=te_fields):
        got = tr.translate_verdict_payload(en_fields, "te", verdict="scam")
    assert got == te_fields, f"batch payload mismatch: {got!r}"

    # 3) Gemini down (e.g. daily quota) -> Groq-batch picks it up.
    groq_fields = {
        "reasoning": "ఈ సందేశం అత్యవసరం అని ఒత్తిడి చేస్తుంది.",
        "red_flags": ["అత్యవసర బెదిరింపు", "లింక్"],
        "advice": ["క్లిక్ చేయవద్దు", "బ్యాంక్‌తో ధృవీకరించండి"],
    }
    with patch.object(
        tr, "_gemini_translate_batch", side_effect=RuntimeError("gemini quota")
    ), patch.object(
        tr, "_groq_translate_batch", return_value=groq_fields
    ):
        got = tr.translate_verdict_payload(en_fields, "te", verdict="scam")
    assert got == groq_fields, f"groq fallback payload mismatch: {got!r}"

    # 4) total failure must raise, not fall back to English.
    unique = {"reasoning": f"probe {id(object())}", "red_flags": ["x"], "advice": ["y"]}
    with patch.object(
        tr, "_gemini_translate_batch", side_effect=RuntimeError("gemini down")
    ), patch.object(
        tr, "_groq_translate_batch", side_effect=RuntimeError("groq down")
    ), patch.object(
        tr, "_google_translate_batch", side_effect=RuntimeError("google down")
    ):
        try:
            tr.translate_verdict_payload(unique, "te")
        except TranslationError as exc:
            assert (
                "gemini-batch" in str(exc)
                and "groq-batch" in str(exc)
                and "google-batch" in str(exc)
            )
        else:
            raise AssertionError(
                "expected TranslationError when every backend fails — "
                "silent English fallback has returned"
            )

    print("Translation backend-chain unit tests passed.")


if __name__ == "__main__":
    test_pipeline_cases()
    if not _translation_backend_available():
        print("SKIP: translation backends unreachable — live-Telugu E2E tests skipped.")
    else:
        test_telugu_response_is_actually_telugu()
        test_telugu_all_fields_are_telugu()
    test_translation_backend_chain()