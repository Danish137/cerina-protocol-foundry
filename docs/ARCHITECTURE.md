# Cerina Protocol Foundry — Architecture Documentation

## System Overview

The Cerina Protocol Foundry is an autonomous, observable multi-agent system designed for generating, critiquing, and iteratively refining Cognitive Behavioral Therapy (CBT) protocols. The system is built around a **Supervisor-Worker blackboard architecture** coordinated via LangGraph, with an asynchronous FastAPI backend and a responsive React/Vite dashboard.

```
┌─────────────────────────────────────────────────────────────────┐
│                      Client Layer                               │
├──────────────────────┬──────────────────────────────────────────┤
│   React / Vite UI    │         MCP Protocol Client              │
│  (Human-in-the-Loop) │      (CLI, Claude Desktop, Cursor)       │
└──────────┬───────────┴──────────────┬───────────────────────────┘
           │                           │
           │ HTTP/SSE                  │ JSON-RPC (stdio)
           │                           │
┌──────────▼───────────────────────────▼──────────────────────────┐
│                      FastAPI Backend                            │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │ Endpoints:                                               │   │
│  │  - POST /api/protocols/create                            │   │
│  │  - GET  /api/protocols/{id}/stream (Server-Sent Events)  │   │
│  │  - GET  /api/protocols/{id}/state                        │   │
│  │  - POST /api/protocols/{id}/approve                      │   │
│  │  - POST /api/protocols/{id}/edit                         │   │
│  │  - POST /api/protocols/{id}/halt                         │   │
│  │  - GET  /api/protocols/{id}/events                       │   │
│  │  - GET  /api/protocols/quota                             │   │
│  └──────────────────────────────────────────────────────────┘   │
└───────────────────────────┬─────────────────────────────────────┘
                            │
                ┌───────────▼───────────┐
                │   LangGraph Workflow   │
                │  (Multi-Agent System)  │
                └───────────┬───────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
┌───────▼────────┐  ┌───────▼────────┐  ┌──────▼────────┐
│  Drafter       │  │ Safety Guardian │  │ Clinical Critic│
│  Agent         │  │ Agent           │  │ Agent          │
└───────┬────────┘  └───────┬────────┘  └──────┬─────────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                            │
                    ┌───────▼────────┐
                    │  Supervisor    │
                    │  Agent         │
                    │  (Evaluator)   │
                    └───────┬────────┘
                            │
                ┌───────────▼───────────┐
                │   Shared State         │
                │   (Blackboard)         │
                │  - current_draft       │
                │  - draft_history       │
                │  - agent_notes         │
                │  - scores (1-5)        │
                │  - score_source        │
                │  - unverified          │
                │  - degraded_review     │
                └───────────┬───────────┘
                            │
                ┌───────────▼───────────┐
                │   SQLite Checkpointer │
                │   (WAL Mode Persistence)│
                └───────────────────────┘
```

---

## Multi-Agent Architecture

### 1. Drafter Agent
- **Role**: Content generation & clinical drafting.
- **Responsibilities**:
  - Synthesizes user intent into structured CBT exercises.
  - Enforces 7 mandatory clinical sections: Title, Introduction/Rationale, Measurable Goals, Step-by-Step Instructions, Guided Practice / Exposure, Reflection / Thought Record, Conclusion & Emergency Support.
  - Formulates revisions incorporating targeted critique from Safety and Critic notes.
- **Streaming**: Streams token-by-token via SSE callbacks to minimize Time to First Token (TTFT).

### 2. Safety Guardian Agent
- **Role**: Patient safety and clinical boundary verification.
- **Responsibilities**:
  - Scans for contraindicated medication advice, unanchored SUDS, or dismissive tone.
  - Enforces mandatory UK/US crisis hotlines (988, 111, Samaritans, Crisis Text Line).
  - Scores safety on a 1–5 rubric with quote-grounded evidence.

