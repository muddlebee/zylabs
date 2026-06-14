import uuid
import structlog
from datetime import datetime, timezone
from functools import lru_cache
from urllib.parse import urlparse

import requests
from firecrawl import V1FirecrawlApp, V1ScrapeOptions
from tavily import TavilyClient
from tenacity import retry, stop_after_attempt, wait_exponential, retry_if_not_exception_type

from app.config import settings
from app.graph.state import Source

log = structlog.get_logger()

NEWS_DOMAINS = {
    "reuters.com", "bloomberg.com", "ft.com", "wsj.com", "techcrunch.com",
    "forbes.com", "businessinsider.com", "cnbc.com", "bbc.com", "theguardian.com",
    "nytimes.com", "economist.com", "wired.com", "venturebeat.com",
}


@lru_cache(maxsize=1)
def _firecrawl() -> V1FirecrawlApp:
    return V1FirecrawlApp(api_key=settings.firecrawl_api_key)


@lru_cache(maxsize=1)
def _tavily() -> TavilyClient:
    return TavilyClient(api_key=settings.tavily_api_key)


def _assign_tier(result_url: str, company_url: str) -> int:
    try:
        result_domain = urlparse(result_url).netloc.lstrip("www.")
        company_domain = urlparse(company_url).netloc.lstrip("www.")
        if result_domain and result_domain == company_domain:
            return 1
        if any(nd in result_domain for nd in NEWS_DOMAINS):
            return 2
    except Exception:
        pass
    return 3


def _firecrawl_search(full_query: str, company_url: str) -> list[Source]:
    """Firecrawl search — raises on any error (no retry for 402)."""
    result = _firecrawl().search(
        full_query,
        limit=5,
        scrape_options=V1ScrapeOptions(formats=["markdown"], only_main_content=True),
        timeout=60000,
    )
    sources: list[Source] = []
    for r in result.data or []:
        url = r.get("url", "") if isinstance(r, dict) else (r.url or "")
        title = r.get("title", url) if isinstance(r, dict) else (r.title or url)
        markdown = r.get("markdown", "") if isinstance(r, dict) else (r.markdown or "")
        description = r.get("description", "") if isinstance(r, dict) else (r.description or "")
        content = markdown if len(markdown) > 200 else (description or markdown)
        sources.append(Source(
            id=str(uuid.uuid4()),
            url=url,
            title=title,
            snippet=content[:600],
            tier=_assign_tier(url, company_url),
            retrieved_at=datetime.now(timezone.utc).isoformat(),
        ))
    return sources


@retry(stop=stop_after_attempt(2), wait=wait_exponential(min=1, max=5))
def _tavily_search(full_query: str, company_url: str) -> list[Source]:
    """Tavily search fallback — snippet-only but reliable."""
    result = _tavily().search(full_query, max_results=5)
    sources: list[Source] = []
    for r in result.get("results", []):
        url = r.get("url", "")
        title = r.get("title", url)
        content = r.get("content", "")
        sources.append(Source(
            id=str(uuid.uuid4()),
            url=url,
            title=title,
            snippet=content[:600],
            tier=_assign_tier(url, company_url),
            retrieved_at=datetime.now(timezone.utc).isoformat(),
        ))
    return sources


def search(query: str, company_name: str, company_url: str = "") -> list[Source]:
    """Search the web. Tries Firecrawl first (rich markdown), falls back to Tavily."""
    full_query = f"{company_name} {query}"
    try:
        return _firecrawl_search(full_query, company_url)
    except requests.exceptions.HTTPError as exc:
        if exc.response is not None and exc.response.status_code == 402:
            log.warning("scrape.firecrawl_no_credits_fallback_tavily")
        else:
            log.warning("scrape.firecrawl_http_error_fallback_tavily", status=getattr(exc.response, 'status_code', None))
    except Exception as exc:
        log.warning("scrape.firecrawl_error_fallback_tavily", error=str(exc)[:100])

    return _tavily_search(full_query, company_url)


@retry(stop=stop_after_attempt(2), wait=wait_exponential(min=1, max=5),
       retry=retry_if_not_exception_type(requests.exceptions.HTTPError))
def scrape(url: str) -> str:
    """Scrape a single URL and return clean markdown content."""
    result = _firecrawl().scrape_url(
        url,
        formats=["markdown"],
        only_main_content=True,
        timeout=30000,
    )
    if isinstance(result, dict):
        return result.get("markdown", "")
    return result.markdown or ""
