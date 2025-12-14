# Cerina Protocol Foundry - Architecture Documentation

## System Overview

The Cerina Protocol Foundry is an autonomous multi-agent system that designs, critiques, and refines CBT (Cognitive Behavioral Therapy) exercises. The system uses a **Supervisor-Worker** pattern with specialized agents that collaborate through a shared state (Blackboard pattern).

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                      User Interface Layer                        │
├──────────────────────┬──────────────────────────────────────────┤
│   React Dashboard    │         MCP Client                        │
│  (Human-in-the-Loop) │    (Machine-to-Machine)                  │
└──────────┬───────────┴──────────────┬───────────────────────────┘
           │                           │
           │ HTTP/SSE                  │ MCP Protocol
           │                           │
┌──────────▼───────────────────────────▼───────────────────────────┐
│                      FastAPI Backend                              │
│  ┌──────────────────────────────────────────────────────────┐   │
│  │              API Endpoints                                │   │
│  │  - POST /api/protocols/create                            │   │
│  │  - GET  /api/protocols/{id}/stream (SSE)                │   │
│  │  - GET  /api/protocols/{id}/state                       │   │
│  │  - POST /api/protocols/{id}/approve                     │   │
│  │  - POST /api/protocols/{id}/halt                        │   │
│  └──────────────────────────────────────────────────────────┘   │
└───────────────────────────┬───────────────────────────────────────┘
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
                    │  (Orchestrator)│
                    └───────┬────────┘
                            │
                ┌───────────▼───────────┐
                │   Shared State         │
                │   (Blackboard)         │
                │  - Current Draft       │
                │  - Draft History       │
                │  - Agent Notes         │
                │  - Quality Scores      │
                │  - Safety Checks       │
                └───────────┬───────────┘
                            │
                ┌───────────▼───────────┐
                │   SQLite Checkpointer │
                │   (Persistence)       │
                └───────────────────────┘
```

## Agent Architecture

### 1. Supervisor Agent
**Role**: Orchestrator and decision-maker
- Evaluates quality metrics (safety, empathy, clinical scores)
- Decides when drafts meet quality thresholds
- Routes workflow between agents
- Manages iteration limits
- Triggers human-in-the-loop pauses

**Decision Logic**:
- If quality scores < thresholds → Route to Drafter for revision
- If quality scores ≥ thresholds → Halt for human approval
- If max iterations reached → Finalize current draft

### 2. Drafter Agent
**Role**: Content creator
- Generates initial CBT exercise drafts
- Incorporates feedback from other agents
- Revises drafts based on critique
- Maintains clinical structure and evidence-based techniques

**Input**: User intent, feedback from other agents
**Output**: Structured CBT exercise draft

### 3. Safety Guardian Agent
**Role**: Safety validator
- Checks for self-harm references
- Identifies medical advice (should be avoided)
- Flags dangerous practices
- Assigns safety score (0.0-1.0)

**Output**: Safety score, safety checks, flagged issues

### 4. Clinical Critic Agent
**Role**: Quality evaluator
- Assesses clinical appropriateness
- Evaluates empathy and tone
- Checks structure and clarity
- Measures actionability
- Assigns empathy and clinical scores (0.0-1.0)

**Output**: Empathy score, clinical score, recommendations

## State Management (Blackboard Pattern)

The `ProtocolState` TypedDict serves as the shared workspace:

```python
ProtocolState:
  - user_intent: str
  - session_id: str
  - status: str
  - current_draft: Optional[str]
  - draft_history: List[ProtocolDraft]
  - agent_notes: List[AgentNote]  # Blackboard scratchpad
  - safety_score: Optional[float]
  - empathy_score: Optional[float]
  - clinical_score: Optional[float]
  - halted: bool
  - human_approved: bool
  - iteration_count: int
  - max_iterations: int
```

### Agent Notes (Blackboard)
Agents communicate through notes:
- **Targeted notes**: `target_agent` specified for direct communication
- **Broadcast notes**: `target_agent=None` for all agents
- **Priority levels**: "info", "warning", "critical"

## Workflow Execution Flow

1. **Initialization**
   - User submits intent
   - Initial state created
   - Workflow starts at "draft" node

2. **Drafting Phase**
   - Drafter creates initial draft
   - Draft added to history
   - State updated with draft content

3. **Review Phase**
   - Safety Guardian reviews draft
   - Clinical Critic evaluates quality
   - Scores updated in state

4. **Decision Phase**
   - Supervisor evaluates scores
   - If quality OK → Halt for human approval
   - If quality insufficient → Route back to Drafter
   - If max iterations → Finalize

5. **Human-in-the-Loop**
   - Workflow pauses at checkpoint
   - Human reviews draft in UI
   - Human can edit or approve
   - Upon approval, workflow resumes

6. **Finalization**
   - Approved draft saved
   - Session marked complete
   - Final protocol stored

## Persistence & Checkpointing

- **SQLite Checkpointer**: Every workflow step is checkpointed
- **Resume on crash**: System can resume from last checkpoint
- **State history**: All state transitions are logged
- **Session tracking**: Each protocol generation is a separate session

## MCP Integration

The MCP server exposes the workflow as tools:
- `create_cbt_protocol`: Start protocol generation
- `get_protocol_status`: Check progress and retrieve draft
- `approve_protocol`: Approve draft (human-in-the-loop)

This allows external MCP clients (e.g., Claude Desktop) to trigger workflows programmatically.

## Quality Thresholds

- **Safety Score**: ≥ 0.8 (required)
- **Empathy Score**: ≥ 0.7 (required)
- **Clinical Score**: ≥ 0.7 (required)
- **Max Iterations**: 5 (safety limit)

## Error Handling

- Workflow errors are caught and logged
- State is preserved even on errors
- Human can review and approve even if workflow errors
- Graceful degradation: partial drafts are still reviewable

