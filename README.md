# AI Research Copilot

> "Your sellers run the conversation. We do everything else."

An AI-powered research tool that prepares sales and business teams for prospect meetings by running a multi-node LangGraph pipeline and generating structured company briefings.

---

## Live Demo

| Layer | URL |
|-------|-----|
| **Frontend** | https://frontend-umber-three-57.vercel.app |
| **Backend API** | https://backend-production-6a4c.up.railway.app |

---

## What It Does

1. Enter a company name, website, and your meeting objective
2. A 7-node LangGraph pipeline researches the company in real time (Firecrawl search + scrape, LLM synthesis)
3. A structured briefing is generated with 8 sections: Overview, Products & Services, Target Customers, Business Signals, Risks & Challenges, Discovery Questions, Outreach Strategy, Unknowns
4. Follow-up chat lets you ask questions grounded in the report

---

## Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + Vite + TypeScript + Tailwind CSS |
| Backend | Python 3.11 + FastAPI + SQLAlchemy (SQLite) |
| AI Workflow | LangGraph 1.x (`StateGraph` + `AsyncSqliteSaver`) |
| LLM | DeepSeek (default) or OpenAI — switchable via env var |
| Web Research | Firecrawl (search + scrape) |
| Financial Data | Firecrawl search + LLM extraction |
| Streaming | Server-Sent Events (SSE) via `asyncio.Queue` |

---

## Local Setup

### Prerequisites
- Python 3.11+
- Node.js 20+
- API keys: DeepSeek (or OpenAI) + Firecrawl

### Backend

```bash
cd backend
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt

cp .env.example .env
# Fill in your API keys in .env

uvicorn app.main:app --host 0.0.0.0 --port 8001 --reload
```

Backend available at `http://localhost:8001`. Health check: `curl http://localhost:8001/healthz`

### Frontend

```bash
cd frontend
npm install
npm run dev
```

Frontend available at `http://localhost:5173`. Requests to `/api/*` are proxied to the backend.

---

## Environment Variables

Copy `backend/.env.example` to `backend/.env` and fill in:

```env
# Required
FIRECRAWL_API_KEY=fc-...
DEEPSEEK_API_KEY=sk-...          # or set OPENAI_API_KEY and MODEL_PROVIDER=openai

# Model (defaults to DeepSeek)
MODEL_PROVIDER=deepseek           # or openai
MODEL_NAME=deepseek-chat          # or gpt-4.1-mini

# Optional tuning
QUALITY_THRESHOLD=0.7
MAX_REVISIONS=2
```

---

## Running Tests

### Backend unit tests (no API keys required)

```bash
cd backend
python3 -m pytest tests/ -q
# 23 tests covering routing, quality scoring, report assembly
```

### Backend E2E tests (makes real API calls)

```bash
cd backend
RUN_E2E=1 python3 -m pytest tests/test_e2e.py -v
```

### Frontend Playwright E2E

```bash
# Start backend (port 8001) and frontend (port 5173) first
cd frontend
npx playwright test
npx playwright show-report   # view HTML report
```

---

## API Reference

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/healthz` | Health check |
| `POST` | `/sessions` | Create research session |
| `GET` | `/sessions` | List all sessions |
| `GET` | `/sessions/:id` | Session detail + report |
| `POST` | `/sessions/:id/run` | Start LangGraph pipeline |
| `GET` | `/sessions/:id/stream` | SSE stream of node updates |
| `POST` | `/sessions/:id/chat` | Follow-up chat message |
| `GET` | `/sessions/:id/chat` | Chat history |

---

## Architecture

See [`docs/architecture.md`](docs/architecture.md) for the full graph design, node descriptions, state schema, and SSE streaming implementation.

```
       ┌─→ enrich_financials ─┐
plan ──┤                      ├─→ synthesize → quality_gate → strategize → generate_report
       └─→ research ───────────┘                    │
               ↑                                    │
               └──── re-research (score < 0.7, revisions < 2) ───┘
```

`enrich_financials` and `research` run as parallel branches off `plan` and converge on
`synthesize`. Sub-question searches run concurrently and snippet-only (no per-page scraping).

### Key Design Decisions

- **Single LLM config** — one `MODEL_NAME`/`MODEL_PROVIDER` pair, switchable via env vars
- **Firecrawl over httpx** — handles JS-rendered SPAs and bot protection; snippet-only search for sub-questions, full markdown scrape reserved for the company homepage
- **AsyncSqliteSaver** — LangGraph checkpoint per session; graph is recoverable on restart
- **SSE via asyncio.Queue** — `/run` starts a background task, `/stream` reads from a per-session queue
- **RAG-lite chat** — report + sources stuffed into system prompt; no vector DB required at demo scale

See [`docs/engineering-decisions.md`](docs/engineering-decisions.md) for full decision rationale.

---

## Project Structure

```
zylabs/
├── backend/
│   ├── app/
│   │   ├── main.py              # FastAPI app, all routes, SSE
│   │   ├── config.py            # pydantic-settings
│   │   ├── db.py                # SQLAlchemy models
│   │   ├── llm.py               # lazy LLM factory
│   │   ├── graph/
│   │   │   ├── build.py         # StateGraph wiring
│   │   │   ├── state.py         # ResearchState TypedDict
│   │   │   ├── routing.py       # conditional edge functions
│   │   │   └── nodes/           # plan, research, financials, synthesize, quality, strategize, report
│   │   ├── tools/
│   │   │   └── scrape.py        # Firecrawl search + scrape
│   │   └── services/
│   │       ├── session_service.py
│   │       └── chat_service.py
│   ├── tests/
│   ├── requirements.txt
│   └── .env.example
├── frontend/
│   ├── src/
│   │   ├── pages/               # HomePage, SessionDetailPage
│   │   ├── components/          # SessionForm, SessionList, WorkflowProgress, ReportView, ChatPanel
│   │   ├── api.ts               # typed API client
│   │   └── types.ts             # shared TypeScript types
│   └── tests/                   # Playwright E2E specs
└── docs/
    ├── architecture.md
    ├── engineering-decisions.md
    ├── product-improvements.md
    └── testing.md
```
