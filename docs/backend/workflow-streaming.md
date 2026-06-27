# Workflow Streaming & Persistence

## Three storage layers

Everything makes sense once you see the three layers:

```
┌─────────────────────────────────────────────────────────┐
│  Layer 1: Process memory (fastest, lost on restart)     │
│  session_events["abc123"] = [e0, e1, e2, ...]           │
│  stream_signals["abc123"] = asyncio.Event               │
│  running_sessions = {"abc123"}                          │
├─────────────────────────────────────────────────────────┤
│  Layer 2: checkpoints.db (LangGraph state per step)     │
│  thread_id="abc123" → full ResearchState after each     │
│  node: sources, findings, quality_score, report, errors │
├─────────────────────────────────────────────────────────┤
│  Layer 3: research.db (app tables)                      │
│  sessions: id, company_name, status, created_at         │
│  reports:  session_id, report JSON                      │
│  chat_messages: session_id, role, content               │
└─────────────────────────────────────────────────────────┘
```

Layer 1 drives live streaming. Layer 2 enables resumption after restart. Layer 3 is the
permanent record.

### Layer 1 detail — three in-memory structures

These live as module-level globals in `main.py`. They coordinate the **background graph
runner** (`_run_graph`) with the **SSE consumer** (`GET /sessions/{id}/stream`). They are
**not** a job queue, thread pool, or worker registry.

Each run is spawned with `asyncio.create_task(_run_graph(...))` — one coroutine on the
event loop per session. `running_sessions` tracks those asyncio tasks, not threads. (Some
graph nodes call `run_in_executor` for blocking Firecrawl I/O, but that is unrelated to
these globals.)

| Structure | Type | Question it answers |
|-----------|------|---------------------|
| `session_events` | `dict[str, list[dict]]` | What node updates have happened? (the event log) |
| `stream_signals` | `dict[str, asyncio.Event]` | Should the SSE client wake up and read new events? (the doorbell) |
| `running_sessions` | `set[str]` | Is `_run_graph` still executing in **this process**? (the alive flag) |

All three are initialised together when `_run_graph` starts and torn down in its `finally`
block (except `session_events`, which is left populated until the next run overwrites it).

```
POST /sessions/{id}/run
  DB status → "running"
  asyncio.create_task(_run_graph)     ← not a thread-pool submit

_run_graph starts (same process, event loop)
  running_sessions.add(session_id)
  session_events[session_id] = []
  stream_signals[session_id] = asyncio.Event()

  ... graph.astream loop ...
      _append_event() → session_events.append + stream_signals[id].set()

_run_graph finally
  running_sessions.discard(session_id)
  stream_signals.pop(session_id).set()   ← final wake (signal then removed)
```

#### `session_events` — the whiteboard

Append-only list of `{"node": "...", "status": "..."}` dicts (sometimes with `"errors"`).
The SSE consumer reads forward from a cursor; it never removes entries. `GET /progress`
returns the same list. If the buffer is empty (e.g. after restart), `_workflow_events`
falls back to reconstructing events from the LangGraph checkpoint.

#### `stream_signals` — the doorbell

While the graph is producing events, the SSE handler would otherwise busy-poll
`session_events`. Instead it parks on `await signal.wait()` (120s timeout).

- **Producer** (`_append_event`): append to `session_events`, then `signal.set()`.
- **Consumer** (`/stream`): drain all events from cursor onward; if caught up, `signal.clear()` then `await signal.wait()`.

When the graph finishes, the signal is **popped** before the final `set()` — the doorbell
is uninstalled. That is why `running_sessions` exists as a separate check (see below).

#### `running_sessions` — the alive flag

Tracks session IDs whose `_run_graph` task has started but not yet reached `finally`.
Only `/stream` reads it; `/progress` and the frontend never see it.

After draining events, the SSE loop checks three sources in order:

