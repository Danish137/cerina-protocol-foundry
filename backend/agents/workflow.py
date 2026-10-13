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

import time
from normalizer import normalize_protocol_markdown
from database import get_db_session, ProtocolSession

async def draft_node(state: ProtocolState) -> ProtocolState:
    """Node: Drafter creates/revises draft with real event lifecycle and empty-draft guard (P0-1, P0-2)"""
    from runner import emit_event
    sid = state.get("session_id", "default")
    rid = state.get("run_id") or f"run_{sid}"
    rkind = state.get("run_kind", "initial")
    # Derive draft version from history length (v1, v2, v3) per requirement 4
    dver = len(state.get("draft_history", [])) + 1

    t0 = time.perf_counter()
    normalized_draft = ""

    # Emit node_start immediately at node entry
    emit_event(
        session_id=sid,
        run_id=rid,
        run_kind=rkind,
        draft_version=dver,
        agent="Drafter",
        event_type="node_start",
        text_content="Synthesizing structured CBT protocol...",
        severity="info",
        data={"node": "draft"}
    )

    try:
        result = await drafter.draft(state)
        raw_draft = result.get("current_draft", "")
        normalized_draft = normalize_protocol_markdown(raw_draft)

        # Integrity Guard: if draft is empty after normalization, fail closed
        if not normalized_draft or not normalized_draft.strip():
            logger_msg = "Draft generation returned empty content."
            emit_event(
                session_id=sid,
                run_id=rid,
                run_kind=rkind,
                draft_version=dver,
                agent="Drafter",
                event_type="error",
                text_content=logger_msg,
                severity="critical",
                data={"code": "empty_draft", "message": logger_msg, "retryable": True}
            )
            state["status"] = "error"
            state["halted"] = True
            return state

        # Update state with valid normalized draft
        state["current_draft"] = normalized_draft
        state["active_agent"] = "Drafter"
        state["status"] = "drafting"
        state["iteration_count"] = state.get("iteration_count", 0) + 1

        state = add_draft_version(state, normalized_draft, "Drafter")
        dver = state["current_version"]
        rev_summary = result.get("revision_summary", [])

        # Emit dedicated draft event (P0-1)
        emit_event(
            session_id=sid,
            run_id=rid,
            run_kind=rkind,
            draft_version=dver,
            agent="Drafter",
            event_type="draft",
            text_content=f"Created draft version {dver}",
            severity="info",
            data={"draft": normalized_draft, "version": dver, "revision_summary": rev_summary}
        )

        # Emit message event with draft attached
        emit_event(
            session_id=sid,
            run_id=rid,
            run_kind=rkind,
            draft_version=dver,
            agent="Drafter",
            event_type="message",
            text_content=f"Draft version {dver} generated with structured clinical hierarchy",
            severity="info",
            to_agent="SafetyGuardian",
            data={"draft": normalized_draft, "version": dver, "revision_summary": rev_summary}
        )

        # Synchronously persist draft to protocol_sessions DB table
        db = get_db_session()
        try:
            db_sess = db.query(ProtocolSession).filter(ProtocolSession.session_id == sid).first()
            if db_sess:
                db_sess.current_draft = normalized_draft
                db_sess.status = "reviewing"
                db.commit()
        except Exception as db_err:
            db.rollback()
        finally:
            db.close()

        return state
    finally:
        latency_ms = round((time.perf_counter() - t0) * 1000, 2)
        emit_event(
            session_id=sid,
            run_id=rid,
            run_kind=rkind,
            draft_version=dver,
            agent="Drafter",
            event_type="node_end",
            text_content=f"Drafter completed draft in {latency_ms}ms",
            severity="info",
            data={"node": "draft", "latency_ms": latency_ms, "draft": normalized_draft, "version": dver}
        )

