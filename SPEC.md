# AI Research Copilot — Build Spec

Source of truth for the build. A user researches a company before a sales/business
meeting; a LangGraph workflow produces a structured, source-grounded briefing; the
user persists sessions and asks follow-up questions over the report.

**Stack (mandated):** React (frontend) · Python + FastAPI (backend) · LangGraph (workflow).
**Constraint:** 3 days. Build the graph green end-to-end first; polish second.

---

## 0. Build order (do not deviate)

1. **Day 1** — Backend skeleton: FastAPI app, config, SQLite + SQLAlchemy models,
   session CRUD, LangGraph graph compiled with a checkpointer. Graph runs end-to-end
   with **stubbed** nodes returning fake data. Prove the wiring (state flows, edges
   route, checkpoint persists) before any LLM call.
2. **Day 1→2** — Fill nodes for real: plan → research (Tavily + scrape) → synthesize →
   quality_gate (real loop) → strategize → generate_report. Add the financials branch.
   SSE streaming of node status.
3. **Day 2→3** — React: session create, history, detail page, live progress UI off the
   SSE stream, follow-up chat. Loading/error/empty states. Responsive.
4. **Day 3** — Polish: graceful degradation on node failure, model tiering, the four docs,
   Dockerfile + compose, demo video. **If time:** upgrade `research` to parallel `Send` fan-out.

Each layer must be demoable on its own. Never leave the graph red overnight.

---

## 1. Data sources (decided — do not ask)

- **Tavily Search API** — web search, one query per research sub-question. Primary evidence.
- **Direct scrape** of the provided company URL (httpx + trafilatura/BeautifulSoup).
- **yfinance** — financials, public companies only, behind the conditional branch.
- Crunchbase / Apollo / LinkedIn enrichment = documented as production upgrade in
  `engineering-decisions.md`, **not built**. Avoids paid dependency in a 3-day build.

Every retrieved item is written to state with a **tier** (1 official site/filings,
2 reputable news, 3 aggregator/other). Tier drives confidence scoring downstream.

---

## 2. State — the contract

One typed object flows through every node. This is what gives intermediate outputs
(stream it), recoverability (checkpoint it), and clean node boundaries.

```python
from typing import TypedDict, Literal, Optional

class Source(TypedDict):
    id: str
    url: str
    title: str
    snippet: str
    tier: int                 # 1=official/filing, 2=reputable news, 3=aggregator
    retrieved_at: str

class ResearchTask(TypedDict):
    id: str
    question: str             # a specific sub-question
    section: str              # which report section it feeds
    done: bool

class SectionFinding(TypedDict):
    section: str
    content: str              # grounded prose
    source_ids: list[str]     # provenance — every finding cites its evidence
    confidence: float         # 0..1, derived from source tiers + coverage

class NodeError(TypedDict):
    node: str
    message: str
    recoverable: bool

class ResearchState(TypedDict):
    # --- inputs ---
    session_id: str
    company_name: str
    company_url: str
    objective: str                                  # drives the plan

    # --- plan + routing signal ---
    research_plan: list[ResearchTask]
    company_type: Literal["public", "private", "startup", "unknown"]

    # --- evidence ---
    sources: list[Source]
    scraped: dict[str, str]                         # url -> extracted text
    financials: Optional[dict]

    # --- analysis ---
    findings: dict[str, SectionFinding]             # keyed by report section
    confidence: dict[str, float]

    # --- quality loop control ---
    quality_score: float
    gaps: list[str]                                 # unmet sub-questions -> re-research targets
    revisions: int                                  # hard cap = loop termination

    # --- output + observability ---
    report: Optional[dict]                          # ResearchReport schema (sec. 4)
    errors: list[NodeError]
    status: str                                     # human-readable, streamed to UI
```

Report sections (the 8 the assignment mandates) — use these exact keys for `findings`:
`overview`, `products_services`, `target_customers`, `business_signals`,
`risks_challenges`, `discovery_questions`, `outreach_strategy`, `unknowns`.
(`sources` is assembled from state, not a finding.)

---

## 3. Graph

