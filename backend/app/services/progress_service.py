"""Reconstruct workflow stepper events from LangGraph checkpoint state."""

from __future__ import annotations

from typing import Any

WORKFLOW_NODES = (
    "plan",
    "enrich_financials",
    "research",
    "synthesize",
    "quality_gate",
    "strategize",
    "generate_report",
)

FACTUAL_SECTIONS = (
    "overview",
    "products_services",
    "target_customers",
    "business_signals",
    "risks_challenges",
)

STRATEGY_SECTIONS = ("discovery_questions", "outreach_strategy", "unknowns")


def events_from_checkpoint(values: dict[str, Any] | None) -> list[dict[str, str]]:
    """Infer completed workflow nodes from persisted graph state."""
    if not values:
        return []

    events: list[dict[str, str]] = []

    if values.get("research_plan"):
        events.append({"node": "plan", "status": "Planning complete"})

    financials = values.get("financials")
    fin_errors = [
        e for e in values.get("errors") or []
        if e.get("node") == "enrich_financials"
    ]
    if financials is not None or fin_errors:
        status = "Financials enriched" if financials else "Financials unavailable"
        events.append({"node": "enrich_financials", "status": status})

    if values.get("sources") or values.get("scraped"):
        events.append({"node": "research", "status": "Research complete"})

    findings = values.get("findings") or {}
    factual_done = any(
        findings.get(section, {}).get("content")
        for section in FACTUAL_SECTIONS
    )
    synth_errors = [e for e in values.get("errors") or [] if e.get("node") == "synthesize"]
    if factual_done or synth_errors:
        status = values.get("status", "Synthesis complete")
        if "Synthesis" not in status:
            status = "Synthesis complete"
        events.append({"node": "synthesize", "status": status})

    if values.get("revisions", 0) > 0:
        score = values.get("quality_score", 0.0)
        events.append({
            "node": "quality_gate",
            "status": f"Quality check complete (score={score:.2f})",
        })

    if any(findings.get(section, {}).get("content") for section in STRATEGY_SECTIONS):
        events.append({"node": "strategize", "status": "Strategy complete"})

    if values.get("report"):
        events.append({"node": "generate_report", "status": "Report ready"})

    return events
