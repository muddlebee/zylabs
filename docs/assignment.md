##### FULL STACK AI ENGINEER ASSIGNMENT

# Build a Production-Grade

# AI Research Copilot using LangGraph

#### “Your sellers run the conversation. We do everything else.”

#### Required Stack

```
Frontend ReactJS
Backend Python + FastAPI
AI Workflow LangGraph (Mandatory)
Time Limit 3 Days
```
_Prepared by Zylabs • zylabs.ai_


## Overview

This assignment evaluates your ability to build a production-minded AI product end-to-end. We are
assessing frontend engineering, backend engineering, AI workflow design, LangGraph usage,
product thinking, business judgment, and overall engineering maturity.

### What We Are Evaluating

1. Frontend Engineering
2. Backend Engineering
3. LangGraph Workflow Design
4. AI Engineering
5. Production Readiness
6. Product Thinking
7. Business Thinking

## Assignment

Build an AI Research Copilot that helps a user prepare for a sales or business meeting by
researching a company and generating a structured briefing.

### Core User Flow

1. Create a research session using company name, website, and research objective.
2. Execute a LangGraph workflow and display progress.
3. Generate a structured research report.
4. Allow follow-up chat based on report context.
5. Persist sessions and workflow outputs.

### Report Must Include

- Company Overview
- Products & Services
- Target Customers
- Business Signals
- Risks & Challenges
- Suggested Discovery Questions
- Suggested Outreach Strategy
- Unknowns


- Sources

## Technical Requirements

### Frontend (ReactJS)

- Research Session Creation
- Session History
- Session Detail Page
- Workflow Progress UI
- Follow-Up Chat
- Loading States
- Error States
- Responsive Design

### Backend (Python + FastAPI)

- Session APIs
- Workflow Execution APIs
- Chat APIs
- Persistence Layer
- Logging
- Error Handling
- Configuration Management

### Illustrative Architecture Example

Frontend → Backend APIs → AI Workflow → Storage
_This diagram is illustrative only. You are free to design your own architecture._

### Illustrative Folder Structure

frontend/
backend/
docs/
README.md

## LangGraph Requirements

**LangGraph is mandatory. A single LLM call wrapped in an API is not acceptable.**

1. Multiple meaningful nodes


2. Shared graph state
3. Conditional routing
4. Intermediate outputs
5. Failure handling
6. Recoverability

### Example Workflow Shape

Planner → Research → Analysis → Quality Check → Report Generation
_This is only an example. You are free to design your own workflow._

## Product & Business Thinking

**Create product-improvements.md (maximum 2 pages).**

1. Identify at least 5 weaknesses in the current product design.
2. Prioritize the top 3 improvements you would build next.
3. Explain who buys the product, who uses it, and why they would pay.
4. Define success metrics.
5. Propose a 4-week AI roadmap.
6. Identify the biggest cost, scaling, and reliability risks.
7. What feature would you remove and why?
8. What feature would you add and why?
9. What would your first 90-day roadmap be?
10. If you owned this product, what would you change first and why?

## Additional Required Documents

1. README.md
2. architecture.md
3. engineering-decisions.md
4. product-improvements.md

### engineering-decisions.md

1. 3 major engineering decisions
2. Alternatives considered
3. Tradeoffs made


4. Top technical debt items
5. Biggest technical risk
6. What you would improve with 2 additional weeks

## Submission

- GitHub Repository
- README
- architecture.md
- engineering-decisions.md
- product-improvements.md
- Demo Video or Hosted Deployment

### Evaluation Rubric

```
Evaluation Area Weight
Frontend Engineering 15%
Backend Engineering 20%
LangGraph Design 25%
AI Engineering 15%
Production Readiness 10%
Product & Business Thinking 15%
```


