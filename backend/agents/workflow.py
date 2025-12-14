"""
LangGraph Workflow - The Multi-Agent Orchestration
Implements a Supervisor-Worker pattern with autonomous decision-making.
"""

from typing import Literal
import asyncio
from langgraph.graph import StateGraph, END
from langgraph.checkpoint.sqlite import SqliteSaver
from langgraph.prebuilt import ToolNode
import sqlite3
from typing import Optional

# Async checkpointer support
try:
    from langgraph.checkpoint.sqlite.aio import AsyncSqliteSaver
    import aiosqlite
except Exception:
    AsyncSqliteSaver = None  # type: ignore
import os

from agents.state import ProtocolState, create_initial_state, add_draft_version
from agents.agents import (
    DrafterAgent,
    SafetyGuardianAgent,
    ClinicalCriticAgent,
    SupervisorAgent
)

# Initialize agents
drafter = DrafterAgent()
safety_guardian = SafetyGuardianAgent()
clinical_critic = ClinicalCriticAgent()
supervisor = SupervisorAgent()

# Initialize checkpointers
_checkpointer: Optional[object] = None

def get_checkpointer():
    """Get SQLite checkpointer for persistence"""
    global _checkpointer
    if _checkpointer is not None:
        return _checkpointer
    
    # Get database path
    db_path = os.getenv("DATABASE_URL", "sqlite:///./cerina_foundry.db")
    if db_path.startswith("sqlite:///"):
        db_path = db_path.replace("sqlite:///", "")
    
    # Ensure directory exists
    if os.path.dirname(db_path) and os.path.dirname(db_path) != ".":
        os.makedirs(os.path.dirname(db_path), exist_ok=True)
    
    # Create a persistent sqlite3 connection and return a SqliteSaver instance
    # If running in an async environment and AsyncSqliteSaver is available,
    # prefer using the async saver. Otherwise fall back to sync saver.
    # Note: creating AsyncSqliteSaver requires `aiosqlite` and an async
    # context; prefer using `init_checkpointer_async()` at app startup.
    try:
        # fallback to sync saver if async not initialized
        conn = sqlite3.connect(db_path, check_same_thread=False)
        _checkpointer = SqliteSaver(conn)
    except Exception:
        _checkpointer = SqliteSaver(db_path)
    
    return _checkpointer

async def draft_node(state: ProtocolState) -> ProtocolState:
    """Node: Drafter creates/revises draft"""
    result = await drafter.draft(state)
    
    # Update state with draft
    state["current_draft"] = result.get("current_draft", state.get("current_draft"))
    state["active_agent"] = result.get("active_agent", "Drafter")
    state["status"] = result.get("status", "drafting")
    state["iteration_count"] += 1
    
    # Add draft to history
    if state["current_draft"]:
        state = add_draft_version(
            state,
            state["current_draft"],
            "Drafter"
        )
    
    return state

async def safety_review_node(state: ProtocolState) -> ProtocolState:
    """Node: Safety Guardian reviews for safety issues"""
    result = await safety_guardian.review(state)
    
    # Update safety metrics
    if "safety_checks" in result:
        state["safety_checks"].update(result["safety_checks"])
    if "safety_score" in result:
        state["safety_score"] = result["safety_score"]
    state["active_agent"] = "SafetyGuardian"
    state["status"] = result.get("status", "reviewing")
    
    return state

async def clinical_critique_node(state: ProtocolState) -> ProtocolState:
    """Node: Clinical Critic evaluates quality"""
    result = await clinical_critic.critique(state)
    
    # Update quality metrics
    if "empathy_score" in result:
        state["empathy_score"] = result["empathy_score"]
    if "clinical_score" in result:
        state["clinical_score"] = result["clinical_score"]
    state["active_agent"] = "ClinicalCritic"
    state["status"] = result.get("status", "critiquing")
    
    return state

async def supervisor_node(state: ProtocolState) -> ProtocolState:
    """Node: Supervisor decides next action"""
    result = await supervisor.decide(state)
    
    state["active_agent"] = "Supervisor"
    state["status"] = result.get("status", "deciding")
    
    # Handle halt condition
    if result.get("halted"):
        state["halted"] = True
        state["status"] = "awaiting_approval"
    
    return state

