"""Verdict generation.

Two paths:
  1. GROQ_API_KEY set        -> real LLM verdict via Groq (openai/gpt-oss-120b),
                                strictly grounded in the retrieved patterns.
  2. GROQ_API_KEY unset      -> deterministic offline "mock reasoner" so the whole
                                pipeline is fully testable with no network access.

Both paths return the exact same shape:
  {verdict, confidence, reasoning, red_flags[], advice[]}

Language handling (rearchitected):
  - Content is ALWAYS generated in English, by both paths, no matter which
    display language the user requested. Asking the LLM/mock to write Telugu
    prose natively proved unreliable across several iterations, so generation
    and translation are now separate steps.
  - For language == "te", the final English strings are translated by the
    deterministic translation layer (translate.py, backed by deep-translator)
    as the very last step, after fragment filtering. For "en", no translation
    happens at all.
  - Retrieved pattern text is NEVER shown verbatim to the user in any
    language — it is grounding context for reasoning only.
  - No red_flags/advice item shorter than 10 characters ever reaches the
    frontend (stray fragments are dropped; empty lists get a default phrase).

Grounding contract (both paths):
  - reasoning must reference something concrete from THIS message (matched
    urgency keywords and the top retrieved pattern), not a generic template
    that looks identical for every message.
"""

import json
import logging
import os
import re
import time

from dotenv import load_dotenv

# Load backend/.env if present (GROQ_API_KEY etc.) so both `uvicorn` and
# direct test runs see the same configuration. Real env vars win.
load_dotenv()

from .retrieval import RetrievedPattern
from .translate import TranslationError, translate_verdict_payload

logger = logging.getLogger(__name__)

GROQ_MODEL = "openai/gpt-oss-120b"

# In-process verdict cache keyed by (message, matched pattern ids). Scam
# messages circulate verbatim to thousands of people, so repeated analyses
# of the same text hit this cache instead of the LLM — this is the main
# defence against the free tier's rate limits (plus a 429 retry below).
# Cap + FIFO eviction keep memory bounded.
_VERDICT_CACHE: dict[tuple, dict] = {}
_VERDICT_CACHE_MAX = 128
_VERDICT_RETRY_DELAY_S = 1.5

# Post-translation verdict cache (Telugu etc.) — see get_verdict.
_TRANSLATED_CACHE: dict[tuple, dict] = {}
_TRANSLATED_CACHE_MAX = 128

VALID_VERDICTS = ("scam", "suspicious", "safe")

