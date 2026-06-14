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

## Production Upgrades (not built — 3-day scope)

- **Parallel research fan-out** via LangGraph `Send` — significant speedup for plans
  with 6+ sub-questions
- **Crunchbase / Apollo enrichment** — richer company data; requires paid API access
- **PostgresSaver** instead of SQLiteSaver — required for multi-process / cloud deploy
- **Model tiering** — restore cheap/strong split for cost optimisation at scale
- **Streaming token output** — pipe LLM token stream through SSE rather than waiting
  for full node completion
