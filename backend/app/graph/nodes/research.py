import asyncio

import structlog
from app.graph.retrieval import research_status
from app.graph.state import ResearchState, NodeError
from app.tools import scrape as scrape_tool
from app.tools.firecrawl_errors import friendly_firecrawl_error

log = structlog.get_logger()


async def research_node(state: ResearchState) -> dict:
    session_id = state["session_id"]
    log.info("research_node.start", session_id=session_id)

    if state.get("retrieval_unavailable"):
        return {"status": "Research skipped — web search unavailable"}

    sources = list(state.get("sources", []))
    prior_source_count = len(sources)
    scraped = dict(state.get("scraped", {}))
    errors = list(state.get("errors", []))
    errors_before = len(errors)
    research_plan = [dict(t) for t in state.get("research_plan", [])]

    gaps = state.get("gaps", [])
    if gaps:
        questions_to_run = gaps
        log.info("research_node.re_research", session_id=session_id, gaps=len(gaps))
    else:
        questions_to_run = [t["question"] for t in research_plan if not t["done"]]

    company_url = state["company_url"]
    company_name = state["company_name"]
    loop = asyncio.get_event_loop()
    search_error_msg: str | None = None

    # Firecrawl SDK is sync — run_in_executor offloads blocking HTTP to the default
    # thread pool so the event loop can serve other requests while searches run.
    async def _scrape_company() -> None:
        # Only full-page scrape (synthesize reads scraped[url][:3000]).
        if not company_url or company_url in scraped:
            return
        try:
            text = await loop.run_in_executor(None, scrape_tool.scrape, company_url)
            scraped[company_url] = text
            log.info("research_node.scraped", session_id=session_id, url=company_url, chars=len(text))
        except Exception as exc:
            log.warning("research_node.scrape_failed", session_id=session_id, error=str(exc))
            nonlocal search_error_msg
            msg = friendly_firecrawl_error(exc)
            if search_error_msg is None:
                search_error_msg = msg
                errors.append(NodeError(node="research", message=msg, recoverable=True))
            scraped[company_url] = ""

    async def _search(question: str) -> list:
        nonlocal search_error_msg
        try:
            return await loop.run_in_executor(
                None,
                lambda: scrape_tool.search(
                    question, company_name, company_url, scrape_results=False,
                ),
            )
        except Exception as exc:
            log.warning("research_node.search_failed", session_id=session_id,
                        question=question, error=str(exc))
            msg = friendly_firecrawl_error(exc)
            if search_error_msg is None:
                search_error_msg = msg
                errors.append(NodeError(node="research", message=msg, recoverable=True))
            return []

    # gather: start all scrape + searches together; wall time ≈ slowest call, not sum.
    # Concurrent on one loop (interleaved awaits), but executor threads run I/O in parallel.
    results = await asyncio.gather(
        _scrape_company(),
        *[_search(q) for q in questions_to_run],
    )

    existing_urls = {s["url"] for s in sources}
    for result_list in results[1:]:  # results[0] is the company-URL scrape (None)
        for r in result_list:
            if r["url"] not in existing_urls:
                sources.append(r)
                existing_urls.add(r["url"])

    # Mark tasks done
    for task in research_plan:
        if not task["done"] and (not gaps or task["question"] in gaps):
            task["done"] = True

    research_errors = errors[errors_before:]
    if questions_to_run and not research_errors:
        new_sources = len(sources) - prior_source_count
        has_scraped = any(text for text in scraped.values())
        if new_sources == 0 and not has_scraped:
            errors.append(NodeError(
                node="research",
                message="All web searches returned no results",
                recoverable=True,
            ))
            research_errors = errors[errors_before:]

    status = research_status(
        questions=questions_to_run,
        prior_source_count=prior_source_count,
        source_count=len(sources),
        scraped=scraped,
        research_errors=research_errors,
    )
    log.info("research_node.done", session_id=session_id, sources=len(sources), status=status)
    return {
        "sources": sources,
        "scraped": scraped,
        "research_plan": research_plan,
        "errors": errors,
        "status": status,
    }
