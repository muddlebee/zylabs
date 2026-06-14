import operator
from typing import Annotated, TypedDict, Literal, Optional


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


def _merge_scraped(a: dict, b: dict) -> dict:
    return {**a, **b}


class ResearchState(TypedDict):
    session_id: str
    company_name: str
    company_url: str
    objective: str

    research_plan: list[ResearchTask]
    company_type: Literal["public", "private", "startup", "unknown"]

    # Annotated with reducers so parallel research_worker outputs auto-merge
    sources: Annotated[list[Source], operator.add]
    scraped: Annotated[dict[str, str], _merge_scraped]
    financials: Optional[dict]

    findings: dict[str, SectionFinding]
    confidence: dict[str, float]

    quality_score: float
    gaps: list[str]
    revisions: int

    report: Optional[dict]
    errors: Annotated[list[NodeError], operator.add]
    status: str

    # Populated per-worker during parallel fan-out; not used outside research phase
    current_task: Optional[ResearchTask]
