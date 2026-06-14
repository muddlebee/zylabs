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
    def test_public_company_routes_to_financials(self):
        assert after_plan(_state(company_type="public")) == "enrich_financials"

    def test_private_company_routes_to_research(self):
        assert after_plan(_state(company_type="private")) == "research"

    def test_startup_routes_to_research(self):
        assert after_plan(_state(company_type="startup")) == "research"

    def test_unknown_routes_to_research(self):
        assert after_plan(_state(company_type="unknown")) == "research"


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
