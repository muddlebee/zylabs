from datetime import datetime, timezone
import structlog
from app.graph.state import ResearchState

log = structlog.get_logger()


async def report_node(state: ResearchState) -> dict:
    session_id = state["session_id"]
    log.info("report_node.start", session_id=session_id)

    report = {
        "session_id": session_id,
        "company_name": state["company_name"],
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sections": state.get("findings", {}),
        "sources": state.get("sources", []),
        "financials": state.get("financials") or {},
        "meta": {
            "quality_score": state.get("quality_score", 0.0),
            "revisions": state.get("revisions", 0),
            "company_type": state.get("company_type", "unknown"),
            "errors": state.get("errors", []),
        },
    }

    log.info("report_node.done", session_id=session_id,
             sections=list(report["sections"].keys()), sources=len(report["sources"]))
    return {"report": report, "status": "Report ready"}
