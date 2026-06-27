# Async Patterns — Backend Internals

How `asyncio` is used across the backend, and why. For the streaming state machine
(`session_events`, `stream_signals`, `running_sessions`), see
[workflow-streaming.md](./workflow-streaming.md). For multi-worker limits, see
[scaling-in-process-state.md](./scaling-in-process-state.md).

---

## Architectural bet

One **asyncio event loop per uvicorn process** (single worker in dev/prod today). FastAPI
handles HTTP on that loop. Long research runs are background **Tasks**. Live progress goes
out over SSE on the same loop.

Three concurrency layers:

```
┌─────────────────────────────────────────────────────────────────────────┐
│  Layer A — Event loop (cooperative)                                     │
│  create_task, Event, astream, ainvoke, async generators                 │
│  Orchestration + signalling; no locks on in-memory dicts                │
├─────────────────────────────────────────────────────────────────────────┤
│  Layer B — Default thread pool (blocking escape hatch)                  │
│  run_in_executor(None, ...) for sync Firecrawl + SSE status DB reads    │
├─────────────────────────────────────────────────────────────────────────┤
│  Layer C — LangGraph graph parallelism                                  │
│  plan → {enrich_financials, research} fan-out on the same event loop    │
│  research node adds nested asyncio.gather for parallel searches           │
└─────────────────────────────────────────────────────────────────────────┘
```

**Not built:** custom thread pools, `asyncio.Queue`, per-session task registries with
cancel, async SQLAlchemy, Celery/RQ, or process pools. Scale-out for streaming is
documented separately (Redis pub/sub sketch).

---

## Map of every `asyncio` API used

| API | Where | Purpose |
|-----|-------|---------|
| `@asynccontextmanager` lifespan | `main.py` | Async checkpointer + graph at startup |
| `create_task` | `main.py` POST `/run` | Background `_run_graph` without blocking HTTP |
| `Event` | `main.py` `stream_signals` | Wake SSE consumer when new node events arrive |
| `wait_for` | `main.py` SSE; `financials.py` | 120s stream timeout; 25s Firecrawl cap |
| `sleep` | `main.py` SSE | DB lag poll (0.2s × 15); fallback when no signal (0.5s) |
| `async for` / `astream` | `main.py` `_run_graph` | Progress events per graph node |
| `AsyncGenerator` + `yield` | `main.py` `/stream` | Lazy SSE frames to the browser |
| `run_in_executor` | `main.py`, `plan`, `research`, `financials` | Sync Firecrawl + sync SQLAlchemy status reads |
| `gather` | `research.py` | Parallel company scrape + N searches |
| `get_event_loop` | executor call sites | Obtain loop for `run_in_executor` |
| `ainvoke` | LLM nodes, chat | Native async HTTP to DeepSeek/OpenAI |
| `aget_state` | `main.py` | Final state + checkpoint fallback for `/progress` |

Sync routes (`GET /sessions`, `POST /sessions`) use FastAPI's default sync handling — fast
CRUD only. Async investment went into **workflow + SSE**.

---

## The event loop model

Everything **orchestrated** on one thread. Coroutines take turns at `await`. When a
coroutine suspends, the loop runs another ready coroutine.

```
Event Loop Thread

├── handle POST /run  → asyncio.create_task(_run_graph)  ← schedules, doesn't block
│                       returns HTTP response immediately
│
├── handle GET /stream → starts event_generator coroutine
│                        hits `await signal.wait()` → suspends
│
├── _run_graph task running
│     await graph.astream() → suspends while LangGraph/LLM does I/O
│     resumes → _append_event → signal.set()
│
├── event_generator resumes (signal fired)
│     drains new events → yields SSE frames → suspends again
│
└── ... repeat
```

**Locks on `session_events` / `stream_signals`:** not needed. Producer and consumer mutate
the same dicts on the event-loop thread. `run_in_executor` workers only touch their own
`SessionLocal()` per call — no shared ORM session across threads.

**Threads do exist** for blocking I/O (see `run_in_executor` below). The loop itself stays
single-threaded.

---

## App lifecycle — `lifespan` (`main.py:36`)

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    async with AsyncSqliteSaver.from_conn_string(settings.checkpoint_db_path) as checkpointer:
        graph_module.graph = build_graph(checkpointer)
        yield
