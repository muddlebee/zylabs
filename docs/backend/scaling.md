# Scaling the Backend

How the FastAPI backend runs today, what limits horizontal scale, and a practical ladder
from single-process dev to production multi-instance deployment.

**Deep dives:**

| Topic | Doc |
|---|---|
| In-process state, Redis pub/sub, job queues | [scaling-in-process-state.md](./scaling-in-process-state.md) |
| Event loop thread vs thread pool | [event-loop-and-thread-pool.md](./event-loop-and-thread-pool.md) |
| asyncio API map and design decisions | [async-patterns.md](./async-patterns.md) |
| SSE, `session_events`, reconnect behaviour | [workflow-streaming.md](./workflow-streaming.md) |
| Route-level request flows | [api-flows.md](./api-flows.md) |

---

## Current architecture

One **monolithic FastAPI app** in `backend/app/main.py`. Uvicorn loads it as:

```bash
uvicorn app.main:app --port 8001 --reload   # dev (Makefile)
uvicorn app.main:app --host 0.0.0.0 --port $PORT   # Railway
```

```
┌──────────────────────────────────────────────────────────────────┐
│  uvicorn — 1 worker (no --workers flag today)                    │
├──────────────────────────────────────────────────────────────────┤
│  FastAPI (main.py)                                               │
│    lifespan → SQLite init + LangGraph compile (module singleton)   │
│    sync routes  → Depends(get_db) → session_service              │
│    POST /run    → asyncio.create_task(_run_graph)  [same process] │
│    GET /stream  → StreamingResponse (SSE)                        │
├──────────────────────────────────────────────────────────────────┤
│  In-process globals: session_events, running_sessions,             │
│                      stream_signals                              │
├──────────────────────────────────────────────────────────────────┤
│  research.db (sessions, reports, chat)                           │
│  checkpoints.db (LangGraph AsyncSqliteSaver)                     │
└──────────────────────────────────────────────────────────────────┘
```

The HTTP layer, graph runner, and SSE consumer all share **one process and one asyncio
event loop**. Graph work is not a separate service or queue — it is a background coroutine
started from the `/run` handler.

---

## Concurrency model — not single-threaded, but single-loop

Each uvicorn worker runs **one asyncio event loop on one thread**. Many coroutines interleave
at `await` points: multiple SSE streams, multiple `_run_graph` tasks, and HTTP handlers can
run concurrently on that loop.

A **default thread pool** handles blocking work so the loop stays responsive:

| Work | Mechanism |
|---|---|
| LangGraph / LLM calls | Native async (`astream`, `ainvoke`) |
| Parallel Firecrawl searches | `asyncio.gather` + `run_in_executor` |
| SSE status polls | `run_in_executor` for sync SQLAlchemy reads |
| Simple CRUD routes | Sync handlers (FastAPI runs in thread pool) |

**Implication:** one worker comfortably runs many concurrent research sessions as long as
external APIs (DeepSeek, Firecrawl) keep up. CPU is rarely the bottleneck; I/O and rate
limits are.

See [async-patterns.md](./async-patterns.md) for the full API map and timeline.

---

## What limits scale today

Three module-level structures in `main.py` tie live streaming to a single process:

```python
session_events: dict[str, list[dict]] = {}
running_sessions: set[str] = set()
stream_signals: dict[str, asyncio.Event] = {}
```

| Scale action | Result |
|---|---|
| `uvicorn --workers 4` | Workers do not share memory → SSE breaks across workers |
| Railway / K8s replicas > 1 | Round-robin sends `/run` and `/stream` to different instances |
| Process restart mid-run | Layer-1 events lost (checkpoint + DB may still recover partial state) |
| SQLite under heavy write load | Single writer; fine for demo, not for high concurrency |

The first wall you hit in production is usually **multi-instance deployment**, not CPU.

See [scaling-in-process-state.md](./scaling-in-process-state.md) for a request-by-request
breakdown of what fails.

---

## Scaling ladder

### Level 0 — Current (demo / single tenant)

**Setup:** 1 uvicorn worker, SQLite, in-memory streaming.

```bash
make backend   # uvicorn app.main:app --port 8001 --reload
```

| ✓ Works | ✗ Not for |
|---|---|
| Multiple concurrent sessions on one machine | Multi-instance load balancing |
| Simple ops, easy debugging | Failover across processes |
| Zero extra infrastructure | High write throughput |

**When to stay here:** local dev, demos, internal tools, low traffic on a single Railway
container.

---

### Level 1 — More workers + sticky sessions (interim)

**Setup:** Multiple uvicorn workers or replicas; load balancer routes by `session_id`.

```bash
uvicorn app.main:app --host 0.0.0.0 --port 8001 --workers 4
```

Configure the load balancer so all requests for one session hit the same worker (hash on
path or cookie). Example nginx sketch:

```nginx
upstream backend {
    hash $uri consistent;
    server 127.0.0.1:8001;
    server 127.0.0.1:8002;
}
```

| ✓ | ✗ |
|---|---|
| No code changes | No failover if that worker dies |
| Quick throughput bump for HTTP | Hot session pinned to one worker |
| | In-memory events still lost on restart |

**When to use:** short-term relief before Redis; accept that sticky sessions and fault
tolerance conflict.

---

### Level 2 — Shared event bus (stateless HTTP tier)

**Setup:** Replace in-memory dicts with Redis (or Postgres NOTIFY + events table). Any
HTTP worker can serve SSE while any worker runs the graph.

