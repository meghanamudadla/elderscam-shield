"""Verdict generation.

Two paths:
  1. GROQ_API_KEY set        -> real LLM verdict via Groq (llama-3.3-70b-versatile),
                                strictly grounded in the retrieved patterns.
  2. GROQ_API_KEY unset      -> deterministic offline "mock reasoner" so the whole
                                pipeline is fully testable with no network access.

Both paths return the exact same shape:
  {verdict, confidence, reasoning, red_flags[], advice[]}

Language contract (both paths):
  - when language == "te", every human-facing string (reasoning, every
    red_flags item, every advice item) is a full Telugu sentence. Retrieved
    pattern text is NEVER shown verbatim to the user in any language — it is
    grounding context for reasoning only, never part of the output.
  - no red_flags/advice item shorter than 10 characters ever reaches the
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
# instruction so the model prioritizes warm, human explanation. The CRITICAL
# line enforces the language contract for Telugu responses; the grounding and
# confidence lines stop generic, copy-pasted answers.
SYSTEM_TEMPLATE = """You are Scam Shield, an AI that classifies messages as scam, suspicious, or safe. You MUST base your verdict ONLY on the retrieved scam-pattern excerpts below and on the message itself. Never invent facts, websites, or numbers.

When explaining reasoning, use one short, concrete everyday analogy a non-technical elderly person would immediately recognize (e.g. comparing an urgent bank threat to a stranger demanding your house keys) instead of technical/clinical language. Keep it warm, calm, and reassuring in tone, never alarmist. Your reasoning must reference specific words or phrases from the user's actual message — do not write a generic template that could apply to any message.

Retrieved patterns:
{pattern_lines}

Reply in {language_label}. CRITICAL: every string value in your JSON response (reasoning, each red_flags item, each advice item) MUST be written entirely in Telugu script (Unicode range U+0C00–U+0C7F), with zero English sentences mixed in, whenever the requested language is Telugu. Do not partially translate — translate fully.
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
]

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
# Copy tables
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

