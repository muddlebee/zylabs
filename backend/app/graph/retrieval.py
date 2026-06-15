"""Shared helpers for web-retrieval failure detection and user-facing messages."""

from __future__ import annotations

from app.graph.state import NodeError, ResearchState

_CREDIT_HINTS = ("credit", "quota", "402", "payment required", "insufficient", "limit exceeded")


def has_research_evidence(state: ResearchState) -> bool:
    sources = state.get("sources") or []
    scraped = {url: text for url, text in (state.get("scraped") or {}).items() if text}
    return bool(sources or scraped)


def is_firecrawl_credits_error(message: str) -> bool:
    lower = message.lower()
    return any(hint in lower for hint in _CREDIT_HINTS)


def retrieval_blocked(state: ResearchState) -> bool:
    """True when research failed and there is no evidence to re-run against."""
    if state.get("retrieval_unavailable"):
        return True
    if has_research_evidence(state):
        return False
    return any(
        e.get("node") in ("research", "plan")
        for e in state.get("errors") or []
    )


def no_evidence_message(errors: list[NodeError]) -> str:
    plan_errors = [e for e in errors if e.get("node") == "plan"]
    if plan_errors:
        return plan_errors[0]["message"]

    retrieval = [
        e for e in errors
        if e.get("node") in ("research", "enrich_financials")
    ]
    if any(is_firecrawl_credits_error(e.get("message", "")) for e in retrieval):
        return (
            "Firecrawl API error (likely credits exhausted) — "
            "no web evidence was retrieved"
        )
    if retrieval:
        return "Web search/scrape failed — no evidence was retrieved"
    return "No evidence was retrieved from web search"


def research_status(
    *,
    questions: list[str],
    prior_source_count: int,
    source_count: int,
    scraped: dict[str, str],
    research_errors: list[NodeError],
) -> str:
    new_sources = source_count - prior_source_count
    has_scraped = any(text for text in scraped.values())

    if not questions:
        return "Research complete"

    if new_sources == 0 and not has_scraped:
        if research_errors:
            if any(is_firecrawl_credits_error(e.get("message", "")) for e in research_errors):
                return "Research failed — Firecrawl unavailable (check credits)"
            return f"Research failed — {len(research_errors)} search error(s)"
        return "Research failed — all searches returned no results"

    if research_errors:
        return f"Research partial — {len(research_errors)} search error(s)"

    return "Research complete"
