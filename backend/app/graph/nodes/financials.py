import asyncio
import time

import structlog

from app.graph.financial_extract import (
    FINANCIAL_GATHER_TIMEOUT,
    FINANCIAL_RESULTS,
    FINANCIAL_SNIPPET_LIMIT,
    build_evidence_text,
    extract_financials_from_text,
    financial_search_query,
    merge_financials,
)
from app.graph.state import ResearchState, NodeError
from app.tools import scrape as scrape_tool
from app.tools.firecrawl_errors import friendly_firecrawl_error

log = structlog.get_logger()


async def financials_node(state: ResearchState) -> dict:
    session_id = state["session_id"]
    company_name = state["company_name"]
    company_url = state.get("company_url", "")
    company_type = state.get("company_type", "unknown")
    errors = list(state.get("errors", []))

    if state.get("retrieval_unavailable"):
        return {"status": "Financials skipped — web search unavailable"}

    log.info(
        "financials_node.start",
        session_id=session_id,
        company=company_name,
        company_type=company_type,
    )
    t0 = time.monotonic()

    try:
        query = financial_search_query(company_type)
        loop = asyncio.get_event_loop()
        sources = await asyncio.wait_for(
            loop.run_in_executor(
                None,
                lambda: scrape_tool.search(
                    query,
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
        combined_text = build_evidence_text(sources)
        if not combined_text.strip():
            raise ValueError("No financial content found via search")

        financials = await extract_financials_from_text(
            company_name,
            combined_text,
            company_type,
        )
        if not financials:
            raise ValueError("No financial fields extracted from search results")

        financials = merge_financials({}, financials)
        elapsed = round(time.monotonic() - t0, 1)
        log.info(
            "financials_node.web_ok",
            session_id=session_id,
            company_type=company_type,
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
        errors.append(NodeError(
            node="enrich_financials",
            message=friendly_firecrawl_error(exc),
            recoverable=True,
        ))
        return {"financials": {}, "errors": errors, "status": "Financials unavailable"}