```
                    ┌─→ enrich_financials ─┐   (public co. only)
   plan ──route──→ research ───────────────┴──→ synthesize ──→ quality_gate
    │              ↑                                                │
    │              └──────────── (gaps) re-research ←──route────────┤
    │                                                               ↓ (pass / cap hit)
    └─(classify company_type)                              strategize → generate_report → END
```

### Node contracts

| Node | Reads | Writes | LLM | Notes |
|---|---|---|---|---|
| `plan` | inputs | `research_plan`, `company_type`, `status` | cheap | Decompose `objective + company` into sub-questions, each tagged to a section. **Also classifies company_type** — this is the routing signal. |
| `research` | `research_plan`, `gaps`, `company_url` | `sources`, `scraped`, marks tasks done, `status`, `errors` | none/cheap | Tavily per open sub-question + scrape the URL. On re-entry, runs **only `gaps`**, not the full plan. Tag every source with tier. |
| `enrich_financials` | `company_name` | `financials`, `status`, `errors` | none | yfinance. Conditional — only on `company_type == "public"`. |
| `synthesize` | `sources`, `scraped`, `financials` | `findings` (factual sections), `confidence` | strong | **Factual only.** Overview/products/customers/signals/risks. Each finding carries `source_ids` + confidence. No strategy here. |
| `quality_gate` | `findings`, `confidence`, `research_plan` | `quality_score`, `gaps`, `status` | cheap | Score: coverage (all sections populated) · grounding (claims have tier-1/2 sources) · confidence floor. Emit concrete `gaps`. **The 25% node — make it real.** |
| `strategize` | `findings` | `findings` (discovery_questions, outreach_strategy, unknowns) | strong | Reasoning *over* findings, not retrieval. Surviving `gaps` → become the **Unknowns** section. |
| `generate_report` | all `findings`, `sources` | `report`, persists session | none | Deterministic assembly into ResearchReport schema. No LLM. |

### Routing

- **After `plan`:** `company_type == "public"` → `enrich_financials`; else → `research`.
  (Both paths converge on `synthesize`.)
- **After `quality_gate`:**
  `quality_score < THRESHOLD and revisions < MAX_REVISIONS` → back to `research`
  (set targeted `gaps`, increment `revisions`); else → `strategize`.
  **`MAX_REVISIONS` is the loop terminator — non-negotiable.** Default `THRESHOLD=0.7`,
  `MAX_REVISIONS=2`.

### The one design choice to make at build time

`research` sequential vs. parallel `Send` fan-out:
- **Sequential** (loop the plan in one node) — simpler, debuggable, ship this first.
- **Parallel** (`Send` each sub-question to a worker, reduce into `sources`) — impressive
  LangGraph depth, faster, costs a few hours on the reduce + partial-failure path.

Build sequential, upgrade to `Send` on day 3 if green. Document either way.

---

## 4. ResearchReport schema (output + API response)

```python
class ResearchReport(TypedDict):
    session_id: str
    company_name: str
    generated_at: str
    sections: dict[str, SectionFinding]   # the 8 keyed sections
    sources: list[Source]
    meta: dict                            # quality_score, revisions, company_type, errors[]
```

---

## 5. Persistence (one mechanism, two rubric lines)

- LangGraph **checkpointer** (`SqliteSaver`, or `PostgresSaver` for deploy) keyed by
  `session_id` as `thread_id`. Persists every super-step → free recoverability **and**
  doubles as workflow-output storage. Interrupted runs resume from last checkpoint.
- **App tables** (SQLAlchemy): `sessions` (id, company, url, objective, status, created_at),
  `reports` (session_id FK, json), `chat_messages` (session_id FK, role, content, created_at).
- Checkpointer = workflow state; app tables = user-facing records + chat. Don't conflate.

---

## 6. API surface (FastAPI)

```
POST   /sessions                  create {company_name, company_url, objective} -> session_id, status
GET    /sessions                  list (history)
GET    /sessions/{id}             detail + report if ready
POST   /sessions/{id}/run         kick the graph (async); returns immediately
GET    /sessions/{id}/stream      SSE — node status updates as the graph runs
POST   /sessions/{id}/chat        follow-up Q over persisted report+sources
GET    /sessions/{id}/chat        chat history
GET    /healthz                   liveness
```

