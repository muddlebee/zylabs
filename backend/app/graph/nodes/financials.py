import structlog
from app.graph.state import ResearchState, NodeError

log = structlog.get_logger()


async def financials_node(state: ResearchState) -> dict:
    session_id = state["session_id"]
    company_name = state["company_name"]
    log.info("financials_node.start", session_id=session_id, company=company_name)

    errors = list(state.get("errors", []))
    try:
        import yfinance as yf
        ticker = yf.Ticker(company_name)
        info = ticker.info
        # yfinance returns an almost-empty dict for unknown tickers
        if not info or len(info) < 5:
            raise ValueError(f"No yfinance data found for '{company_name}'")
        financials = {
            "market_cap": info.get("marketCap"),
            "revenue": info.get("totalRevenue"),
            "employees": info.get("fullTimeEmployees"),
            "sector": info.get("sector"),
            "industry": info.get("industryDisp") or info.get("industry"),
            "description": info.get("longBusinessSummary"),
            "pe_ratio": info.get("trailingPE"),
            "symbol": info.get("symbol"),
        }
        log.info("financials_node.done", session_id=session_id, symbol=financials.get("symbol"))
        return {"financials": financials, "status": "Financials enriched"}
    except Exception as exc:
        log.warning("financials_node.skipped", session_id=session_id, error=str(exc))
        errors.append(NodeError(node="enrich_financials", message=str(exc), recoverable=True))
        return {"financials": {}, "errors": errors, "status": "Financials unavailable"}
