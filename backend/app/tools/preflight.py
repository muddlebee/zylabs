"""Firecrawl readiness check — run once after planning before any searches."""

from __future__ import annotations

import structlog

from app.config import get_firecrawl_api_key
from app.tools.firecrawl_errors import friendly_firecrawl_error
from app.tools.scrape import _get_client

log = structlog.get_logger()

MIN_CREDITS = 1


def check_firecrawl_ready() -> tuple[bool, str]:
    """
    Verify Firecrawl is configured and can accept requests.
    Returns (ok, user_message). user_message is empty when ok=True.
    """
    api_key = get_firecrawl_api_key().strip()
    if not api_key:
        return False, "Firecrawl API key is missing — add FIRECRAWL_API_KEY to backend/.env"

    try:
        client = _get_client()
        usage = client.get_credit_usage()
        remaining = usage.data.remaining_credits
        log.info("firecrawl.preflight.credits", remaining=remaining)
        if remaining < MIN_CREDITS:
            return False, (
                f"Firecrawl credits exhausted ({remaining} remaining). "
                "Add credits at firecrawl.dev or wait for your plan to reset."
            )
    except Exception as exc:
        log.warning("firecrawl.preflight.credit_check_failed", error=str(exc))
        return False, friendly_firecrawl_error(exc)

    try:
        # One cheap probe — catches auth / account issues the credit API might miss.
        client.search("connectivity check", limit=1, timeout=15000)
    except Exception as exc:
        log.warning("firecrawl.preflight.probe_failed", error=str(exc))
        return False, friendly_firecrawl_error(exc)

    return True, ""
