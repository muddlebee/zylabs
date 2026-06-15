from app.services.progress_service import events_from_checkpoint


def test_empty_checkpoint():
    assert events_from_checkpoint(None) == []
    assert events_from_checkpoint({}) == []


def test_plan_only():
    events = events_from_checkpoint({"research_plan": [{"id": "1", "question": "q"}]})
    assert [e["node"] for e in events] == ["plan"]


def test_through_synthesis():
    values = {
        "research_plan": [{"id": "1"}],
        "financials": {"revenue": "$1M"},
        "sources": [{"id": "s1"}],
        "findings": {"overview": {"content": "Acme builds widgets"}},
        "revisions": 0,
    }
    events = events_from_checkpoint(values)
    assert [e["node"] for e in events] == [
        "plan", "enrich_financials", "research", "synthesize",
    ]


def test_completed_workflow():
    values = {
        "research_plan": [{"id": "1"}],
        "financials": {},
        "sources": [{"id": "s1"}],
        "findings": {
            "overview": {"content": "x"},
            "discovery_questions": {"content": "q1"},
        },
        "revisions": 1,
        "quality_score": 0.82,
        "report": {"session_id": "abc"},
    }
    events = events_from_checkpoint(values)
    assert [e["node"] for e in events] == [
        "plan",
        "enrich_financials",
        "research",
        "synthesize",
        "quality_gate",
        "strategize",
        "generate_report",
    ]
