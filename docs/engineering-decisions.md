# Engineering Decisions

Key choices made during the build and the reasoning behind them.

---

## 1. Single LLM provider config (no model tiering)

**Decision:** One `MODEL_NAME` / `MODEL_PROVIDER` pair used by all LLM-calling nodes
(`plan`, `synthesize`, `quality_gate`, `strategize`, `chat`).

**Why:** The spec calls for cheap/strong tiering (e.g. DeepSeek for planning, GPT-4 for
synthesis). For a 3-day build and demo, a single capable model is simpler to configure,
debug, and explain. The `get_llm()` factory in `app/llm.py` is a single swap point —
tiering can be added in one edit by splitting into `get_cheap_llm()` / `get_strong_llm()`
with separate env vars.

**Trade-off:** Slightly higher cost per run vs. a tiered setup. Negligible at demo volume.

---

## 2. Sequential research (not parallel `Send` fan-out)

**Decision:** `research_node` loops through sub-questions sequentially rather than fanning
out with LangGraph `Send`.

**Why:** The spec explicitly recommends this for the first build:
> "Build sequential, upgrade to Send on day 3 if green."

Sequential is easier to debug when a Tavily call fails — you see exactly which question
errored and in what order. Parallel fan-out would require a reducer to merge partial
`sources[]` lists and handle partial failures gracefully.

**Upgrade path:** Split `research_node` into a dispatcher that emits `Send(worker, task)`
per sub-question and a `research_reducer` node that merges results. Document in
`product-improvements.md`.

---

## 3. AsyncSqliteSaver over SqliteSaver

**Decision:** Used `AsyncSqliteSaver` (from `langgraph-checkpoint-sqlite`) instead of the
sync `SqliteSaver`.

**Why:** All node functions are `async`. LangGraph 1.x `graph.astream()` requires an
async-compatible checkpointer — passing a sync `SqliteSaver` raises a runtime error.
`AsyncSqliteSaver` is initialised inside the FastAPI lifespan `async with` block and
lives for the lifetime of the server process.

---

## 4. Lazy LLM instantiation via `@lru_cache`

**Decision:** `get_llm()` in `app/llm.py` is decorated with `@lru_cache(maxsize=1)`.
The `ChatOpenAI` client is not created at import time.

**Why:** Module-level instantiation of `ChatOpenAI` validates the API key immediately.
During tests (and cold imports without a `.env` file), this raises `OpenAIError: Missing
credentials` before any test runs. Lazy init means the client is created on first actual
call — imports stay clean, tests that don't need the LLM can run without keys.

---

## 5. Two separate SQLite databases

**Decision:** `research.db` (SQLAlchemy app tables) and `checkpoints.db` (LangGraph
checkpointer) are kept in separate files.

**Why:** The checkpointer schema is LangGraph's internal format and should not be mixed
with user-facing app data. Keeping them separate makes it safe to wipe `research.db`
for a clean demo without losing checkpoint recoverability, or to inspect `research.db`
with standard SQLite tooling without stepping on the checkpoint tables.

---

## 6. Chat is RAG-lite, not part of the graph

**Decision:** Follow-up chat stuffs the persisted `report + sources` into the system
prompt and calls the LLM directly. It does not re-run or extend the LangGraph workflow.

**Why:** The spec is explicit:
> "Folding it into the main graph muddies state and streaming."

Chat is a stateless Q&A layer over a frozen report. Re-running the graph for every chat
turn would be expensive, slow, and semantically wrong — the research is done.

---

## 7. Firecrawl over httpx + trafilatura for web research

**Decision:** Replaced `httpx + trafilatura` (raw HTTP + content extraction) and `Tavily`
(snippet-only search) with Firecrawl for both search and scraping.

**Why:** Most company websites are React/Next.js SPAs or have Cloudflare protection.
`httpx` fetches the raw HTML of a JS-rendered page and gets almost nothing; trafilatura
then extracts from an empty DOM. Firecrawl runs a headless browser, handles bot
protection, and returns clean markdown. For a sales research tool targeting tech companies
specifically, this is the overwhelming majority of targets.

Additionally, Firecrawl's `search` method with `scrape_options` returns full page
markdown per result — not 150-char snippets. This gives `synthesize` substantially more
evidence to ground findings in, resulting in higher confidence scores.

**Trade-off:** Requires a Firecrawl API key and consumes credits (~5–10 credits per
search query). At 500k free credits this is negligible at demo scale. For production,
cache scraped pages and deduplicate URLs to minimise spend.

---

## 8. Source tier assignment at retrieval time

**Decision:** Every `Source` object gets a `tier` (1/2/3) assigned in `tools/tavily.py`
at the moment it is retrieved, based on domain matching.

**Why:** Tier is used downstream in `quality_gate` (grounding score) and surfaced in the
UI (tier badges on sources). Assigning it once at retrieval keeps all downstream code
simple — nodes read `source["tier"]` directly with no additional lookup.

Tier logic:
- **1** — URL domain matches the company's own URL
- **2** — domain is in a hardcoded set of reputable news outlets
- **3** — everything else

---

## 9. Parallel research fan-out via LangGraph `Send` + `Command`

**Decision:** `research_dispatcher` returns `Command(goto=[Send("research_worker", task) for task in tasks])`. Each sub-question gets its own `research_worker` instance running in parallel. State fields that accumulate across workers (`sources`, `scraped`, `errors`) use `Annotated` reducers (`operator.add` for lists, dict merge for scraped).

