"""
LAYER 3 DIAGNOSTIC — POST test image through the Vite dev proxy (same path the browser uses).
Run from backend/ with: python test_layer3_proxy.py

The frontend calls /api/extract-message-from-image via the Vite proxy.
This script simulates exactly what the browser's fetch() call does.
"""

import json
import os
import sys

try:
    import requests
except ImportError:
    print("ERROR: requests not installed")
    sys.exit(1)

backend_dir = os.path.dirname(__file__)
candidates = ["cropped_sms.png", "fullscreen_sms.png"]
image_path = None
for c in candidates:
    p = os.path.join(backend_dir, c)
    if os.path.exists(p):
        image_path = p
        break

if not image_path:
    print("ERROR: No test image found in backend/")
    sys.exit(1)

print(f"[IMAGE] Using: {image_path}")

with open(image_path, "rb") as f:
    img_bytes = f.read()

print("=== LAYER 3: Through Vite proxy /api/extract-message-from-image ===")
print("(Same URL path the browser's fetch() call uses)")

# Test via the Vite dev proxy path
proxy_url = "http://localhost:5173/api/extract-message-from-image"
direct_url = "http://127.0.0.1:8000/extract-message-from-image"

for label, url in [("VIA VITE PROXY", proxy_url), ("VIA DIRECT (control)", direct_url)]:
    print(f"\n--- {label}: POST {url} ---")
    try:
        r = requests.post(
            url,
            files={"file": ("cropped_sms.png", img_bytes, "image/png")},
            timeout=90,
        )
        print(f"HTTP status: {r.status_code}")
        print(f"Response body: {r.text[:1000]}")
        if r.status_code == 200:
            data = r.json()
            text = data.get("text", "")
            print(f"RESULT: {'PASS' if text else 'FAIL (empty text)'}")
            if text:
                print(f"Extracted text ({len(text)} chars): {text}")
            else:
                print(f"Full response: {json.dumps(data, indent=2)}")
        else:
            print(f"RESULT: FAIL — HTTP {r.status_code}")
    except requests.exceptions.ConnectionError as e:
        print(f"RESULT: FAIL — Connection refused: {e}")
    except Exception as e:
        print(f"RESULT: FAIL — {e}")

# Also test what the frontend logic does with the result
print("\n=== FRONTEND LOGIC CHECK ===")
print("The frontend's vision path (extractViaVision) returns text.trim()")
print("Then handleImageFile checks: if (visionText && visionText.length >= 3)")
try:
    r = requests.post(
        direct_url,
        files={"file": ("cropped_sms.png", img_bytes, "image/png")},
        timeout=90,
    )
    if r.status_code == 200:
        data = r.json()
        text = (data.get("text") or "").strip()
        print(f"text.length = {len(text)}")
        print(f"text && text.length >= 3 → would vision path be used? {bool(text and len(text) >= 3)}")
        if not (text and len(text) >= 3):
            print("FRONTEND LOGIC: FAIL — Vision text would be IGNORED, falling through to Tesseract!")
        else:
            print("FRONTEND LOGIC: PASS — text would be set in textarea via setMessage(visionText)")
            print(f"First 200 chars: {text[:200]}")
    else:
        print(f"Backend returned {r.status_code}, can't check frontend logic")
except Exception as e:
    print(f"ERROR: {e}")
