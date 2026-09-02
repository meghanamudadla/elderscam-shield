"""
Raw OCR extraction via OCR.space — a dedicated OCR engine, used
ONLY for turning image pixels into raw text. It does not attempt
to understand or filter content — that's a separate step (see
main.py's use of Groq for semantic filtering after this).
"""
import os
import requests

OCRSPACE_URL = "https://api.ocr.space/parse/image"


def extract_raw_text(file_bytes: bytes, filename: str) -> str:
    api_key = os.environ.get("OCRSPACE_API_KEY")
    if not api_key:
        raise RuntimeError("OCRSPACE_API_KEY not configured")

    response = requests.post(
        OCRSPACE_URL,
        files={"file": (filename, file_bytes)},
        data={
            "apikey": api_key,
            "language": "eng",
            "OCREngine": "2",  # engine 2 = better accuracy, handles varied layouts better
            "scale": "true",   # auto-upscale small/low-res images
            "detectOrientation": "true",
        },
        timeout=30,
    )
    response.raise_for_status()
    data = response.json()
    if data.get("IsErroredOnProcessing"):
        raise RuntimeError(f"OCR.space error: {data.get('ErrorMessage')}")
    parsed = data.get("ParsedResults", [{}])[0]
    return parsed.get("ParsedText", "").strip()
