# Sanity Check & Testing Guide

Manual and automated steps to verify the full stack is working correctly.

---

## Environments

| Layer    | Local                        | Production                                              |
|----------|------------------------------|---------------------------------------------------------|
| Backend  | `http://localhost:8001`      | `https://backend-production-6a4c.up.railway.app`        |
| Frontend | `http://localhost:5173`      | `https://frontend-umber-three-57.vercel.app`            |

---

## 1. Backend Health

```bash
curl https://backend-production-6a4c.up.railway.app/healthz
# Expected: {"status":"ok"}
```

---

## 2. Session CRUD

### Create
```bash
curl -s -X POST https://backend-production-6a4c.up.railway.app/sessions \
  -H "Content-Type: application/json" \
  -d '{"company_name":"Stripe","company_url":"https://stripe.com","objective":"Understand payments infrastructure strategy"}'
# Expected: {"session_id":"<uuid>","status":"created"}
```

### List
```bash
curl -s https://backend-production-6a4c.up.railway.app/sessions
# Expected: JSON array of sessions
```

### Get detail
```bash
curl -s https://backend-production-6a4c.up.railway.app/sessions/<SESSION_ID>
# Expected: session + report (null if not yet run)
```

---

## 3. Pipeline Execution

### Start pipeline
```bash
curl -s -X POST https://backend-production-6a4c.up.railway.app/sessions/<SESSION_ID>/run
# Expected: {"session_id":"...","status":"running"}
```

### Watch SSE stream
```bash
curl -s https://backend-production-6a4c.up.railway.app/sessions/<SESSION_ID>/stream
# Expected: sequence of SSE events, one per completed node:
#   data: {"node": "plan", "status": "Planning complete"}
#   data: {"node": "research", "status": "Research complete"}
#   data: {"node": "synthesize", "status": "Synthesis complete"}
#   data: {"node": "quality_gate", "status": "Quality check complete (score=0.XX)"}
#   data: {"node": "strategize", "status": "Strategy complete"}
#   data: {"node": "generate_report", "status": "Report ready"}
#   data: {"node": "done", "status": "Workflow complete"}
#   data: null   ← sentinel; stream closes
```

### Verify completed report
```bash
curl -s https://backend-production-6a4c.up.railway.app/sessions/<SESSION_ID> | python3 -c "
import json,sys
d = json.load(sys.stdin)
print('Status:', d['status'])
r = d.get('report')
if r:
    print('Sections:', list(r['sections'].keys()))
    print('Sources:', len(r['sources']))
    print('Quality:', r['meta']['quality_score'])
"
# Expected: 8 sections, 20+ sources, quality >= 0.7
```

---

## 4. Chat API

### Send message
```bash
curl -s -X POST https://backend-production-6a4c.up.railway.app/sessions/<SESSION_ID>/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"What are the top 3 risks I should know about?"}'
# Expected: {"role":"assistant","content":"..."}
```

### Get history
```bash
curl -s https://backend-production-6a4c.up.railway.app/sessions/<SESSION_ID>/chat
# Expected: array of {role, content, created_at}
```

---

## 5. Frontend Smoke Test (manual)

Open `https://frontend-umber-three-57.vercel.app` and verify:

- [ ] Home page loads with "Research Copilot" in the navbar
- [ ] "Recent Sessions" section visible (may be empty on fresh deploy)
- [ ] Session form has 3 fields: Company Name, Company Website, Objective
- [ ] Submitting empty form shows 3 "Required" validation errors
- [ ] Entering invalid URL shows "Enter a valid URL" error
- [ ] Valid submission redirects to `/sessions/<uuid>` detail page
- [ ] Detail page shows sidebar with workflow stepper
- [ ] Nodes animate as the pipeline runs (Planning → Research → Synthesis → …)
- [ ] Report appears after all 7 nodes complete
- [ ] Report contains all 8 sections (Overview, Products & Services, Target Customers, Business Signals, Risks & Challenges, Discovery Questions, Outreach Strategy, Unknowns)
- [ ] Sources show tier badges (Official / News / Web)
- [ ] Quality score badge displayed (e.g. "91% quality")
- [ ] Chat panel visible below report
- [ ] Chat sends a question and receives a grounded answer

---

## 6. Agent-driven UI verification (Cursor browser)

Use this when you need to confirm **what the user actually sees** — especially error states, empty reports, and sidebar stepper behaviour that curl alone cannot validate.

This uses Cursor's **inbuilt browser agent** (`cursor-ide-browser` MCP): navigate to the app, read the accessibility snapshot, and capture a screenshot. No Playwright spec required; good for quick demo prep and one-off regression checks.

### When to use

