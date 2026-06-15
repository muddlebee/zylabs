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
from app.db import get_db, init_db, SessionLocal
import app.graph.build as graph_module
from app.graph.build import build_graph
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
from app.services import session_service, chat_service
from app.services.progress_service import events_from_checkpoint

structlog.configure(
    wrapper_class=structlog.make_filtering_bound_logger(
        getattr(logging, settings.log_level.upper(), logging.INFO)
    )
)
log = structlog.get_logger()

# In-memory workflow event log — survives SSE reconnects within a single process.
session_events: dict[str, list[dict]] = {}
running_sessions: set[str] = set()
stream_signals: dict[str, asyncio.Event] = {}


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
    company_url: str = ""
    objective: str


class ChatRequest(BaseModel):
    message: str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _session_or_404(session_id: str, db: Session):
    session = session_service.get_session(db, session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


def _append_event(session_id: str, event: dict) -> None:
    session_events.setdefault(session_id, []).append(event)
    signal = stream_signals.get(session_id)
    if signal:
        signal.set()


async def _workflow_events(session_id: str) -> list[dict[str, str]]:
    """Return buffered events, falling back to checkpoint reconstruction."""
    buffered = session_events.get(session_id)
    if buffered:
        return buffered

    if graph_module.graph is None:
        return []

    config = {"configurable": {"thread_id": session_id}}
    state = await graph_module.graph.aget_state(config)
    return events_from_checkpoint(state.values if state else None)


async def _run_graph(session_id: str, initial_state: dict, db_factory) -> None:
    config = {"configurable": {"thread_id": session_id}}
    running_sessions.add(session_id)
    session_events[session_id] = []
    stream_signals[session_id] = asyncio.Event()

    try:
        async for chunk in graph_module.graph.astream(initial_state, config=config, stream_mode="updates"):
            # Under the plan→{financials, research} fan-out a single chunk can carry
            # multiple node updates, so emit one SSE event per node rather than the first.
            for node_name, node_state in chunk.items():
                if not isinstance(node_state, dict):
                    continue
                status = node_state.get("status", f"{node_name} running")
                log.info("graph.node_update", session_id=session_id, node=node_name, status=status)
                _append_event(session_id, {"node": node_name, "status": status})

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
        _append_event(session_id, {"node": "error", "status": str(exc)})
    finally:
        running_sessions.discard(session_id)
        # Wake any parked SSE waiter so it re-checks the now-final DB status and
        # emits the terminal `done`/`error` event immediately. The last node event
        # (e.g. generate_report) fires before the report is persisted, so without
        # this nudge the stream would block on the signal until it times out.
        signal = stream_signals.pop(session_id, None)
        if signal:
            signal.set()


# ── Routes ────────────────────────────────────────────────────────────────────

@app.get("/healthz")
def healthz():
    return {"status": "ok", "version": "1.0.2"}


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


@app.get("/sessions/{session_id}/progress")
async def get_session_progress(session_id: str, db: Session = Depends(get_db)):
    session = _session_or_404(session_id, db)
    events = await _workflow_events(session_id)
    return {"session_id": session_id, "status": session.status, "events": events}


@app.post("/sessions/{session_id}/run")
async def run_session(session_id: str, db: Session = Depends(get_db)):
    session = _session_or_404(session_id, db)

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


def _session_status(session_id: str) -> str | None:
    db = SessionLocal()
    try:
        session = session_service.get_session(db, session_id)
        return session.status if session else None
    finally:
        db.close()


@app.get("/sessions/{session_id}/stream")
async def stream_session(session_id: str, after: int = 0, db: Session = Depends(get_db)):
    _session_or_404(session_id, db)

    async def event_generator() -> AsyncGenerator[str, None]:
        cursor = max(0, after)

        while True:
            events = await _workflow_events(session_id)
            while cursor < len(events):
                item = events[cursor]
                cursor += 1
                if item.get("node") == "error":
                    yield f"data: {json.dumps(item)}\n\n"
                    return
                yield f"data: {json.dumps(item)}\n\n"

            status = _session_status(session_id)
            if status == "completed":
                yield f"data: {json.dumps({'node': 'done', 'status': 'Workflow complete'})}\n\n"
                return
            if status == "failed":
                yield f"data: {json.dumps({'node': 'error', 'status': 'Workflow failed'})}\n\n"
                return

            if session_id not in running_sessions:
                # Graph finished but DB status may lag — poll briefly before closing.
                for _ in range(15):
                    await asyncio.sleep(0.2)
                    status = _session_status(session_id)
                    if status == "completed":
                        yield f"data: {json.dumps({'node': 'done', 'status': 'Workflow complete'})}\n\n"
                        return
                    if status == "failed":
                        yield f"data: {json.dumps({'node': 'error', 'status': 'Workflow failed'})}\n\n"
                        return
                return

            signal = stream_signals.get(session_id)
            if signal:
                signal.clear()
                try:
                    await asyncio.wait_for(signal.wait(), timeout=120)
                except asyncio.TimeoutError:
                    yield f"data: {json.dumps({'node': 'timeout', 'status': 'Stream timed out'})}\n\n"
                    return
            else:
                await asyncio.sleep(0.5)

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
