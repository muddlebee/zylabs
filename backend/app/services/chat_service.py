import json
import structlog
from datetime import datetime

from sqlalchemy.orm import Session as DBSession

from app.llm import get_llm
from app.db import ChatMessageModel
from app.services.session_service import get_report

log = structlog.get_logger()

SYSTEM_TEMPLATE = """You are a research assistant helping a salesperson prepare for a meeting.
Answer questions based ONLY on the provided research report and sources.
If the answer is not in the report, say so clearly — do not fabricate.

Research Report:
{report}

Sources:
{sources}"""


def get_chat_history(db: DBSession, session_id: str) -> list[ChatMessageModel]:
    return (
        db.query(ChatMessageModel)
        .filter(ChatMessageModel.session_id == session_id)
        .order_by(ChatMessageModel.created_at.asc())
        .all()
    )


async def chat(db: DBSession, session_id: str, user_message: str) -> str:
    log.info("chat_service.chat", session_id=session_id)

    report = get_report(db, session_id)
    if not report:
        return "No research report found for this session. Run the research workflow first."

    sources_text = "\n".join(
        f"[{s['tier']}] {s['title']} — {s['url']}\n{s['snippet']}"
        for s in report.get("sources", [])
    )
    report_text = json.dumps(
        {k: v["content"] for k, v in report.get("sections", {}).items()},
        indent=2,
    )

    system_prompt = SYSTEM_TEMPLATE.format(report=report_text, sources=sources_text)

    history = get_chat_history(db, session_id)
    messages = [{"role": "system", "content": system_prompt}]
    for msg in history[-10:]:  # last 10 turns for context window
        messages.append({"role": msg.role, "content": msg.content})
    messages.append({"role": "user", "content": user_message})

    try:
        response = await get_llm().ainvoke(messages)
        assistant_reply = response.content
    except Exception as exc:
        log.error("chat_service.llm_error", session_id=session_id, error=str(exc))
        assistant_reply = f"I encountered an error: {exc}"

    now = datetime.utcnow()
    db.add(ChatMessageModel(session_id=session_id, role="user", content=user_message, created_at=now))
    db.add(ChatMessageModel(session_id=session_id, role="assistant", content=assistant_reply, created_at=now))
    db.commit()

    return assistant_reply
