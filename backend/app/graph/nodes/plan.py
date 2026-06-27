import json
import uuid
import asyncio
import structlog

from app.llm import get_llm
from app.graph.state import ResearchState, ResearchTask, NodeError
from app.tools.preflight import check_firecrawl_ready

log = structlog.get_logger()

SYSTEM_PROMPT = """You are a research planning assistant. Given a company and a meeting objective,
decompose the research into 5-8 specific sub-questions that cover these sections:
overview, products_services, target_customers, business_signals, risks_challenges.

Also classify the company type as: public, private, startup, or unknown.
Use "public" for companies listed on a major stock exchange (e.g. CoreWeave/CRWV, Apple/AAPL).

Respond with JSON only, no markdown:
{
  "company_type": "public|private|startup|unknown",
  "research_plan": [
    {"question": "...", "section": "overview|products_services|target_customers|business_signals|risks_challenges"},
    ...
  ]
}"""


async def plan_node(state: ResearchState) -> dict:
    session_id = state["session_id"]
    log.info("plan_node.start", session_id=session_id, company=state["company_name"])

    user_msg = (
        f"Company: {state['company_name']}\n"
        f"URL: {state['company_url']}\n"
        f"Meeting objective: {state['objective']}"
    )

    try:
        # ainvoke: true async HTTP to the LLM — yields the event loop during network wait.
        response = await get_llm().ainvoke([
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": user_msg},
        ])
        raw = response.content.strip()
        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        data = json.loads(raw)

        research_plan: list[ResearchTask] = [
            ResearchTask(
                id=str(uuid.uuid4()),
                question=t["question"],
                section=t["section"],
                done=False,
            )
            for t in data["research_plan"]
        ]

        log.info("plan_node.done", session_id=session_id, tasks=len(research_plan),
                 company_type=data["company_type"])

        ok, firecrawl_msg = await asyncio.get_event_loop().run_in_executor(
            None, check_firecrawl_ready,
        )  # sync credit check — must not block the loop
        if not ok:
            log.warning("plan_node.firecrawl_unavailable", session_id=session_id, reason=firecrawl_msg)
            return {
                "research_plan": research_plan,
                "company_type": data.get("company_type", "unknown"),
                "retrieval_unavailable": True,
                "status": "Web research unavailable",
                "errors": state.get("errors", []) + [
                    NodeError(node="plan", message=firecrawl_msg, recoverable=False),
                ],
            }

        return {
            "research_plan": research_plan,
            "company_type": data.get("company_type", "unknown"),
            "retrieval_unavailable": False,
            "status": "Planning complete",
        }

    except Exception as exc:
        log.error("plan_node.error", session_id=session_id, error=str(exc))
        return {
            "research_plan": [],
            "company_type": "unknown",
            "status": "Planning failed",
            "errors": state.get("errors", []) + [
                NodeError(node="plan", message=str(exc), recoverable=False)
            ],
        }