- New error-handling UI (e.g. Firecrawl preflight failure at Planning)
- Layout/copy changes on session detail (`/sessions/:id`)
- Verifying API + UI agree after backend changes

### Prerequisites

```bash
make dev   # backend :8001, frontend :5173
```

### 1. Seed a session via API

Happy path — use a valid `FIRECRAWL_API_KEY` in `backend/.env`.

Error path — override Firecrawl for one run without editing `.env`:

```bash
# Terminal A: backend with invalid key
cd backend && FIRECRAWL_API_KEY=fc-invalid-test-key uvicorn app.main:app --port 8001

# Terminal B: create + run session
SESSION=$(curl -s -X POST http://localhost:8001/sessions \
  -H 'Content-Type: application/json' \
  -d '{"company_name":"Stripe","company_url":"https://stripe.com","objective":"Prepare for an enterprise sales meeting"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['session_id'])")

curl -s -X POST "http://localhost:8001/sessions/$SESSION/run" > /dev/null

# Poll until terminal status
until curl -s "http://localhost:8001/sessions/$SESSION" \
  | python3 -c "import sys,json; s=json.load(sys.stdin)['status']; print(s); exit(0 if s in ('completed','failed') else 1)"; do sleep 2; done

echo "http://localhost:5173/sessions/$SESSION"
```

Confirm API before opening the browser:

```bash
curl -s "http://localhost:8001/sessions/$SESSION" | python3 -c "
import sys, json
d = json.load(sys.stdin)
m = (d.get('report') or {}).get('meta') or {}
print('status:', d['status'])
print('stopped_at:', m.get('stopped_at'))
print('errors:', m.get('errors'))
"
```

**Firecrawl failure — expected API shape:**

- `status`: `failed`
- `meta.stopped_at`: `"plan"`
- `meta.errors`: single plan-node message (no raw `RetryError` / memory addresses)

### 2. Verify in Cursor browser agent

In Cursor chat, ask the agent to:

1. Open `http://localhost:5173/sessions/<SESSION_ID>`
2. Run a **browser snapshot** (accessibility tree) — check copy and structure without guessing from DOM
3. Take a **screenshot** for visual confirmation

**Firecrawl failure — expected UI:**

| Area | Expected |
|------|----------|
| Status badge | **Failed** (not green Complete) |
| Sidebar | **Planning failed** — "Workflow stopped — no research was run" + one friendly reason |
| Main panel | Single card: *Research stopped at Planning* — no empty report sections, no chat |
| Not shown | Seven-step stepper with mixed green/red, duplicate "Retrieval issues" list, stack traces |

### 3. Agent prompt template

Paste into Cursor when testing a UI change:

```
Start backend/frontend if needed. Create a session with [valid key | invalid FIRECRAWL_API_KEY].
Open the session detail page in the inbuilt browser, snapshot + screenshot.
Confirm: [list expected UI strings/states].
Report pass/fail with the session URL.
```

### Notes

- **New sessions only** — old sessions keep whatever errors/meta were persisted before a UI fix.
- Restart backend after code changes (`make dev` or kill + re-run uvicorn); hot reload may miss graph/routing updates.
- Playwright specs (section 7) remain the repeatable CI path; agent browser checks are for fast human-visible confirmation.

---

## 7. Automated Playwright Tests

From `frontend/`:

```bash
# Run all specs (requires backend on :8001 and frontend on :5173)
npm run test:e2e

# Run a specific spec
npx playwright test tests/04-report-sections.spec.ts

# View HTML report
npx playwright show-report
```

Test files:
| File | Covers |
|------|--------|
| `01-form-validation.spec.ts` | Form validation, error states, redirect on submit |
| `02-session-history.spec.ts` | Session list, status badges, navigation |
| `03-workflow-progress.spec.ts` | Live SSE-driven node stepper, pipeline completion |
| `04-report-sections.spec.ts` | All 8 required report sections, quality score, sources |
| `05-follow-up-chat.spec.ts` | Chat send/receive, suggestion chips, keyboard shortcuts |

---

## 8. Backend Unit Tests

From `backend/`:

```bash
python3 -m pytest tests/ -q
# Expected: 48 passed (excluding test_e2e.py)

# Full E2E (makes real API calls — uses credits)
RUN_E2E=1 python3 -m pytest tests/test_e2e.py -v
```

---

## 9. Known Watchpoints

- Railway SQLite resets on redeploy (no persistent volume). Acceptable for demo.
- Firecrawl may return empty markdown for CAPTCHA-heavy sites — `synthesize` falls back to snippet.
- Financial enrichment uses Firecrawl search; pass the company website URL for better tier-1 results.
- SSE stream times out at 120s if the pipeline hangs — check Railway logs for the error node.
