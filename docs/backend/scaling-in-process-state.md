# Scaling — In-Process State & Redis

Entry point for the scaling ladder and decision guide:
[scaling.md](./scaling.md).

## The problem

Three module-level dicts in `main.py` hold all live session state:

```python
session_events: dict[str, list[dict]] = {}   # event log per session
running_sessions: set[str] = set()           # which sessions are active
stream_signals: dict[str, asyncio.Event] = {} # wake signal per session
```

These live in **one process's memory**. Right now, one process owns everything:

```
Process 1 (uvicorn worker)
┌─────────────────────────────────────────┐
│ session_events = {                      │
│   "abc123": [e0, e1, e2, e3]           │
│   "def456": [e0, e1]                   │
│ }                                       │
│ running_sessions = {"abc123", "def456"} │
│ stream_signals = {                      │
│   "abc123": asyncio.Event()            │
│   "def456": asyncio.Event()            │
│ }                                       │
│                                         │
│ _run_graph("abc123") ← task running    │
│ _run_graph("def456") ← task running    │
└─────────────────────────────────────────┘
```

Scale to two workers — Railway auto-scales, or `uvicorn --workers 2` — and the
state is no longer shared:

```
Load Balancer (round-robin)
        │
        ├──────────────────┬──────────────────┐
        │                  │                  │
   Process 1          Process 2          Process 3
   ┌──────────┐       ┌──────────┐       ┌──────────┐
   │          │       │          │       │          │
   │ "abc123" │       │  empty   │       │  empty   │
   │  running │       │          │       │          │
   │          │       │          │       │          │
   └──────────┘       └──────────┘       └──────────┘
```

---

## Why processes can't share memory

Each Python process has its own isolated memory space — this is the OS process model.
Memory is not shared between processes by default. Even with `uvicorn --workers 4` on
the same machine (4 forks of the same process), each worker has its own copy of every
variable. Changes in one worker's memory are invisible to others.

`asyncio.Event` objects are tied to a single event loop in a single process. You cannot
pass one across a process boundary.

---

## Exactly what breaks — request by request

```
User's browser makes 3 requests for session "abc123":

Request 1: POST /sessions/abc123/run
  → hits Process 1 (round-robin)
  → _run_graph task starts on Process 1
  → session_events["abc123"] = [] on Process 1
  → running_sessions = {"abc123"} on Process 1
  ← 200 OK

Request 2: GET /sessions/abc123/stream  (open SSE)
  → hits Process 2 (round-robin)
  → event_generator starts on Process 2
  → session_events.get("abc123") → None   ← doesn't exist on Process 2
  → running_sessions → "abc123" not there ← Process 2 doesn't know
  → polls DB 15× → "running" → gives up
  ← SSE closes, browser gets onerror immediately

Request 3: GET /sessions/abc123/progress
  → hits Process 3 (round-robin)
  → session_events.get("abc123") → None
  ← {events: []}   ← empty, graph is actually running on Process 1
```

The graph is producing events on Process 1. The browser is talking to Process 2 and 3.
They share nothing.

---

## Fix 1 — Sticky sessions (simplest, but limited)

Route every request for a given `session_id` to the same process. The load balancer
becomes session-aware:

```
Load Balancer with sticky routing
  hash(session_id) % num_workers → always same worker

"abc123" → hash → Process 1  (always)
"def456" → hash → Process 2  (always)
"ghi789" → hash → Process 1  (always)
```

```nginx
upstream backend {
    hash $arg_session_id consistent;  ← hash on query param
    server process1:8000;
    server process2:8000;
    server process3:8000;
}
```

**What it fixes:** all requests for a session go to the same process — the one that
has the events in memory.

**What it breaks:**

```
Process 1 dies mid-run for "abc123"

Browser retries → load balancer routes to Process 2
Process 2: session_events["abc123"] → None
           running_sessions → not there
           ← same broken state as before

Failover is gone. Sticky sessions and fault tolerance are opposites.
```

Other limits:
- One busy session pins to one worker — you can't rebalance hot sessions
- Adding a 4th worker doesn't help existing sessions, only new ones
- Works for a demo, wrong for production

---

## Fix 2 — Redis pub/sub (the right fix)

Move the event log and signalling out of process memory into Redis. Every worker can
publish and subscribe.

```
BEFORE (in-process):
  _run_graph → session_events["abc123"].append(e)
  consumer   → reads session_events["abc123"]

AFTER (Redis):
  _run_graph → redis.rpush("events:abc123", json(e))
                redis.publish("signal:abc123", "1")
  consumer   → redis.lrange("events:abc123", cursor, -1)
                redis.subscribe("signal:abc123")
```

Full cross-process flow:

```
Process 1                    Redis                    Process 2
─────────────────            ──────────────────       ─────────────────
_run_graph("abc123")
  plan node completes
  rpush events:abc123 ─────► list: [e0]
  publish signal:abc123 ───► channel fires       ───► subscriber wakes
                                                       lrange from cursor=0
                                                       ← [e0]
                                                       yield e0 to browser

  research completes
  rpush events:abc123 ─────► list: [e0, e1]
  publish signal:abc123 ───► channel fires       ───► subscriber wakes
                                                       lrange from cursor=1
                                                       ← [e1]
                                                       yield e1 to browser
```

Any process can handle any request. The graph runs on Process 1, the SSE consumer
runs on Process 2, Redis is the shared bus between them.

---

## Redis data structures — mapping to current code

```
Current (in-process)                 Redis equivalent
────────────────────────────────     ─────────────────────────────────────
session_events["abc123"] list        RPUSH events:abc123  (Redis list)
                                     LRANGE events:abc123 cursor -1

stream_signals["abc123"] Event       PUBLISH signal:abc123 "1"
  signal.set()                       SUBSCRIBE signal:abc123
  signal.wait()

running_sessions set                 SADD    running abc123
  running_sessions.add               SREM    running abc123
  running_sessions.discard           SISMEMBER running abc123
  session_id in running_sessions
```

