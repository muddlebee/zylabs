import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

from firecrawl import V1FirecrawlApp, V1ScrapeOptions
from tenacity import retry, stop_after_attempt, wait_exponential

from app.config import get_firecrawl_api_key
from app.graph.state import Source

NEWS_DOMAINS = {
    "reuters.com", "bloomberg.com", "ft.com", "wsj.com", "techcrunch.com",
    "forbes.com", "businessinsider.com", "cnbc.com", "bbc.com", "theguardian.com",
    "nytimes.com", "economist.com", "wired.com", "venturebeat.com",
}


_fc_client: V1FirecrawlApp | None = None
_fc_client_key: str | None = None


def _get_client() -> V1FirecrawlApp:
    global _fc_client, _fc_client_key

    api_key = get_firecrawl_api_key()
    if _fc_client is None or _fc_client_key != api_key:
        _fc_client = V1FirecrawlApp(api_key=api_key)
        _fc_client_key = api_key
    return _fc_client


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
def search(
    query: str,
    company_name: str,
    company_url: str = "",
    *,
    limit: int = 5,
    snippet_limit: int = 600,
    scrape_results: bool = True,
    timeout_ms: int = 60000,
) -> list[Source]:
    """Search the web and return content per result as Source objects."""
    full_query = f"{company_name} {query}"
    kwargs: dict = {"limit": limit, "timeout": timeout_ms}
    if scrape_results:
        kwargs["scrape_options"] = V1ScrapeOptions(formats=["markdown"], only_main_content=True)
    result = _get_client().search(full_query, **kwargs)
    sources: list[Source] = []
    for r in result.data or []:
        url = r.get("url", "") if isinstance(r, dict) else (r.url or "")
        title = r.get("title", url) if isinstance(r, dict) else (r.title or url)
        markdown = r.get("markdown", "") if isinstance(r, dict) else (r.markdown or "")
        description = r.get("description", "") if isinstance(r, dict) else (r.description or "")
        if scrape_results:
            content = markdown if len(markdown) > 200 else (description or markdown)
        else:
            # Snippet-only search — much faster; use description + title.
            content = description or markdown or title
        sources.append(Source(
            id=str(uuid.uuid4()),
            url=url,
            title=title,
            snippet=content[:snippet_limit],
            tier=_assign_tier(url, company_url),
            retrieved_at=datetime.now(timezone.utc).isoformat(),
        ))
    return sources


@retry(stop=stop_after_attempt(2), wait=wait_exponential(min=1, max=5))
def scrape(url: str) -> str:
    """Scrape a single URL and return clean markdown content."""
    result = _get_client().scrape_url(
        url,
        formats=["markdown"],
        only_main_content=True,
        timeout=30000,
    )
    if isinstance(result, dict):
        return result.get("markdown", "")
    return result.markdown or ""
