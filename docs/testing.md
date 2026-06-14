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

## 6. Automated Playwright Tests

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

## 7. Backend Unit Tests

From `backend/`:

```bash
python3 -m pytest tests/ -q
# Expected: 23 passed

# Full E2E (makes real API calls — uses credits)
RUN_E2E=1 python3 -m pytest tests/test_e2e.py -v
```

---

## 8. Known Watchpoints

- Railway SQLite resets on redeploy (no persistent volume). Acceptable for demo.
- Firecrawl may return empty markdown for CAPTCHA-heavy sites — `synthesize` falls back to snippet.
- Financial enrichment uses Firecrawl search; pass the company website URL for better tier-1 results.
- SSE stream times out at 120s if the pipeline hangs — check Railway logs for the error node.
