"""
Cerina Single Runner & Event Tail Architecture (A1, A2, A3)
- Registry enforces exactly one active runner per session (409 Conflict if active).
- /stream NEVER executes the graph; it is a pure SSE tail.
- Events table writes synchronously before SSE emission.
- SSE tail supports Last-Event-ID resume, 15s ping, and fail-safe error propagation.
"""

import asyncio
import json
import logging
import time
import os
from datetime import datetime
from typing import Dict, List, Optional, Any, AsyncGenerator

from sqlalchemy import text
from database import get_db_session, Event, ProtocolSession, LLMUsage
from normalizer import normalize_protocol_markdown

logger = logging.getLogger("cerina.runner")

class RunnerAlreadyActiveError(Exception):
    """Raised when a generation task is already running for a session (HTTP 409)."""
    pass

class RunnerRegistry:
    def __init__(self):
        self._active_tasks: Dict[str, asyncio.Task] = {}
        self._subscribers: Dict[str, List[asyncio.Queue]] = {}
        self._lock = asyncio.Lock()

    async def is_active(self, session_id: str) -> bool:
        async with self._lock:
            task = self._active_tasks.get(session_id)
            if task and not task.done():
                return True
            if session_id in self._active_tasks:
                del self._active_tasks[session_id]
            return False

    async def acquire_or_raise(self, session_id: str, task_factory, *args, **kwargs) -> asyncio.Task:
        async with self._lock:
            existing = self._active_tasks.get(session_id)
            if existing and not existing.done():
                raise RunnerAlreadyActiveError(f"Session {session_id} already has an active runner task.")
            
            task = asyncio.create_task(task_factory(session_id, *args, **kwargs))
            self._active_tasks[session_id] = task
            
            def _cleanup(t):
                if session_id in self._active_tasks and self._active_tasks[session_id] == t:
                    del self._active_tasks[session_id]
            task.add_done_callback(_cleanup)
            return task

    def subscribe(self, session_id: str) -> asyncio.Queue:
        q = asyncio.Queue(maxsize=100)
        self._subscribers.setdefault(session_id, []).append(q)
        return q

    def unsubscribe(self, session_id: str, q: asyncio.Queue):
        if session_id in self._subscribers:
            if q in self._subscribers[session_id]:
                self._subscribers[session_id].remove(q)
            if not self._subscribers[session_id]:
                del self._subscribers[session_id]

    def broadcast(self, session_id: str, event_dict: Dict[str, Any]):
        for q in self._subscribers.get(session_id, []):
            try:
                q.put_nowait(event_dict)
            except asyncio.QueueFull:
                logger.warning(f"Subscriber queue full for session {session_id}, dropping event.")

registry = RunnerRegistry()

# --- Event Persistence & Emission (A2) ---

