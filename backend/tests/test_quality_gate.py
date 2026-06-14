"""Unit tests for quality_gate_node scoring — no API calls."""
import pytest
from app.graph.nodes.quality import quality_gate_node

SECTIONS = ["overview", "products_services", "target_customers", "business_signals", "risks_challenges"]


def _finding(section, content="Some content", source_ids=None, confidence=0.8):
    return {
        "section": section,
        "content": content,
        "source_ids": source_ids if source_ids is not None else ["src-1"],
        "confidence": confidence,
    }


def _state(findings=None, revisions=0, **extra):
    return {
        "session_id": "test-session",
        "company_name": "Acme Corp",
        "findings": findings or {},
        "sources": [],
        "revisions": revisions,
        **extra,
    }


class TestQualityGateScoring:
    async def test_all_sections_populated_high_score(self):
        findings = {s: _finding(s) for s in SECTIONS}
        result = await quality_gate_node(_state(findings=findings))
        assert result["quality_score"] > 0.7
        assert result["gaps"] == []

    async def test_empty_findings_zero_score(self):
        result = await quality_gate_node(_state(findings={}))
        assert result["quality_score"] == 0.0
        assert len(result["gaps"]) == len(SECTIONS)

    async def test_partial_findings_partial_score(self):
        findings = {s: _finding(s) for s in SECTIONS[:3]}
        result = await quality_gate_node(_state(findings=findings))
        assert 0.0 < result["quality_score"] < 1.0

    async def test_findings_without_sources_lower_grounding(self):
        findings_sourced = {s: _finding(s, source_ids=["src-1"]) for s in SECTIONS}
        findings_unsourced = {s: _finding(s, source_ids=[]) for s in SECTIONS}
        r_sourced = await quality_gate_node(_state(findings=findings_sourced))
        r_unsourced = await quality_gate_node(_state(findings=findings_unsourced))
        assert r_sourced["quality_score"] > r_unsourced["quality_score"]

    async def test_low_confidence_emits_gap(self):
        findings = {s: _finding(s, confidence=0.3) for s in SECTIONS}
        result = await quality_gate_node(_state(findings=findings))
        assert len(result["gaps"]) == len(SECTIONS)

    async def test_revisions_incremented(self):
        result = await quality_gate_node(_state(revisions=1))
        assert result["revisions"] == 2

    async def test_revisions_start_from_zero(self):
        result = await quality_gate_node(_state(revisions=0))
        assert result["revisions"] == 1
