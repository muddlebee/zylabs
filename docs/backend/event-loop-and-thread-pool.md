# Event Loop & Thread Pool

How concurrency works in the backend: one **asyncio event loop thread** per uvicorn
worker, plus a **default thread pool** for blocking I/O. This doc explains the split,
what runs where, and why the design avoids locks on in-memory streaming state.

**Related:**

| Topic | Doc |
|---|---|
| Every `asyncio` API call site | [async-patterns.md](./async-patterns.md) |
| Producer/consumer state machine | [workflow-streaming.md](./workflow-streaming.md) |
| Multi-worker limits | [scaling.md](./scaling.md) |

---

## Two layers, one process

Each uvicorn worker runs **one event loop on one OS thread**. Coroutines (HTTP handlers,
graph tasks, SSE generators) are scheduled on that thread. When code must call **sync**
libraries, it offloads work to Python's **default `ThreadPoolExecutor`** via
`run_in_executor`.

```
┌─────────────────────────────────────────────────────────────────┐
│  EVENT LOOP THREAD (1 per uvicorn worker)                       │
│                                                                 │
│  HTTP handlers · _run_graph Tasks · SSE generators              │
│  LangGraph astream · LLM ainvoke · asyncio.Event / sleep        │
│  session_events / stream_signals / running_sessions             │
│                                                                 │
│       await run_in_executor(...)  ──────────────┐               │
└─────────────────────────────────────────────────│───────────────┘
                                                  │
                    ┌─────────────────────────────▼───────────────┐
                    │  THREAD POOL (~min(32, cpu_count + 4))      │
                    │  Firecrawl HTTP · sync SQLite status reads    │
                    │  (each call opens its own SessionLocal)       │
                    └───────────────────────────────────────────────┘
```

This is **not** single-threaded overall. It is **single event-loop thread** plus worker
threads for blocking work.

Dev/prod today: `uvicorn app.main:app --port 8001` with **no `--workers` flag** → one
process, one loop. See [scaling.md](./scaling.md) for multi-worker behaviour.

---

## Event loop thread

### What it is

The event loop is a **scheduler**. Coroutines run until they hit `await`, then yield so
other coroutines can run. There is no preemption — concurrency is **cooperative**.

### What runs on the loop

| Work | Mechanism | File |
|---|---|---|
| Kick off research | `asyncio.create_task(_run_graph)` | `main.py` |
| Graph progress | `async for chunk in graph.astream(...)` | `main.py` |
| SSE to browser | `async def event_generator` + `yield` | `main.py` |
| Producer → consumer wake | `asyncio.Event.set()` / `wait()` | `main.py` |
| LLM calls | `ainvoke` (native async HTTP) | graph nodes, chat |
| Checkpoint reads | `await graph.aget_state(...)` | `main.py` |
| LangGraph fan-out | `plan → {financials, research}` on same loop | `graph/build.py` |
| Nested search parallelism | `asyncio.gather` (interleaved awaits) | `research.py` |
| In-memory streaming state | `session_events`, `running_sessions`, `stream_signals` | `main.py` |

Module-level coordination globals are **loop-thread only** (`main.py`):

```python
session_events: dict[str, list[dict]] = {}
running_sessions: set[str] = set()
stream_signals: dict[str, asyncio.Event] = {}
```

They bridge the background `_run_graph` Task (producer) and `GET /stream` (consumer).
They are **not** a job queue, thread pool, or worker registry.

### No locks needed

Producer and consumer mutate the same dicts on the **same thread**. They never execute
Python bytecode concurrently — they interleave only at `await` boundaries. Locks are
unnecessary.

Thread-pool workers never touch these globals. Each executor call that needs the DB opens
its own `SessionLocal()` and closes it before returning.

---

## Thread pool

### What it is

```python
loop = asyncio.get_event_loop()
result = await loop.run_in_executor(None, sync_function, *args)
```

`None` selects Python's **default `ThreadPoolExecutor`** — typically
`min(32, os.cpu_count() + 4)` worker threads.

While a worker thread runs blocking code, the **event loop keeps serving** other
coroutines. When the thread finishes, the awaiting coroutine resumes with the result.

### Where we use it

| Call site | Blocking work | Why executor |
|---|---|---|
| `_session_status_async` | Sync SQLAlchemy read | SSE polls status in a **hot loop** — must not block the loop |
| `research_node` | Firecrawl `search` / `scrape` | Firecrawl SDK is **sync** |
| `financials_node` | Firecrawl `search` | Same; wrapped in `wait_for(25s)` |
| `plan_node` | `check_firecrawl_ready` | Sync credit preflight |

**Research — parallel Firecrawl on pool threads:**

```python
# research.py — each await run_in_executor suspends on the loop;
# multiple pool threads run HTTP in parallel.
results = await asyncio.gather(
    _scrape_company(),
    *[_search(q) for q in questions_to_run],
)
```

Wall time ≈ slowest call, not the sum of all searches.

**SSE — status reads off the loop:**

