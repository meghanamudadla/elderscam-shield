"""LangGraph pipeline: retrieve -> web_verify -> reason -> format.

A StateGraph with four sequential nodes. Each node receives the shared
dict state and returns an update dict (LangGraph merges returned dicts into
the state with the add_messages-like default behaviour: returned keys are
set, keys returned as None are deleted).

State keys:
  message: str                  (user input)
  language: str                 ("en" | "te")
  patterns: list[RetrievedPattern]
  web_findings: list[dict]      (suspicious phone-number web reports)
  verdict: dict                 (from llm.get_verdict)
  response: dict                (final normalized API response)
"""

from typing import TypedDict

from langgraph.graph import END, StateGraph

from . import llm
from .phone_extract import extract_phone_numbers
from .retrieval import RetrievedPattern, get_retriever
from .web_verify import check_number_reputation


class PipelineState(TypedDict, total=False):
    message: str
    language: str
    patterns: list[RetrievedPattern]
    web_findings: list[dict]
    verdict: dict
    response: dict


def _retrieve(state: PipelineState) -> dict:
    return {"patterns": get_retriever().retrieve(state["message"], k=4)}


def _web_verify(state: PipelineState) -> dict:
    """Check phone numbers in the message against live web scam reports.

    Caps at 2 numbers per message to keep latency bounded. If TAVILY_API_KEY
    is not configured, every call returns checked=False and is filtered out,
    so this node silently no-ops.
    """
    numbers = extract_phone_numbers(state["message"])
    findings = [check_number_reputation(n) for n in numbers[:2]]
    return {"web_findings": [f for f in findings if f.get("checked") and f.get("suspicious")]}


def _reason(state: PipelineState) -> dict:
    return {
        "verdict": llm.get_verdict(
            state["message"],
            state["patterns"],
            state.get("language", "en"),
            web_findings=state.get("web_findings"),
        )
    }


def _format(state: PipelineState) -> dict:
    verdict = state["verdict"]
    response = {
        "verdict": verdict["verdict"],
        "confidence": verdict["confidence"],
        "reasoning": verdict["reasoning"],
        "red_flags": verdict["red_flags"],
        "advice": verdict["advice"],
        "matched_patterns": [p.id for p in state["patterns"]],
    }
    return {"response": response}


def _build_graph():
    graph = StateGraph(PipelineState)
    graph.add_node("retrieve", _retrieve)
    graph.add_node("web_verify", _web_verify)
    graph.add_node("reason", _reason)
    graph.add_node("format", _format)
    graph.set_entry_point("retrieve")
    graph.add_edge("retrieve", "web_verify")
    graph.add_edge("web_verify", "reason")
    graph.add_edge("reason", "format")
    graph.add_edge("format", END)
    return graph.compile()


_graph = _build_graph()


def run_pipeline(message: str, language: str = "en") -> dict:
    """Run the full retrieve->web_verify->reason->format graph and return the response."""
    result = _graph.invoke({"message": message, "language": language})
    return result["response"]