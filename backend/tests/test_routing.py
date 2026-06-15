"""Unit tests for conditional edge routing — no API calls, no LLM."""
import pytest
from app.graph.routing import after_plan, after_quality_gate
from app.config import settings


def _state(**overrides):
    base = {
        "company_type": "private",
        "quality_score": 0.5,
        "revisions": 0,
    }
    return {**base, **overrides}


class TestAfterPlan:
    @pytest.mark.parametrize("company_type", ["public", "startup", "private", "unknown"])
    def test_all_types_fan_out_to_financials_and_research(self, company_type):
        assert after_plan(_state(company_type=company_type)) == ["enrich_financials", "research"]

    def test_retrieval_unavailable_skips_to_report(self):
        assert after_plan(_state(retrieval_unavailable=True)) == "generate_report"


class TestAfterQualityGate:
    def test_low_score_under_cap_loops_back(self):
        state = _state(quality_score=0.4, revisions=1)
        assert after_quality_gate(state) == "research"

    def test_score_above_threshold_goes_to_strategize(self):
        state = _state(quality_score=0.8, revisions=1)
        assert after_quality_gate(state) == "strategize"

    def test_cap_hit_forces_strategize_even_with_low_score(self):
        state = _state(quality_score=0.3, revisions=settings.max_revisions)
        assert after_quality_gate(state) == "strategize"

    def test_exact_threshold_goes_to_strategize(self):
        # score == threshold is NOT below threshold, so should strategize
        state = _state(quality_score=settings.quality_threshold, revisions=1)
        assert after_quality_gate(state) == "strategize"

    def test_zero_revisions_low_score_loops(self):
        state = _state(quality_score=0.1, revisions=0)
        assert after_quality_gate(state) == "research"

    def test_retrieval_blocked_skips_research_loop(self):
        state = _state(
            quality_score=0.1,
            revisions=1,
            sources=[],
            scraped={},
            errors=[{"node": "research", "message": "402 credits", "recoverable": True}],
        )
        assert after_quality_gate(state) == "strategize"