```python
# main.py — never call _session_status directly from async code
async def _session_status_async(session_id: str) -> str | None:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _session_status, session_id)
```

### Sync routes (third path)

FastAPI **sync** routes (`GET /sessions`, `POST /sessions`, `GET /chat`) are also run
in a thread pool by Starlette so they do not block async handlers. These are fast SQLite
CRUD calls — acceptable overhead.

---

## Loop vs pool — decision table

| Work | Runs on | Reason |
|---|---|---|
| LangGraph `astream` / `aget_state` | Loop | Native async checkpoint I/O |
| LLM `ainvoke` | Loop | Async HTTP client |
| `Event`, `sleep`, `wait_for`, `gather` | Loop | Pure asyncio |
| `session_events` / signals | Loop | Shared with SSE on same thread |
| Firecrawl search/scrape | **Pool** | Sync SDK |
| SSE status DB polls | **Pool** | Sync SQLAlchemy, many calls per stream |
| `save_report` at end of `_run_graph` | **Loop** (sync) | Once per run; OK for local SQLite |
| Simple CRUD sync routes | **Pool** (FastAPI) | Starlette default for `def` routes |

**Rule of thumb:** if the library blocks the thread until I/O returns, and it is called
from async code in a hot path → `run_in_executor`. If the library is natively async →
`await` on the loop.

---

## Two kinds of parallelism

Easy to conflate — both appear in a single research run.

### Cooperative (event loop)

Many coroutines **interleave** on one thread:

- `_run_graph` for session A and SSE for session B share the loop
- LangGraph runs `enrich_financials` and `research` as concurrent coroutines after `plan`
- `create_task` schedules more Tasks; it does **not** spawn threads

```
POST /run  → create_task(_run_graph)  → returns 200
GET /stream → await signal.wait()     → suspends; loop is free
_run_graph  → astream yields          → _append_event → signal.set()
SSE         → wakes, drains events, yields frame
```

### Preemptive (thread pool)

Multiple OS threads run blocking I/O **in parallel**:

```
research_node on the loop:
  gather(
    _scrape_company(),   → pool thread 1 (HTTP)
    _search("Q1"),       → pool thread 2 (HTTP)
    _search("Q2"),       → pool thread 3 (HTTP)
    ...
  )
  await gather  ← loop suspended until all threads finish
```

---

## End-to-end timeline (one session)

```text
T0   POST /run (loop)
       sync DB write: status → "running"
       create_task(_run_graph)     ← Task on loop, not a thread
       return 200

T0+  GET /stream (loop)
       event_generator starts
       await signal.wait()         ← suspends

T1   _run_graph Task (loop)
       running_sessions.add
       session_events = []
       stream_signals[id] = Event()

T2   async for astream (loop)
       plan → ainvoke (async LLM I/O, loop free during wait)
       research → gather + run_in_executor (pool threads for Firecrawl)
       each node → _append_event → Event.set()

T3   SSE consumer wakes (loop)
       drain session_events → yield SSE frames
       await _session_status_async  → pool thread for SQLite read
       await signal.wait() again

Tend astream completes (loop)
       sync save_report + update status  ← brief loop block, once
       finally: running_sessions.discard; Event.pop().set()

       SSE: not in running_sessions → poll status via executor
       DB → "completed" → yield {node: "done"}
```

Full SSE state machine: [workflow-streaming.md](./workflow-streaming.md).

---

## Common misconceptions

| Question | Answer |
|---|---|
| Is the app single-threaded? | **No** — one loop thread + a thread pool |
| Can many sessions run concurrently? | **Yes** — many Tasks on one loop |
| Does `create_task` spawn a thread? | **No** — same event loop |
| Why `run_in_executor` for Firecrawl? | Sync SDK would **freeze the entire loop** during HTTP |
| Why no locks on `session_events`? | Only the loop thread mutates them |
| What would block the loop today? | Sync `save_report` at graph end (once per run); mitigated by being rare |

---

## What breaks if you get this wrong

**Run Firecrawl synchronously on the loop (no executor):**
One slow search freezes every SSE stream, every `/run`, and every chat request in that
process until it returns.

**Share an ORM session across executor threads:**
Undefined behaviour / connection errors. Always `SessionLocal()` per executor call.

**Use threads for `_run_graph` instead of `create_task`:**
Would need locks on `session_events` and `stream_signals`. `asyncio.Event` is not the
right cross-thread primitive for this pattern.

**Call `_session_status` directly from SSE loop:**
Blocks the loop on every poll iteration — was a real bug; fixed with `_session_status_async`.

---

## Related code

| File | Role |
|---|---|
| `backend/app/main.py` | Loop orchestration, executor for SSE status, in-memory state |
| `backend/app/graph/nodes/research.py` | `gather` + `run_in_executor` for parallel Firecrawl |
| `backend/app/graph/nodes/financials.py` | `wait_for` + `run_in_executor` |
| `backend/app/graph/nodes/plan.py` | Executor for Firecrawl preflight |
| `docs/backend/async-patterns.md` | Complete API map and design decisions |
