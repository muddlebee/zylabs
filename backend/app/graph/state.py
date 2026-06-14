from typing import TypedDict, Literal, Optional, Annotated


def _merge_errors(left: list, right: list) -> list:
    """Concurrency-safe error merge for parallel branches; dedupes on (node, message)."""
    merged = list(left or [])
    seen = {(e["node"], e["message"]) for e in merged}
    for e in right or []:
        key = (e["node"], e["message"])
        if key not in seen:
            seen.add(key)
            merged.append(e)
    return merged


def _take_last(left, right):
    """Last-writer-wins for the human-facing status string under parallel writes."""
    return right if right is not None else left


class Source(TypedDict):
    id: str
    url: str
    title: str
    snippet: str
    tier: int
    retrieved_at: str


class ResearchTask(TypedDict):
    id: str
    question: str
    section: str
    done: bool


class SectionFinding(TypedDict):
    section: str
    content: str
    source_ids: list[str]
    confidence: float


class NodeError(TypedDict):
    node: str
    message: str
    recoverable: bool


class ResearchState(TypedDict):
    session_id: str
    company_name: str
    company_url: str
    objective: str

    research_plan: list[ResearchTask]
    company_type: Literal["public", "private", "startup", "unknown"]

    sources: list[Source]
    scraped: dict[str, str]
    financials: Optional[dict]

    findings: dict[str, SectionFinding]
    confidence: dict[str, float]

    quality_score: float
    gaps: list[str]
    revisions: int

    report: Optional[dict]
    errors: Annotated[list[NodeError], _merge_errors]
    status: Annotated[str, _take_last]
