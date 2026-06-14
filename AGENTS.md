# Agent Reference — AI Research Copilot

Quick orientation for any agent (or human) picking up this codebase.

---

## Starting the app

```bash
make dev        # starts both servers (Ctrl+C kills both)
make backend    # backend only  → http://localhost:8001
make frontend   # frontend only → http://localhost:5173
make stop       # kill both if running in background
```

Backend must be on **port 8001** — that's what Vite's dev proxy targets.

---

## Stack

| Layer | Technology |
|---|---|
| Workflow | LangGraph 1.x `StateGraph` |
| LLM | DeepSeek or OpenAI via `langchain_openai.ChatOpenAI` |
| Web search | Firecrawl (`search` with `scrape_options`) |
| URL scraping | Firecrawl `scrape_url` |
| Financial data | Firecrawl search + LLM extraction |
| API | FastAPI + uvicorn |
| DB | SQLAlchemy + SQLite (`research.db`) |
| Checkpoints | `AsyncSqliteSaver` (`checkpoints.db`) |
| Frontend | React + Vite + TypeScript |

---

## Repository layout

```
zylabs/
├── Makefile                        # dev workflow (make dev / stop)
├── backend/
│   ├── .env                        # secrets — never commit
│   ├── .env.example                # template
│   ├── app/
│   │   ├── config.py               # all settings via pydantic-settings
│   │   ├── db.py                   # SQLAlchemy models: Session, Report, ChatMessage
│   │   ├── llm.py                  # get_llm() factory, lru_cache'd
│   │   ├── main.py                 # FastAPI app, all routes, SSE streaming
│   │   ├── graph/
│   │   │   ├── build.py            # StateGraph wiring + compile
│   │   │   ├── routing.py          # after_plan, after_quality_gate
│   │   │   ├── state.py            # ResearchState TypedDict + sub-types
│   │   │   └── nodes/
│   │   │       ├── plan.py         # LLM: decompose objective → research tasks
│   │   │       ├── research.py     # Firecrawl search per task + scrape company URL
│   │   │       ├── financials.py   # Firecrawl search + LLM firmographic extraction
│   │   │       ├── synthesize.py   # LLM: write findings grounded in sources
│   │   │       ├── quality.py      # score coverage/grounding/confidence, emit gaps
│   │   │       ├── strategize.py   # LLM: discovery questions + outreach strategy
│   │   │       └── report.py       # assemble final report dict (no LLM)
│   │   ├── tools/
│   │   │   └── scrape.py           # Firecrawl search() + scrape() wrappers
│   │   └── services/
│   │       ├── session_service.py  # CRUD: sessions + reports
│   │       └── chat_service.py     # RAG-lite chat over persisted report
└── frontend/
    ├── vite.config.ts              # proxy /api → localhost:8001
    └── src/
        ├── api.ts                  # all fetch calls — uses /api prefix
        ├── types.ts                # Session, Report, ChatMessage interfaces
        └── components/
            ├── SessionForm.tsx     # create session form (company_url optional)
            ├── WorkflowProgress.tsx # SSE live node status
            ├── ReportView.tsx      # full report + FinancialSnapshot card
            └── ChatPanel.tsx       # follow-up chat
```

---

## Graph flow

```
          ┌─→ enrich_financials ─┐
plan ──────┤                     ├──→ synthesize
          └─→ research ───────────┘        │
                  ▲                   quality_gate
                  │                   /          \
[score<0.7 & revisions<2] ──────────/            \ [pass / cap]
                                              strategize
                                                  │
                                           generate_report → END
```

**Conditional edges:**
- `after_plan`: fans out to **both** `enrich_financials` and `research` (parallel branches that
  converge on `synthesize`). Financials runs for every company type — it's one snippet-only
  search and, running concurrently with research, costs no critical-path time.
- `after_quality_gate`: `quality_score < QUALITY_THRESHOLD AND revisions < MAX_REVISIONS` → `research` (re-research gaps), else → `strategize`

---

## Environment variables

All read from `backend/.env` via `app/config.py`:

