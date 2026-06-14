import asyncio
import json
import structlog
from app.graph.state import ResearchState, NodeError
from app.tools import scrape as scrape_tool
from app.llm import get_llm

log = structlog.get_logger()

_EXTRACT_PROMPT = """Extract financial and firmographic data from the text below about {company}.
Return ONLY valid JSON with these fields (use null for unknown):
{{
  "revenue": "annual revenue as string e.g. '$2.5B' or '$50M'",
  "funding_total": "total funding raised e.g. '$500M Series D'",
  "valuation": "valuation e.g. '$6.5B'",
  "employees": "headcount as integer or null",
  "founded_year": "year as integer or null",
  "headquarters": "city, country",
  "investors": ["list", "of", "notable", "investors"],
  "market_cap": "market cap for public companies or null",
  "description": "one sentence summary of what the company does"
}}

Text:
{text}"""


async def financials_node(state: ResearchState) -> dict:
    session_id = state["session_id"]
    company_name = state["company_name"]
    errors = list(state.get("errors", []))

    log.info("financials_node.start", session_id=session_id, company=company_name)

    try:
        query = "revenue funding valuation employees headcount investors founded market cap"
        sources = await asyncio.get_event_loop().run_in_executor(
            None, lambda: scrape_tool.search(query, company_name, state.get("company_url", ""))
        )
        combined_text = "\n\n".join(
            f"[{s['title']}]\n{s['snippet']}" for s in sources if s.get("snippet")
        )
        if not combined_text.strip():
            raise ValueError("No financial content found via search")

        llm = get_llm()
        prompt = _EXTRACT_PROMPT.format(company=company_name, text=combined_text[:6000])
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
        log.info("financials_node.web_ok", session_id=session_id, fields=list(financials.keys()))
        return {"financials": financials, "status": "Financials enriched"}

    except Exception as exc:
        log.warning("financials_node.skipped", session_id=session_id, error=str(exc))
        errors.append(NodeError(node="enrich_financials", message=str(exc), recoverable=True))
        return {"financials": {}, "errors": errors, "status": "Financials unavailable"}