```

**Decision:** `AsyncSqliteSaver` + one compiled graph per process.

**Why:** Checkpoint I/O during `astream` / `aget_state` is awaitable. No per-request graph
compile or checkpoint connection churn.

**Tradeoff:** `graph_module.graph` is process-global. Fine for one worker; each worker in
a multi-worker deploy builds its own graph but cannot share Layer 1 streaming memory.

---

## Starting a run — `create_task` (`main.py:230`)

```python
session_service.update_session_status(db, session_id, "running")
asyncio.create_task(_run_graph(session_id, initial_state, get_db))
return {"session_id": session_id, "status": "running"}
```

**Decision:** Fire-and-forget; do not `await _run_graph` in the route.

**Why:** Research takes minutes. Client needs immediate `200`, then watches SSE or
`/progress`.

**What `create_task` is NOT:** a thread, a process, or a job-queue worker. It schedules a
`Task` on the **same** event loop. `running_sessions` tracks these Tasks — see
[workflow-streaming.md](./workflow-streaming.md).

**Trap:** unhandled exceptions in a Task log `Task exception was never retrieved`.
`_run_graph` catches internally and writes failure to DB.

**Alternatives not taken:** `await` in route (blocks client), `threading.Thread` (mixes
poorly with `Event`), external job runner (overkill at current scale).

---

## Producer — `_run_graph` + `astream` (`main.py:97`)

```python
async def _run_graph(session_id: str, initial_state: dict, db_factory) -> None:
    running_sessions.add(session_id)
    session_events[session_id] = []
    stream_signals[session_id] = asyncio.Event()
    try:
        async for chunk in graph.astream(initial_state, config=config, stream_mode="updates"):
            for node_name, node_state in chunk.items():
                _append_event(session_id, event)
        final = await graph.aget_state(config)
        # sync save_report + update_session_status (once per run)
    finally:
        running_sessions.discard(session_id)
        stream_signals.pop(session_id, None)?.set()
```

**Decision:** `astream(stream_mode="updates")` not `ainvoke`.

**Why:** Each node completion → SSE progress event. `chunk.items()` handles parallel
fan-out (`plan → {financials, research}`) emitting multiple events per chunk.

**Decision:** In-memory event log + `Event`, not direct SSE writes from `_run_graph`.

**Why:** Decouples producer from reconnecting clients (`?after=N`). Multiple consumers can
read the same list with independent cursors.

**Sync DB in `_run_graph`:** `save_report` / `update_session_status` run on the event loop
after `astream` completes. Acceptable for local SQLite, once per run. SSE status polling
was moved to `run_in_executor` because it runs in a **hot loop** (many reads per session).

---

## Consumer — SSE `event_generator` (`main.py:248`)

```python
async def event_generator() -> AsyncGenerator[str, None]:
    while True:
        events = await _workflow_events(session_id)
        # drain cursor → yield SSE frames
        status = await _session_status_async(session_id)
        if status in ("completed", "failed"): ...
        if session_id not in running_sessions:
            for _ in range(15):
                await asyncio.sleep(0.2)
                status = await _session_status_async(session_id)
        signal = stream_signals.get(session_id)
        if signal:
            signal.clear()
            await asyncio.wait_for(signal.wait(), timeout=120)
        else:
            await asyncio.sleep(0.5)
```

| Piece | Role |
|-------|------|
| `AsyncGenerator` + `yield` | FastAPI pulls frames lazily over the TCP connection |
| `await _workflow_events` | Memory buffer, or `await aget_state` checkpoint fallback |
| `await _session_status_async` | Terminal status without blocking the loop |
| `running_sessions` check | Task done but DB may lag → poll, don't wait on removed `Event` |
| `Event.clear()` + `wait()` | Avoid stale `set()` causing zero-event spin |
| `wait_for(..., 120)` | Close zombie streams with `{node:"timeout"}` |
| `sleep(0.2)` / `sleep(0.5)` | Cooperative delays; yield the loop to other tasks |

**Decision:** Emit `{node:"done"}` when **DB** says `completed`, not when the graph task
returns.

**Why:** Last node event can arrive before `save_report` commits. DB is source of truth.

Full SSE state machine: [workflow-streaming.md](./workflow-streaming.md).

---

## Key async primitives in `main.py`

### `asyncio.Event` — doorbell (`main.py:101, 287–291`)

```python
signal.wait()   # suspends until set
signal.set()    # wakes all waiters
signal.clear()  # resets to not-set
```

Producer (`_append_event`) sets after each append. Consumer clears before wait so a
`set()` that fired between drain and wait doesn't cause a busy spin.

### `asyncio.wait_for` — bounded wait (`main.py:291`)

120s cap on `signal.wait()`. On `TimeoutError`, yield `{node:"timeout"}` and close.

### `async for` over LangGraph (`main.py:104`)

`astream` is an async generator. LangGraph awaits I/O between yields so other Tasks
(HTTP, SSE) run during LLM/Firecrawl waits.

---

## `run_in_executor` — the thread pool escape hatch

Python's **default** `ThreadPoolExecutor` (`None` → roughly `min(32, cpu_count + 4)`
workers). Used wherever a **sync** library would otherwise block the event loop.

### SSE status polling — fixed (`main.py:244`)

**Problem:** `_session_status` uses sync SQLAlchemy inside the async SSE generator. Called
every loop iteration + up to 15× during DB lag poll.

```python
def _session_status(session_id: str) -> str | None:
    db = SessionLocal()
    try:
        return session_service.get_session(db, session_id).status
    finally:
        db.close()

