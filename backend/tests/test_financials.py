"""Unit tests for financial enrichment — no live API calls."""
import asyncio
import json
from unittest.mock import AsyncMock, MagicMock, patch

from app.graph.financial_extract import (
    NON_PUBLIC_FINANCIAL_QUERY,
    PUBLIC_FINANCIAL_QUERY,
    financial_search_query,
    merge_financials,
)
from app.graph.nodes.financials import financials_node


def _source(url: str, title: str = "t", snippet: str = "revenue $1B market cap $10B CRWV") -> dict:
    return {
        "id": url,
        "url": url,
        "title": title,
        "snippet": snippet,
        "tier": 3,
        "retrieved_at": "2026-01-01T00:00:00+00:00",
    }


class TestFinancialSearchQuery:
    def test_public_query(self):
        assert financial_search_query("public") == PUBLIC_FINANCIAL_QUERY
        assert "revenue" in PUBLIC_FINANCIAL_QUERY

    def test_non_public_query(self):
        assert financial_search_query("private") == NON_PUBLIC_FINANCIAL_QUERY
        assert financial_search_query("startup") == NON_PUBLIC_FINANCIAL_QUERY
        assert "revenue" in NON_PUBLIC_FINANCIAL_QUERY
        assert "funding" in NON_PUBLIC_FINANCIAL_QUERY


class TestMergeFinancials:
    def test_fills_missing_keys_only(self):
        merged = merge_financials(
            {"revenue": "$1B", "source": "web"},
            {"revenue": "$2B", "funding_total": "$500M", "valuation": "$10B"},
        )
        assert merged["revenue"] == "$1B"
        assert merged["funding_total"] == "$500M"
        assert merged["valuation"] == "$10B"


class TestFinancialsNode:
    def test_uses_public_query_for_public_company(self):
        seen: dict = {}

        def fake_search(query, company_name, company_url, **kwargs):
            seen.update(kwargs)
            seen["query"] = query
            return [_source("https://example.com")]

        mock_llm = MagicMock()
        mock_llm.ainvoke = AsyncMock(return_value=MagicMock(content=json.dumps({
            "revenue": "$1B",
            "market_cap": "$10B",
            "symbol": "ACME",
        })))

        with patch("app.graph.nodes.financials.scrape_tool.search", side_effect=fake_search), \
             patch("app.graph.nodes.financials.extract_financials_from_text", new=AsyncMock(return_value={
                 "revenue": "$1B",
                 "market_cap": "$10B",
                 "symbol": "ACME",
             })):
            result = asyncio.run(financials_node({
                "session_id": "s1",
                "company_name": "Acme",
                "company_url": "",
                "company_type": "public",
                "errors": [],
            }))

        assert seen["query"] == PUBLIC_FINANCIAL_QUERY
        assert seen["scrape_results"] is False
        assert seen["limit"] == 5
        assert seen["timeout_ms"] == 15000
        assert result["financials"]["revenue"] == "$1B"
        assert result["financials"]["symbol"] == "ACME"

    def test_uses_non_public_query_for_private_company(self):
        seen: dict = {}

        def fake_search(query, company_name, company_url, **kwargs):
            seen["query"] = query
            return [_source("https://example.com", snippet="revenue $100M funding $500M")]

        with patch("app.graph.nodes.financials.scrape_tool.search", side_effect=fake_search), \
             patch("app.graph.nodes.financials.extract_financials_from_text", new=AsyncMock(return_value={
                 "revenue": "$100M",
                 "funding_total": "$500M",
             })):
            result = asyncio.run(financials_node({
                "session_id": "s1",
                "company_name": "StealthCo",
                "company_url": "",
                "company_type": "private",
                "errors": [],
            }))

        assert seen["query"] == NON_PUBLIC_FINANCIAL_QUERY
        assert result["financials"]["revenue"] == "$100M"
        assert result["financials"]["funding_total"] == "$500M"
