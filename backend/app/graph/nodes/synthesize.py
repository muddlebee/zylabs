import json
import structlog

from app.llm import get_llm
from app.graph.state import ResearchState, SectionFinding, NodeError

log = structlog.get_logger()

FACTUAL_SECTIONS = [
    "overview",
    "products_services",
    "target_customers",
    "business_signals",
    "risks_challenges",
]

SYSTEM_PROMPT = """You are a research analyst synthesizing evidence into a structured company briefing.
Given sources and scraped website content, write grounded findings for each section.
Every finding MUST cite source IDs from the provided sources list.

Respond with JSON only, no markdown:
{
  "findings": {
    "overview": {
      "content": "...",
      "source_ids": ["<id1>", "<id2>"],
      "confidence": 0.0-1.0
    },
    "products_services": { ... },
    "target_customers": { ... },
    "business_signals": { ... },
    "risks_challenges": { ... }
  }
}

Confidence guide: 0.9 = multiple tier-1/2 sources; 0.7 = some tier-2; 0.5 = tier-3 only; 0.3 = inferred."""


def _build_context(state: ResearchState) -> str:
    parts = []

    scraped = state.get("scraped", {})
    if scraped:
        for url, text in scraped.items():
            if text:
                parts.append(f"[SCRAPED: {url}]\n{text[:3000]}")

    financials = state.get("financials") or {}
    if financials:
        parts.append(f"[FINANCIALS]\n{json.dumps(financials, indent=2)}")

    sources = state.get("sources", [])
    if sources:
        src_text = "\n".join(
            f"[SOURCE id={s['id']} tier={s['tier']}] {s['title']}\n{s['url']}\n{s['snippet']}"
            for s in sources
        )
        parts.append(f"[SOURCES]\n{src_text}")

    return "\n\n---\n\n".join(parts)


async def synthesize_node(state: ResearchState) -> dict:
    session_id = state["session_id"]
    log.info("synthesize_node.start", session_id=session_id,
             sources=len(state.get("sources", [])))

    errors = list(state.get("errors", []))
    existing_findings = dict(state.get("findings", {}))

    context = _build_context(state)
    if not context.strip():
        log.warning("synthesize_node.no_context", session_id=session_id)
        return {"findings": existing_findings, "confidence": {}, "status": "Synthesis skipped — no evidence"}

    user_msg = (
        f"Company: {state['company_name']}\n"
        f"Objective: {state['objective']}\n\n"
        f"Evidence:\n{context}"
    )

    try:
        response = await get_llm().ainvoke([
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ])
        raw = response.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        data = json.loads(raw)

        findings: dict[str, SectionFinding] = {}
        confidence: dict[str, float] = {}
        for section in FACTUAL_SECTIONS:
            f = data["findings"].get(section, {})
            if f:
                findings[section] = SectionFinding(
                    section=section,
                    content=f.get("content", ""),
                    source_ids=f.get("source_ids", []),
                    confidence=float(f.get("confidence", 0.5)),
                )
                confidence[section] = findings[section]["confidence"]

        existing_findings.update(findings)
        log.info("synthesize_node.done", session_id=session_id, sections=list(findings.keys()))
        return {
            "findings": existing_findings,
            "confidence": confidence,
            "status": "Synthesis complete",
        }

    except Exception as exc:
        log.error("synthesize_node.error", session_id=session_id, error=str(exc))
        errors.append(NodeError(node="synthesize", message=str(exc), recoverable=True))
        return {
            "findings": existing_findings,
            "confidence": {},
            "errors": errors,
            "status": "Synthesis failed",
        }
