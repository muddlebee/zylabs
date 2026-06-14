import asyncio
import json
import structlog
from app.graph.state import ResearchState, NodeError
from app.tools import scrape as scrape_tool
from app.llm import get_llm

log = structlog.get_logger()

YFINANCE_TIMEOUT = 15  # seconds before we give up on yfinance

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


def _yfinance_fetch(company_name: str) -> dict:
    """Sync yfinance call — run inside a thread with timeout."""
    import yfinance as yf

    # If company_name looks like a ticker (short, uppercase), try it directly first
    symbol = company_name.upper()
    if len(company_name) <= 6 and company_name.replace(".", "").isalpha():
        info = yf.Ticker(symbol).info
        if info and len(info) >= 5 and info.get("regularMarketPrice") is not None:
            return {"symbol": symbol, "info": info}

    # Otherwise resolve via search
    try:
        quotes = yf.Search(company_name, max_results=3).quotes
        if quotes:
            symbol = quotes[0].get("symbol", company_name.upper())
            info = yf.Ticker(symbol).info
            if info and len(info) >= 5:
                return {"symbol": symbol, "info": info}
    except Exception:
        pass

    return {}


async def financials_node(state: ResearchState) -> dict:
    session_id = state["session_id"]
    company_name = state["company_name"]
    company_type = state.get("company_type", "unknown")
    errors = list(state.get("errors", []))

    log.info("financials_node.start", session_id=session_id, company=company_name, type=company_type)

    # Public companies: try yfinance with a hard timeout
    if company_type == "public":
        try:
            loop = asyncio.get_event_loop()
            result = await asyncio.wait_for(
                loop.run_in_executor(None, _yfinance_fetch, company_name),
                timeout=YFINANCE_TIMEOUT,
            )
            if result:
                info = result["info"]
                symbol = result["symbol"]
                financials = {
                    "market_cap": _fmt_large(info.get("marketCap")),
                    "revenue": _fmt_large(info.get("totalRevenue")),
                    "employees": info.get("fullTimeEmployees"),
                    "sector": info.get("sector") or info.get("category"),
                    "headquarters": info.get("city"),
                    "description": info.get("longBusinessSummary"),
                    "pe_ratio": info.get("trailingPE"),
                    "symbol": symbol,
                    "source": "yfinance",
                }
                log.info("financials_node.yfinance_ok", session_id=session_id, symbol=symbol)
                return {"financials": financials, "status": "Financials enriched"}
        except asyncio.TimeoutError:
            log.warning("financials_node.yfinance_timeout", session_id=session_id)
        except Exception as exc:
            log.warning("financials_node.yfinance_failed", session_id=session_id, error=str(exc))

    # All company types: Firecrawl search for financial signals
    try:
        query = "revenue funding valuation employees headcount investors founded"
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
        financials["source"] = "web"
        log.info("financials_node.web_ok", session_id=session_id)
        return {"financials": financials, "status": "Financials enriched"}

    except Exception as exc:
        log.warning("financials_node.skipped", session_id=session_id, error=str(exc))
        errors.append(NodeError(node="enrich_financials", message=str(exc), recoverable=True))
        return {"financials": {}, "errors": errors, "status": "Financials unavailable"}


def _fmt_large(n):
    if n is None:
        return None
    try:
        n = int(n)
    except (TypeError, ValueError):
        return str(n)
    if n >= 1_000_000_000:
        return f"${n / 1_000_000_000:.1f}B"
    if n >= 1_000_000:
        return f"${n / 1_000_000:.0f}M"
    return f"${n:,}"
