#!/usr/bin/env python3
"""Seed a completed session with fixture report for Playwright E2E tests."""

from __future__ import annotations

import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

# Ensure backend root is on sys.path when invoked from repo root.
BACKEND_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND_ROOT))

from app.db import init_db, SessionLocal  # noqa: E402
from app.services import session_service  # noqa: E402

ALL_SECTIONS = [
    "overview",
    "products_services",
    "target_customers",
    "business_signals",
    "risks_challenges",
    "discovery_questions",
    "outreach_strategy",
    "unknowns",
]


def _finding(section: str) -> dict:
    label = section.replace("_", " ").title()
    return {
        "section": section,
        "content": (
            f"{label} fixture content for Playwright E2E. "
            "This paragraph is long enough to satisfy prose length checks in the test suite."
        ),
        "source_ids": ["s1"],
        "confidence": 0.85,
    }


def main() -> None:
    if os.environ.get("ALLOW_TEST_SEED") != "1":
        print("Refusing to seed: set ALLOW_TEST_SEED=1", file=sys.stderr)
        sys.exit(1)

    output_path = Path(sys.argv[1]) if len(sys.argv) > 1 else None

    init_db()
    db = SessionLocal()
    try:
        session = session_service.create_session(
            db,
            company_name="Notion",
            company_url="https://notion.so",
            objective="Understand their product-led growth motion ahead of an enterprise expansion call",
        )
        session_service.update_session_status(db, session.id, "completed")

        now = datetime.now(timezone.utc).isoformat()
        report = {
            "session_id": session.id,
            "company_name": "Notion",
            "generated_at": now,
            "sections": {section: _finding(section) for section in ALL_SECTIONS},
            "sources": [
                {
                    "id": "s1",
                    "url": "https://example.com/notion",
                    "title": "Notion Official Site",
                    "snippet": "Collaborative workspace platform.",
                    "tier": 1,
                    "retrieved_at": now,
                },
                {
                    "id": "s2",
                    "url": "https://news.example.com/notion",
                    "title": "Notion in the News",
                    "snippet": "Recent coverage of Notion growth.",
                    "tier": 2,
                    "retrieved_at": now,
                },
            ],
            "financials": {"employees": "500+", "founded_year": "2016"},
            "meta": {
                "quality_score": 0.82,
                "revisions": 0,
                "company_type": "private",
                "errors": [],
            },
        }
        session_service.save_report(db, session.id, report)

        payload = {"sessionId": session.id}
        if output_path:
            output_path.write_text(json.dumps(payload), encoding="utf-8")
        else:
            print(json.dumps(payload))
    finally:
        db.close()


if __name__ == "__main__":
    main()