def emit_event(
    session_id: str,
    run_id: str,
    run_kind: str,
    draft_version: int,
    agent: str,
    event_type: str,
    text_content: str,
    severity: str = "info",
    to_agent: Optional[str] = None,
    data: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """
    Persists event to events table synchronously (unless token event)
    and broadcasts to live in-process SSE subscribers.
    """
    data = data or {}
    ts_now = datetime.utcnow()
    
    # Tokens are live-only (not persisted per A2)
    if event_type == "token":
        payload = {
            "session_id": session_id,
            "seq": -1,
            "run_id": run_id,
            "run_kind": run_kind,
            "draft_version": draft_version,
            "agent": agent,
            "type": event_type,
            "to_agent": to_agent,
            "severity": severity,
            "text": text_content,
            "data": data,
            "ts": ts_now.isoformat()
        }
        registry.broadcast(session_id, payload)
        return payload

    db = get_db_session()
    try:
        # Determine next seq synchronously
        res = db.execute(
            text("SELECT COALESCE(MAX(seq), 0) + 1 FROM events WHERE session_id = :sid"),
            {"sid": session_id}
        ).scalar()
        seq = int(res or 1)

        event_obj = Event(
            session_id=session_id,
            seq=seq,
            run_id=run_id,
            run_kind=run_kind,
            draft_version=draft_version,
            agent=agent,
            type=event_type,
            to_agent=to_agent,
            severity=severity,
            text=text_content,
            data=data,
            ts=ts_now
        )
        db.add(event_obj)
        db.commit()

        payload = {
            "session_id": session_id,
            "seq": seq,
            "run_id": run_id,
            "run_kind": run_kind,
            "draft_version": draft_version,
            "agent": agent,
            "type": event_type,
            "to_agent": to_agent,
            "severity": severity,
            "text": text_content,
            "data": data,
            "ts": ts_now.isoformat()
        }
        registry.broadcast(session_id, payload)
        return payload
    except Exception as e:
        db.rollback()
        logger.error(f"Failed to persist event for {session_id}: {e}", exc_info=True)
        raise
    finally:
        db.close()

# --- Single Runner Execution (A1, A7, A8) ---

async def run_protocol_workflow(
    session_id: str,
    run_id: str,
    run_kind: str = "initial", # initial | revision | human_revision
    review_depth: str = "standard", # standard | thorough
    human_instruction: Optional[str] = None
):
    """
    The Single Runner task owning graph execution.
    Never races with SSE stream.
    """
    logger.info(f"[RUNNER] Starting run {run_id} ({run_kind}) for session {session_id}")
    
    from agents.workflow import create_workflow
    from agents.state import add_agent_note
    
    workflow = create_workflow()
    config = {"configurable": {"thread_id": session_id}}
    
    current_state_tuple = await workflow.aget_state(config)
    state = current_state_tuple.values.copy() if current_state_tuple else {}

    draft_version = state.get("current_version", 1)
    if run_kind in ["revision", "human_revision"]:
        draft_version += 1
        state["current_version"] = draft_version

    # Handle human instruction injection (A8)
    if human_instruction:
        state = add_agent_note(
            state,
            "Human",
            human_instruction,
            target_agent="Drafter",
            priority="critical"
        )
        state["status"] = "needs_revision"
        state["active_agent"] = "Supervisor"
        state["halted"] = False
        await workflow.aupdate_state(config, state, as_node="supervisor")
        emit_event(
            session_id=session_id,
            run_id=run_id,
            run_kind=run_kind,
            draft_version=draft_version,
            agent="Human",
            event_type="human_action",
            text_content=f"Instruction: {human_instruction}",
            severity="info",
            to_agent="Drafter"
        )

    # Developer override: FORCE_REVISION
    force_revision = os.getenv("FORCE_REVISION", "0") == "1"

    node_agents = {
        "draft": "Drafter",
        "safety_review": "SafetyGuardian",
        "clinical_critique": "ClinicalCritic",
        "supervisor": "Supervisor"
    }

    try:
        async for event in workflow.astream(None, config, stream_mode="updates"):
            for node_name, state_update in event.items():
                agent_name = node_agents.get(node_name, "System")
                t_start = time.time()
                
                # Emit node_start (A2)
                emit_event(
                    session_id=session_id,
                    run_id=run_id,
                    run_kind=run_kind,
                    draft_version=draft_version,
                    agent=agent_name,
                    event_type="node_start",
                    text_content=f"{agent_name} started {node_name}",
                    severity="info",
                    data={"node": node_name}
                )

                # Fetch updated state
                st = await workflow.aget_state(config)
                curr_values = st.values if st else {}
                latency_ms = round((time.time() - t_start) * 1000, 2)

                # Node-specific structured event handling
                if node_name == "draft":
                    raw_draft = curr_values.get("current_draft", "")
                    normalized_draft = normalize_protocol_markdown(raw_draft)
                    curr_values["current_draft"] = normalized_draft
                    await workflow.aupdate_state(config, {"current_draft": normalized_draft}, as_node="draft")
                    
                    emit_event(
                        session_id=session_id,
                        run_id=run_id,
                        run_kind=run_kind,
                        draft_version=draft_version,
                        agent=agent_name,
                        event_type="message",
                        text_content=f"Created draft version {draft_version}",
                        severity="info",
                        to_agent="SafetyGuardian"
                    )

                elif node_name == "safety_review":
                    s_score = curr_values.get("safety_score", 0.0)
                    s_checks = curr_values.get("safety_checks", {})
                    s_source = curr_values.get("score_source", "llm")
                    emit_event(
                        session_id=session_id,
                        run_id=run_id,
                        run_kind=run_kind,
                        draft_version=draft_version,
                        agent=agent_name,
                        event_type="score",
                        text_content=f"Safety check: {s_score:.2f} ({s_source})",
                        severity="critical" if s_score < 0.8 else "info",
                        data={
                            "metric": "safety",
                            "score": s_score,
                            "score_source": s_source,
                            "checks": s_checks,
                            "unavailable": (s_source == "unavailable")
                        }
                    )

                elif node_name == "clinical_critique":
                    emp_score = curr_values.get("empathy_score", 0.0)
                    clin_score = curr_values.get("clinical_score", 0.0)
                    c_source = curr_values.get("score_source", "llm")
                    emit_event(
                        session_id=session_id,
                        run_id=run_id,
                        run_kind=run_kind,
                        draft_version=draft_version,
                        agent=agent_name,
                        event_type="score",
                        text_content=f"Empathy: {emp_score:.1f}/5, Clinical fidelity: {clin_score:.1f}/5",
                        severity="warning" if (emp_score < 3.5 or clin_score < 3.5) else "info",
                        data={
                            "metric": "clinical",
                            "empathy_score": emp_score,
                            "clinical_score": clin_score,
                            "score_source": c_source,
                            "unavailable": (c_source == "unavailable")
                        }
                    )

                elif node_name == "supervisor":
                    status = curr_values.get("status", "")
                    halted = curr_values.get("halted", False)
                    route = "halt" if (halted or status == "awaiting_approval") else ("revise" if "needs_revision" in status else "pass")
                    
                    reason = "Quality thresholds met. Ready for human review."
                    if route == "revise":
                        reason = f"Draft requires revision (iteration {curr_values.get('iteration_count', 1)})."
                    elif route == "halt":
                        reason = "Workflow completed or reached safety threshold. Paused for clinician sign-off."

                    emit_event(
                        session_id=session_id,
                        run_id=run_id,
                        run_kind=run_kind,
                        draft_version=draft_version,
                        agent=agent_name,
                        event_type="decision",
                        text_content=f"Supervisor decision: {route}. {reason}",
                        severity="warning" if route == "revise" else "info",
                        data={"route": route, "reason": reason}
                    )

                # Emit node_end (A2)
                emit_event(
                    session_id=session_id,
                    run_id=run_id,
                    run_kind=run_kind,
                    draft_version=draft_version,
                    agent=agent_name,
                    event_type="node_end",
                    text_content=f"{agent_name} completed {node_name} in {latency_ms}ms",
                    severity="info",
                    data={"node": node_name, "latency_ms": latency_ms}
                )

                # Check if paused at checkpoint for human review
                if curr_values.get("halted") or curr_values.get("status") in ["awaiting_approval", "halted"]:
                    emit_event(
                        session_id=session_id,
                        run_id=run_id,
                        run_kind=run_kind,
                        draft_version=draft_version,
                        agent="System",
                        event_type="checkpoint",
                        text_content="Protocol paused for clinician review and sign-off.",
                        severity="info",
                        data={"status": "awaiting_approval"}
                    )
                    emit_event(
                        session_id=session_id,
                        run_id=run_id,
                        run_kind=run_kind,
                        draft_version=draft_version,
                        agent="System",
                        event_type="run_end",
                        text_content="Run finished: awaiting human approval.",
                        severity="info",
                        data={"status": "awaiting_approval"}
                    )
                    return

        # If loop completed to terminal state
        emit_event(
            session_id=session_id,
            run_id=run_id,
            run_kind=run_kind,
            draft_version=draft_version,
            agent="System",
            event_type="run_end",
            text_content="Workflow completed successfully.",
            severity="info",
            data={"status": "completed"}
        )

    except Exception as e:
        logger.error(f"[RUNNER] Exception during workflow for {session_id}: {e}", exc_info=True)
        code = "quota_exceeded" if "429" in str(e) or "quota" in str(e).lower() else "runner_error"
        retryable = (code != "quota_exceeded")
        emit_event(
            session_id=session_id,
            run_id=run_id,
            run_kind=run_kind,
            draft_version=draft_version,
            agent="System",
            event_type="error",
            text_content=f"Execution error: {str(e)}",
            severity="critical",
            data={"code": code, "message": str(e), "retryable": retryable}
        )
        emit_event(
            session_id=session_id,
            run_id=run_id,
            run_kind=run_kind,
            draft_version=draft_version,
            agent="System",
            event_type="run_end",
            text_content="Run terminated due to error.",
            severity="critical",
            data={"status": "error", "code": code}
        )

# --- Recheck Run (A8 /revalidate) ---

async def run_recheck_workflow(session_id: str, run_id: str, edited_draft: str):
    """
    Executes a recheck run on an edited draft (Safety -> Critic).
    Never restarts drafting; emits individual verdicts and deltas as events.
    """
    from agents.workflow import create_workflow, safety_guardian, clinical_critic
    from normalizer import normalize_protocol_markdown
    
    clean_draft = normalize_protocol_markdown(edited_draft)
    workflow = create_workflow()
    config = {"configurable": {"thread_id": session_id}}
    
    st_tuple = await workflow.aget_state(config)
    state = st_tuple.values.copy() if st_tuple else {}
    draft_version = state.get("current_version", 1)

    emit_event(
        session_id=session_id,
        run_id=run_id,
        run_kind="recheck",
        draft_version=draft_version,
        agent="Human",
        event_type="human_action",
        text_content="Clinician triggered re-check on edited draft",
        severity="info"
    )

    state["current_draft"] = clean_draft
    
    # 1. Safety Guardian
    emit_event(
        session_id=session_id,
        run_id=run_id,
        run_kind="recheck",
        draft_version=draft_version,
        agent="SafetyGuardian",
        event_type="node_start",
        text_content="Safety Guardian reviewing edited draft",
        severity="info"
    )
    s_res = await safety_guardian.review(state)
    s_score = s_res.get("safety_score", 0.0)
    emit_event(
        session_id=session_id,
        run_id=run_id,
        run_kind="recheck",
        draft_version=draft_version,
        agent="SafetyGuardian",
        event_type="score",
        text_content=f"Safety score after edits: {s_score:.2f}",
        severity="critical" if s_score < 0.8 else "info",
        data={"metric": "safety", "score": s_score, "checks": s_res.get("safety_checks", {})}
    )
    emit_event(
        session_id=session_id,
        run_id=run_id,
        run_kind="recheck",
        draft_version=draft_version,
        agent="SafetyGuardian",
        event_type="node_end",
        text_content="Safety check complete",
        severity="info"
    )

    # 2. Clinical Critic
    emit_event(
        session_id=session_id,
        run_id=run_id,
        run_kind="recheck",
        draft_version=draft_version,
        agent="ClinicalCritic",
        event_type="node_start",
        text_content="Clinical Critic reviewing edited draft",
        severity="info"
    )
    c_res = await clinical_critic.critique(state)
    emp = c_res.get("empathy_score", 0.0)
    fid = c_res.get("clinical_score", 0.0)
    emit_event(
        session_id=session_id,
        run_id=run_id,
        run_kind="recheck",
        draft_version=draft_version,
        agent="ClinicalCritic",
        event_type="score",
        text_content=f"Empathy: {emp:.1f}/5, Clinical fidelity: {fid:.1f}/5",
        severity="info",
        data={"metric": "clinical", "empathy_score": emp, "clinical_score": fid}
    )
    emit_event(
        session_id=session_id,
        run_id=run_id,
        run_kind="recheck",
        draft_version=draft_version,
        agent="ClinicalCritic",
        event_type="node_end",
        text_content="Clinical critique complete",
        severity="info"
    )

    # Update state
    state["safety_score"] = s_score
    state["empathy_score"] = emp
    state["clinical_score"] = fid
    await workflow.aupdate_state(config, state, as_node="supervisor")

    emit_event(
        session_id=session_id,
        run_id=run_id,
        run_kind="recheck",
        draft_version=draft_version,
        agent="System",
        event_type="run_end",
        text_content="Re-check completed. Ready for approval.",
        severity="info",
        data={"status": "awaiting_approval"}
    )
