import requests
from tenacity import RetryError, stop_after_attempt, wait_none, retry

from app.tools.firecrawl_errors import friendly_firecrawl_error


def test_friendly_unwraps_retry_error():
    resp = requests.Response()
    resp.status_code = 402
    http_err = requests.exceptions.HTTPError(
        "402 Payment Required: Insufficient credits", response=resp,
    )
    retry_err = RetryError(http_err)
    msg = friendly_firecrawl_error(retry_err)
    assert "credit" in msg.lower()
    assert "RetryError" not in msg
    assert "0x" not in msg


def test_friendly_missing_key_style_message():
    msg = friendly_firecrawl_error(Exception("401 Unauthorized"))
    assert "api key" in msg.lower() or "401" in msg
