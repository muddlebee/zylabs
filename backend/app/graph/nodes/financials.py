import asyncio
import json
import time

import structlog
from app.graph.state import ResearchState, NodeError
from app.tools import scrape as scrape_tool
from app.llm import get_llm

log = structlog.get_logger()

# One snippet-only search — fast (~3-5s) and cheap (no per-result scrapes).
FINANCIAL_QUERY = "revenue earnings market cap stock price funding valuation"
FINANCIAL_RESULTS = 5
FINANCIAL_SNIPPET_LIMIT = 1500
FINANCIAL_LLM_CONTEXT = 5000
FINANCIAL_GATHER_TIMEOUT = 25

_EXTRACT_PROMPT = """Extract financial and firmographic data from the text below about {company}.
Return ONLY valid JSON with these fields (use null for unknown):
{{
  "revenue": "annual or quarterly revenue as string e.g. '$2.5B' or '$50M'",
  "market_cap": "market cap for public companies e.g. '$35B'",
  "symbol": "stock ticker for public companies e.g. 'CRWV'",
  "funding_total": "total funding raised e.g. '$500M Series D'",
  "employees": "headcount as integer or null",
  "founded_year": "year as integer or null",
  "headquarters": "city, country",
  "description": "one sentence summary of what the company does"
}}

Text:
{text}"""


async def financials_node(state: ResearchState) -> dict:
    session_id = state["session_id"]
    company_name = state["company_name"]
    company_url = state.get("company_url", "")
    errors = list(state.get("errors", []))

    log.info("financials_node.start", session_id=session_id, company=company_name)
    t0 = time.monotonic()

    try:
        loop = asyncio.get_event_loop()
        sources = await asyncio.wait_for(
            loop.run_in_executor(
                None,
                lambda: scrape_tool.search(
                    FINANCIAL_QUERY,
                    company_name,
                    company_url,
                    limit=FINANCIAL_RESULTS,
                    snippet_limit=FINANCIAL_SNIPPET_LIMIT,
                    scrape_results=False,
                    timeout_ms=15000,
                ),
            ),
            timeout=FINANCIAL_GATHER_TIMEOUT,
        )
        combined_text = "\n\n".join(
            f"[{s['title']}]\n{s['snippet']}" for s in sources if s.get("snippet")
        )
        if not combined_text.strip():
            raise ValueError("No financial content found via search")

        llm = get_llm()
        prompt = _EXTRACT_PROMPT.format(
            company=company_name,
            text=combined_text[:FINANCIAL_LLM_CONTEXT],
        )
        response = await llm.ainvoke([{"role": "user", "content": prompt}])
        raw = response.content.strip()
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        financials = json.loads(raw)
        financials = {
            k: v for k, v in financials.items()
            if v is not None and v != "" and not (isinstance(v, list) and len(v) == 0)
        }
        if not financials:
            raise ValueError("No financial fields extracted from search results")

        financials["source"] = "web"
        elapsed = round(time.monotonic() - t0, 1)
        log.info(
            "financials_node.web_ok",
            session_id=session_id,
            sources=len(sources),
            fields=list(financials.keys()),
            elapsed_s=elapsed,
        )
        return {"financials": financials, "status": "Financials enriched"}

    except asyncio.TimeoutError:
        msg = f"Financial search timed out after {FINANCIAL_GATHER_TIMEOUT}s"
        log.warning("financials_node.timeout", session_id=session_id)
        errors.append(NodeError(node="enrich_financials", message=msg, recoverable=True))
        return {"financials": {}, "errors": errors, "status": "Financials unavailable"}

    except Exception as exc:
        log.warning("financials_node.skipped", session_id=session_id, error=str(exc))
        errors.append(NodeError(node="enrich_financials", message=str(exc), recoverable=True))
        return {"financials": {}, "errors": errors, "status": "Financials unavailable"}
