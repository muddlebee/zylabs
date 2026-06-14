import asyncio
import structlog
from langchain_core.tools import tool
from langchain_core.messages import SystemMessage, HumanMessage
from langgraph.prebuilt import create_react_agent

from app.graph.state import ResearchState, NodeError
from app.tools import scrape as scrape_tool
from app.llm import get_llm

log = structlog.get_logger()

MAX_TOOL_STEPS = 3


async def research_worker(state: ResearchState) -> dict:
    """ReAct agent that researches one task using web_search and scrape_page tools."""
    task = state["current_task"]
    session_id = state["session_id"]
    company_name = state["company_name"]
    company_url = state.get("company_url", "")

    log.info("research_worker.start", session_id=session_id, question=task["question"][:80])

    collected_sources = []
    collected_scraped = {}
    errors = []

    # ── Tools ────────────────────────────────────────────────────────────────

    @tool
    async def web_search(query: str) -> str:
        """Search the web for information about the company. Use for any factual question."""
        try:
            results = await asyncio.get_event_loop().run_in_executor(
                None, lambda: scrape_tool.search(query, company_name, company_url)
            )
            collected_sources.extend(results)
            if not results:
                return "No results found."
            return "\n\n".join(
                f"[{s['title']}]\nURL: {s['url']}\n{s['snippet']}" for s in results
            )
        except Exception as exc:
            return f"Search failed: {exc}"

    @tool
    async def scrape_page(url: str) -> str:
        """Fetch and read the full content of a specific webpage. Use when you have a direct URL."""
        if url in collected_scraped:
            return collected_scraped[url][:3000]
        try:
            text = await asyncio.get_event_loop().run_in_executor(
                None, lambda: scrape_tool.scrape(url)
            )
            collected_scraped[url] = text
            return text[:3000] or "No content found."
        except Exception as exc:
            return f"Scrape failed: {exc}"

    # ── Agent ────────────────────────────────────────────────────────────────

    system = (
        f"You are a B2B sales research analyst investigating {company_name}. "
        f"Use your tools to answer the research question thoroughly. "
        f"Stop once you have enough evidence — do not make unnecessary tool calls."
    )

    agent = create_react_agent(get_llm(), [web_search, scrape_page])

    try:
        await agent.ainvoke({
            "messages": [
                SystemMessage(content=system),
                HumanMessage(content=f"Research question: {task['question']}"),
            ]
        })
    except Exception as exc:
        log.warning("research_worker.agent_error", session_id=session_id, error=str(exc))
        errors.append(NodeError(node="research_worker", message=str(exc), recoverable=True))

    # Also scrape the company homepage once (first worker that hasn't seen it will do it)
    if company_url and company_url not in collected_scraped:
        try:
            text = await asyncio.get_event_loop().run_in_executor(
                None, lambda: scrape_tool.scrape(company_url)
            )
            collected_scraped[company_url] = text
        except Exception:
            pass

    log.info("research_worker.done", session_id=session_id,
             question=task["question"][:60], sources=len(collected_sources))

    return {
        "sources": collected_sources,
        "scraped": collected_scraped,
        "errors": errors,
        "status": f"Researched: {task['question'][:60]}",
    }
