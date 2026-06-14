"""Shared financial extraction helpers — used by enrich_financials and synthesize merge."""

from __future__ import annotations

import json
from typing import Any

from app.llm import get_llm

FINANCIAL_RESULTS = 5
FINANCIAL_SNIPPET_LIMIT = 1500
FINANCIAL_LLM_CONTEXT = 5000
FINANCIAL_GATHER_TIMEOUT = 25

PUBLIC_FINANCIAL_QUERY = "revenue annual revenue earnings market cap stock price ticker employees"
NON_PUBLIC_FINANCIAL_QUERY = (
    "revenue annual revenue funding valuation investors funding round employees sector"
)

_COMMON_FIELDS = """\
  "revenue": "annual or estimated revenue e.g. '$2.5B' or '$50M' (use reported figures or credible estimates)",
  "employees": "headcount as integer or null",
  "founded_year": "year as integer or null",
  "headquarters": "city, country",
  "sector": "industry or sector e.g. 'AI / LLM APIs'",
  "description": "one sentence summary of what the company does\""""

_PUBLIC_FIELDS = """\
  "market_cap": "market cap e.g. '$35B'",
  "symbol": "stock ticker e.g. 'CRWV'\""""

_NON_PUBLIC_FIELDS = """\
  "funding_total": "total funding raised e.g. '$500M'",
  "valuation": "latest valuation e.g. '$10B'",
  "investors": ["lead investors or backers"],
  "latest_round": "most recent round e.g. 'Series D $200M'\""""


def is_public_company(company_type: str | None) -> bool:
    return (company_type or "unknown").lower() == "public"


def financial_search_query(company_type: str | None) -> str:
    if is_public_company(company_type):
        return PUBLIC_FINANCIAL_QUERY
    return NON_PUBLIC_FINANCIAL_QUERY


def build_extract_prompt(company: str, text: str, company_type: str | None) -> str:
    if is_public_company(company_type):
        fields = f"{_COMMON_FIELDS},\n{_PUBLIC_FIELDS}"
    else:
        fields = f"{_COMMON_FIELDS},\n{_NON_PUBLIC_FIELDS}"

    return f"""Extract financial and firmographic data from the text below about {company}.
Return ONLY valid JSON with these fields (use null for unknown):
{{
{fields}
}}

Text:
{text}"""


def parse_financials_response(raw: str) -> dict[str, Any]:
    content = raw.strip()
    if content.startswith("```"):
        content = content.split("```")[1]
        if content.startswith("json"):
            content = content[4:]
    return json.loads(content)


def clean_financials(financials: dict[str, Any]) -> dict[str, Any]:
    return {
        k: v for k, v in financials.items()
        if k != "source"
        and v is not None
        and v != ""
        and not (isinstance(v, list) and len(v) == 0)
    }


def merge_financials(
    existing: dict[str, Any] | None,
    incoming: dict[str, Any] | None,
) -> dict[str, Any]:
    """Fill gaps in existing financials; never overwrite populated fields."""
    merged = dict(existing or {})
    for key, value in clean_financials(incoming or {}).items():
        current = merged.get(key)
        if current is None or current == "" or (isinstance(current, list) and len(current) == 0):
            merged[key] = value
    if merged:
        merged["source"] = "web"
    return merged


def build_evidence_text(
    sources: list[dict[str, Any]],
    scraped: dict[str, str] | None = None,
    *,
    snippet_limit: int = FINANCIAL_SNIPPET_LIMIT,
    total_limit: int = FINANCIAL_LLM_CONTEXT,
) -> str:
    parts: list[str] = []
    for url, text in (scraped or {}).items():
        if text:
            parts.append(f"[SCRAPED: {url}]\n{text[:snippet_limit]}")

    for source in sources:
        snippet = source.get("snippet") or ""
        if snippet:
            title = source.get("title") or source.get("url") or "source"
            parts.append(f"[{title}]\n{snippet[:snippet_limit]}")

    combined = "\n\n".join(parts)
    return combined[:total_limit]


async def extract_financials_from_text(
    company_name: str,
    text: str,
    company_type: str | None,
) -> dict[str, Any]:
    if not text.strip():
        return {}

    llm = get_llm()
    prompt = build_extract_prompt(company_name, text, company_type)
    response = await llm.ainvoke([{"role": "user", "content": prompt}])
    financials = parse_financials_response(response.content)
    return clean_financials(financials)
