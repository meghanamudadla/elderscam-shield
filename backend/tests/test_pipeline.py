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


def test_telugu_response_is_actually_telugu():
    msg = "మీకు నెలకు 60,000 జీతంతో వర్క్ ఫ్రమ్ హోమ్ జాబ్ ఇస్తున్నాము. నమోదు చేయడానికి మీ వివరాలు నిర్ధారించండి."
    result = run_pipeline(msg, "te")
    telugu_chars = sum(1 for ch in result["reasoning"] if 0x0C00 <= ord(ch) <= 0x0C7F)
    assert telugu_chars > 10, f"reasoning is not actually in Telugu: {result['reasoning']}"
    assert "Closest match" not in result["reasoning"]
    assert '"' not in result["reasoning"] or "—" not in result["reasoning"]  # no leaked raw-quote-plus-dash pattern
    print("Telugu language-conformance test passed.")


def test_telugu_all_fields_are_telugu():
    msg = "మీ బ్యాంక్ ఖాతా బ్లాక్ అవుతుంది, వెంటనే ఈ లింక్‌పై క్లిక్ చేయండి"
    result = run_pipeline(msg, "te")

    def has_telugu(s):
        return any(0x0C00 <= ord(ch) <= 0x0C7F for ch in s)

    assert has_telugu(result["reasoning"]), f"reasoning not Telugu: {result['reasoning']}"
    for flag in result["red_flags"]:
        assert has_telugu(flag), f"red flag not Telugu: {flag}"
    for step in result["advice"]:
        assert has_telugu(step), f"advice not Telugu: {step}"
    print("All-fields Telugu test passed.")


if __name__ == "__main__":
    test_pipeline_cases()
    test_telugu_response_is_actually_telugu()
    test_telugu_all_fields_are_telugu()