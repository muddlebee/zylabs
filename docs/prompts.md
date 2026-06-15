# LLM Prompts

There is **no single system prompt** for the research workflow. Each LLM-calling step owns its
own instructions in code. All workflow nodes share the same model via `get_llm()` (see
[`architecture.md`](architecture.md#llm-configuration)); only the prompt text differs.

---

## Inventory

| Step | File | Message shape |
|---|---|---|
| `plan` | `backend/app/graph/nodes/plan.py` | system + user |
| `enrich_financials` | `backend/app/graph/financial_extract.py` | user only |
| `synthesize` | `backend/app/graph/nodes/synthesize.py` | system + user |
| `strategize` | `backend/app/graph/nodes/strategize.py` | system + user |
| Follow-up chat | `backend/app/services/chat_service.py` | system (templated) + history + user |

Workflow nodes use `temperature=0` and expect **JSON-only** responses (markdown fences are
stripped before parsing). Chat uses the same model but is not part of the LangGraph.

---

## Workflow nodes

### `plan`

**System** (`SYSTEM_PROMPT`):

```
You are a research planning assistant. Given a company and a meeting objective,
decompose the research into 5-8 specific sub-questions that cover these sections:
overview, products_services, target_customers, business_signals, risks_challenges.

Also classify the company type as: public, private, startup, or unknown.
Use "public" for companies listed on a major stock exchange (e.g. CoreWeave/CRWV, Apple/AAPL).

Respond with JSON only, no markdown:
{
  "company_type": "public|private|startup|unknown",
  "research_plan": [
    {"question": "...", "section": "overview|products_services|target_customers|business_signals|risks_challenges"},
    ...
  ]
}
```

**User:** company name, URL, meeting objective.

---

### `enrich_financials`

No system message. `build_extract_prompt()` sends a single user message asking for structured
JSON firmographics. Field list varies by `company_type` (public companies get `market_cap` /
`symbol`; private/startup get funding fields).

**User** (template):

```
Extract financial and firmographic data from the text below about {company}.
Return ONLY valid JSON with these fields (use null for unknown):
{ ... field schema ... }

Text:
{search snippets}
```

Also used by `synthesize` when merging financials from accumulated evidence.

---

### `synthesize`

**System** (`SYSTEM_PROMPT`):

```
You are a research analyst synthesizing evidence into a structured company briefing.
Given sources and scraped website content, write grounded findings for each section.
Every finding MUST cite source IDs from the provided sources list.

Respond with JSON only, no markdown:
{
  "findings": {
    "overview": {
      "content": "...",
      "source_ids": ["<id1>", "<id2>"],
      "confidence": 0.0-1.0
    },
    "products_services": { ... },
    "target_customers": { ... },
    "business_signals": { ... },
    "risks_challenges": { ... }
  }
}

Confidence guide: 0.9 = multiple tier-1/2 sources; 0.7 = some tier-2; 0.5 = tier-3 only; 0.3 = inferred.
```

**User:** company name, objective, and an evidence block built from scraped homepage text,
financials JSON, and numbered sources (id, tier, title, URL, snippet).

---

### `strategize`

**System** (`SYSTEM_PROMPT`):

```
You are a strategic sales advisor. Given research findings about a company,
produce three strategic outputs to help a salesperson prepare for a meeting.

Respond with JSON only, no markdown:
{
  "discovery_questions": {
    "content": "5-7 sharp discovery questions the salesperson should ask, formatted as a numbered list",
    "source_ids": [],
    "confidence": 0.8
  },
  "outreach_strategy": {
    "content": "Personalized outreach strategy: the right angle, tone, and value prop based on the company's situation",
    "source_ids": [],
    "confidence": 0.8
  },
  "unknowns": {
    "content": "Key unknowns that remain after research — information gaps the salesperson should probe for",
    "source_ids": [],
    "confidence": 1.0
  }
}
```

**User:** company name, meeting objective, formatted findings from prior sections, and known gaps
from `quality_gate`.

---

## Follow-up chat

Separate from the graph. The system message is built at request time from the persisted report
and sources (`SYSTEM_TEMPLATE` in `chat_service.py`):

```
You are a research assistant helping a salesperson prepare for a meeting.
Answer questions based ONLY on the provided research report and sources.
If the answer is not in the report, say so clearly — do not fabricate.

Research Report:
{report}

Sources:
{sources}
```

The last 10 chat turns are appended before the new user message.

---

## Editing prompts

- Change persona or output schema in the node's `SYSTEM_PROMPT` (or `build_extract_prompt` /
  `SYSTEM_TEMPLATE` for the exceptions above).
- There is no shared base prompt today — if you want consistent voice across nodes, extract a
  common prefix and prepend it in each caller.
- After prompt changes, run a full session and check JSON parsing still succeeds; all workflow
  nodes assume valid JSON in the model reply.
