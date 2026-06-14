import asyncio

import structlog
from app.graph.state import ResearchState, NodeError
from app.tools import scrape as scrape_tool

log = structlog.get_logger()


async def research_node(state: ResearchState) -> dict:
    session_id = state["session_id"]
    log.info("research_node.start", session_id=session_id)

    sources = list(state.get("sources", []))
    scraped = dict(state.get("scraped", {}))
    errors = list(state.get("errors", []))
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

    # Scrape the company URL once — the only page we keep in full (synthesize reads
    # it at [:3000]). Runs concurrently with the searches below.
    async def _scrape_company() -> None:
        if not company_url or company_url in scraped:
            return
        try:
            text = await loop.run_in_executor(None, scrape_tool.scrape, company_url)
            scraped[company_url] = text
            log.info("research_node.scraped", session_id=session_id, url=company_url, chars=len(text))
        except Exception as exc:
            log.warning("research_node.scrape_failed", session_id=session_id, error=str(exc))
            errors.append(NodeError(node="research", message=f"Scrape failed: {exc}", recoverable=True))
            scraped[company_url] = ""

    # Snippet-only search per question, fanned out concurrently. Downstream only ever
    # reads Source.snippet, so full-page scrapes here were paid-for-and-discarded
    # Firecrawl credits — we now take the search description and skip the scrape.
    async def _search(question: str) -> list:
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
            errors.append(NodeError(node="research", message=f"Search failed for '{question}': {exc}", recoverable=True))
            return []

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

    log.info("research_node.done", session_id=session_id, sources=len(sources))
    return {
        "sources": sources,
        "scraped": scraped,
        "research_plan": research_plan,
        "errors": errors,
        "status": "Research complete",
    }