```
1. DB status completed/failed?  → yield done/error, close
2. session_id NOT in running_sessions?  → graph task is done; poll DB ~3s for lagging status, then close
3. else  → graph still running; park on stream_signals.wait()
```

The race this solves: when the graph ends, the last node event fires **before**
`save_report` commits to `research.db`. The `finally` block discards from
`running_sessions` and pops the signal, waking the consumer. At that instant DB may still
say `"running"`. Step 2 above polls briefly instead of waiting 120s on a removed signal.

#### What these structures do *not* do

- **Not duplicate of DB status** — DB is set to `"running"` on POST `/run` before
  `_run_graph` adds to `running_sessions` (tiny window where they disagree).
- **Not double-run prevention** — nothing blocks POST `/run` if a session is already in
  `running_sessions`.
- **Not shared across workers** — each uvicorn process has its own copy. `/run` on
  worker A and `/stream` on worker B breaks live streaming. See
  `scaling-in-process-state.md` for the Redis replacement sketch.

---

## The workflow process — what happens inside `_run_graph`

The graph is built once at startup (`build_graph(checkpointer)`). Every run is a call to
`graph.astream()` with a unique `thread_id = session_id`. LangGraph checkpoints the full
`ResearchState` to `checkpoints.db` after every node completes.

```
graph.astream(initial_state, config={"thread_id": "abc123"})

Step 1 — plan node:
  LLM call → decompose objective into research questions
  LangGraph: checkpoint ResearchState to checkpoints.db
  _run_graph: _append_event({node:"plan", status:"Planning complete"})

Step 2 — after_plan routing:
  reads state.retrieval_unavailable
  if True  → jump to generate_report (no research possible)
  if False → fan out to BOTH enrich_financials AND research

Step 3 — enrich_financials + research run in parallel:
  LangGraph fires both edges from plan simultaneously
  Two nodes execute concurrently on the same event loop
  Single astream chunk can carry BOTH updates:
    chunk = {
      "enrich_financials": {status:"Financials enriched"},
      "research": {status:"Researching 8 topics"}
    }
  _run_graph iterates chunk.items() → emits TWO events to session_events

Step 4 — synthesize (waits for both to converge):
  combines sources + financials into findings sections

Step 5 — quality_gate:
  scores coverage: 0.0 → 1.0
  after_quality_gate routing:
    score < 0.7 AND revisions < 2 → loop back to research
    else → strategize

Step 6 — (optional loop) targeted re-research on gaps:
  revisions counter increments in state

Step 7 — strategize → generate_report:
  report written to ResearchState
  _run_graph: save_report(db) → research.db
              update_session_status("completed")
              stream_signals.pop + signal.set() ← final wake of SSE consumer
```

---

## How session_events grows — step by step

The list starts empty when `_run_graph` initialises and grows one entry per node.
The SSE consumer always reads forward from its cursor — it never removes entries.

