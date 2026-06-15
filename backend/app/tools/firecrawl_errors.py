"""User-facing Firecrawl / web-retrieval error messages."""

from __future__ import annotations

import requests
from tenacity import RetryError


def root_exception(exc: BaseException) -> BaseException:
    if isinstance(exc, RetryError):
        last = getattr(exc, "last_attempt", None)
        if last is not None and getattr(last, "failed", False):
            inner = last.exception()
            if inner is not None:
                return root_exception(inner)
    cause = exc.__cause__
    if cause is not None and cause is not exc:
        return root_exception(cause)
    if isinstance(exc, RetryError) and exc.args:
        arg = exc.args[0]
        if isinstance(arg, BaseException):
            return root_exception(arg)
    return exc


def _http_status_message(status_code: int, detail: str = "") -> str:
    detail = detail.strip()
    suffix = f" ({detail})" if detail else ""
    messages = {
        401: "Firecrawl API key is invalid — check FIRECRAWL_API_KEY in backend/.env",
        402: "Firecrawl credits exhausted — add credits at firecrawl.dev or wait for your plan to reset",
        403: "Firecrawl access denied — verify your API key has search permissions",
        429: "Firecrawl rate limit reached — wait a minute and try again",
    }
    if status_code in messages:
        return messages[status_code]
    if status_code >= 500:
        return f"Firecrawl service error ({status_code}) — try again in a few minutes{suffix}"
    if status_code >= 400:
        return f"Firecrawl request failed ({status_code}){suffix}"
    return f"Firecrawl error ({status_code}){suffix}"


def _extract_http_detail(exc: requests.exceptions.HTTPError) -> str:
    resp = exc.response
    if resp is None:
        return str(exc).strip()
    try:
        body = resp.json()
        parts = [body.get("error"), body.get("details")]
        text = " — ".join(p for p in parts if p)
        if text:
            return text
    except Exception:
        pass
    text = str(exc).strip()
    if text and "RetryError" not in text:
        return text
    return ""


def friendly_firecrawl_error(exc: BaseException) -> str:
    """Turn RetryError/HTTPError/stack traces into a short user-facing message."""
    root = root_exception(exc)

    if isinstance(root, requests.exceptions.HTTPError):
        detail = _extract_http_detail(root)
        code = root.response.status_code if root.response is not None else 0
        return _http_status_message(code, detail)

    if isinstance(root, requests.exceptions.Timeout):
        return "Firecrawl request timed out — check your connection and try again"

    if isinstance(root, requests.exceptions.ConnectionError):
        return "Could not reach Firecrawl — check your network connection"

    text = str(root).strip()
    lower = text.lower()

    if not text or "retryerror" in lower or "future at 0x" in lower:
        return "Web search unavailable — Firecrawl could not complete the request"

    if any(h in lower for h in ("credit", "quota", "402", "payment required", "insufficient")):
        return "Firecrawl credits exhausted — add credits at firecrawl.dev"

    if "401" in lower or "unauthorized" in lower or "invalid api key" in lower:
        return "Firecrawl API key is invalid — check FIRECRAWL_API_KEY in backend/.env"

    if "429" in lower or "rate limit" in lower:
        return "Firecrawl rate limit reached — wait a minute and try again"

    if len(text) > 160:
        return "Web search unavailable — Firecrawl returned an error"
    return text
