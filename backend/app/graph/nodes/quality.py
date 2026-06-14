import structlog
from app.config import settings
from app.graph.state import ResearchState

log = structlog.get_logger()

FACTUAL_SECTIONS = [
    "overview",
    "products_services",
    "target_customers",
    "business_signals",
    "risks_challenges",
]


async def quality_gate_node(state: ResearchState) -> dict:
    session_id = state["session_id"]
    findings = state.get("findings", {})
    sources = state.get("sources", [])
    revisions = state.get("revisions", 0)

    log.info("quality_gate_node.start", session_id=session_id,
             sections=list(findings.keys()), revisions=revisions)

    populated = [s for s in FACTUAL_SECTIONS if s in findings and findings[s].get("content")]
    coverage = len(populated) / len(FACTUAL_SECTIONS)

    grounded = [
        s for s in populated
        if findings[s].get("source_ids")
    ]
    grounding = len(grounded) / len(populated) if populated else 0.0

    confidences = [findings[s]["confidence"] for s in populated]
    avg_confidence = sum(confidences) / len(confidences) if confidences else 0.0

    quality_score = (coverage + grounding + avg_confidence) / 3.0

    # Identify gaps: missing sections or low-confidence sections
    gaps: list[str] = []
    for section in FACTUAL_SECTIONS:
        if section not in findings or not findings[section].get("content"):
            gaps.append(f"Find more information about {section.replace('_', ' ')} for {state['company_name']}")
        elif findings[section]["confidence"] < 0.5:
            gaps.append(
                f"Find better sources for {section.replace('_', ' ')} of {state['company_name']} "
                f"(current confidence {findings[section]['confidence']:.2f})"
            )

    revisions += 1
    log.info(
        "quality_gate_node.scored",
        session_id=session_id,
        quality_score=round(quality_score, 3),
        coverage=round(coverage, 3),
        grounding=round(grounding, 3),
        avg_confidence=round(avg_confidence, 3),
        gaps=len(gaps),
        revisions=revisions,
    )

    return {
        "quality_score": quality_score,
        "gaps": gaps,
        "revisions": revisions,
        "status": f"Quality check complete (score={quality_score:.2f})",
    }
