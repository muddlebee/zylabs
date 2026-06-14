# Product Improvements

*AI Research Copilot — Product & Business Thinking*

---

## 1. Five Weaknesses in the Current Design

**1. Sequential research is slow.**
The pipeline runs sub-questions one after another — a 6-question plan takes 6× the latency of a single search. On a live demo this is acceptable; for a product with SLA expectations it is not. Users waiting 90 seconds for a briefing will abandon.

**2. SQLite breaks at scale.**
Both the application DB and the LangGraph checkpointer write to SQLite files on the local filesystem. A second uvicorn worker, a container restart, or a cloud deploy wipes state. This is a single-point-of-failure that cannot be scaled horizontally.

**3. No session ownership or auth.**
Any user with the URL can see any session. There is no login, no workspace, no role separation. A sales team cannot share sessions safely, and a SaaS pricing model is impossible without identity.

**4. Source quality is shallow for private companies.**
yfinance covers public companies well. For private, pre-IPO, or international companies the financial enrichment node returns nothing, and Firecrawl's web search is the only signal. Research quality for the most interesting enterprise prospects (fast-growing, private) is systematically lower.

**5. The report is static — it cannot be updated.**
Once generated, the report is frozen. If the company announces a funding round the next day, the user has no way to refresh a section without re-running the entire pipeline from scratch.

---

## 2. Top 3 Improvements to Build Next

**Priority 1 — Parallel research fan-out via LangGraph `Send`**
Split `research_node` into a dispatcher that emits `Send(worker, question)` per sub-question and a `research_reducer` that merges partial `sources[]` lists. Expected speedup: 5–6× on a 6-question plan. This is the single highest-leverage change for user experience and requires no external dependencies.

**Priority 2 — PostgreSQL persistence + multi-user auth**
Replace `AsyncSqliteSaver` with `AsyncPostgresSaver` (already supported by `langgraph-checkpoint-postgres`), swap SQLite app DB for Postgres, add JWT-based auth with workspace scoping. Unlocks horizontal scaling, persistent state across deploys, and a SaaS billing model.

**Priority 3 — Section-level refresh ("Re-research this section")**
Allow users to trigger a targeted re-research on a single section (e.g. Business Signals) without re-running the full pipeline. Implement as a new graph entry point that accepts `section_key` + `gaps` and runs only the `research → synthesize → quality_gate` sub-chain for that section. This is the most-requested feature class for intelligence tools: "the data changed, update just this part."

---

## 3. Who Buys, Who Uses, and Why They Pay

**Buyer:** VP of Sales or Revenue Operations. They buy tools that reduce ramp time for AEs and increase win rates. They evaluate on integration (CRM, Slack), compliance (data residency), and seat economics.

**User:** Account Executives and SDRs preparing for discovery and demo calls. They have 15 minutes before a call, not 2 hours. They need signal, not documents.

**Why they pay:** Manual prospect research takes 45–90 minutes per account. A polished AI briefing in 2 minutes means an AE can prep 30× more accounts — or spend the saved time on actual selling. At $50–100/seat/month the ROI math is trivial to justify in a procurement conversation.

---

## 4. Success Metrics

| Metric | Target | Why it matters |
|--------|--------|----------------|
| Briefing quality score | ≥ 0.80 average | Direct proxy for output usefulness |
| Pipeline p95 latency | < 90s | User abandonment threshold |
| Sessions per active user per week | ≥ 3 | Indicates habitual use, not trial |
| Follow-up chat messages per session | ≥ 2 | Shows users find the report useful enough to dig deeper |
| Report-to-meeting conversion | tracked via CRM tag | Ultimate business outcome |

---

## 5. 4-Week AI Roadmap

| Week | Focus | Deliverable |
|------|-------|-------------|
| 1 | Parallel fan-out | `Send`-based research, 5× faster pipeline |
| 2 | Source expansion | Apollo/Crunchbase enrichment for private companies; LinkedIn signal parsing |
| 3 | Model tiering | DeepSeek for planning/quality, GPT-4o for synthesis/strategy; 40% cost reduction |
| 4 | Streaming token output | Pipe LLM token stream through SSE so the report renders word-by-word, eliminating the perception of wait |

---

## 6. Biggest Cost, Scaling, and Reliability Risks

**Cost:** Firecrawl consumes 5–10 credits per research query. At 6 sub-questions per session, one full run costs ~60 credits. At scale (1,000 sessions/day) this is 60,000 credits/day — a meaningful line item. Mitigation: cache scraped pages by URL + TTL, deduplicate sources across sessions for the same company.

**Scaling:** SQLite + single-process FastAPI cannot serve concurrent pipeline runs safely. Multiple runs writing to the same DB file causes lock contention. Mitigation: PostgreSQL, connection pooling (asyncpg), and background task workers (Celery or ARQ) separate from the API process.

**Reliability:** The LLM calls have no circuit breaker beyond tenacity retry. A DeepSeek outage silently degrades all nodes that call `get_llm()`. Mitigation: provider fallback (DeepSeek primary → OpenAI secondary), per-node timeout caps, and alerting on `NodeError` count in the persisted report.

---

## 7. Feature to Remove

**Remove:** the `revisions` re-research loop (quality score < threshold → re-run research).

**Why:** It doubles pipeline latency in the worst case without reliably improving output quality — a second pass with the same Firecrawl queries returns the same sources. The `quality_gate` score is a proxy metric, not a ground truth. Users experience a 2-minute wait instead of a 90-second one and get marginally different text. The effort is better spent on better prompts in the initial synthesis pass. Keep the quality score as a transparency signal; remove the automatic re-run.

---

## 8. Feature to Add

**Add:** CRM push — one-click export of the research briefing as a note on the contact/account record in Salesforce or HubSpot.

**Why:** The briefing's value is realized in the CRM, not in this app. AEs already have a tab open in their CRM before every call. Requiring them to switch windows and copy-paste destroys the workflow. A native integration makes the tool a permanent part of the pre-call ritual rather than a one-off research aid. This is also the primary proof point for the VP of Sales buyer: "my team's call notes are getting richer without extra effort."

---

## 9. First 90-Day Roadmap

| Days | Milestone |
|------|-----------|
| 0–30 | Ship parallel fan-out (Priority 1). Add Postgres + auth. Onboard 3–5 beta sales teams. Instrument session → meeting conversion tracking. |
| 31–60 | Launch CRM integration (Salesforce + HubSpot). Add section-level refresh. Implement model tiering for cost control. |
| 61–90 | Open to self-serve signup. Add Slack digest ("your Stripe briefing is ready"). Build admin dashboard for usage, quality trends, and per-team cost. |

---

## 10. What to Change First

**Replace the sequential research loop with parallel `Send` fan-out.**

This is the change with the highest ratio of user impact to implementation complexity. The pipeline latency drop from ~90s to ~20s changes the product from "I'll run this while I make coffee" to "I'll run this while I look up their LinkedIn." That shift in perceived speed fundamentally changes adoption behavior — users run it for more accounts, more often. Everything else (better sources, richer sections, CRM push) is multiplied by that frequency. A slow product with great output is a tool people use occasionally. A fast product with good output is a habit.
