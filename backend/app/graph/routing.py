from app.config import settings
from app.graph.retrieval import retrieval_blocked
from app.graph.state import ResearchState


def after_plan(state: ResearchState):
    if state.get("retrieval_unavailable"):
        return "generate_report"
    return ["enrich_financials", "research"]


def after_quality_gate(state: ResearchState) -> str:
    if retrieval_blocked(state):
        return "strategize"
    below_threshold = state.get("quality_score", 0.0) < settings.quality_threshold
    under_cap = state.get("revisions", 0) < settings.max_revisions
    if below_threshold and under_cap:
        return "research"
    return "strategize"