async def _session_status_async(session_id: str) -> str | None:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _session_status, session_id)
```

```
Event Loop Thread                 Worker Thread (default pool)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━
[event_gen] ── await ──suspends   _session_status() ████████
[_run_graph]   resumes ────────── ──────────────────── result
[GET /health]  handled ─────────  ────────────────────    ↓
[event_gen]  ◄──────────────────────────────── resumes with result
```

Each call opens and closes its own session — safe across threads.

**Why fix this but not `save_report`?** SSE polls many times per session; report save is
once. Local SQLite reads are ~0.1–0.2ms each but compound under concurrent streams or
remote Postgres.

### Graph nodes — Firecrawl (sync HTTP client)

| Node | Pattern | Why |
|------|---------|-----|
| `plan.py` | `run_in_executor(check_firecrawl_ready)` | Sync preflight after LLM plan |
| `research.py` | `gather` of `run_in_executor` scrape + N searches | Parallel I/O; don't block loop |
| `financials.py` | `wait_for(run_in_executor(search), 25s)` | Hard cap on one parallel branch |

```python
# research.py — parallel searches
results = await asyncio.gather(
    _scrape_company(),
    *[_search(q) for q in questions_to_run],
)

# financials.py — bounded single search
sources = await asyncio.wait_for(
    loop.run_in_executor(None, lambda: scrape_tool.search(...)),
    timeout=FINANCIAL_GATHER_TIMEOUT,
)
```

**Decision:** `gather` inside research, not sequential awaits — wall time ≈ slowest call.

**Decision:** `wait_for` on financials only — one call on critical path; research degrades
per-question on failure.

### Still sync on the event loop (acceptable for now)

| Call site | Why left sync |
|-----------|----------------|
| `save_report` in `_run_graph` | Once per run; local SQLite |
| `chat_service.chat` DB read/write | Short, low frequency |
| `GET /sessions` CRUD routes | FastAPI sync routes; trivial ORM |

Revisit if moving to remote Postgres or high concurrent SSE load.

### Thread pool saturation

Workers still block on I/O. Hundreds of SSE streams polling status could queue on the
pool. At current scale (one stream per session) the default pool is sufficient. At
thousands of streams, rethink polling (pub/sub push) rather than adding threads.

---

## Graph nodes — three I/O strategies

### Native async — LLM (`ainvoke`)

`plan`, `synthesize`, `strategize`, `financial_extract`, `chat_service`:

```python
response = await get_llm().ainvoke(messages)
```

LangChain async client; network I/O without blocking the loop.

### Executor + gather / wait_for — Firecrawl

See table above. Firecrawl Python SDK is synchronous.

### `async def` with no await — CPU only

`quality_gate_node`, `report_node`: dict math and assembly. Match LangGraph's async node
signature; work is microseconds.

---

## LangGraph parallelism (not `asyncio.gather`)

```text
plan ──┬── enrich_financials ──┐
       └── research ──────────┴── synthesize → ...
```

LangGraph runs `enrich_financials` and `research` concurrently on the same event loop
after `plan`. Join at `synthesize`. Nested `gather` inside `research` adds another level of
parallelism for sub-questions.

**Decision:** Graph-level fan-out via LangGraph edges, not manual `create_task` per branch.
Checkpointing and routing stay inside the framework.

---

## Design decisions summary

| Problem | Choice | Rationale |
|---------|--------|-----------|
| Long research run | `create_task(_run_graph)` | Immediate HTTP response |
| Live UI | `astream` + in-memory events + SSE | Reconnect, decoupled producer/consumer |
| Wake SSE without polling | `asyncio.Event` | Efficient wait between node updates |
| Graph done, DB lagging | `running_sessions` + `sleep` poll | Don't wait 120s on removed signal |
| Sync Firecrawl | `run_in_executor` + `gather` | Parallel searches, loop stays free |
| Hung financial search | `wait_for(25s)` | Bounded failure on parallel branch |
| SSE status DB reads | `run_in_executor` | Hot-loop polls were blocking loop |
| Report save | Sync DB in `_run_graph` | Once per run; OK for SQLite |
| Multi-worker streaming | Not in code | Per-process memory; see scaling doc |

---

## End-to-end timeline (one session)

```text
T0   POST /run
       sync: DB → "running"
       create_task(_run_graph)
       return 200

T0+  GET /stream
       event_generator starts

T1   _run_graph
       running_sessions.add; session_events=[]; Event created

T2.. async for astream
       nodes: ainvoke (LLM) / run_in_executor (Firecrawl)
       each node → _append_event → Event.set()
       SSE: drain → await Event.wait() → repeat

Tend astream done
       sync: save_report (brief loop block)
       finally: running_sessions.discard; Event.pop().set()

       SSE: not in running_sessions → await _session_status_async (executor)
       DB → "completed" → yield {node:"done"}
```

---

## Related docs

- [workflow-streaming.md](./workflow-streaming.md) — `session_events`, `stream_signals`,
  `running_sessions`, SSE cursor, browser refresh behaviour
- [scaling-in-process-state.md](./scaling-in-process-state.md) — multi-worker breakage,
  Redis replacement sketch