# System prompt for the Groq call. {pattern_lines} is filled in per request.
# The analogy instruction comes before the JSON-shape instruction so the
# model prioritizes warm, human explanation. The model ALWAYS replies in
# English — Telugu is produced later by the deterministic translate step,
# never by the model itself.
SYSTEM_TEMPLATE = """You are Scam Shield, an AI that classifies messages as scam, suspicious, or safe. You MUST base your verdict ONLY on the retrieved scam-pattern excerpts below and on the message itself. Never invent facts, websites, or numbers.

When explaining reasoning, use one short, concrete everyday analogy a non-technical elderly person would immediately recognize (e.g. comparing an urgent bank threat to a stranger demanding your house keys) instead of technical/clinical language. Keep it warm, calm, and reassuring in tone, never alarmist. Your reasoning must reference specific words or phrases from the user's actual message — do not write a generic template that could apply to any message.

Retrieved patterns:
{pattern_lines}

Reply in English, unconditionally — the requested display language is handled by a separate deterministic translation step after you, so never translate or transliterate your output yourself.

If the message text contains generic app security assurances or unrelated UI text (e.g. 'this is secure', 'end-to-end encrypted', delivery/read status), disregard those specific phrases when forming your verdict — reason only about the actual communicated content.

Base your confidence score on how many concrete red flags you found in this specific message — more distinct red flags and stronger keyword/pattern matches should mean higher confidence, weak or single-signal matches should mean lower confidence. Do not default to a round number out of habit.
Return ONLY raw JSON (no markdown, no fences, no commentary) with exactly these keys:
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
    "credited", "withdraw", "proceed to", "before 9pm", "claim",
]

# Same-day deadline pattern: "before 9PM", "before 9pm", "before 9 PM", etc.
# Used alongside literal keyword hits as an extra urgency signal in _mock_score.
_DEADLINE_RE = re.compile(r"before\s+\d{1,2}\s*(am|pm)\b", re.IGNORECASE)

# Hidden/zero-width Unicode characters that can be smuggled into a message to
# evade filters. Presence is treated as a suspicious signal in the mock
# confidence formula.
_HIDDEN_CHARS = set(
    "\u200b\u200c\u200d\u2060\u2061\u2062\u2063\u2064\ufeff\u00ad"
    "\u200e\u200f\u202a\u202b\u202c\u202d\u202e"
)


def _has_hidden_chars(text: str) -> bool:
    return any(ch in _HIDDEN_CHARS for ch in text)


# ---------------------------------------------------------------------------
# Copy tables (English only — Telugu is produced by translate.py)
# ---------------------------------------------------------------------------

# Per-pattern everyday analogies (EN). The mock reasoner picks the analogy of
# the top matched pattern so different scam types never share the same line.
_PATTERN_ANALOGY_EN = {
    "kyc-block-urgency": (
        "This is like a caller warning that your front-door lock will stop "
        "working in 24 hours unless you hand over your keys through the "
        "window — a real bank never fixes your account by making you panic."
    ),
    "otp-upi-phishing": (
        "This is like a stranger at the door asking to borrow your wallet "
        "'just to check it is genuine' — anyone who asks for your OTP or PIN "
        "is really asking for your money."
    ),
    "lottery-prize-fee": (
        "This is like someone on the street promising you a big gift but "
        "demanding cash 'to release it' first — a real prize never arrives "
        "with a fee attached."
    ),
    "relative-distress": (
        "This is like a stranger claiming to be a relative in trouble and "
        "begging you to send money secretly — a real loved one would call you "
        "directly, not ask for a quiet transfer to a stranger's account."
    ),
    "fake-delivery-fee": (
        "This is like a courier demanding a 'small fee' at the door before "
        "letting you see your parcel — genuine deliveries never ask you to "
        "pay through a random link."
    ),
    "guaranteed-investment": (
        "This is like a stranger promising your money will double in a few "
        "days if you hand it over now — if a return is guaranteed, the only "
        "guarantee is that you lose your money."
    ),
    "govt-scheme-processing-fee": (
        "This is like someone at the door saying you owe a small fee before "
        "you can receive a government benefit — real government schemes never "
        "collect processing fees over WhatsApp."
    ),
    "fake-customer-care": (
        "This is like a worker asking you to hand over your payment card "
        "because he claims your bill failed — real companies give you their "
        "own official number, never a random link to call."
    ),
    "job-advance-fee": (
        "This is like an employer offering you a job but asking you to pay "
        "before you start — real jobs pay you, they never ask you to pay "
        "registration or training fees first."
    ),
    "digital-arrest": (
        "This is like someone in a borrowed uniform standing at your door and "
        "ordering you to stay inside and pay money — real police never arrest "
        "anyone over a call or demand payment to 'clear' a case."
    ),
    "vishing-bank-tax-official": (
        "This is like a caller pretending to be both your bank and the tax "
        "office at once, asking you to move your money 'to safety' — officials "
        "never ask you to transfer money to a 'settlement account'."
    ),
    "fake_credit_withdrawal": (
        "This is like a stranger slipping a fake receipt into your pocket that "
        "says you were already paid, then rushing you to tap a link before 9PM "
        "to collect it — real money never needs you to click a random link to "
        "claim or withdraw it."
    ),
    "routine-bill": (
        "This is like a familiar postman dropping off a routine letter you "
        "were already expecting — a regular bill with no panic, no prize, and "
        "no urgent action requested."
    ),
    "user-triggered-otp": (
        "This is like a receipt you printed yourself for a purchase you made — "
        "an OTP you asked for is routine, as long as you share it with no one."
    ),
    "known-contact-routine": (
        "This is like a neighbour waving hello with a normal everyday "
        "message — a routine note from someone you know, with nothing urgent "
        "or money-related in it."
    ),
}

# Generic fallback analogies per verdict, used only when the top pattern has
# no dedicated template above. These are the original everyday analogies.
_REASONING_EN = {
    "scam": (
        "This is like a stranger banging on your front door and shouting that "
        "you must let them in right now or something terrible will happen — "
        "real banks and officials never create that kind of panic."
    ),
    "suspicious": (
        "This is like a visitor who knocks politely but keeps peeking through "
        "your window — probably harmless, but it is wise to check who they "
        "really are before opening the door."
    ),
    "safe": (
        "This is like a familiar postman dropping off a routine letter you "
        "were already expecting — no need to worry."
    ),
}

# Short verdict-specific caution lines appended after the pattern analogy.
_VERDICT_CAUTION_EN = {
    "scam": (
        "Treat this as a scam: do not reply, share nothing, and do not click "
        "any links."
    ),
    "suspicious": (
        "Treat this as suspicious: verify through an official channel before "
        "acting, especially if it asks for money, OTPs, or personal information."
    ),
    "safe": "Treat this as safe: no action is needed.",
}

# Human-readable pattern names, used in the "matches the pattern of ..." line.
_PATTERN_LABEL_EN = {
    "kyc-block-urgency": "KYC block scare",
    "otp-upi-phishing": "OTP/PIN phishing",
    "lottery-prize-fee": "lottery prize fee",
    "relative-distress": "relative in distress",
    "fake-delivery-fee": "fake delivery fee",
    "guaranteed-investment": "guaranteed investment",
    "govt-scheme-processing-fee": "government scheme fee",
    "fake-customer-care": "fake customer care",
    "job-advance-fee": "job advance fee",
    "digital-arrest": "digital arrest",
    "vishing-bank-tax-official": "bank/tax official impersonation",
    "fake_credit_withdrawal": "fake credit withdrawal",
    "routine-bill": "routine bill",
    "user-triggered-otp": "user-triggered OTP",
    "known-contact-routine": "known contact",
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

# English scam keyword -> full-phrase red flag. Every item is a complete
# phrase (>= 10 chars) so no stray single word ever reaches the frontend.
_FLAG_EN = {
    "urgent": "The message pushes urgency to make you act fast.",
    "immediately": "The message tells you to act immediately without thinking.",
    "otp": "The message asks you to share your OTP.",
    "pin": "The message asks you to share your PIN.",
    "cvv": "The message asks you to share your card CVV.",
    "arrest": "The message threatens you with arrest.",
    "won": "The message says you have won something.",
    "winner": "The message calls you a prize winner.",
    "click here": "The message tells you to click a link.",
    "link": "The message directs you to a link.",
    "kyc": "The message claims your KYC has expired.",
    "blocked": "The message claims your account will be blocked.",
    "block": "The message claims your account will be blocked.",
    "account": "The message talks about your bank account.",
    "refund": "The message promises you a refund.",
    "fee": "The message asks you to pay a fee.",
    "pay": "The message asks you to pay money.",
    "send money": "The message asks you to send money.",
    "transfer": "The message asks you to transfer money.",
    "cbi": "The message claims to be from the CBI.",
    "police": "The message claims to be from the police.",
    "customs": "The message claims to be from customs.",
    "lottery": "The message mentions a lottery.",
    "prize": "The message mentions a prize.",
    "guaranteed": "The message guarantees returns.",
    "returns": "The message promises high returns.",
    "double your money": "The message promises to double your money.",
    "aadhaar": "The message asks for your Aadhaar details.",
    "subsidy": "The message mentions a government subsidy.",
    "scheme": "The message mentions a government scheme.",
    "job": "The message offers you a job.",
    "salary": "The message mentions a salary.",
    "training": "The message asks for a training fee.",
    "warrant": "The message mentions a warrant.",
    "digital arrest": "The message threatens digital arrest.",
    "delivery": "The message mentions a delivery.",
    "courier": "The message mentions a courier package.",
    "tax": "The message asks you to pay tax.",
    "pan": "The message asks for your PAN details.",
    "money laundering": "The message accuses you of money laundering.",
    "wallet": "The message mentions a wallet.",
    "reward": "The message promises a reward.",
    "free": "The message offers something free.",
    "processing": "The message asks for a processing fee.",
    "credited": "The message claims money was credited to your account.",
    "withdraw": "The message urges you to withdraw money via a link.",
    "proceed to": "The message tells you to 'proceed' via a link before a deadline.",
    "before 9pm": "The message pressures you with a same-day deadline.",
    "claim": "The message urges you to claim money via a link.",
    "before deadline": "The message pressures you with a same-day deadline.",
}

# English default phrases per verdict, used when fragment-filtering empties a
# list. These are English because the deterministic translation step runs
# AFTER filtering, so defaults get translated along with everything else.
_DEFAULT_FLAG = {
    "scam": "The message pressures you with urgency or demands personal details.",
    "suspicious": "The message asks for money, OTPs, or personal information.",
    "safe": "No red flags were found.",
}
_DEFAULT_ADVICE = {
    "scam": "Do not reply or share anything; report it to your bank or the police (cyber cell / 1930).",
    "suspicious": "Verify the message through an official channel before acting.",
    "safe": "No action is needed; keep using official apps and websites.",
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


def _coerce_verdict_dict(raw: dict) -> dict:
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


def _drop_fragments(result: dict) -> dict:
    """Drop stray fragments (< 10 chars) from red_flags/advice.

    If filtering empties a list, replace it with one sensible default phrase
    for the verdict category. A single word must never reach the frontend as
    a red flag or advice item. Runs in English, BEFORE the deterministic
    translation step.
    """
    for field in ("red_flags", "advice"):
        cleaned = [
            str(item).strip()
            for item in result[field]
            if len(str(item).strip()) >= 10
        ]
        if not cleaned:
            defaults = _DEFAULT_FLAG if field == "red_flags" else _DEFAULT_ADVICE
            cleaned = [defaults[result["verdict"]]]
        result[field] = cleaned
    return result


def _groq_verdict(message: str, patterns: list[RetrievedPattern]) -> dict:
    """Call Groq's openai/gpt-oss-120b, strictly grounded in `patterns`.

    Always asks for English output — translation to Telugu happens later in
    get_verdict, so the model is never asked to write Telugu itself.

    Rate-limit handling: the free tier can return HTTP 429 under bursts. The
    call is retried once after a short delay; if it still fails, the caller
    falls back to the mock reasoner (the service never hard-fails).
    """
    from groq import Groq  # imported lazily so the module works without the dep

    client = Groq(api_key=os.environ["GROQ_API_KEY"])

    pattern_lines = "\n".join(f"- [{p.category}] {p.text}" for p in patterns)
    system_prompt = SYSTEM_TEMPLATE.format(pattern_lines=pattern_lines)

    kwargs = dict(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": message},
        ],
        temperature=0.2,
        max_tokens=600,
    )

    attempt = 0
    while True:
        try:
            response = client.chat.completions.create(**kwargs)
            break
        except Exception as exc:
            if attempt == 0 and getattr(exc, "status_code", None) == 429:
                logger.warning("Groq rate limited (429); retrying after %.1fs.", _VERDICT_RETRY_DELAY_S)
                time.sleep(_VERDICT_RETRY_DELAY_S)
                attempt = 1
                continue
            raise

    content = response.choices[0].message.content or ""
    return _coerce_verdict_dict(json.loads(_strip_code_fences(content)))


def _mock_score(message: str, patterns: list[RetrievedPattern]) -> tuple:
    """Shared deterministic scoring for the offline mock reasoner.

    Strategy:
      - the top retrieved pattern's category is the base signal;
      - a keyword-urgency heuristic counts distinct scam trigger words in the
        message; 0 hits and a weak match can downgrade a scam base to
        suspicious, and 2+ hits can upgrade a safe base to suspicious.

    Confidence formula (explicit and deterministic):
        base by verdict category:  scam 55, suspicious 40/45, safe 65
      + 5 per distinct urgency-keyword hit, capped at +20 total
      + up to +30 from the top retrieved pattern's similarity score
        (int(score * 60), capped at 30)
      + 5 if the message contains hidden/zero-width Unicode characters
        (a suspicious signal from the Unicode scan)
      clamped to [15, 97] — never exactly 0 or 100.

    Returns (top, hits, score, verdict, confidence) where hits is the ordered
    list of matched urgency keywords (so reasoning can name them).
    """
    top = patterns[0]
    lowered = message.lower()
    hits = [kw for kw in SCAM_KEYWORDS if kw in lowered]
    # Regex-based deadline detection: "before 9PM", "before 10 AM", etc.
    # Counts as an extra urgency signal even if the literal "before 9pm" phrase
    # wasn't matched (e.g. "before 10am"). Maps to pseudo-keyword "before deadline".
    if _DEADLINE_RE.search(message) and "before deadline" not in hits:
        hits.append("before deadline")
    score = top.score

    if top.category == "scam":
        if len(hits) >= 2 or score >= 0.25:
            verdict, base_conf = "scam", 55
        else:
            verdict, base_conf = "suspicious", 40
    else:  # top pattern is safe
        if len(hits) >= 2:
            verdict, base_conf = "suspicious", 45
        else:
            verdict, base_conf = "safe", 65

    confidence = base_conf
    confidence += min(int(score * 60), 30)
    confidence += min(len(hits) * 5, 20)
    if _has_hidden_chars(message):
        confidence += 5
    confidence = max(15, min(97, confidence))

    return top, hits, score, verdict, confidence


def _mock_reason(message: str, hits: list[str], top: RetrievedPattern, verdict: str) -> str:
    """Specific, grounded English reasoning for the mock path.

    Names which urgency keywords actually matched and which pattern was the
    top match, then uses that pattern's own analogy so different scam types
    never reuse the same line.
    """
    label = _PATTERN_LABEL_EN.get(top.id, top.category)
    noun = "scams" if top.category == "scam" else "messages"
    if hits:
        words = ", ".join(f"'{h}'" for h in hits[:4])
        match_line = (
            f"This message uses pressure words like {words} and matches the "
            f"pattern of {label} {noun}."
        )
    else:
        match_line = f"This message matches the pattern of {label} {noun}."
    analogy = _PATTERN_ANALOGY_EN.get(top.id, _REASONING_EN[verdict])
    return f"{match_line} {analogy} {_VERDICT_CAUTION_EN[verdict]}"


def _mock_verdict(message: str, patterns: list[RetrievedPattern]) -> dict:
    """Deterministic offline reasoner — no network, fully testable.

    Always produces English output (the same language both paths generate
    in); Telugu is produced by the translation step in get_verdict.
    """
    top, hits, _, verdict, confidence = _mock_score(message, patterns)

    flags: list[str] = []
    for kw in hits:
        phrase = _FLAG_EN.get(kw, "The message shows a scam warning sign.")
        if phrase not in flags:
            flags.append(phrase)
        if len(flags) >= 5:
            break

    return {
        "verdict": verdict,
        "confidence": confidence,
        "reasoning": _mock_reason(message, hits, top, verdict),
        "red_flags": flags,
        "advice": _ADVICE_EN[verdict],
    }


def get_verdict(message: str, patterns: list[RetrievedPattern], language: str = "en") -> dict:
    """Return {verdict, confidence, reasoning, red_flags[], advice[]}.

    Uses Groq when GROQ_API_KEY is set; otherwise falls back to the mock
    reasoner (and also on any Groq/network error, so the service never
    hard-fails because of the LLM provider).

    Language handling: both paths generate ENGLISH only. For language == "te"
    the final English strings are translated deterministically — reasoning
    and every red_flags/advice item, one by one — as the last step before
    returning. For "en" no translation happens. translate_text fails safe
    (returns the English text unchanged) if the translation service is
    unreachable, so the service never crashes because of translation.

    Fragment safeguard: red_flags/advice items shorter than 10 characters are
    dropped BEFORE translation; emptied lists get a default phrase, which is
    then translated along with everything else.

    Rate-limit safeguard: the final English verdict (post fragment-filtering,
    pre translation) is cached by (message, matched pattern ids). Scam texts
    circulate verbatim, so repeats are answered from cache without hitting
    the LLM — the main defence against free-tier 429s, on top of the one
    retry inside _groq_verdict.
    """
    cache_key = (message, tuple(p.id for p in patterns))
    cached = _VERDICT_CACHE.get(cache_key)
    if cached is None:
        result: dict = _mock_verdict(message, patterns)

        if os.environ.get("GROQ_API_KEY"):
            try:
                result = _groq_verdict(message, patterns)
            except Exception as exc:  # network, quota, malformed JSON, ...
                logger.warning("Groq verdict failed (%s); using mock reasoner.", exc)
                result = _mock_verdict(message, patterns)

        result = _drop_fragments(result)

        if len(_VERDICT_CACHE) >= _VERDICT_CACHE_MAX:
            _VERDICT_CACHE.pop(next(iter(_VERDICT_CACHE)))
        _VERDICT_CACHE[cache_key] = result
    else:
        result = dict(cached)

    if language == "te":
        # Second-level cache keyed by (message, pattern ids, language): stores
        # the POST-translation verdict so repeat Telugu analyses cost zero
        # translator requests (the English _VERDICT_CACHE above stays
        # language-neutral because translation depends on the requested lang).
        translated_key = (message, tuple(p.id for p in patterns), "te")
        translated_cached = _TRANSLATED_CACHE.get(translated_key)
        if translated_cached is not None:
            return dict(translated_cached)

        try:
            fields = {
                "reasoning": result["reasoning"],
                "red_flags": result["red_flags"],
                "advice": result["advice"],
            }
            done = translate_verdict_payload(fields, "te", result["verdict"])
            result.update(done)
            if len(_TRANSLATED_CACHE) >= _TRANSLATED_CACHE_MAX:
                _TRANSLATED_CACHE.pop(next(iter(_TRANSLATED_CACHE)))
            _TRANSLATED_CACHE[translated_key] = dict(result)
        except TranslationError as exc:
            # Every translation backend is down. Degrade gracefully: keep the
            # English content so the pipeline never crashes, but make the
            # breakage loud in the server console.
            logger.warning(
                "Translation unavailable for a Telugu request; returning English "
                "content. Detail: %s",
                exc,
            )

    return result