**Why:** Sequential search was the single largest latency contributor — a 6-question plan blocked 6 Firecrawl calls in series. With parallel fan-out, all workers fire simultaneously and converge on `synthesize` when the last one finishes. Expected wall-clock reduction: 5–6× on a typical plan.

**Trade-off:** Parallel Firecrawl calls consume credits faster. Mitigated by deduplication in the reducer (duplicate URLs are overwritten, not appended). Checkpoint state is larger since workers write independently.

---

## 10. ReAct tool-calling agent for each research worker

**Decision:** Each `research_worker` is a `create_react_agent(llm, [web_search, scrape_page])` instance. The agent decides which tool to call based on the question, how many times to call it, and when it has enough evidence. Tools are closures that append discovered sources to a local list, which is returned as the node's output.

**Why:** A fixed "always call Firecrawl search once" approach cannot adapt to question type. Financial questions benefit from a direct yfinance lookup; questions about a specific product page benefit from `scrape_page` on a known URL. The ReAct loop (`think → act → observe → think`) lets the LLM make these decisions, producing higher-quality evidence for the same credit budget.

**Trade-off:** Adds LLM tokens per worker (tool-calling overhead). Mitigated by `MAX_TOOL_STEPS = 3` per worker. Using `create_react_agent` from `langgraph.prebuilt` keeps the implementation concise — the agent graph is managed internally.

---

## 11. Ticker/ETF classification fix in plan prompt

**Decision:** Added an explicit rule to the `plan` system prompt: if the company name is 2–5 uppercase letters (e.g. DRAM, SPY, AAPL), classify as `public`. This triggers `enrich_financials` via yfinance for ETFs and stocks that would otherwise be labelled `unknown`.

**Why:** The LLM has no reliable prior that short uppercase strings are tickers. Without the rule, `DRAM` was classified as `unknown`, skipping the financial enrichment node entirely and losing structured NAV / expense-ratio data that yfinance returns instantly.

---

## Production Upgrades (not built — 3-day scope)

- **Parallel research fan-out** via LangGraph `Send` — significant speedup for plans
  with 6+ sub-questions
- **Crunchbase / Apollo enrichment** — richer company data; requires paid API access
- **PostgresSaver** instead of SQLiteSaver — required for multi-process / cloud deploy
- **Model tiering** — restore cheap/strong split for cost optimisation at scale
- **Streaming token output** — pipe LLM token stream through SSE rather than waiting
  for full node completion

---

## Top Technical Debt Items

1. **SQLite in production** — both `research.db` and `checkpoints.db` write to the
   container filesystem. A redeploy wipes all session history. The fix is
   `AsyncPostgresSaver` + a managed Postgres instance. Every other scalability
   improvement is blocked behind this.

2. **No authentication** — all sessions are world-readable via URL. The API has no
   concept of a user, workspace, or token. Adding auth requires changes to every route
   and the DB schema.

3. **`asyncio.create_task` for background pipeline** — the pipeline runs as a detached
   task in the FastAPI process. If the process restarts mid-run the task is silently lost
   and the session is stuck in `running`. A proper task queue (ARQ, Celery) with a
   worker process would make this recoverable without relying on the LangGraph checkpoint
   alone.

4. **Hardcoded news domain list in tier assignment** — `tools/scrape.py` has a small
   inline set of "reputable news" domains for tier-2 classification. It misses many
   legitimate sources and needs to be replaced with a maintained allowlist or a
   domain-reputation API.

5. **No pagination on `/sessions`** — the list endpoint returns all sessions. At 10,000
   sessions this becomes a slow full-table scan. Needs `limit`/`offset` or cursor-based
   pagination.

---

## Biggest Technical Risk

**The re-research loop can hang silently.**

If `quality_gate` scores below the threshold and `revisions < MAX_REVISIONS`, the graph
re-enters `research_node`. If Firecrawl is degraded (rate-limited, returning empty
markdown), the second pass produces the same low-quality sources, scores below threshold
again, and the loop runs `MAX_REVISIONS` times before exiting — each pass consuming
full pipeline latency. With `MAX_REVISIONS=2` this doubles the worst-case run time.
Worse, if the LLM is unavailable during `synthesize`, the node logs a `NodeError` and
returns empty findings. `quality_gate` then scores 0.0, the loop fires, and the same
failure repeats until the revision cap is hit.

**Mitigation implemented:** `NodeError` is appended to state and the graph always
continues. `MAX_REVISIONS` caps the loop. But there is no circuit breaker that detects
"we failed the same way twice" and exits early. That check would require comparing the
current `errors` list to the previous revision's errors.

---

## What We Would Improve With 2 Additional Weeks

**Week 1:**
- Parallel `Send` fan-out in `research_node` — 5× latency reduction, highest user impact
- PostgreSQL + `AsyncPostgresSaver` — required for any multi-user or cloud deployment
- JWT auth with workspace scoping — unlocks team use and a SaaS billing model

**Week 2:**
- CRM push (Salesforce / HubSpot) — export briefing as a contact note with one click
- Section-level refresh — re-research a single section without re-running the full graph
- Streaming token output — pipe LLM tokens through SSE so the report renders
  progressively rather than appearing all at once after a 90-second wait
