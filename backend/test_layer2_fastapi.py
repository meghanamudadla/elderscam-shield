"""
LAYER 2 DIAGNOSTIC — POST test image directly to FastAPI /extract-message-from-image.
Run from backend/ with: python test_layer2_fastapi.py
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

print("=== LAYER 2: FastAPI /extract-message-from-image ===")
print(f"[REQUEST] POST http://127.0.0.1:8000/extract-message-from-image")
print(f"[REQUEST] file size: {len(img_bytes)} bytes")

try:
    r = requests.post(
        "http://127.0.0.1:8000/extract-message-from-image",
        files={"file": ("cropped_sms.png", img_bytes, "image/png")},
        timeout=90,
    )
    print(f"\n[RESPONSE] HTTP status: {r.status_code}")
    print(f"[RESPONSE] body: {r.text}")

    if r.status_code == 200:
        data = r.json()
        text = data.get("text", "")
        if text:
            print(f"\nLAYER 2: PASS")
            print(f"Extracted text ({len(text)} chars):\n{text}")
        else:
            print("\nLAYER 2: FAIL — HTTP 200 but no 'text' field in response")
            print(json.dumps(data, indent=2))
    else:
        print(f"\nLAYER 2: FAIL — HTTP {r.status_code}")
        try:
            print(json.dumps(r.json(), indent=2))
        except Exception:
            print(r.text)
except requests.exceptions.ConnectionError as e:
    print(f"\nLAYER 2: FAIL — Backend not reachable: {e}")
    print("Is the backend running? Start it with: uvicorn app.main:app --reload")
except Exception as e:
    print(f"\nLAYER 2: FAIL — Unexpected error: {e}")
