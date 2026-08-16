"""LangGraph pipeline: retrieve -> reason -> format.

A StateGraph with three sequential nodes. Each node receives the shared
dict state and returns an update dict (LangGraph merges returned dicts into
the state with the add_messages-like default behaviour: returned keys are
set, keys returned as None are deleted).

State keys:
  message: str                  (user input)
  language: str                 ("en" | "te")
  patterns: list[RetrievedPattern]
  verdict: dict                 (from llm.get_verdict)
  response: dict                (final normalized API response)
"""

from typing import TypedDict

from langgraph.graph import END, StateGraph

from . import llm
from .retrieval import RetrievedPattern, get_retriever


class PipelineState(TypedDict, total=False):
    message: str
    language: str
    patterns: list[RetrievedPattern]
    verdict: dict
    response: dict


def _retrieve(state: PipelineState) -> dict:
    return {"patterns": get_retriever().retrieve(state["message"], k=4)}


def _reason(state: PipelineState) -> dict:
    return {
        "verdict": llm.get_verdict(
            state["message"], state["patterns"], state.get("language", "en")
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
    graph.add_node("reason", _reason)
    graph.add_node("format", _format)
    graph.set_entry_point("retrieve")
    graph.add_edge("retrieve", "reason")
    graph.add_edge("reason", "format")
    graph.add_edge("format", END)
    return graph.compile()


_graph = _build_graph()


def run_pipeline(message: str, language: str = "en") -> dict:
    """Run the full retrieve->reason->format graph and return the response."""
    result = _graph.invoke({"message": message, "language": language})
    return result["response"]