- `/run` launches the graph in a background task; client subscribes to `/stream`.
- **SSE:** `stream_mode="updates"` from LangGraph → push `{node, status}` per super-step.
  React renders the progress UI directly off node names.

---

## 7. Chat — separate from the research graph

Follow-up chat is **not** part of the LangGraph run. After the report persists, chat is
RAG-lite: stuff `report + sources` for that `session_id` into context, answer grounded in it,
store the turn. Folding it into the main graph muddies state and streaming. Reuse persisted
state as context; never re-run the workflow for a chat turn.

---

## 8. Cross-cutting (where "production-minded" is scored)

- **Failure handling:** wrap every external call (Tavily, scrape, yfinance, LLM) with retry
  (tenacity) + **graceful degradation** — a failed search appends to `errors` and continues
  with partial evidence rather than killing the graph. `quality_gate` already handles thin
  evidence; that's the recovery path.
- **Recoverability:** checkpointer (sec. 5). Resume interrupted runs by `thread_id`.
- **Model tiering:** cheap/fast model for `plan` + `quality_gate`; strong model for
  `synthesize` + `strategize`. Cheap to implement, scores on AI Engineering.
- **Config management:** pydantic-settings, all keys/models/thresholds from env. No hardcoding.
- **Logging:** structured (structlog or stdlib JSON), log node entry/exit + errors with
  `session_id`. This is also your observability story for the writeup.
- **Provenance:** every factual claim in a finding carries `source_ids`. Non-negotiable —
  it's what makes the report trustworthy and demoable.

---

## 9. Frontend (React) — checklist

- **Create session** form (name, url, objective) with validation.
- **Session history** list → links to detail.
- **Session detail**: report rendered by section; sources list with tier badges + links.
- **Workflow progress UI**: live, driven by SSE node updates (plan → research → … → report).
- **Follow-up chat** panel on the detail page.
- **States everywhere**: loading (skeletons), error (retry), empty.
- **Responsive**.

---

## 10. Repo layout

```
backend/
  app/
    main.py                 # FastAPI app, routes, SSE
    config.py               # pydantic-settings
    db.py                   # engine, session, models
    graph/
      state.py              # ResearchState + typed dicts (sec. 2)
      build.py              # StateGraph wiring, edges, checkpointer
      nodes/                # plan.py, research.py, financials.py, synthesize.py,
                            #   quality.py, strategize.py, report.py
      routing.py            # conditional edge fns
    tools/                  # tavily.py, scrape.py, yfinance.py (retry + degrade)
    services/               # session_service, chat_service
  tests/
frontend/
  src/ (components, pages, api client, SSE hook)
docs/
  architecture.md
  engineering-decisions.md
  product-improvements.md
README.md
docker-compose.yml
```

---

## 11. Definition of done (maps to the rubric)

- [ ] Graph: 6+ meaningful nodes, shared state, **2 conditional edges**, real quality
      **loop with cap**, intermediate outputs streamed, failure handling, recoverable. *(25%)*
- [ ] Backend: all APIs, persistence, logging, error handling, config. *(20%)*
- [ ] Frontend: all screens + all states + responsive. *(15%)*
- [ ] AI: model tiering, grounded findings w/ provenance, sensible prompts. *(15%)*
- [ ] Production: Docker, graceful degradation, healthz, README runnable. *(10%)*
- [ ] Docs: README, architecture.md, engineering-decisions.md, product-improvements.md. *(15%)*
- [ ] Demo video or hosted deployment.

---

## 12. First message to Claude Code

> "Build the backend skeleton from docs/SPEC.md. Start with: FastAPI app + config +
> SQLAlchemy models + session CRUD, then the LangGraph graph in app/graph/ compiled with a
> SqliteSaver checkpointer and **stubbed nodes** returning fake data, so the graph runs
> end-to-end and routes correctly before any real LLM/Tavily call. Wire the SSE stream last
> in this pass. Don't fill node logic yet."
