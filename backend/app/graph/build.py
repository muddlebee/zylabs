from langgraph.graph import StateGraph, END
from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver

from app.graph.state import ResearchState
from app.graph.routing import after_plan, after_quality_gate
from app.graph.nodes.plan import plan_node
from app.graph.nodes.research import research_dispatcher
from app.graph.nodes.research_worker import research_worker
from app.graph.nodes.financials import financials_node
from app.graph.nodes.synthesize import synthesize_node
from app.graph.nodes.quality import quality_gate_node
from app.graph.nodes.strategize import strategize_node
from app.graph.nodes.report import report_node


def build_graph(checkpointer):
    builder = StateGraph(ResearchState)

    builder.add_node("plan", plan_node)
    builder.add_node("enrich_financials", financials_node)
    builder.add_node("research_dispatcher", research_dispatcher)
    builder.add_node("research_worker", research_worker)
    builder.add_node("synthesize", synthesize_node)
    builder.add_node("quality_gate", quality_gate_node)
    builder.add_node("strategize", strategize_node)
    builder.add_node("generate_report", report_node)

    builder.set_entry_point("plan")

    # plan → financials (public) or dispatcher (all others)
    builder.add_conditional_edges(
        "plan",
        after_plan,
        {"enrich_financials": "enrich_financials", "research_dispatcher": "research_dispatcher"},
    )
    builder.add_edge("enrich_financials", "research_dispatcher")

    # dispatcher returns Command(goto=[Send(...)]) — LangGraph handles fan-out automatically
    # all workers converge on synthesize
    builder.add_edge("research_worker", "synthesize")

    builder.add_edge("synthesize", "quality_gate")
    builder.add_conditional_edges(
        "quality_gate",
        after_quality_gate,
        {"research_dispatcher": "research_dispatcher", "strategize": "strategize"},
    )
    builder.add_edge("strategize", "generate_report")
    builder.add_edge("generate_report", END)

    return builder.compile(checkpointer=checkpointer)


# Module-level graph instance — initialized in main.py lifespan with the async checkpointer
graph = None
checkpointer: AsyncSqliteSaver = None
