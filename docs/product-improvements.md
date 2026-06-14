# Product Improvements

Product and business thinking for the AI Research Copilot.

> Context: research is already concurrent and snippet-only — full runs ~53s, Firecrawl spend
> down ~80% (see Engineering Decision #3). Everything below is forward-looking.

---

## 1. Five weaknesses

1. **Latency is LLM-bound.** Search is no longer the bottleneck — `plan + synthesize + strategize`
   are ~45s of a ~53s run. There's no streaming, so the user watches a spinner.
2. **SQLite doesn't scale.** App DB and checkpointer both write local files; a second worker,
   restart, or redeploy wipes state. Can't run horizontally.
3. **No auth.** Any URL holder sees any session — no user, workspace, or roles. No safe team use,
   no billing.
4. **Thin data on private companies.** Enrichment runs for every company type, but for
   pre-IPO/international firms web search is the only signal and it's shallow — exactly the
   high-value prospects.
5. **Reports are frozen.** A funding round tomorrow means re-running the whole pipeline; there's
   no way to refresh one section.

## 2. Top 3 to build next

1. **Cut perceived latency.** Stream `synthesize` tokens through SSE and trim its context. Later:
   an LLM-drafts/search-verifies hybrid to cut search count, and `Send` fan-out for large plans.
2. **Postgres + auth.** `AsyncPostgresSaver`, Postgres app DB, JWT with workspace scoping —
   unblocks scale, durable state, and a billing model.
3. **Section-level refresh.** Re-research one section via a graph entry point that runs only
   `research → synthesize → quality_gate` for that key.

## 3. Who buys, who uses, why they pay

- **Buyer:** VP Sales / RevOps — cares about AE ramp time, win rate, CRM/Slack fit, seat economics.
- **User:** AEs and SDRs prepping calls — 15 minutes, not 2 hours. They want signal, not documents.
- **Why pay:** manual research is 45–90 min/account. A 2-minute briefing means more accounts
  prepped, or more time selling. $50–100/seat/month is easy ROI.

## 4. Success metrics

| Metric | Target | Why |
|--------|--------|-----|
| Briefing quality score | ≥ 0.80 avg | Proxy for output usefulness |
| Pipeline p95 latency | < 90s | Abandonment threshold |
| Sessions / active user / week | ≥ 3 | Habit, not trial |
| Chat messages / session | ≥ 2 | Report is useful enough to dig into |
| Report → meeting conversion | CRM-tagged | The business outcome |

## 5. 4-week AI roadmap

| Week | Focus | Deliverable |
|------|-------|-------------|
| 1 | Durable state + auth | Postgres + `AsyncPostgresSaver`, JWT, workspace scoping |
| 2 | Source expansion | Apollo/Crunchbase enrichment for private companies; LinkedIn signals |
| 3 | Model tiering | DeepSeek for plan/quality, GPT-4o for synthesis/strategy; ~40% cheaper |
| 4 | Streaming output | LLM token stream over SSE — report renders progressively |

## 6. Biggest risks

- **Cost:** Firecrawl. ~<10 credits/run post-optimization (was ~60); ~10k/day at 1k sessions.
  Mitigate with `maxAge` caching and cross-session dedupe.
- **Scaling:** SQLite + single-process FastAPI → lock contention under concurrent runs. Mitigate
  with Postgres, asyncpg pooling, and separate worker processes.
- **Reliability:** no circuit breaker beyond tenacity retry — a DeepSeek outage degrades every LLM
  node. Mitigate with provider fallback (DeepSeek → OpenAI), per-node timeouts, `NodeError` alerting.

## 7. Feature to remove

**The automatic re-research loop.** Worst case it doubles latency for marginally different text —
a second pass with the same queries returns the same sources, and `quality_gate` is a proxy, not
ground truth. Keep the score as a transparency signal; drop the auto re-run and put the effort
into a stronger first synthesis pass.

## 8. Feature to add

**CRM push.** One-click export of the briefing as a Salesforce/HubSpot contact note. The value
lands in the CRM, where the AE already is — no window-switching, no copy-paste. It's also the
clearest proof point for the VP Sales buyer.

## 9. First 90 days

| Days | Milestone |
|------|-----------|
| 0–30 | Streaming output + Postgres + auth. Onboard 3–5 beta teams. Instrument session → meeting conversion. |
| 31–60 | CRM integration (Salesforce + HubSpot). Section-level refresh. Model tiering for cost control. |
| 61–90 | Self-serve signup. Slack digest. Admin dashboard for usage, quality trends, per-team cost. |

## 10. What I'd change first

**Stream the output.** Parallelizing search already got runs to ~53s; the next win is *perceived*
speed. Streaming `synthesize` token-by-token turns a 50-second blank wait into something that
feels live — cheaper than any data-quality work, and it multiplies how often the tool gets used.
