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

What's lost: exact status strings from each node (e.g. "Researching 8 topics across 4
domains"). The checkpoint stores state, not messages. Reconstruction uses generic
statuses.

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
