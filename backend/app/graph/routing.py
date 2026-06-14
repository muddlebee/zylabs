from app.config import settings
from app.graph.state import ResearchState


def after_plan(state: ResearchState):
    # Run financials enrichment for every company type — private firms still have
    # funding/valuation signal worth surfacing. It's one cheap snippet search, and
    # we fan it out to run concurrently with research rather than as a serial
    # pre-step, so it adds no time to the critical path.
    return ["enrich_financials", "research"]


def after_quality_gate(state: ResearchState) -> str:
    below_threshold = state.get("quality_score", 0.0) < settings.quality_threshold
    under_cap = state.get("revisions", 0) < settings.max_revisions
    if below_threshold and under_cap:
        return "research"
    return "strategize"