```
FIRECRAWL_API_KEY     # web search + scraping (has per-page credit cost)
TAVILY_API_KEY        # available as fallback (see Known Issues)
OPENAI_API_KEY        # if MODEL_PROVIDER=openai
DEEPSEEK_API_KEY      # if MODEL_PROVIDER=deepseek (default)
DEEPSEEK_BASE_URL     # default: https://api.deepseek.com/v1
MODEL_NAME            # deepseek-chat or gpt-4.1-mini
MODEL_PROVIDER        # deepseek or openai
QUALITY_THRESHOLD     # default 0.7
MAX_REVISIONS         # default 2
DATABASE_URL          # default sqlite:///./research.db
CHECKPOINT_DB_PATH    # default ./checkpoints.db
LOG_LEVEL             # default INFO
```

---

## API routes

```
POST   /sessions              create session → {session_id, status}
GET    /sessions              list all sessions
GET    /sessions/{id}         session detail + report if ready
POST   /sessions/{id}/run     kick off graph (returns immediately)
GET    /sessions/{id}/stream  SSE: {node, status} per graph step
POST   /sessions/{id}/chat    follow-up question → {role, content}
GET    /sessions/{id}/chat    chat history
GET    /healthz               {status: "ok"}
```

SSE stream format: `data: {"node": "synthesize", "status": "Synthesis complete"}\n\n`  
Ends with: `data: {"node": "done", "status": "Workflow complete"}\n\n`

---

## State shape

```python
ResearchState:
  session_id, company_name, company_url, objective   # inputs
  research_plan: list[ResearchTask]                  # from plan node
  company_type: "public"|"private"|"startup"|"unknown"
  sources: list[Source]                              # accumulated evidence
  scraped: dict[str, str]                            # url → markdown
  financials: dict | None                            # Firecrawl + LLM extracted firmographics
  findings: dict[str, SectionFinding]                # 8 sections
  confidence: dict[str, float]
  quality_score: float
  gaps: list[str]                                    # re-research questions
  revisions: int
  report: dict | None                                # final output
  errors: list[NodeError]
  status: str
```

---

## Common issues and how to debug

### "Synthesis skipped — no evidence"
`synthesize_node` checks `sources` and `scraped` — if both empty it skips.
Root causes:
- Firecrawl credits exhausted (check: `curl https://api.firecrawl.dev/v1/team/credit-usage -H "Authorization: Bearer $FIRECRAWL_API_KEY"`)
- `research_node` is catching all exceptions silently — check server logs for `research_node.search_failed` or `research_node.scrape_failed`

### Frontend "not connecting to backend"
Check `frontend/vite.config.ts` — proxy target must match the port uvicorn is running on (default `8001`).

### "Session not found" after server restart
SQLite `research.db` persists across restarts. If it's missing, the session is gone. `checkpoints.db` (LangGraph state) is separate — both must exist for full recovery.

### LangGraph checkpoint errors on startup
Delete `checkpoints.db` and restart. Old checkpoint schema can conflict with new graph structure after major refactors.

### Financial snapshot empty
`enrich_financials` uses Firecrawl search + LLM extraction. If it returns `{}`, check server logs for `financials_node.skipped` and verify Firecrawl credits/API key.

### Re-research loop runs MAX_REVISIONS times but quality stays low
`quality_gate` scores below 0.7 when coverage < 1.0 (sections missing) or grounding = 0 (no `source_ids`). If Firecrawl returns empty markdown, `synthesize` has no content to cite. Check Firecrawl credit balance first.

---

## Firecrawl credit cost

Research uses **snippet-only** search (`scrape_results=False`, no `scrape_options`), so no
per-page scraping is billed for sub-questions:
- `research_node`: 1 `search` per sub-question (5–8/run) + 1 `scrape_url` of the company
  homepage — the only full page fetched
- `enrich_financials`: 1 snippet-only `search`
- Re-research loop re-runs only the gap questions (usually 1–3), not the full plan

A typical run is well under ~10 Firecrawl calls with **zero discarded full-page scrapes**.
The old path scraped ~5 pages per search (~30–50 credits/run) then truncated each result to
600 chars — paying for content nothing downstream read (only `Source.snippet` is ever used).

Free plan: 1000 credits/month. Check balance before running multiple test sessions.

---

## Open PR / branches

| Branch | What's in it |
|---|---|
| `main` | Stable. Concurrent snippet-only research (`asyncio.gather`); financials fans out parallel with research for all company types. |
| `feat/parallel-research-react-agent` | Parallel `Send` fan-out, ReAct agents per task, ticker classification fix. Not merged — synthesize "no evidence" bug being debugged (root cause: Firecrawl credits, not the parallel logic). |
