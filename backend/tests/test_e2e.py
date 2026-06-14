"""
End-to-end integration test — hits real Tavily + DeepSeek APIs.

Run with:  RUN_E2E=1 pytest tests/test_e2e.py -v -s
Skipped by default so the unit suite stays free/fast.
"""
import asyncio
import os
import pytest
import httpx
from httpx import ASGITransport

pytestmark = pytest.mark.skipif(
    os.environ.get("RUN_E2E") != "1",
    reason="Set RUN_E2E=1 to run integration tests",
)

TIMEOUT = 300  # seconds max for the full workflow


@pytest.fixture
async def client():
    from app.main import app
    async with httpx.AsyncClient(
        transport=ASGITransport(app=app),
        base_url="http://test",
        timeout=30,
    ) as c:
        yield c


async def _poll_until_done(client: httpx.AsyncClient, session_id: str) -> dict:
    """Poll session detail until status is completed or failed (or timeout)."""
    for _ in range(TIMEOUT // 5):
        r = await client.get(f"/sessions/{session_id}")
        data = r.json()
        status = data.get("status")
        print(f"  status: {status}")
        if status in ("completed", "failed"):
            return data
        await asyncio.sleep(5)
    raise TimeoutError(f"Workflow did not complete within {TIMEOUT}s")


class TestHealthz:
    async def test_healthz(self, client):
        r = await client.get("/healthz")
        assert r.status_code == 200
        assert r.json()["status"] == "ok"


class TestSessionCRUD:
    async def test_create_and_list_session(self, client):
        r = await client.post("/sessions", json={
            "company_name": "Test Co",
            "company_url": "https://example.com",
            "objective": "Test run",
        })
        assert r.status_code == 201
        session_id = r.json()["session_id"]
        assert session_id

        r = await client.get("/sessions")
        assert r.status_code == 200
        ids = [s["session_id"] for s in r.json()]
        assert session_id in ids

    async def test_get_session_detail(self, client):
        r = await client.post("/sessions", json={
            "company_name": "Detail Co",
            "company_url": "https://example.com",
            "objective": "Test",
        })
        session_id = r.json()["session_id"]

        r = await client.get(f"/sessions/{session_id}")
        assert r.status_code == 200
        data = r.json()
        assert data["company_name"] == "Detail Co"
        assert data["report"] is None  # not run yet

    async def test_get_nonexistent_session_returns_404(self, client):
        r = await client.get("/sessions/does-not-exist")
        assert r.status_code == 404


class TestFullWorkflow:
    async def test_stripe_research_end_to_end(self, client):
        # Create session
        r = await client.post("/sessions", json={
            "company_name": "Stripe",
            "company_url": "https://stripe.com",
            "objective": "Understand their developer tooling and identify partnership opportunities",
        })
        assert r.status_code == 201
        session_id = r.json()["session_id"]

        # Kick the run
        r = await client.post(f"/sessions/{session_id}/run")
        assert r.status_code == 200
        assert r.json()["status"] == "running"

        # Poll until done
        data = await _poll_until_done(client, session_id)

        assert data["status"] == "completed", f"Workflow failed: {data}"

        report = data["report"]
        assert report is not None, "Report should be persisted"

        sections = report["sections"]
        expected_sections = [
            "overview", "products_services", "target_customers",
            "business_signals", "risks_challenges",
            "discovery_questions", "outreach_strategy", "unknowns",
        ]
        for section in expected_sections:
            assert section in sections, f"Missing section: {section}"
            assert sections[section]["content"], f"Empty content for section: {section}"

        assert len(report["sources"]) > 0, "Should have at least one source"
        assert report["meta"]["quality_score"] > 0, "Quality score should be positive"

        print(f"\n  Quality score: {report['meta']['quality_score']:.2f}")
        print(f"  Sources: {len(report['sources'])}")
        print(f"  Revisions: {report['meta']['revisions']}")
        for s, f in sections.items():
            print(f"  [{s}] confidence={f['confidence']} | {f['content'][:80]}...")


class TestChat:
    async def test_chat_without_report_returns_message(self, client):
        r = await client.post("/sessions", json={
            "company_name": "Chat Test Co",
            "company_url": "https://example.com",
            "objective": "Test",
        })
        session_id = r.json()["session_id"]

        r = await client.post(f"/sessions/{session_id}/chat", json={"message": "Hello"})
        assert r.status_code == 200
        assert "No research report" in r.json()["content"]

    async def test_chat_history_empty_initially(self, client):
        r = await client.post("/sessions", json={
            "company_name": "History Co",
            "company_url": "https://example.com",
            "objective": "Test",
        })
        session_id = r.json()["session_id"]

        r = await client.get(f"/sessions/{session_id}/chat")
        assert r.status_code == 200
        assert r.json() == []
