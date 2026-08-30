"""
LAYER 1 DIAGNOSTIC — standalone Gemini vision API test.
Run from backend/ with: python test_gemini_direct.py
This bypasses FastAPI entirely — it calls Gemini directly using the
EXACT same request format as /extract-message-from-image in main.py.
"""

import base64
import json
import os
import sys

# ---------------------------------------------------------------------------
# Load API key from .env manually (no dotenv dependency needed)
# ---------------------------------------------------------------------------
env_path = os.path.join(os.path.dirname(__file__), ".env")
api_key = None
if os.path.exists(env_path):
    with open(env_path) as f:
        for line in f:
            line = line.strip()
            if line.startswith("GEMINI_API_KEY="):
                api_key = line.split("=", 1)[1].strip().strip('"').strip("'")
                break

if not api_key:
    # fallback: check environment
    api_key = os.environ.get("GEMINI_API_KEY", "")

if not api_key:
    print("ERROR: GEMINI_API_KEY not found in .env or environment")
    sys.exit(1)

print(f"[KEY] Using API key starting with: {api_key[:12]}... (len={len(api_key)})")

# ---------------------------------------------------------------------------
# Pick the test image — use cropped_sms.png if it exists, else fullscreen
# ---------------------------------------------------------------------------
backend_dir = os.path.dirname(__file__)
candidates = ["cropped_sms.png", "fullscreen_sms.png"]
image_path = None
for c in candidates:
    p = os.path.join(backend_dir, c)
    if os.path.exists(p):
        image_path = p
        break

if not image_path:
    print("ERROR: No test image found in backend/. Expected cropped_sms.png or fullscreen_sms.png")
    sys.exit(1)

print(f"[IMAGE] Using: {image_path}")

with open(image_path, "rb") as f:
    raw_bytes = f.read()

print(f"[IMAGE] Size: {len(raw_bytes)} bytes")

b64 = base64.b64encode(raw_bytes).decode("ascii")

# Detect MIME type from file extension
mime = "image/png"
if image_path.lower().endswith(".jpg") or image_path.lower().endswith(".jpeg"):
    mime = "image/jpeg"
elif image_path.lower().endswith(".webp"):
    mime = "image/webp"

# ---------------------------------------------------------------------------
# Exact same constants as main.py
# ---------------------------------------------------------------------------
VISION_MODEL = "gemini-2.5-flash"
VISION_SYSTEM_PROMPT = (
    "This is a screenshot of a messaging or caller-ID app. Extract ONLY the "
    "actual message text that a person sent or received — the real "
    "SMS/WhatsApp/chat content. Ignore and do NOT include: security notices, "
    "fraud warnings, encryption banners, delivery/read receipts, timestamps, "
    "status bar icons, transaction summary cards, contact names, or any app "
    "interface chrome. Return ONLY the raw message text, exactly as written, "
    "with no commentary, no quotation marks, no explanation of what you excluded."
)
VISION_API_URL = (
    "https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent"
)

# ---------------------------------------------------------------------------
# Exact same payload shape as main.py
# ---------------------------------------------------------------------------
payload = {
    "systemInstruction": {"parts": [{"text": VISION_SYSTEM_PROMPT}]},
    "contents": [
        {
            "parts": [
                {"text": "Extract only the message text from this screenshot."},
                {"inline_data": {"mime_type": mime, "data": b64}},
            ]
        }
    ],
    "generationConfig": {"temperature": 0.1, "maxOutputTokens": 1024},
}

print(f"\n[REQUEST] POST {VISION_API_URL.format(model=VISION_MODEL)}")
print(f"[REQUEST] payload size (approx): {len(json.dumps(payload))} chars")

# ---------------------------------------------------------------------------
# Make the raw HTTP call
# ---------------------------------------------------------------------------
try:
    import requests
except ImportError:
    print("ERROR: requests not installed. Run: pip install requests")
    sys.exit(1)

url = VISION_API_URL.format(model=VISION_MODEL)
resp = requests.post(
    url,
    params={"key": api_key},
    json=payload,
    timeout=60,
)

print(f"\n[RESPONSE] HTTP status: {resp.status_code}")
print(f"[RESPONSE] Headers: {dict(resp.headers)}")
print(f"\n[RESPONSE BODY — RAW]:\n{resp.text}")

# ---------------------------------------------------------------------------
# Try to parse and extract text
# ---------------------------------------------------------------------------
print("\n--- PARSED RESULT ---")
try:
    data = resp.json()
    if "error" in data:
        print(f"LAYER 1: FAIL — API returned error: {data['error']}")
    else:
        parts = (
            data.get("candidates", [{}])[0]
            .get("content", {})
            .get("parts", [])
        )
        text = "".join(p.get("text", "") for p in parts).strip()
        if text:
            print(f"LAYER 1: PASS")
            print(f"Extracted text ({len(text)} chars):\n{text}")
        else:
            finish = data.get("candidates", [{}])[0].get("finishReason", "unknown")
            print(f"LAYER 1: FAIL — No text extracted. finishReason={finish}")
            print(f"Full parsed candidates: {json.dumps(data.get('candidates', []), indent=2)}")
except Exception as e:
    print(f"LAYER 1: FAIL — Could not parse response as JSON: {e}")