async def safety_review_node(state: ProtocolState) -> ProtocolState:
    """Node: Safety Guardian reviews with in-node event lifecycle (P0-2)"""
    from runner import emit_event
    sid = state.get("session_id", "default")
    rid = state.get("run_id") or f"run_{sid}"
    rkind = state.get("run_kind", "initial")
    dver = state.get("current_version", 1)

    t0 = time.perf_counter()

    emit_event(
        session_id=sid,
        run_id=rid,
        run_kind=rkind,
        draft_version=dver,
        agent="SafetyGuardian",
        event_type="node_start",
        text_content="Auditing contraindications & risk factors...",
        severity="info",
        data={"node": "safety_review"}
    )

    try:
        result = await safety_guardian.review(state)

        if "safety_checks" in result:
            state["safety_checks"].update(result["safety_checks"])
        if "safety_score" in result:
            state["safety_score"] = result["safety_score"]
        if "score_source" in result:
            state["score_source"] = result["score_source"]
        if "unverified" in result:
            state["unverified"] = result["unverified"]

        state["active_agent"] = "SafetyGuardian"
        state["status"] = result.get("status", "reviewing")

        s_score = state.get("safety_score", 0.0)
        s_checks = state.get("safety_checks", {})
        s_source = state.get("score_source", "llm")
        checks_passed = sum(1 for v in s_checks.values() if v)
        checks_total = max(len(s_checks), 5)

        emit_event(
            session_id=sid,
            run_id=rid,
            run_kind=rkind,
            draft_version=dver,
            agent="SafetyGuardian",
            event_type="score",
            text_content=f"Safety checks passed: {checks_passed}/{checks_total} ({s_source})",
            severity="critical" if s_score < 0.8 else "info",
            data={
                "metric": "safety",
                "score": s_score,
                "checks_passed": checks_passed,
                "checks_total": checks_total,
                "score_source": s_source,
                "checks": s_checks,
                "model": result.get("model", "judge_model"),
                "unavailable": (s_source == "unavailable")
            }
        )

        return state
    finally:
        latency_ms = round((time.perf_counter() - t0) * 1000, 2)
        emit_event(
            session_id=sid,
            run_id=rid,
            run_kind=rkind,
            draft_version=dver,
            agent="SafetyGuardian",
            event_type="node_end",
            text_content=f"SafetyGuardian completed review in {latency_ms}ms",
            severity="info",
            data={"node": "safety_review", "latency_ms": latency_ms}
        )

async def clinical_critique_node(state: ProtocolState) -> ProtocolState:
    """Node: Clinical Critic evaluates with in-node event lifecycle (P0-2)"""
    from runner import emit_event
    sid = state.get("session_id", "default")
    rid = state.get("run_id") or f"run_{sid}"
    rkind = state.get("run_kind", "initial")
    dver = state.get("current_version", 1)

    t0 = time.perf_counter()

    emit_event(
        session_id=sid,
        run_id=rid,
        run_kind=rkind,
        draft_version=dver,
        agent="ClinicalCritic",
        event_type="node_start",
        text_content="Evaluating therapeutic empathy & CBT fidelity...",
        severity="info",
        data={"node": "clinical_critique"}
    )

    try:
        result = await clinical_critic.critique(state)

        if "empathy_score" in result:
            state["empathy_score"] = result["empathy_score"]
        if "clinical_score" in result:
            state["clinical_score"] = result["clinical_score"]
        if "score_source" in result:
            state["score_source"] = result["score_source"]
        if "unverified" in result:
            state["unverified"] = result["unverified"]

        state["active_agent"] = "ClinicalCritic"
        state["status"] = result.get("status", "critiquing")

        emp_score = state.get("empathy_score", 0.0)
        clin_score = state.get("clinical_score", 0.0)
        c_source = state.get("score_source", "llm")

        emit_event(
            session_id=sid,
            run_id=rid,
            run_kind=rkind,
            draft_version=dver,
            agent="ClinicalCritic",
            event_type="score",
            text_content=f"Empathy: {emp_score:.1f}/5, Clinical fidelity: {clin_score:.1f}/5 ({c_source})",
            severity="warning" if (emp_score < 3.5 or clin_score < 3.5) else "info",
            data={
                "metric": "clinical",
                "empathy_score": emp_score,
                "clinical_score": clin_score,
                "score_source": c_source,
                "model": result.get("model", "judge_model"),
                "unavailable": (c_source == "unavailable")
            }
        )

        return state
    finally:
        latency_ms = round((time.perf_counter() - t0) * 1000, 2)
        emit_event(
            session_id=sid,
            run_id=rid,
            run_kind=rkind,
            draft_version=dver,
            agent="ClinicalCritic",
            event_type="node_end",
            text_content=f"ClinicalCritic completed critique in {latency_ms}ms",
            severity="info",
            data={"node": "clinical_critique", "latency_ms": latency_ms}
        )

