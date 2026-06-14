import uuid
import structlog
from langgraph.types import Command, Send

from app.graph.state import ResearchState, ResearchTask

log = structlog.get_logger()


async def research_dispatcher(state: ResearchState) -> Command:
    """Fan out one Send per research task so workers run in parallel."""
    session_id = state["session_id"]
    gaps = state.get("gaps", [])

    if gaps:
        tasks = [
            ResearchTask(id=str(uuid.uuid4()), question=q, section="gaps", done=False)
            for q in gaps
        ]
        log.info("research_dispatcher.gaps", session_id=session_id, count=len(tasks))
    else:
        tasks = [t for t in state.get("research_plan", []) if not t.get("done")]
        log.info("research_dispatcher.tasks", session_id=session_id, count=len(tasks))

    return Command(
        goto=[Send("research_worker", {"current_task": task}) for task in tasks]
    )
