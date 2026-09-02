"""
Extracts candidate phone numbers from message text so they can be
checked against live web reports (see web_verify.py). Deliberately
permissive — false positives just mean an extra harmless search,
false negatives mean a missed check, so lean toward catching more.
"""
import re

# Matches +91 numbers, bare 10-digit Indian mobile numbers, and
# numbers with common separators (spaces, dashes).
PHONE_PATTERN = re.compile(
    r'(?:\+?91[\s-]?)?[6-9]\d{9}\b'
    r'|'
    r'\+?\d{1,3}[\s-]?\d{3,4}[\s-]?\d{3,4}[\s-]?\d{3,4}'
)


def extract_phone_numbers(text: str) -> list[str]:
    """Return up to 3 deduplicated, normalized phone numbers from *text*."""
    matches = PHONE_PATTERN.findall(text)
    # normalize: strip spaces/dashes for dedup, but keep at most 3
    # to avoid excessive API calls on a message with many numbers
    seen: set[str] = set()
    result: list[str] = []
    for m in matches:
        normalized = re.sub(r'[\s-]', '', m)
        if normalized not in seen and len(normalized) >= 10:
            seen.add(normalized)
            result.append(normalized)
        if len(result) >= 3:
            break
    return result
