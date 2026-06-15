"""Tests for retrieval failure detection helpers."""

from app.graph.retrieval import (
    has_research_evidence,
    is_firecrawl_credits_error,
    no_evidence_message,
    research_status,
    retrieval_blocked,
)
from app.graph.state import NodeError


def test_has_research_evidence_sources():
    assert has_research_evidence({"sources": [{"id": "1"}], "scraped": {}})


def test_has_research_evidence_scraped():
    assert has_research_evidence({"sources": [], "scraped": {"https://x.com": "text"}})


def test_has_research_evidence_empty():
    assert not has_research_evidence({"sources": [], "scraped": {}})


def test_is_firecrawl_credits_error():
    assert is_firecrawl_credits_error("Insufficient credits remaining")
    assert not is_firecrawl_credits_error("Connection timeout")


def test_no_evidence_message_credits():
    errors = [NodeError(node="research", message="402 Payment Required: no credits", recoverable=True)]
    assert "Firecrawl" in no_evidence_message(errors)


def test_research_status_all_failed():
    status = research_status(
        questions=["What do they sell?"],
        prior_source_count=0,
        source_count=0,
        scraped={},
        research_errors=[
            NodeError(node="research", message="402 credits", recoverable=True),
        ],
    )
    assert "Firecrawl" in status


def test_retrieval_blocked_without_evidence():
    state = {
        "sources": [],
        "scraped": {},
        "errors": [NodeError(node="research", message="boom", recoverable=True)],
    }
    assert retrieval_blocked(state)


def test_retrieval_blocked_with_evidence():
    state = {
        "sources": [{"id": "1"}],
        "scraped": {},
        "errors": [NodeError(node="research", message="boom", recoverable=True)],
    }
    assert not retrieval_blocked(state)
