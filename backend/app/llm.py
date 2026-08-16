"""Verdict generation.

Two paths:
  1. GROQ_API_KEY set        -> real LLM verdict via Groq (llama-3.3-70b-versatile),
                                strictly grounded in the retrieved patterns.
  2. GROQ_API_KEY unset      -> deterministic offline "mock reasoner" so the whole
                                pipeline is fully testable with no network access.

Both paths return the exact same shape:
  {verdict, confidence, reasoning, red_flags[], advice[]}
"""

import json
import logging
import os
import re

from dotenv import load_dotenv

# Load backend/.env if present (GROQ_API_KEY etc.) so both `uvicorn` and
# direct test runs see the same configuration. Real env vars win.
load_dotenv()

from .retrieval import RetrievedPattern

logger = logging.getLogger(__name__)

GROQ_MODEL = "llama-3.3-70b-versatile"

VALID_VERDICTS = ("scam", "suspicious", "safe")

# System prompt for the Groq call. {pattern_lines} and {language_label} are
# filled in per request. The analogy instruction comes before the JSON-shape
# instruction so the model prioritizes warm, human explanation.
SYSTEM_TEMPLATE = """You are Scam Shield, an AI that classifies messages as scam, suspicious, or safe. You MUST base your verdict ONLY on the retrieved scam-pattern excerpts below and on the message itself. Never invent facts, websites, or numbers.

When explaining reasoning, use one short, concrete everyday analogy a non-technical elderly person would immediately recognize (e.g. comparing an urgent bank threat to a stranger demanding your house keys) instead of technical/clinical language. Keep it warm, calm, and reassuring in tone, never alarmist.

Retrieved patterns:
{pattern_lines}

Reply in {language_label}. Return ONLY raw JSON (no markdown, no fences, no commentary) with exactly these keys:
{{"verdict": "scam|suspicious|safe", "confidence": <integer 0-100>, "reasoning": "<short explanation referencing the matched pattern>", "red_flags": ["..."], "advice": ["..."]}}"""

# Keyword-urgency heuristic used by the offline mock reasoner. A word is only
# counted once per message, but hitting several distinct words is a strong
# signal of scam pressure tactics.
SCAM_KEYWORDS = [
    "urgent", "immediately", "otp", "pin", "cvv", "arrest", "won", "winner",
    "click here", "link", "kyc", "blocked", "block", "account", "refund",
    "fee", "pay", "send money", "transfer", "cbi", "police", "customs",
    "lottery", "prize", "guaranteed", "returns", "double your money",
    "aadhaar", "subsidy", "scheme", "job", "salary", "training", "warrant",
    "digital arrest", "delivery", "courier", "tax", "pan", "money laundering",
    "wallet", "reward", "free", "processing",
]

