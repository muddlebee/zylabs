# Async Patterns — Backend Internals

## The event loop model

Everything runs on one thread. Coroutines take turns. `await` is the yield point — when a coroutine hits `await`, it suspends and the event loop picks up another coroutine that's ready to run.

```
Event Loop Thread

├── handle POST /run  → asyncio.create_task(_run_graph)  ← schedules, doesn't block
│                       returns HTTP response immediately
│
├── handle GET /stream → starts event_generator coroutine
│                        hits `await signal.wait()` → suspends
│
├── _run_graph task running
│     await graph.astream() → suspends while LangGraph/Firecrawl does I/O
│     resumes → _append_event → signal.set()
│
├── event_generator resumes (signal fired)
│     drains new events → yields SSE frames → suspends again
│
└── ... repeat
```

No threads. No locks needed. The GIL plus single-threaded event loop means concurrent mutation of `session_events` and `stream_signals` is safe.

---

## Key async components

### `asyncio.create_task` — fire and forget (`main.py:230`)

```python
asyncio.create_task(_run_graph(session_id, initial_state, get_db))
return {"session_id": session_id, "status": "running"}
```

`create_task` wraps the coroutine in a `Task` object and schedules it on the running event loop. The HTTP handler returns immediately — the client gets `200` in milliseconds while the graph runs in the background.

**Trap:** if the task raises an unhandled exception that nobody awaits, Python logs
`Task exception was never retrieved` and silently swallows it. `_run_graph` catches internally and writes to DB — so it's handled — but this is the pattern to watch.

**What `create_task` is NOT:** it's not a thread, not a process, not parallelism. It's cooperative concurrency — `_run_graph` only runs when it's `await`-ing something (network I/O to Firecrawl/DeepSeek). CPU-bound work inside a task would block the entire event loop.

---

### `asyncio.Event` — the wake signal (`main.py:101, 282–289`)

An `asyncio.Event` has two states: set / not-set.

```python
signal.wait()   # suspends until set
signal.set()    # wakes all waiters
signal.clear()  # resets to not-set
```

Producer sets it, consumer waits on it. The clear-before-wait pattern is subtle:

```python
signal.clear()                                     # line 284
await asyncio.wait_for(signal.wait(), timeout=120) # line 286
```

Without `clear()` first: if the producer called `signal.set()` between the consumer's last drain and this point, `signal.wait()` returns immediately on a stale signal — the consumer spins draining zero events repeatedly.

---

### `asyncio.wait_for` — bounded blocking (`main.py:286`)

```python
await asyncio.wait_for(signal.wait(), timeout=120)
```

Wraps `signal.wait()` with a 120-second deadline. If no event fires, raises `asyncio.TimeoutError`, which sends a `timeout` SSE event and closes the stream. Prevents zombie connections from holding the generator open forever.

---

### `async for` over LangGraph (`main.py:104`)

```python
async for chunk in graph_module.graph.astream(initial_state, config=config, stream_mode="updates"):
```

`astream` is an async generator — each `yield` is a suspension point. LangGraph does `await` on I/O (LLM calls, Firecrawl requests) between yields, so the event loop runs other tasks during those waits.

`stream_mode="updates"` means each chunk is `{node_name: node_state}` — only what changed in that step. A single chunk from the parallel fan-out (`plan → {financials, research}`) can carry two node updates, which is why the code iterates `chunk.items()`.

---

### `AsyncGenerator[str, None]` — the SSE stream (`main.py:248`)

```python
async def event_generator() -> AsyncGenerator[str, None]:
    yield f"data: {json.dumps(item)}\n\n"
```

`yield` inside `async def` makes it an async generator. FastAPI's `StreamingResponse` calls `__anext__()` on it — each `yield` sends a chunk over the TCP socket. The generator is lazy — it only runs when FastAPI pulls the next value.

`return` inside the generator is clean termination — FastAPI closes the response and ends the HTTP/2 stream or TCP connection.

---

### Lifespan — DB connection scoped to app lifetime (`main.py:36`)

```python
@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    async with AsyncSqliteSaver.from_conn_string(settings.checkpoint_db_path) as checkpointer:
        graph_module.graph = build_graph(checkpointer)
        yield       # app runs here
    log.info("app.stopped")
```

`AsyncSqliteSaver` holds one open async SQLite connection for the process lifetime. No per-request open/close overhead for checkpoints. The `yield` is where FastAPI serves requests; cleanup runs after.

---

## The blocking sync call — known issue

### What it is (`main.py:235`)

```python
def _session_status(session_id: str) -> str | None:   # regular def, not async
    db = SessionLocal()
    try:
        session = session_service.get_session(db, session_id)
        return session.status if session else None
    finally:
        db.close()
```

This is a sync function called from inside the async `event_generator`. SQLAlchemy's sync ORM does blocking I/O — it calls the OS and waits. This **blocks the event loop** for the duration of the DB read.

### When it blocks everything

```
BLOCKED (sync I/O holds the thread):

Event Loop Thread
│
├─[event_gen]──_session_status()──████████████──returns
│                                 ↑ BLOCKED
│                                 SQLAlchemy opens OS file handle,
│                                 reads SQLite, no await anywhere
│
├─[_run_graph]─────────────────── WAITING ──────────────  ← can't resume
├─[GET /healthz]───────────────── WAITING ──────────────  ← request stalls
```

### Why it doesn't hurt now

SQLite is on the same disk as the process. OS page cache likely has it warm. Read latency is ~50–200 microseconds — the event loop freezes for 0.2ms, imperceptible.

At scale it compounds:

```
10 concurrent sessions, each polling status twice per second:

SQLite local:    10 × 2 × 0.2ms  =   4ms/sec blocked   ← fine
Postgres remote: 10 × 2 × 5ms   = 100ms/sec blocked   ← noticeable
Postgres loaded: 10 × 2 × 50ms  =   1s/sec blocked    ← requests timing out
```

---

## The fix — `run_in_executor`

`run_in_executor` hands the blocking call to a worker thread from Python's built-in `ThreadPoolExecutor`, and gives back an awaitable. The event loop suspends the coroutine and runs other work while the worker thread does the blocking I/O.

```
AFTER fix:

Event Loop Thread                 Worker Thread (from pool)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━  ━━━━━━━━━━━━━━━━━━━━━━━━━━
[event_gen] ── await ──suspends   _session_status() ████████
[_run_graph]   resumes ────────── ──────────────────── result
[GET /health]  handled ─────────  ────────────────────    ↓
[event_gen]  ◄──────────────────────────────── resumes with result
```

### Implementation

```python
async def _session_status_async(session_id: str) -> str | None:
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(None, _session_status, session_id)
```

`None` means use the default pool (`min(32, cpu_count + 4)` threads). Each call to `_session_status` creates and closes its own session — no sharing between threads, no race conditions.

### The one gotcha

Worker threads still block. If hundreds of concurrent SSE streams each poll status, the thread pool exhausts and callers queue up. For this project's scale (one stream per research session, a few polls per minute), the default pool is never close to saturation. At thousands of concurrent streams, the polling pattern itself would need rethinking (e.g., push status via pub/sub instead of polling DB).