### 3. Clinical Critic Agent
- **Role**: Quality and pedagogical evaluation.
- **Responsibilities**:
  - Assesses therapeutic warmth/empathy, fidelity to CBT principles, clarity, structural completeness, and actionability.
  - Extracts verbatim quotes from draft to substantiate score deductions.
  - Prevents rubber-stamping by validating that cited phrases exist in the current draft.

### 4. Supervisor Agent
- **Role**: Routing and workflow decision logic.
- **Responsibilities**:
  - Evaluates scores against clinical thresholds: Safety >= 4/5, Warmth >= 3/5, Fidelity >= 4/5, Clarity >= 3/5, Structure >= 4/5, Actionability >= 3/5.
  - **Deterministic Completeness Gate**: Validates all 7 required sections and terminal punctuation before routing to human approval.
  - **Fail-Closed Outage Handling**: If safety checks were unavailable (`unverified=True`), halts for human review but flags state as degraded, requiring explicit clinician acknowledgement.
  - Enforces iteration limits (maximum 3 revisions) before escalating to human reviewer.

---

## State Management (The Blackboard Pattern)

The `ProtocolState` object represents the blackboard on which all agents read and write:

```python
class ProtocolState(TypedDict):
    user_intent: str
    session_id: str
    status: str                         # 'drafting' | 'reviewing' | 'awaiting_approval' | 'approved' | 'halted'
    current_draft: Optional[str]
    draft_history: List[Dict[str, Any]]
    agent_notes: List[AgentNote]        # Blackboard communication scratchpad
    scores: Dict[str, Any]              # Rubric scores (1–5)
    score_source: Optional[str]         # 'llm' | 'heuristic' | 'unavailable'
    unverified: bool                    # True if automated safety checks could not run
    degraded_review: bool               # True if router failed over to secondary/heuristic
    drafter_model: Optional[str]
    drafter_provider: Optional[str]
    safety_model: Optional[str]
    critic_model: Optional[str]
    iteration_count: int
    max_iterations: int
    halted: bool
    human_approved: bool
    human_edited: bool
```

### Blackboard Notes
Agents communicate via `agent_notes` containing:
- `sender`: Generating agent ID
- `recipient`: Target agent (`drafter`, `supervisor`, or `all`)
- `note_type`: `safety_violation`, `clinical_critique`, `revision_instruction`
- `content`: Specific feedback with verbatim quotes

---

## Resilient Routing & Zero Same-Family Rule

To guarantee objective evaluation, the LLM router enforces the **Zero Same-Family Rule**:
- The model family that generated a draft is **strictly forbidden** from acting as judge (Safety Guardian or Clinical Critic).
- If `openai/gpt-oss-120b` (Groq/OpenAI family) drafts, judges must be Google Gemini or Meta Llama.
- If `gemini-3.1-flash-lite` (Google family) drafts, judges must be Groq Qwen/OpenAI or Meta Llama.

### Failure Isolation & Outage Handling
1. **Model Fallback Chain**: Each role has an ordered list of fallback models across providers (Groq, Gemini, OpenRouter).
2. **Graceful Degradation**: If an entire provider experiences 503/429 errors, the router automatically fails over to the next provider without breaking the active SSE stream.
3. **All Judges Down**: If all judge providers are unavailable:
   - State sets `unverified=True` and `score_source="unavailable"`.
   - Workflow pauses in `awaiting_approval` with a prominent warning banner.
   - Normal `/approve` returns HTTP 409 `recheck_required` to block blind approval. Reviewer must explicitly override via `clinician_bypass` or request a re-check.

---

## Streaming & Persistence

1. **Server-Sent Events (SSE)**: Real-time event log streamed over `/api/protocols/{id}/stream`. If the SSE connection drops, the client automatically falls back to polling `/api/protocols/{id}/events?after={seq}`.
2. **SQLite WAL Mode**: State is persisted via SQLite in Write-Ahead Logging (WAL) mode for concurrency and zero-loss crash recovery.
3. **Draft Versioning**: Every draft iteration is recorded with a content hash, timestamp (ISO 8601 UTC), and serving model metadata.
