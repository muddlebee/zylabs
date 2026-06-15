"""Unit tests for report_node — deterministic assembly, no API calls."""
import pytest
from app.graph.nodes.report import report_node

ALL_SECTIONS = [
    "overview", "products_services", "target_customers",
    "business_signals", "risks_challenges",
    "discovery_questions", "outreach_strategy", "unknowns",
]


def _finding(section):
    return {"section": section, "content": f"Content for {section}", "source_ids": ["s1"], "confidence": 0.8}


def _source(i):
    return {"id": f"s{i}", "url": f"https://example.com/{i}", "title": f"Source {i}",
            "snippet": "snippet", "tier": 2, "retrieved_at": "2026-01-01T00:00:00+00:00"}


def _state(**overrides):
    base = {
        "session_id": "test-123",
        "company_name": "Acme",
        "findings": {s: _finding(s) for s in ALL_SECTIONS},
        "sources": [_source(i) for i in range(3)],
        "quality_score": 0.9,
        "revisions": 1,
        "company_type": "private",
        "errors": [],
    }
    return {**base, **overrides}


class TestReportNode:
    async def test_report_has_required_top_level_keys(self):
        result = await report_node(_state())
        report = result["report"]
        assert "session_id" in report
        assert "company_name" in report
        assert "generated_at" in report
        assert "sections" in report
        assert "sources" in report
        assert "meta" in report

    async def test_report_passes_through_all_findings(self):
        result = await report_node(_state())
        assert set(result["report"]["sections"].keys()) == set(ALL_SECTIONS)

    async def test_report_preserves_sources(self):
        result = await report_node(_state())
        assert len(result["report"]["sources"]) == 3

    async def test_meta_contains_quality_score(self):
        result = await report_node(_state())
        assert result["report"]["meta"]["quality_score"] == 0.9

    async def test_meta_contains_revisions(self):
        result = await report_node(_state())
        assert result["report"]["meta"]["revisions"] == 1

    async def test_status_is_report_ready(self):
        result = await report_node(_state())
        assert result["status"] == "Report ready"

    async def test_empty_findings_still_produces_report(self):
        result = await report_node(_state(findings={}, sources=[]))
        assert result["report"]["sections"] == {}
        assert result["report"]["sources"] == []

    async def test_retrieval_unavailable_keeps_plan_error_only(self):
        result = await report_node(_state(
            retrieval_unavailable=True,
            findings={},
            sources=[],
            errors=[
                {"node": "plan", "message": "Credits exhausted", "recoverable": False},
                {"node": "synthesize", "message": "skipped", "recoverable": False},
            ],
        ))
        meta = result["report"]["meta"]
        assert meta["stopped_at"] == "plan"
        assert meta["retrieval_unavailable"] is True
        assert len(meta["errors"]) == 1
        assert meta["errors"][0]["node"] == "plan"
