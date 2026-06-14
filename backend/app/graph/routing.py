from app.config import settings
from app.graph.state import ResearchState


def after_plan(state: ResearchState) -> str:
    if state.get("company_type") == "public":
        return "enrich_financials"
    return "research"


def after_quality_gate(state: ResearchState) -> str:
    below_threshold = state.get("quality_score", 0.0) < settings.quality_threshold
    under_cap = state.get("revisions", 0) < settings.max_revisions
    if below_threshold and under_cap:
        return "research"
    return "strategize"
