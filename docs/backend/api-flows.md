# API Flows — End to End

## Complete API map

```
Browser                          FastAPI                        Background
─────────────────────────────    ──────────────────────────     ──────────────
GET  /sessions                   list_sessions()
POST /sessions                   create_session()
POST /sessions/{id}/run          run_session()                  create_task(_run_graph)
GET  /sessions/{id}              get_session()
GET  /sessions/{id}/progress     get_session_progress()
GET  /sessions/{id}/stream       stream_session() → SSE
POST /sessions/{id}/chat         post_chat()
GET  /sessions/{id}/chat         get_chat()
```

---

## Flow 1 — Home page loads

```
HomePage mounts
    │
    └── useEffect → api.listSessions()
                    │
                    GET /sessions
                    │
                    ◄── [{session_id, company_name, status, created_at}, ...]
                    │
                    setSessions(data.sort by created_at desc)
                    │
                    └── SessionList renders cards
```

One GET, sorted by date, renders the list. No state machine, no streaming.

---

## Flow 2 — User creates a research session

`SessionForm.handleSubmit` fires two API calls sequentially — create first, then run:

```
User clicks "Start Research"
    │
    ├── validate(values) — client side, no API call
    │
    ├── POST /sessions  {company_name, company_url, objective}
    │   ◄── {session_id: "abc123", status: "created"}
    │
    ├── POST /sessions/abc123/run
    │   │
    │   │  server side:
    │   │  update_session_status(db, "running")
    │   │  asyncio.create_task(_run_graph(...))  ← graph starts in background
    │   │
    │   ◄── {session_id: "abc123", status: "running"}
    │       returns immediately, graph running in background
    │
    └── navigate("/sessions/abc123")   ← React Router pushes to detail page
```

Why two calls instead of one `POST /sessions/run`? Clean separation — session creation
is idempotent and instant. Running is the expensive async operation. You can create a
session without running it (useful for queuing, scheduling, retrying).

---

## Flow 3 — Detail page loads

Three things happen on mount in sequence:

```
SessionDetailPage mounts, id="abc123"
    │
    ├── 1. fetchSession() → GET /sessions/abc123
    │      ◄── {session_id, company_name, status:"running", report:null}
    │      setSession(data)
    │      setLoading(false)
    │
    │   page renders:
    │   ├── aside: company name, StatusBadge("running"), WorkflowProgress
    │   └── main:  spinner "Research in progress…"
    │
    └── 2. WorkflowProgress mounts → useWorkflowStream starts
               │
               (see workflow-streaming.md — Flow 4)
```

`SessionDetailPage` owns the `session` state. `WorkflowProgress` owns the live event
stream. When the stream finishes, it calls `onComplete(session)` which updates
`SessionDetailPage`'s state — that's how the report appears without a page reload.

```typescript
const handleWorkflowComplete = useCallback((detail: SessionDetail) => {
  setSession(detail)   // replaces the whole session object, report included
}, [])
```

---

## Flow 4 — Streaming workflow

See `workflow-streaming.md` for the full breakdown of `useWorkflowStream`, the three
storage layers, and how browser refresh persists state.

---

## Flow 5 — Chat

Completely separate from the workflow stream. Works on a completed session only:

```
User types message → ChatPanel
    │
    POST /sessions/abc123/chat  {message: "What's their revenue model?"}
    │
    │  server: chat_service.chat(db, session_id, message)
    │  ├── loads report from DB as context
    │  ├── calls LLM with report + chat history + user message
    │  └── saves assistant reply to DB
    │
    ◄── {role:"assistant", content:"Their revenue model is..."}
    │
    append to local messages state

GET /sessions/abc123/chat   ← on ChatPanel mount, loads history
◄── [{role:"user",...}, {role:"assistant",...}]
```

The chat is grounded in the stored report — it's passed as context to the LLM on every
call. No vector DB. The full report text is the context window (RAG-lite pattern).

---

## Full lifecycle — everything tied together

```
                    ┌─────────────────────────────────────────────┐
                    │              BROWSER                         │
                    │                                             │
  HomePage          │  SessionDetailPage                          │
  ──────────        │  ──────────────────                         │
  GET /sessions     │  GET /sessions/{id}  ← initial load         │
  → render list     │         │                                    │
                    │         └── WorkflowProgress                │
  SessionForm       │               │                             │
  ──────────        │         useWorkflowStream                   │
  POST /sessions    │               │                             │
  POST /{id}/run    │         GET /progress    ← phase A          │
  navigate →        │         EventSource SSE  ← phase B          │
                    │         GET /{id}        ← phase C polling  │
                    │               │                             │
                    │         onComplete(session)                  │
                    │               │                             │
                    │         setSession → report renders          │
                    │                                             │
                    │         ChatPanel                           │
                    │         ─────────                           │
                    │         GET /{id}/chat   ← history on mount │
                    │         POST /{id}/chat  ← each message     │
                    └─────────────────────────────────────────────┘
                                      │
                    ┌─────────────────▼───────────────────────────┐
                    │              FASTAPI                         │
                    │                                             │
                    │  SQLite (research.db)   checkpoints.db      │
                    │  ─────────────────────  ──────────────────  │
                    │  sessions table         LangGraph state      │
                    │  reports table          per thread_id        │
                    │  chat_messages table                         │
                    │                                             │
                    │  In-memory (per process)                    │
                    │  ─────────────────────                      │
                    │  session_events dict    ← whiteboard        │
                    │  stream_signals dict    ← doorbell          │
                    │  running_sessions set   ← who's active      │
                    └─────────────────────────────────────────────┘
                                      │
                    ┌─────────────────▼───────────────────────────┐
                    │         LANGGRAPH (_run_graph task)          │
                    │                                             │
                    │  plan → financials ──┐                      │
                    │         research  ───┴─► synthesize         │
                    │                         quality_gate        │
                    │                         ↙ (loop if <0.7)   │
                    │                        strategize           │
                    │                        generate_report      │
                    │                                             │
                    │  Each node → _append_event → signal.set()   │
                    └─────────────────────────────────────────────┘
```

## The single key that ties everything together

`session_id` flows through every layer:

```
React Router param  → /sessions/abc123
API calls           → /sessions/abc123/stream
LangGraph config    → thread_id: "abc123"
SQLite              → sessions.id = "abc123"
In-memory dicts     → session_events["abc123"]
Chat history        → chat_messages.session_id = "abc123"
```

Everything hangs off one UUID. The session is the unit of work, persistence, streaming,
and chat context.
