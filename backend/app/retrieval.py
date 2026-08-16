"""TF-IDF retrieval over the static knowledge base.

Kept deliberately dependency-light: scikit-learn only, no model downloads.
For a real deployment this would be a vector DB (see README), but TF-IDF is
surprisingly effective for short pattern matching and runs offline.
"""

from dataclasses import dataclass

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import cosine_similarity

from .knowledge_base import KNOWLEDGE_BASE


@dataclass(frozen=True)
class RetrievedPattern:
    id: str
    category: str
    text: str
    score: float


class SimpleRetriever:
    def __init__(self, patterns: list[dict] | None = None) -> None:
        self.patterns = list(patterns or KNOWLEDGE_BASE)
        texts = [p["text"] for p in self.patterns]
        self._vectorizer = TfidfVectorizer(
            stop_words="english",
            ngram_range=(1, 2),
            lowercase=True,
        )
        # fit_transform on the knowledge base; query vectors are transformed
        # against the same vocabulary at retrieval time.
        self._pattern_matrix = self._vectorizer.fit_transform(texts)

    def retrieve(self, query: str, k: int = 4) -> list[RetrievedPattern]:
        """Rank knowledge-base patterns against the query, descending by score.

        Always returns at least 1 result, even on a very weak match — the
        pipeline needs *something* to reason over. The fallback result is the
        most similar pattern by raw score (which will just be low).
        """
        query_vec = self._vectorizer.transform([query or ""])
        scores = cosine_similarity(query_vec, self._pattern_matrix).flatten()
        ranked = sorted(
            (
                RetrievedPattern(
                    id=p["id"],
                    category=p["category"],
                    text=p["text"],
                    score=float(score),
                )
                for p, score in zip(self.patterns, scores)
            ),
            key=lambda r: r.score,
            reverse=True,
        )
        return ranked[: max(1, min(k, len(ranked)))]


_retriever: SimpleRetriever | None = None


def get_retriever() -> SimpleRetriever:
    """Module-level singleton so the vectorizer is fit only once per process."""
    global _retriever
    if _retriever is None:
        _retriever = SimpleRetriever()
    return _retriever