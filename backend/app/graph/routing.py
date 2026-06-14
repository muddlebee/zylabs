from app.config import settings
from app.graph.state import ResearchState


def after_plan(state: ResearchState):
    # Financials enrichment only carries signal for companies with public
    # market/funding data. For private/unknown it returns noise, so skip it and
    # save a Firecrawl search + an LLM call. When it does run, fan it out to run
    # concurrently with research instead of as a serial pre-step.
    if state.get("company_type") in ("public", "startup"):
        return ["enrich_financials", "research"]
    return "research"


def after_quality_gate(state: ResearchState) -> str:
    below_threshold = state.get("quality_score", 0.0) < settings.quality_threshold
    under_cap = state.get("revisions", 0) < settings.max_revisions
    if below_threshold and under_cap:
        return "research"
    return "strategize"
