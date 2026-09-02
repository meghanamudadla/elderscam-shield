"""
Checks a phone number against live web search results for public
scam reports. This is a REAL-TIME grounding source, separate from
the static local knowledge base — it can catch specific reported
numbers the local knowledge base was never seeded with.
"""
import logging
import os

logger = logging.getLogger(__name__)

SCAM_INDICATOR_WORDS = [
    "scam", "fraud", "fake", "spam", "reported", "block this number",
    "cheater", "cheat", "beware",
]


def check_number_reputation(phone_number: str) -> dict:
    """Search the live web for scam/fraud reports about *phone_number*.

    Returns a dict with keys:
      checked   — True if a search was actually performed
      suspicious — True if scam-indicator words were found in results
      summary   — human-readable summary of what was found (or why not)
      top_titles — up to 3 result titles (empty list if unchecked)
    """
    api_key = os.environ.get("TAVILY_API_KEY")
    if not api_key:
        return {"checked": False, "suspicious": False, "summary": None, "top_titles": []}

    try:
        from tavily import TavilyClient  # lazy import — module works without dep

        client = TavilyClient(api_key=api_key)
        response = client.search(
            query=f'"{phone_number}" scam OR fraud OR complaint OR reported number',
            search_depth="basic",
            max_results=5,
        )
        results = response.get("results", [])
        combined_text = " ".join(r.get("content", "") for r in results).lower()
        hits = [w for w in SCAM_INDICATOR_WORDS if w in combined_text]

        return {
            "checked": True,
            "suspicious": len(hits) > 0,
            "summary": (
                f"Found {len(results)} web result(s), {len(hits)} scam-indicator terms"
                if results
                else "No web results found"
            ),
            "top_titles": [r.get("title", "") for r in results[:3]],
        }
    except Exception as e:
        # Never let a search failure break the whole verdict pipeline
        logger.warning("Tavily web search failed for %s: %s", phone_number, e)
        return {"checked": False, "suspicious": False, "summary": f"Search failed: {e}", "top_titles": []}
