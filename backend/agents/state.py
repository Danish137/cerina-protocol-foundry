"""
Deep State Management - The "Blackboard" Pattern
Rich, structured state that agents share and collaborate on.
"""

from typing import TypedDict, List, Dict, Any, Optional
from datetime import datetime, timezone

def utc_now() -> datetime:
    return datetime.now(timezone.utc)

def utc_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

class AgentNote(TypedDict):
    """Notes agents leave for each other on the blackboard"""
    agent_name: str
    note: str
    target_agent: Optional[str]  # If None, note is for all agents
    timestamp: str  # ISO UTC with Z
    priority: str  # "info", "warning", "critical"

class ProtocolDraft(TypedDict):
    """A versioned draft of the CBT exercise"""
    content: str
    version: int
    iteration: int
    created_by: str
    provenance: str  # ai_initial | ai_revision | human_edit | human_requested_revision
    timestamp: str  # ISO UTC with Z
    safety_score: Optional[float]
    empathy_score: Optional[float]
    clinical_score: Optional[float]
    feedback: List[str]  # Feedback from other agents

class ProtocolState(TypedDict):
    """
    The shared state (blackboard) that all agents read from and write to.
    This is the central workspace for the multi-agent collaboration.
    """
    # Core workflow state
    user_intent: str
    session_id: str
    status: str  # "initializing", "drafting", "reviewing", "awaiting_approval", "approved", "completed"
    
    # Draft management
    current_draft: Optional[str]  # The latest draft content
    draft_history: List[ProtocolDraft]  # All previous drafts
    current_version: int
    iteration_count: int
    max_iterations: int  # Safety limit
    
    # Agent collaboration
    agent_notes: List[AgentNote]  # The blackboard scratchpad
    active_agent: Optional[str]  # Which agent is currently working
    agent_decisions: Dict[str, Any]  # Decisions made by each agent
    
    # Safety and quality metrics
    safety_checks: Dict[str, bool]  # Results from safety guardian
    safety_score: Optional[float]
    empathy_score: Optional[float]
    clinical_score: Optional[float]
    score_source: Optional[str]
    unverified: Optional[bool]
    degraded_review: Optional[bool]
    
    # Human-in-the-loop
    halted: bool  # Whether workflow is paused for human review
    human_approved: bool
    human_edits: Optional[str]  # Edits made by human
    
    # Provider and model tracking for Zero Same-Family Grading
    drafter_provider: Optional[str]
    drafter_model: Optional[str]

    # Metadata
    start_time: str
    last_update: str
    metadata: Dict[str, Any]  # Additional context

def create_initial_state(
    user_intent: str,
    session_id: str,
    max_iterations: int = 5
) -> ProtocolState:
    """Create initial state for a new protocol generation"""
    now_str = utc_iso()
    return ProtocolState(
        user_intent=user_intent,
        session_id=session_id,
        status="initializing",
        current_draft=None,
        draft_history=[],
        current_version=0,
        iteration_count=0,
        max_iterations=max_iterations,
        agent_notes=[],
        active_agent=None,
        agent_decisions={},
        safety_checks={},
        safety_score=None,
        empathy_score=None,
        clinical_score=None,
        score_source="llm",
        unverified=False,
        degraded_review=False,
        halted=False,
        human_approved=False,
        human_edits=None,
        drafter_provider=None,
        drafter_model=None,
        start_time=now_str,
        last_update=now_str,
        metadata={}
    )

def add_agent_note(
    state: ProtocolState,
    agent_name: str,
    note: str,
    target_agent: Optional[str] = None,
    priority: str = "info"
) -> ProtocolState:
    """Helper to add a note to the blackboard"""
    new_note: AgentNote = {
        "agent_name": agent_name,
        "note": note,
        "target_agent": target_agent,
        "timestamp": utc_iso(),
        "priority": priority
    }
    state.setdefault("agent_notes", []).append(new_note)
    state["last_update"] = utc_iso()
    return state

def add_draft_version(
    state: ProtocolState,
    content: str,
    created_by: str,
    provenance: str = "ai_initial",
    safety_score: Optional[float] = None,
    empathy_score: Optional[float] = None,
    clinical_score: Optional[float] = None,
    feedback: Optional[List[str]] = None
) -> ProtocolState:
    """Helper to add a new draft version to history (derived from history length: v1, v2, v3...)"""
    history = state.setdefault("draft_history", [])
    new_version = len(history) + 1
    new_draft: ProtocolDraft = {
        "content": content,
        "version": new_version,
        "iteration": state.get("iteration_count", 0),
        "created_by": created_by,
        "provenance": provenance,
        "timestamp": utc_iso(),
        "safety_score": safety_score,
        "empathy_score": empathy_score,
        "clinical_score": clinical_score,
        "feedback": feedback or []
    }
    history.append(new_draft)
    state["current_version"] = new_version
    state["current_draft"] = content
    state["last_update"] = utc_iso()
    return state

def update_latest_draft_scores(
    state: ProtocolState,
    safety_score: Optional[float] = None,
    empathy_score: Optional[float] = None,
    clinical_score: Optional[float] = None,
    feedback: Optional[List[str]] = None
) -> ProtocolState:
    """Helper to backfill scores into the latest draft history entry when reviewers finish"""
    history = state.get("draft_history", [])
    if history:
        latest = history[-1]
        if safety_score is not None:
            latest["safety_score"] = safety_score
        if empathy_score is not None:
            latest["empathy_score"] = empathy_score
        if clinical_score is not None:
            latest["clinical_score"] = clinical_score
        if feedback:
            latest.setdefault("feedback", []).extend(feedback)
    return state