# Bilingual copy for the mock reasoner. Each verdict gets a warm reasoning line
# with a short everyday analogy (in the same spirit as the LLM system prompt)
# and an advice list in English and Telugu. The English reasoning additionally
# renders the closest matched pattern's text so users can see the grounding.
_REASONING_EN = {
    "scam": (
        "This is like a stranger banging on your front door and shouting that "
        "you must let them in right now or something terrible will happen — "
        "real banks and officials never create that kind of panic. Do not "
        "share any personal details and do not click any links."
    ),
    "suspicious": (
        "This is like a visitor who knocks politely but keeps peeking through "
        "your window — probably harmless, but it is wise to check who they "
        "really are before opening the door. Be cautious before acting, "
        "especially if it asks for money, OTPs, or personal information."
    ),
    "safe": (
        "This is like a familiar postman dropping off a routine letter you "
        "were already expecting — no need to worry. It matches everyday "
        "messages such as a regular bill, an OTP you triggered yourself, or a "
        "note from a known contact, with no obvious scam indicators."
    ),
}
_REASONING_TE = {
    "scam": (
        "ఇది ఒక అపరిచితుడు మీ ఇంటి తలుపు కొడుతూ 'వెంటనే తెరవకపోతే చాలా అనర్థం "
        "జరుగుతుంది' అని భయపెడుతున్నట్లు ఉంది — నిజమైన బ్యాంక్ లేదా అధికారి ఎప్పుడూ "
        "ఇలా భయం కలిగించరు. మీ వ్యక్తిగత వివరాలను ఎవరితోనూ పంచుకోవద్దు మరియు ఏ "
        "లింక్ పైనా క్లిక్ చేయవద్దు."
    ),
    "suspicious": (
        "ఇది మర్యాదగా తలుపు తట్టి, కిటికీ గుండా మెల్లగా చూస్తున్న వ్యక్తిలా ఉంది — "
        "బహుశా నిర్దోషి కావచ్చు, కానీ తలుపు తెరిచే ముందు వారు ఎవరో తెలుసుకోవడం "
        "తెలివైన పని. ముఖ్యంగా డబ్బు, OTP లేదా వ్యక్తిగత సమాచారం అడిగితే "
        "జాగ్రత్తగా ఉండండి."
    ),
    "safe": (
        "ఇది తెలిసిన పోస్ట్‌మేన్ మీరు ఎదురుచూస్తున్న సాధారణ లేఖను అందించినట్లు "
        "ఉంది — భయపడాల్సిన అవసరం లేదు. సాధారణ బిల్లు, మీరే ప్రారంభించిన OTP, లేదా "
        "తెలిసిన వ్యక్తి నుండి సందేశం వంటి రోజువారీ సందేశాలతో సరిపోతుంది, మరియు "
        "స్పష్టమైన మోస సూచనలు ఏవీ కనిపించలేదు."
    ),
}
_ADVICE_EN = {
    "scam": [
        "Do not reply, do not click links, and do not call back the number.",
        "Never share OTP, UPI PIN, CVV, or bank details with anyone.",
        "Block the sender and report the number to your bank or the police (cyber cell / 1930).",
        "Tell a family member or friend about this message before doing anything.",
    ],
    "suspicious": [
        "Pause before acting — pressure to act fast is itself a warning sign.",
        "Verify the claim through an official channel (bank app, government website, official phone number).",
        "If it asks for OTP, PIN, or money, treat it as a scam until proven otherwise.",
        "Check the sender's number/email against the official contact of the organization.",
    ],
    "safe": [
        "No action needed — this looks like an ordinary routine message.",
        "If it mentions an OTP you did not request, delete it and do not share it.",
        "Keep using official apps and websites for payments.",
    ],
}
_ADVICE_TE = {
    "scam": [
        "బదులివ్వవద్దు, లింక్ లపై క్లిక్ చేయవద్దు, ఆ నంబర్ కు తిరిగి కాల్ చేయవద్దు.",
        "OTP, UPI PIN, CVV లేదా బ్యాంక్ వివరాలను ఎవరితోనూ పంచుకోవద్దు.",
        "పంపినవారిని బ్లాక్ చేయండి మరియు మీ బ్యాంక్ కు లేదా పోలీసులకు (సైబర్ సెల్ / 1930) నివేదించండి.",
        "ఏదైనా చేయడానికి ముందు కుటుంబ సభ్యుడికి లేదా స్నేహితుడికి ఈ సందేశం గురించి చెప్పండి.",
    ],
    "suspicious": [
        "వెంటనే చర్య తీసుకోకండి — తొందరగా చేయమని ఒత్తిడి చేయడమే ఒక హెచ్చరిక సంకేతం.",
        "అధికారిక మార్గం ద్వారా ధృవీకరించండి (బ్యాంక్ యాప్, ప్రభుత్వ వెబ్‌సైట్, అధికారిక ఫోన్ నంబర్).",
        "OTP, PIN లేదా డబ్బు అడిగితే నిరూపించబడే వరకు దాన్ని మోసంగానే పరిగణించండి.",
        "పంపినవారి నంబర్ ను సంస్థ యొక్క అధికారిక కాంటాక్ట్ తో సరిపోల్చండి.",
    ],
    "safe": [
        "ఎటువంటి చర్య అవసరం లేదు — ఇది సాధారణ రొటీన్ సందేశంగా కనిపిస్తోంది.",
        "మీరు అడగని OTP గురించి ఉంటే దాన్ని డిలీట్ చేయండి మరియు ఎవరికీ ఇవ్వవద్దు.",
        "చెల్లింపుల కోసం అధికారిక యాప్ లు మరియు వెబ్‌సైట్ లను మాత్రమే ఉపయోగించండి.",
    ],
}