---

## Implementation sketch

```python
import redis.asyncio as redis

r = redis.from_url("redis://localhost:6379")

# Producer — replaces _append_event
async def _append_event(session_id: str, event: dict) -> None:
    await r.rpush(f"events:{session_id}", json.dumps(event))
    await r.publish(f"signal:{session_id}", "1")

# Consumer — replaces event_generator inner loop
async def event_generator(session_id: str, after: int):
    cursor = after
    pubsub = r.pubsub()
    await pubsub.subscribe(f"signal:{session_id}")

    while True:
        # drain everything from cursor onward
        raw_events = await r.lrange(f"events:{session_id}", cursor, -1)
        for raw in raw_events:
            event = json.loads(raw)
            yield f"data: {json.dumps(event)}\n\n"
            cursor += 1

        # check terminal state
        status = await _session_status_async(session_id)
        if status == "completed":
            yield f"data: {json.dumps({'node':'done'})}\n\n"
            return
        if status == "failed":
            yield f"data: {json.dumps({'node':'error'})}\n\n"
            return

        # wait for next signal (replaces asyncio.Event.wait)
        msg = await pubsub.get_message(timeout=120)
        if msg is None:
            yield f"data: {json.dumps({'node':'timeout'})}\n\n"
            return

# running_sessions replacements
await r.sadd("running", session_id)          # was: running_sessions.add
await r.srem("running", session_id)          # was: running_sessions.discard
await r.sismember("running", session_id)     # was: session_id in running_sessions
```

---

## What Redis buys you

```
                       Current          Sticky sessions     Redis pub/sub
──────────────────────────────────────────────────────────────────────────
Multiple workers       ✗ breaks         ✓ works             ✓ works
Failover               N/A (1 process)  ✗ sessions lost     ✓ seamless
Horizontal scale       ✗               limited              ✓ add workers freely
Event replay (?after)  ✓ list           ✓ list              ✓ Redis list
Process restart        ✗ events lost    ✗ events lost        ✓ Redis persists*
Complexity             low              low                  medium

* Redis persistence requires AOF or RDB snapshots — off by default.
```

---

## Fix 3 — Postgres LISTEN/NOTIFY (no extra dependency)

Same idea as Redis pub/sub using Postgres's built-in notification system. Zero
extra infrastructure if you're already running Postgres.

```sql
-- Producer notifies when event appended:
SELECT pg_notify('session_abc123', '{"node":"research","status":"running"}');

-- Consumer listens:
LISTEN session_abc123;
-- blocks until NOTIFY fires, receives payload directly
```

```python
# Producer:
await conn.execute(
    "SELECT pg_notify($1, $2)",
    f"session_{session_id}", json.dumps(event)
)

# Consumer:
conn = await asyncpg.connect(DATABASE_URL)
await conn.add_listener(f"session_{session_id}", handle_event)
```

**Tradeoff vs Redis:**

| | Redis | Postgres NOTIFY |
|---|---|---|
| Extra service | Yes | No (already have Postgres) |
| Max payload | unlimited | 8000 bytes per notification |
| Throughput | higher | lower |
| Connection cost | lightweight | heavier (full DB connection) |
| Event log (lrange) | native | need separate events table |
| Operational cost | manage Redis + Postgres | manage Postgres only |

For this project, Postgres NOTIFY is the pragmatic choice when migrating off SQLite
to Postgres — you get pub/sub for free without adding Redis.

---

## The deeper issue — LangGraph tasks across workers

Even after fixing event distribution, there is a harder problem:
`asyncio.create_task(_run_graph(...))` pins graph execution to one process. You cannot
move a running asyncio task to another process.

At scale, graph execution should run in a **separate worker pool** — decoupled from
the HTTP server:

```
HTTP servers (stateless, scale freely)    Worker pool (graph execution)
──────────────────────────────────────    ──────────────────────────────
Process 1: handle HTTP requests           Worker A: _run_graph("abc123")
Process 2: handle HTTP requests           Worker B: _run_graph("def456")
Process 3: handle HTTP requests           Worker C: _run_graph("ghi789")
        │                                         │
        └──────────────── Redis ──────────────────┘
                    job queue + pub/sub
```

```
POST /sessions/abc123/run
  HTTP server: push job to Redis queue
  HTTP server: return 200 immediately (no create_task)

Worker A picks job from queue:
  runs _run_graph("abc123")
  publishes events to Redis

Any HTTP server's SSE consumer:
  subscribes to Redis signal:abc123
  reads from Redis list events:abc123
  streams to browser
```

This is what Celery, RQ, or Dramatiq provide — a proper task queue. The current
`asyncio.create_task` is a simplified version that only works within one process.

---

## Where the current system sits

```
Single process, single worker            ← current state
  session_events in memory ✓
  works perfectly, zero ops overhead

Single process, uvicorn --workers 4
  session_events NOT shared ✗
  breaks immediately on first scale-out

Multiple Railway containers
  session_events NOT shared ✗
  breaks immediately on auto-scale

With sticky sessions
  works, but no failover, no rebalancing

With Redis pub/sub + stateless workers
  fully stateless HTTP servers ✓
  horizontal scale ✓
  failover ✓

With Redis + separate worker pool
  HTTP and graph execution independently scalable ✓
  production-grade ✓
```

The single process design is correct for the current stage — zero operational overhead,
simple debugging, works perfectly. The first scaling wall is Railway auto-scaling to
two instances. The answer: Redis pub/sub replaces the three in-memory dicts, workers
become stateless, and the system scales horizontally.