def should_continue(state: ProtocolState) -> Literal["draft", "safety_review", "clinical_critique", "supervisor", "halt", "end"]:
    """
    Router function: Decides which node to execute next based on current state.
    This implements the autonomous decision-making logic.
    """
    # If halted, wait for human approval
    if state.get("halted"):
        return "halt"
    
    # If human approved, continue to finalization
    if state.get("human_approved"):
        state["halted"] = False
        return "end"
    
    # Check what stage we're in
    active_agent = state.get("active_agent")
    status = state.get("status", "")
    
    # After drafting, always review safety
    if active_agent == "Drafter":
        return "safety_review"
    
    # After safety review, critique clinically
    if active_agent == "SafetyGuardian":
        return "clinical_critique"
    
    # After critique, supervisor decides
    if active_agent == "ClinicalCritic":
        return "supervisor"
    
    # Supervisor decides next action
    if active_agent == "Supervisor":
        # Check supervisor's decision
        if "needs_revision" in status:
            return "draft"  # Route back to drafter for revision
        elif "ready_for_review" in status or "awaiting_review" in status:
            return "halt"
        else:
            return "end"
    
    # Default: if no draft exists, start with draft
    if not state.get("current_draft"):
        return "draft"
    
    # Default: supervisor decides
    return "supervisor"

def create_workflow():
    """Create and compile the LangGraph workflow"""
    
    # Create graph
    workflow = StateGraph(ProtocolState)
    
    # Add nodes
    workflow.add_node("draft", draft_node)
    workflow.add_node("safety_review", safety_review_node)
    workflow.add_node("clinical_critique", clinical_critique_node)
    workflow.add_node("supervisor", supervisor_node)
    
    # Set entry point
    workflow.set_entry_point("draft")
    
    # Add conditional edges (autonomous routing)
    workflow.add_conditional_edges(
        "draft",
        should_continue,
        {
            "draft": "draft",
            "safety_review": "safety_review",
            "clinical_critique": "clinical_critique",
            "supervisor": "supervisor",
            "halt": END,
            "end": END
        }
    )
    
    workflow.add_conditional_edges(
        "safety_review",
        should_continue,
        {
            "draft": "draft",
            "clinical_critique": "clinical_critique",
            "supervisor": "supervisor",
            "halt": END,
            "end": END
        }
    )
    
    workflow.add_conditional_edges(
        "clinical_critique",
        should_continue,
        {
            "draft": "draft",
            "supervisor": "supervisor",
            "halt": END,
            "end": END
        }
    )
    
    workflow.add_conditional_edges(
        "supervisor",
        should_continue,
        {
            "draft": "draft",
            "clinical_critique": "clinical_critique",
            "supervisor": "supervisor",
            "halt": END,
            "end": END
        }
    )
    
    # Compile with checkpointer
    checkpointer = get_checkpointer()
    app = workflow.compile(checkpointer=checkpointer)
    
    return app


async def init_checkpointer_async():
    """Asynchronously initialize and store an AsyncSqliteSaver for app use.

    Call this from your FastAPI `startup` handler to ensure an async
    checkpointer is available for `StateGraph` async methods.
    """
    global _checkpointer
    if _checkpointer is not None:
        return _checkpointer

    if AsyncSqliteSaver is None:
        raise RuntimeError("AsyncSqliteSaver is not installed. Install aiosqlite and langgraph with async support.")

    # Build db path similar to get_checkpointer
    db_path = os.getenv("DATABASE_URL", "sqlite:///./cerina_foundry.db")
    if db_path.startswith("sqlite:///"):
        db_path = db_path.replace("sqlite:///", "")

    # Ensure directory exists
    if os.path.dirname(db_path) and os.path.dirname(db_path) != ".":
        os.makedirs(os.path.dirname(db_path), exist_ok=True)

    # Create aiosqlite connection and AsyncSqliteSaver
    conn = await aiosqlite.connect(db_path)
    saver = AsyncSqliteSaver(conn)
    _checkpointer = saver
    return saver


async def close_checkpointer_async():
    """Close the async checkpointer connection if present."""
    global _checkpointer
    if _checkpointer is None:
        return
    try:
        if AsyncSqliteSaver is not None and isinstance(_checkpointer, AsyncSqliteSaver):
            await _checkpointer.conn.close()
    finally:
        _checkpointer = None