| In-process | Shared store |
|---|---|
| `session_events[id]` | `RPUSH` / `LRANGE events:{id}` |
| `stream_signals[id].set()` | `PUBLISH signal:{id}` |
| `running_sessions` | `SADD` / `SISMEMBER running` |

Implementation sketch and cross-process flow diagrams:
[scaling-in-process-state.md § Fix 2](./scaling-in-process-state.md#fix-2--redis-pubsub-the-right-fix).

**Postgres alternative:** LISTEN/NOTIFY when already on Postgres — no Redis, but need a
durable events table for replay. See
[scaling-in-process-state.md § Fix 3](./scaling-in-process-state.md#fix-3--postgres-listennotify-no-extra-dependency).

| ✓ | ✗ |
|---|---|
| Horizontal HTTP scale | Graph still pinned to process that received `/run` |
| SSE works across workers | Need Redis or Postgres migration |
| Event replay via list cursor (`?after=N`) | Operational complexity |

**When to use:** first production multi-instance deploy (e.g. Railway auto-scale > 1).

---

### Level 3 — Job queue + worker pool (production)

**Setup:** HTTP servers enqueue graph jobs; dedicated workers dequeue and run `_run_graph`.
Events still flow through Redis (or equivalent).

```
POST /run  →  LPUSH jobs  →  200 OK immediately
Worker     →  BRPOP jobs  →  _run_graph  →  publish events to Redis
GET /stream (any HTTP instance)  →  subscribe + lrange  →  SSE
```

Tools: Celery, RQ, Dramatiq, or a thin Redis list consumer.

| ✓ | ✗ |
|---|---|
| HTTP and graph scale independently | Largest code + ops change |
| Survives HTTP worker restarts | Queue monitoring, retries, dead letters |
| Proper backpressure | |

See [scaling-in-process-state.md § LangGraph tasks across workers](./scaling-in-process-state.md#the-deeper-issue--langgraph-tasks-across-workers).

**When to use:** sustained load, many concurrent research runs, need isolation between API
latency and long-running workflows.

---

### Level 4 — Production data layer

| Component | Today | At scale |
|---|---|---|
| App DB | SQLite `research.db` | Postgres + connection pool (`asyncpg` or SQLAlchemy 2 async) |
| Checkpoints | `AsyncSqliteSaver` (local file) | Postgres or Redis checkpointer (LangGraph-supported backends) |
| Config | `DATABASE_URL` in `.env` | Managed Postgres (Railway, Neon, RDS) |

SQLite limits: one writer, file on local disk (not shared across containers). Migrating
app tables to Postgres is a prerequisite for multi-container DB access. Pair with Level 2
or 3 for streaming.

---

## Decision guide

```
Need more concurrent sessions on ONE machine?
  → Usually already OK (asyncio + external I/O bound)
  → Watch Firecrawl credits and LLM rate limits

Need more HTTP replicas (Railway auto-scale, K8s)?
  → Level 2 minimum (Redis or Postgres events)
  → Sticky sessions alone = band-aid only

Need failover / no lost SSE on worker crash?
  → Level 2 with durable Redis (AOF) or Postgres events table

Need to scale graph execution separately from API?
  → Level 3 (job queue + worker pool)

Need production persistence?
  → Level 4 (Postgres) + Level 2 or 3
```

---

## Comparison matrix

| | Level 0 | Level 1 sticky | Level 2 Redis | Level 3 queue | Level 4 Postgres |
|---|---|---|---|---|---|
| Multi-worker HTTP | ✗ | ✓ (fragile) | ✓ | ✓ | ✓ |
| Failover | N/A | ✗ | ✓* | ✓ | ✓ |
| Independent graph scale | ✗ | ✗ | ✗ | ✓ | ✓ |
| Code change | none | infra only | medium | large | medium |
| Extra services | none | none | Redis | Redis + workers | Postgres |

\* Requires Redis persistence (AOF/RDB) or Postgres-backed event log.

---

## Recommended path for this project

1. **Now:** Level 0 — correct for current stage; document and debug easily.
2. **First Railway scale-out:** Level 2 — Redis pub/sub replaces the three globals;
   keep `create_task` initially if graph and HTTP stay co-located.
3. **Sustained production load:** Level 3 + Level 4 — queue workers, Postgres for app
   data and optionally checkpoints.

Do not jump to Level 3 before Level 2 unless you already run a queue for other reasons.

---

## Checklist before scaling out

- [ ] Confirm multi-instance is actually needed (metrics, not premature optimization)
- [ ] Move `session_events` / signals / `running_sessions` off process memory
- [ ] Migrate `research.db` off SQLite if containers > 1
- [ ] Choose shared checkpointer if graph must resume across worker restarts
- [ ] Load-test `/run` + `/stream` on separate workers (not just `/healthz`)
- [ ] Set Redis/Postgres TTL or cleanup for old `events:{session_id}` keys
- [ ] Document sticky-session config if used as interim measure

---

## Related code

| File | Role |
|---|---|
| `backend/app/main.py` | Routes, in-memory state, `_run_graph`, SSE |
| `backend/app/db.py` | SQLAlchemy models, `get_db()` |
| `backend/app/graph/build.py` | LangGraph compile in lifespan |
| `backend/railway.toml` | Production start command |
| `Makefile` | Dev uvicorn invocation |
