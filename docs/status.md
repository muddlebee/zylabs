# Project Status

**Date:** 2026-06-14  
**Assignment deadline:** 3 days from start

---

## What's done

### Backend — fully working, verified end-to-end

- [x] FastAPI app with all 8 API routes (`/sessions`, `/run`, `/stream`, `/chat`, `/healthz`)
- [x] SQLAlchemy models — `sessions`, `reports`, `chat_messages`
- [x] LangGraph `StateGraph` with 7 nodes and 2 conditional edges
- [x] All nodes implemented with real logic (no stubs)
  - [x] `plan` — LLM decomposes objective into sub-questions, classifies company type
  - [x] `enrich_financials` — yfinance, soft-skip on failure
  - [x] `research` — Firecrawl search (full markdown per result) + Firecrawl scrape of company URL
  - [x] `synthesize` — LLM writes grounded findings with source citations
  - [x] `quality_gate` — scoring (coverage + grounding + confidence), gap emission
  - [x] `strategize` — LLM generates discovery questions, outreach strategy, unknowns
  - [x] `generate_report` — deterministic assembly, persists to SQLite
- [x] Quality re-research loop with `MAX_REVISIONS=2` hard cap
- [x] SSE streaming of node status updates
- [x] `AsyncSqliteSaver` checkpointer — recoverability per session
- [x] RAG-lite follow-up chat over persisted report
- [x] Graceful degradation — every external call try/excepted, errors appended, graph continues
- [x] Lazy LLM init — safe imports without API keys
- [x] Configurable provider — switch between DeepSeek and OpenAI via env vars
- [x] Structured logging with `structlog` + `session_id` on every log line
- [x] Test suite — 23 unit tests (routing, quality scoring, report assembly) + e2e suite

### Live run verified
- Stripe research completed: quality score 0.95, 35 sources, all 8 sections populated, zero errors

### Docs
- [x] `docs/architecture.md` — graph, nodes, state, streaming, persistence
- [x] `docs/engineering-decisions.md` — key decisions + trade-offs

---

## What's remaining

### Must have (rubric-critical)

- [ ] **Frontend** *(15% of grade)*
  - Session create form (company name, URL, objective) with validation
  - Session history list → links to detail
  - Session detail: report rendered by section, sources with tier badges + links
  - Live workflow progress UI driven by SSE stream
  - Follow-up chat panel on detail page
  - Loading skeletons, error states, empty states
  - Responsive layout

- [ ] **README.md** at repo root *(part of 15% docs)*
  - Setup instructions (clone → env → `pip install` → `uvicorn`)
  - How to run tests (`pytest` unit, `RUN_E2E=1 pytest` integration)
  - Architecture diagram reference

- [ ] **`docs/product-improvements.md`** *(part of 15% docs)*
  - What would be built next with more time
  - Parallel research fan-out, richer data sources, model tiering, etc.

- [ ] **Docker + docker-compose** *(10% production)*
  - `Dockerfile` for the backend
  - `docker-compose.yml` wiring backend + (optionally) frontend

### Nice to have (polish)

- [ ] Frontend error boundary + retry button on failed runs
- [ ] Source tier badge colour coding in the UI
- [ ] Confidence bar per report section
- [ ] Session status polling fallback when SSE is unavailable

---

## Immediate next steps (in order)

1. **React frontend** — this is the biggest remaining chunk; start with session create + history, then detail + SSE progress, then chat
2. **README.md** — quick to write once frontend is done
3. **product-improvements.md** — can write in parallel with frontend
4. **Dockerfile + docker-compose** — last, after frontend is wired

---

## Known issues / watch-outs

- `research.db` and `checkpoints.db` are written to the process working directory —
  make sure to `cd backend/` before running uvicorn or tests
- The `.env` file must be present in `backend/` (copy from `.env.example` and fill keys)
- `RUN_E2E=1 pytest tests/test_e2e.py` makes real API calls — costs Tavily + LLM credits
- yfinance ticker lookup uses company name as-is; for public companies pass the ticker symbol
  (e.g. "AAPL") not the full name for better results
