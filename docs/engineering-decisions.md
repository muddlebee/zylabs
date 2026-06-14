# Engineering Decisions

Notable choices, what I rejected, and what I'd fix with more time.

---

## Three decisions that shaped the build

### 1. Retrieve-then-read, not an agentic tool loop

The LLM never calls a "search" tool. `plan` writes a fixed list of sub-questions, `research`
runs them, `synthesize` reads the results back. Grounding is enforced downstream: `quality_gate`
scores a finding by whether it cites real `source_ids`.

- **Rejected:** an agent that decides each search mid-generation. More adaptive, but it adds an
  LLM round-trip per search, makes runs non-deterministic, and lets the model answer from memory
  instead of from sources.
- **Trade-off:** less adaptive when the data is surprising. The gap-driven re-research loop wins
  some of that back.

### 2. Firecrawl for all retrieval

One tool for both web search and page scraping. Replaced an earlier `httpx + trafilatura + Tavily`
stack.

- **Why:** targets are mostly React/Next SPAs behind Cloudflare. `httpx` fetches an empty JS
  shell and trafilatura extracts nothing; Firecrawl runs a headless browser and returns clean
  markdown.
- **Rejected:** raw HTTP + readability extraction (dies on SPAs); Tavily (snippets only, no real
  page content).
- **Trade-off:** paid API and credits — mitigated by decision #3.

### 3. Concurrent, snippet-only research

`research` fans its sub-question searches out with `asyncio.gather`, asks for snippets only (no
per-page scrape), and `enrich_financials` runs as a parallel branch instead of a serial pre-step.

The first build searched sequentially and full-scraped every result — minutes per run, ~30–50
Firecrawl credits. Both were waste: the searches are independent, and `synthesize` only ever
reads `Source.snippet` (the full markdown got truncated to 600 chars and thrown away). Only the
company homepage is still scraped in full.

- **Result:** ~53s end-to-end (research itself ~3.5s), ~80% fewer Firecrawl credits. The critical
  path is now the LLM nodes, not the web.
- **Trade-off:** parallel branches write `errors`/`status` in one superstep, so those state keys
  need reducers (dedupe-merge / last-wins). Logs interleave instead of running strictly in order.
- **Next:** `Send`-based worker fan-out for very large plans; an LLM-drafts / search-verifies
  hybrid to cut the number of searches.

---

## Other choices

| Choice | Why |
|---|---|
| Single LLM for every node (`MODEL_PROVIDER`/`MODEL_NAME`) | Simpler to configure and debug in 3 days. `get_llm()` is a one-line swap point for tiering later. |
| `AsyncSqliteSaver` over `SqliteSaver` | All nodes are async; `astream()` rejects a sync checkpointer. Initialised in the FastAPI lifespan. |
| `@lru_cache` on `get_llm()` | Lazy init avoids validating the API key at import, so key-free tests run clean. |
| Two SQLite files (`research.db`, `checkpoints.db`) | Keeps app data and LangGraph's internal checkpoint format separable — wipe one without the other. |
| Chat is RAG-lite, outside the graph | Stateless Q&A over a frozen report; re-running the graph per chat turn would be slow and semantically wrong. |
| Tier assigned at retrieval (`_assign_tier`) | Compute domain trust once; downstream just reads `source["tier"]`. |

---

## Top technical debt

| # | Debt | Fix |
|---|---|---|
| 1 | SQLite on the container FS — a redeploy wipes history. Blocks every scaling step. | `AsyncPostgresSaver` + managed Postgres |
| 2 | No auth — every session is world-readable by URL | JWT + workspace scoping (touches every route and the schema) |
| 3 | Pipeline runs as a detached `asyncio.create_task` — lost on restart, session stuck in `running` | Real task queue (ARQ/Celery) with a worker process |
| 4 | Hardcoded news-domain set drives tier-2 classification | Maintained allowlist or a domain-reputation API |
| 5 | `/sessions` returns everything — full scan at scale | Cursor pagination |

---

## Biggest technical risk

**The re-research loop burns time on repeated failure.** If Firecrawl is degraded or the LLM is
down during `synthesize`, the second pass produces the same empty results, scores low again, and
the loop runs to `MAX_REVISIONS` — each pass a full pipeline latency.

Today `MAX_REVISIONS=2` caps it and every `NodeError` is non-fatal, so it never crashes. What's
missing is a circuit breaker that notices "failed the same way twice" and exits early.

---

## With two more weeks

**Week 1 — make it production-real:** Postgres + `AsyncPostgresSaver`; JWT auth with workspace
scoping; move the pipeline onto a worker queue.

**Week 2 — faster and stickier:** stream `synthesize` tokens through SSE; section-level refresh
(re-research one section); one-click CRM push (Salesforce/HubSpot).
