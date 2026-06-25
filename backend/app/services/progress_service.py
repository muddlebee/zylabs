"""Reconstruct workflow stepper events from LangGraph checkpoint state."""

from __future__ import annotations

from typing import Any

from app.graph.retrieval import research_status

FACTUAL_SECTIONS = (
    "overview",
    "products_services",
    "target_customers",
    "business_signals",
    "risks_challenges",
)

STRATEGY_SECTIONS = ("discovery_questions", "outreach_strategy", "unknowns")


def _event(node: str, status: str, errors: list | None = None) -> dict[str, Any]:
    event: dict[str, Any] = {"node": node, "status": status}
    if errors:
        event["errors"] = errors
    return event


def _errors_for_node(values: dict[str, Any], node: str) -> list:
    return [e for e in values.get("errors") or [] if e.get("node") == node]


def events_from_checkpoint(values: dict[str, Any] | None) -> list[dict[str, Any]]:
    """Infer completed workflow nodes from persisted graph state."""
    if not values:
        return []

    events: list[dict[str, Any]] = []

    if values.get("research_plan"):
        plan_errors = _errors_for_node(values, "plan")
        if values.get("retrieval_unavailable"):
            status = values.get("status", "Web research unavailable")
            events.append(_event("plan", status, plan_errors or None))
        else:
            events.append(_event("plan", "Planning complete", plan_errors or None))

    if values.get("retrieval_unavailable"):
        if values.get("report"):
            events.append(_event("generate_report", "Stopped at planning"))
        return events

    financials = values.get("financials")
    fin_errors = _errors_for_node(values, "enrich_financials")
    if financials is not None or fin_errors:
        status = "Financials enriched" if financials else "Financials unavailable"
        events.append(_event("enrich_financials", status, fin_errors or None))

    research_errors = _errors_for_node(values, "research")
    if values.get("sources") or values.get("scraped") or research_errors:
        plan = values.get("research_plan") or []
        questions = [t["question"] for t in plan if isinstance(t, dict) and t.get("question")]
        status = research_status(
            questions=questions,
            prior_source_count=0,
            source_count=len(values.get("sources") or []),
            scraped=values.get("scraped") or {},
            research_errors=research_errors,
        )
        events.append(_event("research", status, research_errors or None))

    findings = values.get("findings") or {}
    factual_done = any(
        findings.get(section, {}).get("content")
        for section in FACTUAL_SECTIONS
    )
    synth_errors = _errors_for_node(values, "synthesize")
    if factual_done or synth_errors:
        status = values.get("status", "Synthesis complete")
        if "Synthesis" not in status and not factual_done:
            status = synth_errors[0]["message"] if synth_errors else "Synthesis skipped"
        events.append(_event("synthesize", status, synth_errors or None))

    if values.get("revisions", 0) > 0:
        score = values.get("quality_score", 0.0)
        events.append({
            "node": "quality_gate",
            "status": f"Quality check complete (score={score:.2f})",
        })

    strategy_errors = _errors_for_node(values, "strategize")
    if any(findings.get(section, {}).get("content") for section in STRATEGY_SECTIONS) or strategy_errors:
        status = "Strategy complete"
        if strategy_errors and not any(findings.get(section, {}).get("content") for section in STRATEGY_SECTIONS):
            status = strategy_errors[0]["message"]
        events.append(_event("strategize", status, strategy_errors or None))

    if values.get("report"):
        events.append(_event("generate_report", "Report ready"))

    return events
