import uuid
from datetime import datetime, timezone
from functools import lru_cache
from urllib.parse import urlparse

from firecrawl import V1FirecrawlApp, V1ScrapeOptions
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import settings
from app.graph.state import Source

NEWS_DOMAINS = {
    "reuters.com", "bloomberg.com", "ft.com", "wsj.com", "techcrunch.com",
    "forbes.com", "businessinsider.com", "cnbc.com", "bbc.com", "theguardian.com",
    "nytimes.com", "economist.com", "wired.com", "venturebeat.com",
}


@lru_cache(maxsize=1)
def _client() -> V1FirecrawlApp:
    return V1FirecrawlApp(api_key=settings.firecrawl_api_key)


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


@retry(stop=stop_after_attempt(3), wait=wait_exponential(min=1, max=10))
def search(query: str, company_name: str, company_url: str = "") -> list[Source]:
    """Search the web and return full-page content per result as Source objects."""
    full_query = f"{company_name} {query}"
    result = _client().search(
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
        # Prefer markdown content; fall back to description snippet if markdown is empty/blocked
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
def scrape(url: str) -> str:
    """Scrape a single URL and return clean markdown content."""
    result = _client().scrape_url(
        url,
        formats=["markdown"],
        only_main_content=True,
        timeout=30000,
    )
    if isinstance(result, dict):
        return result.get("markdown", "")
    return result.markdown or ""
