import json
import structlog

from app.llm import get_llm
from app.graph.retrieval import has_research_evidence
from app.graph.state import ResearchState, SectionFinding, NodeError

log = structlog.get_logger()

FACTUAL_SECTIONS = (
    "overview",
    "products_services",
    "target_customers",
    "business_signals",
    "risks_challenges",
)

SYSTEM_PROMPT = """You are a strategic sales advisor. Given research findings about a company,
produce three strategic outputs to help a salesperson prepare for a meeting.

Respond with JSON only, no markdown:
{
  "discovery_questions": {
    "content": "5-7 sharp discovery questions the salesperson should ask, formatted as a numbered list",
    "source_ids": [],
    "confidence": 0.8
  },
  "outreach_strategy": {
    "content": "Personalized outreach strategy: the right angle, tone, and value prop based on the company's situation",
    "source_ids": [],
    "confidence": 0.8
  },
  "unknowns": {
    "content": "Key unknowns that remain after research — information gaps the salesperson should probe for",
    "source_ids": [],
    "confidence": 1.0
  }
}"""


async def strategize_node(state: ResearchState) -> dict:
    session_id = state["session_id"]
    log.info("strategize_node.start", session_id=session_id)

    findings = dict(state.get("findings", {}))
    errors = list(state.get("errors", []))
    gaps = state.get("gaps", [])

    has_factual = any(
        findings.get(section, {}).get("content")
        for section in FACTUAL_SECTIONS
    )
    if not has_factual and not has_research_evidence(state):
        msg = "Strategy skipped — no research evidence to base recommendations on"
        log.warning("strategize_node.skipped", session_id=session_id, reason=msg)
        errors.append(NodeError(node="strategize", message=msg, recoverable=False))
        return {"findings": findings, "errors": errors, "status": msg}

    findings_summary = "\n\n".join(
        f"## {k.replace('_', ' ').title()}\n{v['content']}"
        for k, v in findings.items()
        if v.get("content")
    )

    gaps_text = "\n".join(f"- {g}" for g in gaps) if gaps else "None identified"

    user_msg = (
        f"Company: {state['company_name']}\n"
        f"Meeting objective: {state['objective']}\n\n"
        f"Research Findings:\n{findings_summary}\n\n"
        f"Known Gaps:\n{gaps_text}"
    )

    try:
        response = await get_llm().ainvoke([  # async LLM I/O — event loop stays responsive
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ])
        raw = response.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        data = json.loads(raw)

        for section in ("discovery_questions", "outreach_strategy", "unknowns"):
            f = data.get(section, {})
            findings[section] = SectionFinding(
                section=section,
                content=f.get("content", ""),
                source_ids=f.get("source_ids", []),
                confidence=float(f.get("confidence", 0.8)),
            )

        log.info("strategize_node.done", session_id=session_id)
        return {"findings": findings, "status": "Strategy complete"}

    except Exception as exc:
        log.error("strategize_node.error", session_id=session_id, error=str(exc))
        errors.append(NodeError(node="strategize", message=str(exc), recoverable=True))
        return {"findings": findings, "errors": errors, "status": "Strategy failed"}