async def supervisor_node(state: ProtocolState) -> ProtocolState:
    """Node: Supervisor decides next action with in-node event lifecycle (P0-2, P1-2)"""
    from runner import emit_event
    sid = state.get("session_id", "default")
    rid = state.get("run_id") or f"run_{sid}"
    rkind = state.get("run_kind", "initial")
    dver = state.get("current_version", 1)

    t0 = time.perf_counter()

    emit_event(
        session_id=sid,
        run_id=rid,
        run_kind=rkind,
        draft_version=dver,
        agent="Supervisor",
        event_type="node_start",
        text_content="Evaluating clinical rubrics & determining routing...",
        severity="info",
        data={"node": "supervisor"}
    )

    try:
        result = await supervisor.decide(state)

        state["active_agent"] = "Supervisor"
        state["status"] = result.get("status", "deciding")

        is_halt = result.get("halted") or result.get("next_agent") == "HALT" or result.get("status") in ["awaiting_approval", "ready_for_review", "awaiting_review"]
        if is_halt:
            state["halted"] = True
            state["status"] = "awaiting_approval"

        route = "human" if is_halt else ("revise" if result.get("next_agent") == "Drafter" else "halt")
        reason = result.get("reason", "Routing decision finalized.")

        # Supervisor decision event (A7, P1-2)
        emit_event(
            session_id=sid,
            run_id=rid,
            run_kind=rkind,
            draft_version=dver,
            agent="Supervisor",
            event_type="decision",
            text_content=f"Supervisor decision: {reason}",
            severity="info" if is_halt else "warning",
            data={"route": route, "reason": reason}
        )

        return state
    finally:
        latency_ms = round((time.perf_counter() - t0) * 1000, 2)
        emit_event(
            session_id=sid,
            run_id=rid,
            run_kind=rkind,
            draft_version=dver,
            agent="Supervisor",
            event_type="node_end",
            text_content=f"Supervisor completed in {latency_ms}ms",
            severity="info",
            data={"node": "supervisor", "latency_ms": latency_ms}
        )


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
    current_loop = asyncio.get_running_loop()
    if _checkpointer is not None and AsyncSqliteSaver is not None and isinstance(_checkpointer, AsyncSqliteSaver):
        lock_loop = getattr(_checkpointer.lock, "_loop", None) if hasattr(_checkpointer, "lock") else None
        if lock_loop == current_loop:
            return _checkpointer
        try:
            if hasattr(_checkpointer, "conn") and _checkpointer.conn:
                await _checkpointer.conn.close()
        except Exception:
            pass
        _checkpointer = None

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
        if hasattr(_checkpointer, "conn") and _checkpointer.conn:
            await _checkpointer.conn.close()
    except Exception:
        pass
    _checkpointer = None
    try:
        if AsyncSqliteSaver is not None and isinstance(_checkpointer, AsyncSqliteSaver):
            await _checkpointer.conn.close()
    finally:
        _checkpointer = None

