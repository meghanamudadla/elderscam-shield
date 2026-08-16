"""Pydantic request/response models shared by the API."""

from pydantic import BaseModel, Field


class AnalyzeRequest(BaseModel):
    message: str = Field(..., description="The suspicious message to analyze")
    language: str = Field("en", description='Reply language: "en" or "te"')


class VerdictResponse(BaseModel):
    verdict: str = Field(..., description='One of "scam", "suspicious", "safe"')
    confidence: int = Field(..., ge=0, le=100, description="Confidence 0-100")
    reasoning: str = Field(..., description="Human-readable explanation")
    red_flags: list[str] = Field(default_factory=list)
    advice: list[str] = Field(default_factory=list)
    matched_patterns: list[str] = Field(
        default_factory=list, description="IDs of knowledge-base patterns matched"
    )


class ReportIn(BaseModel):
    snippet: str = Field(..., max_length=200, description="Short snippet of the message")
    verdict: str = Field(..., description="Verdict given for this message")
    category: str = Field(
        "other", description="Top matched knowledge-base pattern id (or 'other')"
    )


class ReportOut(BaseModel):
    snippet: str
    verdict: str
    reported_at: str