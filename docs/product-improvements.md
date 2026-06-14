# Product Improvements

*AI Research Copilot — Product & Business Thinking*

---

## 1. Five Weaknesses in the Current Design

**1. Latency is now LLM-bound, not search-bound.**
Research searches were the original bottleneck (sequential, full-page scrapes). They now fan out concurrently and snippet-only, and `enrich_financials` runs in parallel with `research`, so a full run is ~53s — and that time is now dominated by the three LLM nodes (`plan`, `synthesize`, `strategize`), not web search. The remaining lever is the LLM: trim the synthesize context, stream tokens, or adopt the DeepSeek-drafts/search-verifies hybrid (Improvement 4) to cut both latency and search count.

**2. SQLite breaks at scale.**
Both the application DB and the LangGraph checkpointer write to SQLite files on the local filesystem. A second uvicorn worker, a container restart, or a cloud deploy wipes state. This is a single-point-of-failure that cannot be scaled horizontally.

**3. No session ownership or auth.**
Any user with the URL can see any session. There is no login, no workspace, no role separation. A sales team cannot share sessions safely, and a SaaS pricing model is impossible without identity.

**4. Source quality is shallow for private companies.**
Financial enrichment is now a Firecrawl search + LLM extraction that runs for every company type, so private firms do get funding/valuation signal where it exists publicly. But for pre-IPO or international companies that signal is thin, and web search remains the only source. Research quality for the most interesting enterprise prospects (fast-growing, private) is still systematically lower than for public companies.

**5. The report is static — it cannot be updated.**
Once generated, the report is frozen. If the company announces a funding round the next day, the user has no way to refresh a section without re-running the entire pipeline from scratch.

---

## 2. Top 3 Improvements to Build Next

**Priority 1 — Cut LLM latency (search is no longer the bottleneck)**
Basic parallelism is already shipped: sub-question searches fan out concurrently via `asyncio.gather` and `enrich_financials` runs in parallel with `research`, so a full run is ~53s and the critical path is now the LLM nodes, not web search. The next leverage points: (a) shrink the `synthesize` context (cap sources / snippet sizes) and stream its tokens to the UI; (b) adopt a DeepSeek-drafts/search-verifies hybrid to cut the *number* of searches; (c) for very large plans, graduate from in-node `asyncio.gather` to a LangGraph `Send`-based worker fan-out with a `research_reducer` for unbounded scaling.

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
| 1 | Durable state + auth | Postgres + `AsyncPostgresSaver`, JWT auth, workspace scoping |
| 2 | Source expansion | Apollo/Crunchbase enrichment for private companies; LinkedIn signal parsing |
| 3 | Model tiering | DeepSeek for planning/quality, GPT-4o for synthesis/strategy; ~40% cost reduction |
| 4 | Streaming token output | Pipe LLM token stream through SSE so the report renders word-by-word, eliminating the perception of wait |

*(Research parallelization + snippet-only search already shipped — see Engineering Decision #2.)*

---

## 6. Biggest Cost, Scaling, and Reliability Risks

**Cost:** Firecrawl is the main external spend. After the snippet-only change, research costs ~1 credit per sub-question plus a single homepage scrape — well under ~10 credits per run, down from ~60 when every result was full-scraped. At 1,000 sessions/day that's ~10k credits/day. Mitigation: `maxAge` caching to reuse recent pages, deduplicate sources across sessions for the same company, and the DeepSeek-drafts/search-verifies hybrid to cut search count further.

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

**Done: parallelize research + snippet-only search. Next: cut LLM latency.**

Parallelizing the research loop (concurrent searches + financials running alongside research) and dropping wasteful full-page scrapes already pulled a full run down to ~53s and slashed Firecrawl spend. That was the highest user-impact / lowest-complexity change, and it's shipped. The next frontier is the LLM critical path: streaming `synthesize` output and trimming its context would move perceived latency from "I'll run this while I make coffee" to "I'll run this while I look up their LinkedIn." That shift in perceived speed fundamentally changes adoption behavior — users run it for more accounts, more often. Everything else (better sources, richer sections, CRM push) is multiplied by that frequency. A slow product with great output is a tool people use occasionally. A fast product with good output is a habit.