# Per-pattern everyday analogies (TE). Full Telugu sentences; no em dashes,
# no double quotes.
_PATTERN_ANALOGY_TE = {
    "kyc-block-urgency": (
        "ఇది మీ ఇంటి తాళం 24 గంటల్లో పని చేయడం ఆగిపోతుందని చెప్పి, కిటికీ గుండా "
        "తాళం చెవి ఇచ్చేయమని ఫోన్ లో భయపెట్టినట్లు ఉంది. నిజమైన బ్యాంక్ ఎప్పుడూ "
        "ఇలా భయం కలిగించి వివరాలు అడగదు."
    ),
    "otp-upi-phishing": (
        "ఇది తలుపు దగ్గర నిలబడిన అపరిచితుడు ఇది నిజమో కాదో చూడటానికి మీ వాలెట్ "
        "అప్పుగా అడిగినట్లు ఉంది. OTP లేదా PIN అడిగే వ్యక్తి నిజానికి మీ డబ్బునే "
        "అడుగుతున్నాడు."
    ),
    "lottery-prize-fee": (
        "ఇది వీధిలో ఎవరో పెద్ద బహుమతి ఇస్తామని చెప్పి, ముందుగా డబ్బు ఇవ్వమని "
        "అడిగినట్లు ఉంది. నిజమైన బహుమతికి ఎప్పుడూ ఫీజు ఉండదు."
    ),
    "relative-distress": (
        "ఇది బంధువు ఇబ్బందులో ఉన్నాడని చెప్పుకుని, రహస్యంగా డబ్బు పంపమని అడిగే "
        "అపరిచితుడిలా ఉంది. నిజమైన బంధువు మిమ్మల్ని నేరుగా పిలుస్తారు, అపరిచిత "
        "ఖాతాకు డబ్బు పంపమని అడగరు."
    ),
    "fake-delivery-fee": (
        "ఇది ప్యాకేజీ చూపించే ముందే చిన్న ఫీజు చెల్లించమని డెలివరీ వ్యక్తి అడిగినట్లు "
        "ఉంది. నిజమైన డెలివరీ సంస్థలు యాప్ ద్వారానే ఛార్జీలు తీసుకుంటాయి."
    ),
    "guaranteed-investment": (
        "ఇది మీ డబ్బు కొన్ని రోజుల్లో రెట్టింపు అవుతుందని చెప్పి ఇప్పుడే ఇచ్చేయమని "
        "అడిగే వ్యక్తిలా ఉంది. హామీ ఇచ్చే పెట్టుబడి అంటే మీ డబ్బు పోతుందని హామీ."
    ),
    "govt-scheme-processing-fee": (
        "ఇది ప్రభుత్వ పథకం డబ్బు రావాలంటే ముందుగా ఫీజు కట్టమని చెప్పే వ్యక్తిలా "
        "ఉంది. నిజమైన ప్రభుత్వ పథకాలు ప్రాసెసింగ్ ఫీజు అడగవు."
    ),
    "fake-customer-care": (
        "ఇది మీ బిల్లు విఫలమైందని చెప్పి, కార్డు వివరాలు అడిగే వ్యక్తిలా ఉంది. "
        "నిజమైన కంపెనీలు వాటి అధికారిక నంబర్ నుండే సంప్రదిస్తాయి."
    ),
    "job-advance-fee": (
        "ఇది ఉద్యోగం ఇస్తామని చెప్పి, పని ప్రారంభించే ముందే డబ్బు కట్టమని అడిగే "
        "యజమానిలా ఉంది. నిజమైన ఉద్యోగం మీకు డబ్బు ఇస్తుంది, మిమ్మల్ని డబ్బు "
        "అడగదు."
    ),
    "digital-arrest": (
        "ఇది యూనిఫాం ధరించిన వ్యక్తి తలుపు దగ్గర నిలబడి ఇంట్లోనే ఉండమని, డబ్బు "
        "కట్టమని ఆదేశించినట్లు ఉంది. నిజమైన పోలీసులు ఫోన్ లో అరెస్ట్ చేయరు "
        "లేదా డబ్బు అడగరు."
    ),
    "vishing-bank-tax-official": (
        "ఇది ఒకే వ్యక్తి బ్యాంక్ మరియు పన్ను శాఖ తరపున మాట్లాడుతూ, డబ్బు "
        "కాపాడటానికి వేరే ఖాతాకు బదిలీ చేయమని అడిగినట్లు ఉంది. అధికారులు "
        "ఎప్పుడూ ఇలా అడగరు."
    ),
    "routine-bill": (
        "ఇది తెలిసిన పోస్ట్‌మేన్ మీరు ఎదురుచూస్తున్న సాధారణ లేఖను ఇచ్చినట్లు "
        "ఉంది. భయం లేని, తొందర లేని సాధారణ బిల్లు ఇది."
    ),
    "user-triggered-otp": (
        "ఇది మీరే చేసిన లావాదేవీకి వచ్చిన రసీదులా ఉంది. మీరే అడిగిన OTP "
        "సాధారణమే, దాన్ని ఎవరికీ ఇవ్వకండి."
    ),
    "known-contact-routine": (
        "ఇది పక్కింటి వారు నమస్కారం చెప్పినట్లు ఉంది. మీకు తెలిసిన వ్యక్తి నుండి "
        "వచ్చిన సాధారణ సందేశం, డబ్బు గురించి ఏమీ లేదు."
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
_REASONING_TE = {
    "scam": (
        "ఇది ఒక అపరిచితుడు మీ ఇంటి తలుపు కొట్టి, వెంటనే తెరవకపోతే చాలా అనర్థం "
        "జరుగుతుందని భయపెడుతున్నట్లు ఉంది. నిజమైన బ్యాంక్ లేదా అధికారి ఎప్పుడూ "
        "ఇలా భయం కలిగించరు."
    ),
    "suspicious": (
        "ఇది మర్యాదగా తలుపు తట్టి, కిటికీ గుండా మెల్లగా చూస్తున్న వ్యక్తిలా ఉంది. "
        "బహుశా నిర్దోషి కావచ్చు, కానీ తలుపు తెరిచే ముందు వారు ఎవరో తెలుసుకోవడం "
        "తెలివైన పని."
    ),
    "safe": (
        "ఇది తెలిసిన పోస్ట్‌మేన్ మీరు ఎదురుచూస్తున్న సాధారణ లేఖను అందించినట్లు "
        "ఉంది, భయపడాల్సిన అవసరం లేదు."
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
_VERDICT_CAUTION_TE = {
    "scam": (
        "దీన్ని మోసంగానే పరిగణించండి: బదులివ్వవద్దు, వివరాలు పంచుకోవద్దు, "
        "లింక్ పై క్లిక్ చేయవద్దు."
    ),
    "suspicious": (
        "దీన్ని అనుమానాస్పదంగా పరిగణించండి: ఏదైనా చర్యకు ముందు అధికారిక మార్గం "
        "ద్వారా ధృవీకరించండి, ముఖ్యంగా డబ్బు, OTP లేదా వివరాలు అడిగితే."
    ),
    "safe": "దీన్ని సురక్షితంగా పరిగణించవచ్చు: ఎటువంటి చర్య అవసరం లేదు.",
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
    "routine-bill": "routine bill",
    "user-triggered-otp": "user-triggered OTP",
    "known-contact-routine": "known contact",
}
_PATTERN_LABEL_TE = {
    "kyc-block-urgency": "KYC బ్లాక్ భయం",
    "otp-upi-phishing": "OTP/PIN ఫిషింగ్",
    "lottery-prize-fee": "లాటరీ బహుమతి ఫీజు",
    "relative-distress": "బంధువు ఇబ్బంది",
    "fake-delivery-fee": "నకిలీ డెలివరీ ఫీజు",
    "guaranteed-investment": "నకిలీ పెట్టుబడి",
    "govt-scheme-processing-fee": "ప్రభుత్వ పథకం ఫీజు",
    "fake-customer-care": "నకిలీ కస్టమర్ కేర్",
    "job-advance-fee": "ఉద్యోగ అడ్వాన్స్ ఫీజు",
    "digital-arrest": "డిజిటల్ అరెస్ట్",
    "vishing-bank-tax-official": "బ్యాంక్/పన్ను అధికారి నటన",
    "routine-bill": "సాధారణ బిల్లు",
    "user-triggered-otp": "మీరే ప్రారంభించిన OTP",
    "known-contact-routine": "తెలిసిన వ్యక్తి సందేశం",
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
        "వెంటనే చర్య తీసుకోకండి. తొందరగా చేయమని ఒత్తిడి చేయడమే ఒక హెచ్చరిక సంకేతం.",
        "అధికారిక మార్గం ద్వారా ధృవీకరించండి (బ్యాంక్ యాప్, ప్రభుత్వ వెబ్‌సైట్, అధికారిక ఫోన్ నంబర్).",
        "OTP, PIN లేదా డబ్బు అడిగితే నిరూపించబడే వరకు దాన్ని మోసంగానే పరిగణించండి.",
        "పంపినవారి నంబర్ ను సంస్థ యొక్క అధికారిక కాంటాక్ట్ తో సరిపోల్చండి.",
    ],
    "safe": [
        "ఎటువంటి చర్య అవసరం లేదు. ఇది సాధారణ రొటీన్ సందేశంగా కనిపిస్తోంది.",
        "మీరు అడగని OTP గురించి ఉంటే దాన్ని డిలీట్ చేయండి మరియు ఎవరికీ ఇవ్వవద్దు.",
        "చెల్లింపుల కోసం అధికారిక యాప్ లు మరియు వెబ్‌సైట్ లను మాత్రమే ఉపయోగించండి.",
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
}

# English scam keyword -> Telugu red-flag sentence. Full Telugu sentences.
_FLAG_TE = {
    "urgent": "అత్యవసరమని ఒత్తిడి చేస్తోంది",
    "immediately": "వెంటనే చేయమని ఒత్తిడి చేస్తోంది",
    "otp": "OTP అడుగుతోంది",
    "pin": "PIN అడుగుతోంది",
    "cvv": "CVV అడుగుతోంది",
    "arrest": "అరెస్ట్ చేస్తామని బెదిరిస్తోంది",
    "won": "మీరు గెలిచారని చెబుతోంది",
    "winner": "మీరు బహుమతి గెలిచారని చెబుతోంది",
    "click here": "లింక్ పై క్లిక్ చేయమని చెబుతోంది",
    "link": "ఒక లింక్ పంపుతోంది",
    "kyc": "KYC గడువు ముగిసిందని చెబుతోంది",
    "blocked": "ఖాతా బ్లాక్ అవుతుందని చెబుతోంది",
    "block": "ఖాతా బ్లాక్ అవుతుందని చెబుతోంది",
    "account": "బ్యాంక్ ఖాతా గురించి చెబుతోంది",
    "refund": "రీఫండ్ ఇస్తామని చెబుతోంది",
    "fee": "ఫీజు కట్టమని అడుగుతోంది",
    "pay": "డబ్బు చెల్లించమని అడుగుతోంది",
    "send money": "డబ్బు పంపమని అడుగుతోంది",
    "transfer": "డబ్బు బదిలీ చేయమని అడుగుతోంది",
    "cbi": "CBI అధికారి పేరు చెబుతోంది",
    "police": "పోలీసులు అని చెప్పుకుంటోంది",
    "customs": "కస్టమ్స్ అధికారులు అని చెప్పుకుంటోంది",
    "lottery": "లాటరీ గురించి చెబుతోంది",
    "prize": "బహుమతి గురించి చెబుతోంది",
    "guaranteed": "హామీ ఇస్తున్నామని చెబుతోంది",
    "returns": "ఎక్కువ లాభం వస్తుందని చెబుతోంది",
    "double your money": "డబ్బు రెట్టింపు అవుతుందని చెబుతోంది",
    "aadhaar": "ఆధార్ వివరాలు అడుగుతోంది",
    "subsidy": "సబ్సిడీ గురించి చెబుతోంది",
    "scheme": "ఏదో పథకం గురించి చెబుతోంది",
    "job": "ఉద్యోగం ఇస్తామని చెబుతోంది",
    "salary": "జీతం గురించి చెబుతోంది",
    "training": "ట్రైనింగ్ కోసం డబ్బు అడుగుతోంది",
    "warrant": "వారెంట్ ఉందని చెబుతోంది",
    "digital arrest": "డిజిటల్ అరెస్ట్ చేస్తామని బెదిరిస్తోంది",
    "delivery": "డెలివరీ గురించి చెబుతోంది",
    "courier": "కొరియర్ ప్యాకేజీ గురించి చెబుతోంది",
    "tax": "పన్ను చెల్లించమని అడుగుతోంది",
    "pan": "PAN వివరాలు అడుగుతోంది",
    "money laundering": "మనీ లాండరింగ్ ఆరోపణ చేస్తోంది",
    "wallet": "వాలెట్ గురించి చెబుతోంది",
    "reward": "బహుమతి ఇస్తామని చెబుతోంది",
    "free": "ఉచితంగా ఇస్తామని చెబుతోంది",
    "processing": "ప్రాసెసింగ్ ఫీజు అడుగుతోంది",
}

# Bilingual default phrases, used when fragment-filtering empties a list.
_DEFAULT_FLAG = {
    "en": {
        "scam": "The message pressures you with urgency or demands personal details.",
        "suspicious": "The message asks for money, OTPs, or personal information.",
        "safe": "No red flags were found.",
    },
    "te": {
        "scam": "ఈ సందేశం ఒత్తిడి చేస్తూ వ్యక్తిగత వివరాలు అడుగుతోంది.",
        "suspicious": "ఈ సందేశం డబ్బు, OTP లేదా వ్యక్తిగత సమాచారం అడుగుతోంది.",
        "safe": "ఎటువంటి హెచ్చరికలు కనుగొనబడలేదు.",
    },
}
_DEFAULT_ADVICE = {
    "en": {
        "scam": "Do not reply or share anything; report it to your bank or the police (cyber cell / 1930).",
        "suspicious": "Verify the message through an official channel before acting.",
        "safe": "No action is needed; keep using official apps and websites.",
    },
    "te": {
        "scam": "బదులివ్వవద్దు లేదా వివరాలు పంచుకోవద్దు; మీ బ్యాంక్ కు లేదా పోలీసులకు (సైబర్ సెల్ / 1930) నివేదించండి.",
        "suspicious": "చర్య తీసుకునే ముందు అధికారిక మార్గం ద్వారా ధృవీకరించండి.",
        "safe": "ఎటువంటి చర్య అవసరం లేదు; అధికారిక యాప్ లు మరియు వెబ్‌సైట్ లను ఉపయోగించండి.",
    },
}

# Hardcoded, fully-Telugu generic templates used only if the real LLM path
# twice fails the Telugu language-conformance check. Keyed by verdict.
_TELUGU_FALLBACK = {
    "scam": {
        "verdict": "scam",
        "confidence": 88,
        "reasoning": (
            "ఈ సందేశంలో మోసానికి సంబంధించిన స్పష్టమైన సంకేతాలు ఉన్నాయి. "
            "డబ్బు చెల్లించవద్దు, ఏ లింక్ పైనా క్లిక్ చేయవద్దు, ఎవరికీ "
            "వ్యక్తిగత వివరాలు ఇవ్వవద్దు."
        ),
        "red_flags": [
            "డబ్బు లేదా వ్యక్తిగత వివరాలు అడుగుతోంది",
            "ఒత్తిడి లేదా తొందరపాటు భాష ఉంది",
        ],
        "advice": [
            "ఎటువంటి డబ్బు చెల్లించవద్దు లేదా వివరాలు పంచుకోవద్దు.",
            "మీ బ్యాంక్ కు లేదా పోలీసులకు (సైబర్ సెల్ / 1930) నివేదించండి.",
        ],
    },
    "suspicious": {
        "verdict": "suspicious",
        "confidence": 55,
        "reasoning": (
            "ఈ సందేశంలో కొన్ని అనుమానాస్పద సంకేతాలు ఉన్నాయి. ఏదైనా చర్య "
            "తీసుకునే ముందు అధికారిక మార్గం ద్వారా ధృవీకరించండి."
        ),
        "red_flags": [
            "తెలియని లేదా ధృవీకరించని పంపినవారు",
            "డబ్బు, OTP లేదా వ్యక్తిగత వివరాలు అడగవచ్చు",
        ],
        "advice": [
            "అధికారిక చానల్ ద్వారా నిర్ధారించుకోండి.",
            "OTP, PIN లేదా డబ్బు అడిగితే మోసంగానే పరిగణించండి.",
        ],
    },
    "safe": {
        "verdict": "safe",
        "confidence": 70,
        "reasoning": (
            "ఈ సందేశంలో మోసానికి సంబంధించిన సంకేతాలు కనిపించలేదు. ఇది "
            "సాధారణ రోజువారీ సందేశంలా ఉంది."
        ),
        "red_flags": [],
        "advice": [
            "ఎటువంటి చర్య అవసరం లేదు.",
            "మీరు అడగని OTP గురించి ఉంటే దాన్ని ఎవరికీ ఇవ్వవద్దు.",
        ],
    },
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


def _contains_telugu(text: str) -> bool:
    """True if any character of `text` is in the Telugu Unicode block."""
    return any(0x0C00 <= ord(ch) <= 0x0C7F for ch in text)


def _non_telugu_fields(result: dict) -> list[str]:
    """Fields that violate the Telugu language contract (empty lists pass)."""
    missing: list[str] = []
    if not _contains_telugu(result["reasoning"]):
        missing.append("reasoning")
    if result["red_flags"] and any(
        not _contains_telugu(str(flag)) for flag in result["red_flags"]
    ):
        missing.append("red_flags")
    if result["advice"] and any(
        not _contains_telugu(str(step)) for step in result["advice"]
    ):
        missing.append("advice")
    return missing


def _drop_fragments(result: dict, language: str) -> dict:
    """Drop stray fragments (< 10 chars) from red_flags/advice.

    If filtering empties a list, replace it with one sensible bilingual
    default phrase for the verdict category. A single word must never reach
    the frontend as a red flag or advice item.
    """
    for field in ("red_flags", "advice"):
        cleaned = [
            str(item).strip()
            for item in result[field]
            if len(str(item).strip()) >= 10
        ]
        if not cleaned:
            defaults = _DEFAULT_FLAG if field == "red_flags" else _DEFAULT_ADVICE
            cleaned = [defaults[language][result["verdict"]]]
        result[field] = cleaned
    return result


def _groq_verdict(
    message: str,
    patterns: list[RetrievedPattern],
    language: str,
    insist_telugu: bool = False,
) -> dict:
    """Call Groq's llama-3.3-70b-versatile, strictly grounded in `patterns`."""
    from groq import Groq  # imported lazily so the module works without the dep

    client = Groq(api_key=os.environ["GROQ_API_KEY"])

    pattern_lines = "\n".join(f"- [{p.category}] {p.text}" for p in patterns)
    language_label = "English" if language == "en" else "Telugu (తెలుగు)"

    system_prompt = SYSTEM_TEMPLATE.format(
        pattern_lines=pattern_lines, language_label=language_label
    )
    if insist_telugu:
        system_prompt += (
            "\nYour previous response was not in Telugu — respond only in Telugu this time."
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


def _mock_reason_en(
    message: str, hits: list[str], top: RetrievedPattern, verdict: str
) -> str:
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


def _mock_reason_te(
    message: str, hits: list[str], top: RetrievedPattern, verdict: str
) -> str:
    """Specific, grounded Telugu reasoning for the mock path.

    Same structure as the English variant but every sentence is Telugu; the
    matched English keywords are quoted as-is (they are words from the user's
    own message), never translated English sentences.
    """
    label = _PATTERN_LABEL_TE.get(top.id, "మోసం")
    noun = "మోసాల" if top.category == "scam" else ""
    if hits:
        words = ", ".join(f"'{h}'" for h in hits[:4])
        match_line = (
            f"ఈ సందేశంలో {words} వంటి ఒత్తిడి పదాలు ఉన్నాయి మరియు ఇది {label} "
            f"{noun} నమూనాతో సరిపోతుంది."
        )
    else:
        match_line = f"ఈ సందేశం {label} {noun} నమూనాతో సరిపోతుంది."
    analogy = _PATTERN_ANALOGY_TE.get(top.id, _REASONING_TE[verdict])
    return f"{match_line} {analogy} {_VERDICT_CAUTION_TE[verdict]}"


def _mock_verdict_en(message: str, patterns: list[RetrievedPattern]) -> dict:
    """English copy of the offline mock reasoner."""
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
        "reasoning": _mock_reason_en(message, hits, top, verdict),
        "red_flags": flags,
        "advice": _ADVICE_EN[verdict],
    }


def _mock_verdict_te(message: str, patterns: list[RetrievedPattern]) -> dict:
    """Telugu copy of the offline mock reasoner.

    Every returned string is a full Telugu sentence: reasoning references the
    specific matched pattern and keywords, red_flags are mapped keywords to
    Telugu flag sentences (deduplicated), and advice comes from the Telugu
    copy table.
    """
    top, hits, _, verdict, confidence = _mock_score(message, patterns)

    flags: list[str] = []
    for kw in hits:
        sentence = _FLAG_TE.get(kw) or "మోసపూరిత సూచన కనుగొనబడింది"
        if sentence not in flags:
            flags.append(sentence)
        if len(flags) >= 5:
            break

    return {
        "verdict": verdict,
        "confidence": confidence,
        "reasoning": _mock_reason_te(message, hits, top, verdict),
        "red_flags": flags,
        "advice": _ADVICE_TE[verdict],
    }


def _mock_verdict(message: str, patterns: list[RetrievedPattern], language: str) -> dict:
    """Deterministic offline reasoner — no network, fully testable.

    The language parameter is the FIRST thing branched on: everything returned
    is selected from the language's own copy tables, so a Telugu request can
    never receive English output (or retrieved pattern text, which is never
    shown verbatim in any language).
    """
    if language == "te":
        return _mock_verdict_te(message, patterns)
    return _mock_verdict_en(message, patterns)


def get_verdict(message: str, patterns: list[RetrievedPattern], language: str = "en") -> dict:
    """Return {verdict, confidence, reasoning, red_flags[], advice[]}.

    Uses Groq when GROQ_API_KEY is set; otherwise falls back to the mock
    reasoner (and also on any Groq/network error, so the service never
    hard-fails because of the LLM provider).

    Language-conformance safeguard: for Telugu requests, reasoning, EVERY
    red_flags item, and EVERY advice item must contain Telugu script. The
    mock path is structurally Telugu; a violation in the real LLM path
    triggers ONE retry with an even more explicit instruction, and any field
    still failing is replaced with the hardcoded fully-Telugu template for
    that verdict — English is never shown to a Telugu user.

    Fragment safeguard: red_flags/advice items shorter than 10 characters are
    dropped; emptied lists get a bilingual default phrase for the verdict.
    """
    result: dict = _mock_verdict(message, patterns, language)

    if os.environ.get("GROQ_API_KEY"):
        try:
            result = _groq_verdict(message, patterns, language)
        except Exception as exc:  # network, quota, malformed JSON, ...
            logger.warning("Groq verdict failed (%s); using mock reasoner.", exc)
            result = _mock_verdict(message, patterns, language)

        if language == "te":
            missing = _non_telugu_fields(result)
            if missing:
                logger.warning(
                    "Groq returned non-Telugu fields %s; retrying once with a "
                    "stronger instruction.",
                    missing,
                )
                try:
                    result = _groq_verdict(message, patterns, language, insist_telugu=True)
                except Exception as exc:
                    logger.warning("Groq retry failed (%s); using mock reasoner.", exc)
                    result = _mock_verdict(message, patterns, language)
                missing = _non_telugu_fields(result)
                if missing:
                    logger.warning(
                        "Groq still failed Telugu conformance on fields %s; "
                        "replacing them with the hardcoded Telugu template.",
                        missing,
                    )
                    fallback = _TELUGU_FALLBACK[result["verdict"]]
                    for field in missing:
                        result[field] = fallback[field]

    result = _drop_fragments(result, language)
    return result