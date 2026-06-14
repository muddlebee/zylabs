from typing import TypedDict, Literal, Optional


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
    errors: list[NodeError]
    status: str
