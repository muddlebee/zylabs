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
  - [x] `enrich_financials` — Firecrawl + LLM extraction, soft-skip on failure; runs in parallel with `research` for all company types
  - [x] `research` — concurrent snippet-only Firecrawl searches (`asyncio.gather`) + one full Firecrawl scrape of the company URL
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

- [x] **Frontend** *(15% of grade)* — built, Vite+React, dev server running
  - [x] Session create form with validation (name, URL, objective)
  - [x] Session history list with status badges + relative timestamps
  - [x] Session detail: report by section, sources with tier badges + links
  - [x] Live workflow progress UI driven by SSE stream (animated stepper)
  - [x] Follow-up chat panel with suggestion chips
  - [x] Loading skeletons, error states, empty states
  - [ ] Responsive layout (wired, needs mobile polish — see 07-responsive.spec.ts)

- [x] **Playwright E2E tests** — 5 of 7 spec files written, paused at 03-workflow-progress
  - [x] 01-form-validation.spec.ts
  - [x] 02-session-history.spec.ts
  - [x] 03-workflow-progress.spec.ts
  - [x] 04-report-sections.spec.ts
  - [x] 05-follow-up-chat.spec.ts


---

### Deployment status — LIVE ✓

- [x] **Backend → Railway** — `https://backend-production-6a4c.up.railway.app`
  - Deployed 2026-06-14; SQLite on writable container filesystem
  - All env vars set (DeepSeek, Firecrawl, OpenAI, thresholds)
  - `railway.toml` with `uvicorn app.main:app --host 0.0.0.0 --port $PORT`

- [x] **Frontend → Vercel** — `https://frontend-umber-three-57.vercel.app`
  - Detected as Vite automatically; `vercel.json` SPA rewrites in place
  - `VITE_API_URL` env var points to Railway backend
  - Build clean, status READY