```
T=0s   POST /sessions/abc123/run fires
       _run_graph starts
       session_events["abc123"] = []          ← empty list created

       session_events["abc123"]
       ┌───────────────────────┐
       │  (empty)              │  cursor=0
       └───────────────────────┘


T=2s   plan node completes
       _append_event({node:"plan", status:"Planning complete"})

       session_events["abc123"]
       ┌────────────────────────────────────────────────┐
       │ [0] {node:"plan", status:"Planning complete"}  │  ← appended
       └────────────────────────────────────────────────┘
            signal.set() → SSE consumer wakes
            consumer: cursor=0 < len=1 → drain [0] → yield to browser
            consumer: cursor=1, parks on signal.wait()


T=18s  enrich_financials + research both complete (parallel)
       chunk carries both in one dict
       _append_event({node:"enrich_financials", status:"Financials enriched"})
       _append_event({node:"research",          status:"Researching 12 topics"})

       session_events["abc123"]
       ┌────────────────────────────────────────────────────────────────┐
       │ [0] {node:"plan",              status:"Planning complete"}     │
       │ [1] {node:"enrich_financials", status:"Financials enriched"}  │  ← appended
       │ [2] {node:"research",          status:"Researching 12 topics"}│  ← appended
       └────────────────────────────────────────────────────────────────┘
            signal.set() (first append) → consumer wakes
            signal already set (second append) → no-op
            consumer: cursor=1 < len=3 → drain [1],[2] in one pass
            consumer: cursor=3, parks on signal.wait()


T=26s  synthesize completes
       _append_event({node:"synthesize", status:"Synthesis complete"})

       session_events["abc123"]
       ┌────────────────────────────────────────────────────────────────┐
       │ [0] {node:"plan",              status:"Planning complete"}     │
       │ [1] {node:"enrich_financials", status:"Financials enriched"}  │
       │ [2] {node:"research",          status:"Researching 12 topics"}│
       │ [3] {node:"synthesize",        status:"Synthesis complete"}   │  ← appended
       └────────────────────────────────────────────────────────────────┘
            signal.set() → consumer drains [3] → cursor=4


T=27s  quality_gate completes (score=0.61, below threshold)
       _append_event({node:"quality_gate", status:"Score 0.61 — re-researching"})

       session_events["abc123"]
       ┌────────────────────────────────────────────────────────────────────────────┐
       │ [0] {node:"plan",              status:"Planning complete"}                 │
       │ [1] {node:"enrich_financials", status:"Financials enriched"}              │
       │ [2] {node:"research",          status:"Researching 12 topics"}            │
       │ [3] {node:"synthesize",        status:"Synthesis complete"}               │
       │ [4] {node:"quality_gate",      status:"Score 0.61 — re-researching"}      │  ← appended
       └────────────────────────────────────────────────────────────────────────────┘
            consumer drains [4] → cursor=5


T=38s  research loops again (revision 1)
       _append_event({node:"research", status:"Targeted re-research on 3 gaps"})

       session_events["abc123"]
       ┌──────────────────────────────────────────────────────────────────────────────┐
       │ [0] {node:"plan",              ...}                                           │
       │ [1] {node:"enrich_financials", ...}                                           │
       │ [2] {node:"research",          status:"Researching 12 topics"}               │
       │ [3] {node:"synthesize",        ...}                                           │
       │ [4] {node:"quality_gate",      status:"Score 0.61 — re-researching"}         │
       │ [5] {node:"research",          status:"Targeted re-research on 3 gaps"}      │  ← second research
       └──────────────────────────────────────────────────────────────────────────────┘
            note: "research" appears TWICE — UI revision counter increments


T=46s  synthesize → quality_gate (score=0.88, passes) → strategize → generate_report
       four more appends

       session_events["abc123"]   final state
       ┌──────────────────────────────────────────────────────────────────────────────┐
       │ [0]  {node:"plan",              status:"Planning complete"}                   │
       │ [1]  {node:"enrich_financials", status:"Financials enriched"}               │
       │ [2]  {node:"research",          status:"Researching 12 topics"}             │
       │ [3]  {node:"synthesize",        status:"Synthesis complete"}                │
       │ [4]  {node:"quality_gate",      status:"Score 0.61 — re-researching"}       │
       │ [5]  {node:"research",          status:"Targeted re-research on 3 gaps"}    │
       │ [6]  {node:"synthesize",        status:"Synthesis complete"}                │
       │ [7]  {node:"quality_gate",      status:"Score 0.88 — passing"}              │
       │ [8]  {node:"strategize",        status:"Strategy complete"}                 │
       │ [9]  {node:"generate_report",   status:"Report ready"}                      │
       └──────────────────────────────────────────────────────────────────────────────┘
            finally: running_sessions.discard, stream_signals.pop.set()
            consumer wakes: checks DB → "completed"
            yields {node:"done"} → browser
            generator returns, SSE connection closes
```

---

## The cursor — how reconnect works

