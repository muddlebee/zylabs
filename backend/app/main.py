import asyncio
import json
import logging
import structlog
from contextlib import asynccontextmanager
from typing import AsyncGenerator

from fastapi import FastAPI, Depends, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db, init_db
import app.graph.build as graph_module
from app.graph.build import build_graph
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from app.services import session_service, chat_service

structlog.configure(
    wrapper_class=structlog.make_filtering_bound_logger(
        getattr(logging, settings.log_level.upper(), logging.INFO)
    )
)
log = structlog.get_logger()

# session_id -> asyncio.Queue for SSE updates
active_streams: dict[str, asyncio.Queue] = {}


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    async with AsyncSqliteSaver.from_conn_string(settings.checkpoint_db_path) as checkpointer:
        graph_module.graph = build_graph(checkpointer)
        log.info("app.started")
        yield
    log.info("app.stopped")


app = FastAPI(title="AI Research Copilot", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Pydantic schemas ──────────────────────────────────────────────────────────

class CreateSessionRequest(BaseModel):
    company_name: str
    company_url: str
    objective: str


class ChatRequest(BaseModel):
    message: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _session_or_404(session_id: str, db: Session):
    session = session_service.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


async def _run_graph(session_id: str, initial_state: dict, db_factory) -> None:
    queue = active_streams.get(session_id)
    config = {"configurable": {"thread_id": session_id}}

    try:
        async for chunk in graph_module.graph.astream(initial_state, config=config, stream_mode="updates"):
            node_name = next(iter(chunk))
            node_state = chunk[node_name]
            status = node_state.get("status", f"{node_name} running")
            log.info("graph.node_update", session_id=session_id, node=node_name, status=status)
            if queue:
                await queue.put({"node": node_name, "status": status})

        # Retrieve final state and persist report
        final = await graph_module.graph.aget_state(config)
        report = final.values.get("report")
        if report:
            db = next(db_factory())
            try:
                session_service.save_report(db, session_id, report)
                session_service.update_session_status(db, session_id, "completed")
            finally:
                db.close()

    except Exception as exc:
        log.error("graph.run_error", session_id=session_id, error=str(exc))
        db = next(db_factory())
        try:
            session_service.update_session_status(db, session_id, "failed")
        finally:
            db.close()
        if queue:
            await queue.put({"node": "error", "status": str(exc)})
    finally:
        if queue:
            await queue.put(None)  # sentinel — stream is done


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.post("/sessions", status_code=201)
def create_session(req: CreateSessionRequest, db: Session = Depends(get_db)):
    session = session_service.create_session(db, req.company_name, req.company_url, req.objective)
    log.info("session.created", session_id=session.id)
    return {"session_id": session.id, "status": session.status}


@app.get("/sessions")
def list_sessions(db: Session = Depends(get_db)):
    sessions = session_service.list_sessions(db)
    return [
        {
            "session_id": s.id,
            "company_name": s.company_name,
            "company_url": s.company_url,
            "objective": s.objective,
            "status": s.status,
            "created_at": s.created_at.isoformat(),
        }
        for s in sessions
    ]


@app.get("/sessions/{session_id}")
def get_session(session_id: str, db: Session = Depends(get_db)):
    session = _session_or_404(session_id, db)
    report = session_service.get_report(db, session_id)
    return {
        "session_id": session.id,
        "company_name": session.company_name,
        "company_url": session.company_url,
        "objective": session.objective,
        "status": session.status,
        "created_at": session.created_at.isoformat(),
        "report": report,
    }


@app.post("/sessions/{session_id}/run")
async def run_session(session_id: str, db: Session = Depends(get_db)):
    session = _session_or_404(session_id, db)

    queue: asyncio.Queue = asyncio.Queue()
    active_streams[session_id] = queue

    initial_state = {
        "session_id": session_id,
        "company_name": session.company_name,
        "company_url": session.company_url,
        "objective": session.objective,
        "research_plan": [],
        "company_type": "unknown",
        "sources": [],
        "scraped": {},
        "financials": None,
        "findings": {},
        "confidence": {},
        "quality_score": 0.0,
        "gaps": [],
        "revisions": 0,
        "report": None,
        "errors": [],
        "status": "Starting",
    }

    session_service.update_session_status(db, session_id, "running")
    asyncio.create_task(_run_graph(session_id, initial_state, get_db))
    log.info("session.run_started", session_id=session_id)
    return {"session_id": session_id, "status": "running"}


@app.get("/sessions/{session_id}/stream")
async def stream_session(session_id: str):
    async def event_generator() -> AsyncGenerator[str, None]:
        queue = active_streams.get(session_id)
        if not queue:
            yield f"data: {json.dumps({'node': 'error', 'status': 'No active run found'})}\n\n"
            return

        try:
            while True:
                item = await asyncio.wait_for(queue.get(), timeout=120)
                if item is None:
                    yield f"data: {json.dumps({'node': 'done', 'status': 'Workflow complete'})}\n\n"
                    break
                yield f"data: {json.dumps(item)}\n\n"
        except asyncio.TimeoutError:
            yield f"data: {json.dumps({'node': 'timeout', 'status': 'Stream timed out'})}\n\n"
        finally:
            active_streams.pop(session_id, None)

    return StreamingResponse(event_generator(), media_type="text/event-stream")


@app.post("/sessions/{session_id}/chat")
async def post_chat(session_id: str, req: ChatRequest, db: Session = Depends(get_db)):
    _session_or_404(session_id, db)
    reply = await chat_service.chat(db, session_id, req.message)
    return {"role": "assistant", "content": reply}


@app.get("/sessions/{session_id}/chat")
def get_chat(session_id: str, db: Session = Depends(get_db)):
    _session_or_404(session_id, db)
    history = chat_service.get_chat_history(db, session_id)
    return [
        {
            "role": msg.role,
            "content": msg.content,
            "created_at": msg.created_at.isoformat(),
        }
        for msg in history
    ]