def _strip_code_fences(text: str) -> str:
    """Remove ```json ... ``` fences the model may wrap around its output."""
    text = text.strip()
    if text.startswith("```"):
        first_nl = text.find("\n")
        text = text[first_nl + 1:] if first_nl != -1 else text[3:]
    if text.endswith("```"):
        last_nl = text.rfind("\n")
        text = text[:last_nl] if last_nl != -1 else text[:-3]
    return text.strip()


def _coerce_verdict_dict(raw: dict, language: str) -> dict:
    """Validate/normalize an LLM-produced dict into the canonical schema."""
    verdict = str(raw.get("verdict", "suspicious")).strip().lower()
    if verdict not in VALID_VERDICTS:
        verdict = "suspicious"

    try:
        confidence = int(round(float(raw.get("confidence", 50))))
    except (TypeError, ValueError):
        confidence = 50
    confidence = max(0, min(100, confidence))

    def _as_str_list(value) -> list[str]:
        if isinstance(value, list):
            return [str(item) for item in value]
        if isinstance(value, str) and value:
            return [value]
        return []

    return {
        "verdict": verdict,
        "confidence": confidence,
        "reasoning": str(raw.get("reasoning", "")).strip(),
        "red_flags": _as_str_list(raw.get("red_flags")),
        "advice": _as_str_list(raw.get("advice")),
    }


def _groq_verdict(message: str, patterns: list[RetrievedPattern], language: str) -> dict:
    """Call Groq's llama-3.3-70b-versatile, strictly grounded in `patterns`."""
    from groq import Groq  # imported lazily so the module works without the dep

    client = Groq(api_key=os.environ["GROQ_API_KEY"])

    pattern_lines = "\n".join(f"- [{p.category}] {p.text}" for p in patterns)
    language_label = "English" if language == "en" else "Telugu (తెలుగు)"

    system_prompt = SYSTEM_TEMPLATE.format(
        pattern_lines=pattern_lines, language_label=language_label
    )

    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": message},
        ],
        temperature=0.2,
        max_tokens=600,
    )
    content = response.choices[0].message.content or ""
    return _coerce_verdict_dict(json.loads(_strip_code_fences(content)), language)


def _mock_verdict(message: str, patterns: list[RetrievedPattern], language: str) -> dict:
    """Deterministic offline reasoner — no network, fully testable.

    Strategy:
      - the top retrieved pattern's category is the base signal;
      - a keyword-urgency heuristic counts distinct scam trigger words in the
        message; 0 hits and a weak match can downgrade a scam base to
        suspicious, and 2+ hits can upgrade a safe base to suspicious.
    """
    top = patterns[0]
    lowered = message.lower()
    hits = sum(1 for kw in SCAM_KEYWORDS if kw in lowered)
    score = top.score

    if top.category == "scam":
        if hits >= 2 or score >= 0.25:
            verdict, base_conf = "scam", 55
        else:
            verdict, base_conf = "suspicious", 40
    else:  # top pattern is safe
        if hits >= 2:
            verdict, base_conf = "suspicious", 45
        else:
            verdict, base_conf = "safe", 65

    # Confidence blends the base with how strongly the message matched the KB
    # and how many distinct scam keywords appeared.
    confidence = base_conf + int(score * 60) + hits * 5
    confidence = max(5, min(98, confidence))

    reasoning_en = _REASONING_EN[verdict] + (
        f' (Closest match: "{top.text[:90]}…" — {top.category}).'
    )
    reasoning_te = _REASONING_TE[verdict]
    red_flags_en = [
        kw for kw in SCAM_KEYWORDS if kw in lowered
    ][:5]

    return {
        "verdict": verdict,
        "confidence": confidence,
        "reasoning": reasoning_te if language == "te" else reasoning_en,
        "red_flags": red_flags_en,
        "advice": _ADVICE_TE[verdict] if language == "te" else _ADVICE_EN[verdict],
    }


def get_verdict(message: str, patterns: list[RetrievedPattern], language: str = "en") -> dict:
    """Return {verdict, confidence, reasoning, red_flags[], advice[]}.

    Uses Groq when GROQ_API_KEY is set; otherwise falls back to the mock
    reasoner (and also on any Groq/network error, so the service never
    hard-fails because of the LLM provider).
    """
    if os.environ.get("GROQ_API_KEY"):
        try:
            return _groq_verdict(message, patterns, language)
        except Exception as exc:  # network, quota, malformed JSON, ...
            logger.warning("Groq verdict failed (%s); using mock reasoner.", exc)

    return _mock_verdict(message, patterns, language)