The cursor is the consumer's read position in the list. It only ever moves forward.

```
Normal flow:                              Reconnect mid-run:

session_events = [e0,e1,e2,e3,e4,e5]    session_events = [e0,e1,e2,e3,e4,e5]
                                                           (server kept the list)
consumer cursor=0                         browser refresh → GET /progress
  drain e0 → yield → cursor=1            ◄── {events:[e0,e1,e2], status:"running"}
  drain e1 → yield → cursor=2            frontend: after = 3
  drain e2 → yield → cursor=3
  park on signal.wait()                   new EventSource(?after=3)
                                          new consumer cursor=3
  e3 arrives → signal.set()
  drain e3 → yield → cursor=4              cursor=3 < len=6
  park on signal.wait()                     drain e3 → yield
                                            drain e4 → yield
  e4 arrives → signal.set()                drain e5 → yield
  drain e4 → yield → cursor=5              cursor=6 = len → park
  ...                                     ← seamless, nothing missed
```

The list never shrinks. An old consumer at cursor=0 and a new consumer at cursor=3
can both read from the same list simultaneously without interfering.

---

## The streaming detail — producer to browser

```
_run_graph (background task)          event_generator (SSE consumer)
────────────────────────────          ──────────────────────────────

await graph.astream(...)
  │
  ├── plan node completes
  │   chunk = {"plan": {...}}
  │   _append_event(e0)               signal.set() → consumer wakes
  │                                   drains e0
  │                                   yield "data:{node:plan}\n\n" → browser
  │
  ├── enrich_financials + research complete
  │   chunk = {                       ← one chunk, two nodes
  │     "enrich_financials": {},
  │     "research": {}
  │   }
  │   _append_event(e1)               signal.set() → consumer wakes
  │   _append_event(e2)               signal already set, no-op
  │                                   consumer drains BOTH e1 and e2 in one pass
  │                                   yield e1 → browser
  │                                   yield e2 → browser
  │
  ├── synthesize → quality_gate → strategize → generate_report
  │   each: _append_event → signal.set → consumer drains → yield to browser
  │
  └── finally block:
      running_sessions.discard("abc123")
      stream_signals.pop("abc123").set()  ← mandatory final wake
                                             consumer checks DB: "completed"
                                             yield {node:"done"} → browser
                                             generator returns, SSE closes
```

The `finally` block wake is critical — without it the consumer would park on
`signal.wait()` for up to 120s after the graph finishes, because the last node event
fires before `save_report` commits to DB.

After the wake, the consumer may find DB still `"running"` and `session_id not in
running_sessions` (task done, status lagging). It polls DB for up to 3s before closing
rather than waiting on the now-removed signal. See **Layer 1 detail** above.

---

## Browser refresh — what persists and when

### Refresh while graph is running (server not restarted)

```
Browser refreshes mid-run

GET /sessions/abc123
◄── {status:"running", report:null}     from research.db

GET /sessions/abc123/progress
  server: session_events.get("abc123")
          ← still in process memory
          returns [e0:"plan", e1:"financials", e2:"research"]
◄── {status:"running", events:[e0,e1,e2]}

setEvents([e0,e1,e2])    ← UI restores all 3 nodes instantly
after = 3
EventSource ?after=3     ← picks up exactly where browser left off
← e3, e4... continue streaming
```

### Refresh after completion

```
GET /sessions/abc123
◄── {status:"completed", report:{...}}  from research.db

useWorkflowStream:
  initialStatus="completed" → done=true from the start
  no EventSource opened, no GET /progress called

SessionDetailPage:
  session.report exists → ReportView renders immediately
```

### Refresh after server restart

```
Server restarts → process memory wiped:
  session_events = {}   ← gone
  stream_signals = {}   ← gone
  running_sessions = {} ← gone
  asyncio tasks dead    ← graph was mid-run, now gone

GET /sessions/abc123
◄── {status:"running"}   research.db still says running (stale)

GET /sessions/abc123/progress
  server: session_events.get("abc123") → None
  fallback: graph.aget_state({"thread_id":"abc123"})
            reads checkpoints.db → last saved ResearchState
            events_from_checkpoint(state.values)
```

`events_from_checkpoint` infers completed nodes from checkpoint state:

```python
# research_plan exists → plan ran
if values.get("research_plan"):
    events.append(_event("plan", "Planning complete"))

# sources/scraped exist → research ran
if values.get("sources") or values.get("scraped"):
    events.append(_event("research", status))

# findings has factual sections → synthesize ran
if any(findings.get(s) for s in FACTUAL_SECTIONS):
    events.append(_event("synthesize", "Synthesis complete"))

# report exists → generate_report ran
if values.get("report"):
    events.append(_event("generate_report", "Report ready"))
```

What's lost: exact status strings from each node. The checkpoint stores state, not
messages. Reconstruction uses generic statuses.

---

## How `getNodeState` drives the UI — no explicit state machine

The UI never tracks "which node is active" as a variable. `getNodeState` derives it
purely from the events array on every render using `COMPLETION_TRIGGERS`:

```
events = [plan, enrich_financials, research, synthesize]

COMPLETION_TRIGGERS:
  "plan" is done if ANY of [enrich_financials, research, synthesize, ...] seen ✓
  "enrich_financials" is done if ANY of [synthesize, ...] seen ✓
  "research" is done if ANY of [synthesize, ...] seen ✓
  "synthesize" seen directly ✓

inferCompleted → {plan, enrich_financials, research, synthesize}

getNodeState results:
  plan              → "done"    → green dot + checkmark
  enrich_financials → "done"    → green dot + checkmark
  research          → "done"    → green dot + checkmark
  synthesize        → "done"    → green dot + checkmark
  quality_gate      → "active"  → pulsing blue dot
  strategize        → "pending" → grey dot
  generate_report   → "pending" → grey dot
```

`COMPLETION_TRIGGERS` is the key insight — instead of requiring the quality_gate event
to mark it done, it checks if any *later* node arrived. So even if quality_gate was
missed in a reconnect, it shows as done if strategize has been seen.

---

## `pollSessionUntilReady` — bridging graph finish and DB write

When `generate_report` SSE event arrives, the report isn't in research.db yet:

```
graph timeline:
  generate_report node returns state with report
  LangGraph: checkpoint (report now in checkpoints.db)
  _run_graph: _append_event({node:"generate_report"})
              ← SSE fires to browser immediately
  _run_graph: save_report(db)            ← NOW writes to research.db
              update_session_status("completed")

browser timeline:
  receives {node:"generate_report"} event
  resolveViaApi() → GET /sessions/abc123
  ◄── {status:"running", report:null}   ← DB write hasn't happened yet
  startPolling(500ms)
  ...
  GET /sessions/abc123
  ◄── {status:"completed", report:{...}}  ← now committed
  finish(true, session)
  setSession(session) → report renders
```

`pollSessionUntilReady` retries up to 30 × 500ms = 15 seconds. Without it, `onComplete`
would fire with `report:null` and the report view would never appear.

---

## Persistence summary

```
Artifact                 Tab close  Refresh  Server restart
──────────────────────────────────────────────────────────
Session record           ✓ DB       ✓ DB     ✓ DB
Report JSON              ✓ DB       ✓ DB     ✓ DB
Chat history             ✓ DB       ✓ DB     ✓ DB
Node event log           ✗ memory   ✓ mem    ✗ reconstructed from checkpoint
Graph state/checkpoint   ✓ DB       ✓ DB     ✓ DB
Live SSE connection      ✗ closed   ✗ reconnects  ✗ graph dead
```

The report is the durable output — once written to research.db, it's permanent regardless
of what happens to the process, the connection, or the browser. Everything else is
best-effort progress tracking layered on top.
