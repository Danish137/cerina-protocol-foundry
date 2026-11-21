"""
Hosted MCP Server for Cerina API
Mountable StreamableHTTP MCP server (stateless mode) exposed at /mcp and /mcp/.
Provides 5 tools: create_exercise, get_status, get_exercise, revise_exercise, approve_exercise.
Enforces per-IP abuse controls, token ownership, log redaction, and clinical safety checks.
"""

import asyncio
import os
import re
import secrets
import time
import logging
from datetime import datetime, timezone
from typing import Dict, Any, Optional, Tuple

from mcp.server.fastmcp import FastMCP, Context
from mcp.server.transport_security import TransportSecuritySettings

from database import get_db_session, ProtocolSession, Event
from runner import registry, run_protocol_workflow, emit_event
from crisis import screen_crisis_intent, get_crisis_resources
from security import (
    generate_session_id,
    generate_session_token,
    hash_token,
    get_capacity_status,
)
from normalizer import normalize_protocol_markdown

logger = logging.getLogger("cerina.hosted_mcp")

# --- Log Redaction Filter ---

class TokenRedactionFilter(logging.Filter):
    """Redacts known session tokens and token-like patterns from log records."""

    def __init__(self):
        super().__init__()
        self._tokens: set[str] = set()

    def register_token(self, token: str):
        if token and len(token) >= 8:
            self._tokens.add(token)

    def filter(self, record: logging.LogRecord) -> bool:
        try:
            if isinstance(record.msg, str):
                for token in self._tokens:
                    if token in record.msg:
                        record.msg = record.msg.replace(token, "[REDACTED_TOKEN]")

            if record.args:
                if isinstance(record.args, tuple):
                    new_args = []
                    for a in record.args:
                        if isinstance(a, str):
                            for token in self._tokens:
                                if token in a:
                                    a = a.replace(token, "[REDACTED_TOKEN]")
                        new_args.append(a)
                    record.args = tuple(new_args)
                elif isinstance(record.args, dict):
                    new_args = {}
                    for k, v in record.args.items():
                        if isinstance(v, str):
                            for token in self._tokens:
                                if token in v:
                                    v = v.replace(token, "[REDACTED_TOKEN]")
                        new_args[k] = v
                    record.args = new_args
        except Exception:
            pass
        return True

token_redaction_filter = TokenRedactionFilter()

# --- Abuse & Rate Limiting Controls ---

# Per-IP tracking
_mcp_daily_runs: Dict[str, Dict[str, Any]] = {}
_mcp_active_runs: Dict[str, str] = {}

def get_client_ip(ctx: Optional[Context] = None) -> str:
    """Extracts client IP from request headers (X-Forwarded-For or client.host)."""
    if ctx and ctx.request_context and ctx.request_context.request:
        req = ctx.request_context.request
        fwd = req.headers.get("x-forwarded-for")
        if fwd:
            return fwd.split(",")[0].strip()
        if req.client and req.client.host:
            return req.client.host
    return "127.0.0.1"

def check_ip_rate_limits(client_ip: str) -> Optional[Dict[str, Any]]:
    """Checks daily generation cap and single active run per connection."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    record = _mcp_daily_runs.get(client_ip)
    if not record or record.get("date") != today:
        _mcp_daily_runs[client_ip] = {"date": today, "count": 0}

    daily_limit = int(os.getenv("MCP_DAILY_RUNS_PER_IP", "5"))
    if _mcp_daily_runs[client_ip]["count"] >= daily_limit:
        return {
            "status": "rejected",
            "message": f"Daily limit of {daily_limit} exercise generations reached for this connection. Please try again tomorrow.",
            "error": "Daily generation limit reached",
        }

    active_sid = _mcp_active_runs.get(client_ip)
    if active_sid:
        task = registry.get_task(active_sid)
        if task and not task.done():
            return {
                "status": "rejected",
                "message": "An exercise generation is already in progress for this connection. Please wait for it to complete.",
                "error": "Active generation already in progress",
            }
        else:
            _mcp_active_runs.pop(client_ip, None)

    return None

def record_ip_run_start(client_ip: str, session_id: str):
    """Records an active run and increments the daily counter."""
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    if client_ip not in _mcp_daily_runs or _mcp_daily_runs[client_ip].get("date") != today:
        _mcp_daily_runs[client_ip] = {"date": today, "count": 0}
    _mcp_daily_runs[client_ip]["count"] += 1
    _mcp_active_runs[client_ip] = session_id

NOT_FOUND_MESSAGE = "Run not found"

def verify_run_access(run_id: str, run_token: str) -> Tuple[Optional[ProtocolSession], Optional[Dict[str, Any]]]:
    """
    Validates token ownership against session record.
    Returns identical 'Run not found' error for missing session, invalid token, or hash mismatch.
    """
    if not run_id or not run_token:
        return None, {"status": "error", "message": NOT_FOUND_MESSAGE, "error": NOT_FOUND_MESSAGE}

    db = get_db_session()
    try:
        sess = db.query(ProtocolSession).filter(ProtocolSession.session_id == run_id).first()
        if not sess or not sess.token_hash:
            return None, {"status": "error", "message": NOT_FOUND_MESSAGE, "error": NOT_FOUND_MESSAGE}

        provided_hash = hash_token(run_token)
        import hmac
        if not hmac.compare_digest(sess.token_hash, provided_hash):
            return None, {"status": "error", "message": NOT_FOUND_MESSAGE, "error": NOT_FOUND_MESSAGE}

        return sess, None
    finally:
        db.close()

def map_plain_status(status: str, node: Optional[str] = None) -> str:
    """Maps internal state and node names to plain-language user status stages."""
    if status == "approved":
        return "Approved"
    if status == "awaiting_review":
        return "Ready for your review"
    if status == "care_panel":
        return "Care resources displayed"
    if status == "failed":
        return "Failed"

    if status in ("generating", "revising", "revalidating"):
        if node == "draft":
            return "Writing your exercise"
        elif node == "safety":
            return "Safety check"
        elif node == "critic":
            return "Quality review"
        return "Writing your exercise"

    return "Writing your exercise"

# --- FastMCP Server Setup ---

security_settings = TransportSecuritySettings(
    enable_dns_rebinding_protection=True,
    allowed_hosts=[
        "cerina-protocol-foundry-production.up.railway.app",
        "localhost",
        "localhost:*",
        "127.0.0.1",
        "127.0.0.1:*",
        "testserver",
    ],
    allowed_origins=[
        "https://cerina-protocol-foundry.vercel.app",
        "http://localhost:5173",
        "http://localhost:3000",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ],
)

hosted_mcp = FastMCP(
    name="Cerina API",
    stateless_http=True,
    transport_security=security_settings,
)

# --- 5 Hosted Tools ---

@hosted_mcp.tool()
async def create_exercise(situation: str, style: str = "standard", ctx: Context = None) -> Dict[str, Any]:
    """Create a self-help exercise based on cognitive behavioral therapy (CBT) principles for your situation. Not therapy or medical advice.

This tool uses a multi-agent system to design, evaluate against clinical safety checks, and refine exercises.
Parameters:
- situation: Description of what you are experiencing or working through.
- style: Review depth ("standard" or "deep").
Returns {run_id, run_token, status, message}.
"""
    client_ip = get_client_ip(ctx)

    # 1. IP rate and abuse checks
    abuse_error = check_ip_rate_limits(client_ip)
    if abuse_error:
        return abuse_error

    # 2. Local Crisis Screening: crisis returns resources immediately and starts NO run
    is_crisis, matched_phrase = screen_crisis_intent(situation)
    if is_crisis:
        logger.info(f"Crisis intent matched in hosted MCP request from {client_ip}.")
        resources = get_crisis_resources("US")
        return {
            "status": "care_panel",
            "message": "Immediate crisis support is available. Please reach out to these resources.",
            "care_resources": resources,
        }

    # 3. Capacity Guard Check
    cap = get_capacity_status()
    if cap.get("exhausted"):
        return {
            "status": "rejected",
            "message": "Today's demonstration AI generation limit has been reached. Please return when quota resets.",
            "error": "quota_exceeded",
        }

    # 4. Create Session Record
    session_id = generate_session_id()
    session_token = generate_session_token()
    token_redaction_filter.register_token(session_token)
    token_hash = hash_token(session_token)
    run_id = f"run_{secrets.token_urlsafe(8)}"

    db = get_db_session()
    try:
        sess = ProtocolSession(
            session_id=session_id,
            token_hash=token_hash,
            user_intent=situation,
            status="generating",
            review_depth=style,
            current_run_id=run_id,
            meta_data={"source": "mcp", "mcp_revisions": 0},
        )
        db.add(sess)
        db.commit()
    finally:
        db.close()

    # Pre-create LangGraph state
    try:
        from agents.workflow import create_workflow
        from agents.state import create_initial_state
        workflow = create_workflow()
        config = {"configurable": {"thread_id": session_id}}
        init_state = create_initial_state(user_intent=situation, session_id=session_id)
        init_state["review_depth"] = style
        init_state["current_version"] = 0
        init_state["status"] = "generating"
        await workflow.aupdate_state(config, init_state, as_node="draft")
    except Exception as e:
        logger.warning(f"MCP create_exercise state init notice: {e}")

    # Acquire Runner Task
    await registry.acquire_or_raise(
        session_id,
        run_protocol_workflow,
        run_id=run_id,
        run_kind="initial",
        review_depth=style,
    )
    record_ip_run_start(client_ip, session_id)

    # 5. Wait up to ~25s for early progress
    start_time = time.monotonic()
    current_status = "generating"
    while time.monotonic() - start_time < 25.0:
        db = get_db_session()
        try:
            s = db.query(ProtocolSession).filter(ProtocolSession.session_id == session_id).first()
            if s:
                current_status = s.status
        finally:
            db.close()

        is_active = await registry.is_active(session_id)
        if not is_active or current_status in ("awaiting_review", "approved", "failed"):
            break
        await asyncio.sleep(0.5)

    plain_stage = map_plain_status(current_status)
    stage_msg = (
        "Your exercise is ready for review."
        if current_status == "awaiting_review"
        else "Exercise generation is in progress. Use get_status to follow along."
    )

    return {
        "run_id": session_id,
        "run_token": session_token,
        "status": plain_stage,
        "message": stage_msg,
    }

@hosted_mcp.tool()
async def get_status(run_id: str, run_token: str, wait_seconds: int = 20, ctx: Context = None) -> Dict[str, Any]:
    """Get the current progress and status of an exercise generation run.

Waits up to wait_seconds for in-progress operations to reach the next stage.
Returns plain status stages ("Writing your exercise", "Safety check", "Quality review", "Ready for your review", "Approved").
"""
    sess, err = verify_run_access(run_id, run_token)
    if err:
        return err

    # Wait up to wait_seconds if runner is currently active
    wait_limit = min(max(int(wait_seconds), 1), 30)
    start_time = time.monotonic()
    while time.monotonic() - start_time < wait_limit:
        is_active = await registry.is_active(run_id)
        if not is_active:
            break
        db = get_db_session()
        try:
            s = db.query(ProtocolSession).filter(ProtocolSession.session_id == run_id).first()
            if s and s.status in ("awaiting_review", "approved", "failed"):
                break
        finally:
            db.close()
        await asyncio.sleep(0.5)

    # Read latest session state
    db = get_db_session()
    try:
        latest = db.query(ProtocolSession).filter(ProtocolSession.session_id == run_id).first()
        status = latest.status if latest else sess.status
        meta = dict(latest.meta_data or {}) if latest else {}
    finally:
        db.close()

    # Determine node from LangGraph state if available
    active_node = None
    iteration = 1
    try:
        from agents.workflow import create_workflow
        wf = create_workflow()
        st = await wf.aget_state({"configurable": {"thread_id": run_id}})
        if st and st.values:
            iteration = st.values.get("iteration_count", 1)
        if st and st.next:
            active_node = st.next[0] if len(st.next) > 0 else None
    except Exception:
        pass

    plain_stage = map_plain_status(status, active_node)
    if meta.get("recheck_required"):
        plain_stage = "Needs recheck"

    messages = {
        "Writing your exercise": "Drafter is writing your exercise based on clinical CBT principles.",
        "Safety check": "Evaluating exercise against safety boundaries and risk criteria.",
        "Quality review": "Reviewing clarity, tone, and practical self-help guidance.",
        "Ready for your review": "Your exercise draft is complete and ready for your review.",
        "Approved": "Exercise has been approved.",
        "Needs recheck": meta.get("recheck_message") or "This draft wasn't fully checked. Run the checks again.",
        "Failed": "The generation encountered an issue and did not complete.",
    }

    return {
        "run_id": run_id,
        "status": plain_stage,
        "message": messages.get(plain_stage, "Processing exercise."),
        "iteration": iteration,
        "awaiting_review": (status == "awaiting_review"),
    }

@hosted_mcp.tool()
async def get_exercise(run_id: str, run_token: str, ctx: Context = None) -> Dict[str, Any]:
    """Retrieve the current Markdown exercise draft and safety/quality summary."""
    sess, err = verify_run_access(run_id, run_token)
    if err:
        return err

    db = get_db_session()
    try:
        s = db.query(ProtocolSession).filter(ProtocolSession.session_id == run_id).first()
        current_draft = s.current_draft if s else None
        safety_score = s.safety_score if s else None
        empathy_score = s.empathy_score if s else None
        clinical_score = s.clinical_score if s else None
        status = s.status if s else sess.status
    finally:
        db.close()

    if not current_draft:
        return {
            "run_id": run_id,
            "status": map_plain_status(status),
            "message": "Exercise draft is still being prepared. Check get_status for progress.",
            "draft": None,
            "summary": None,
        }

    summary = {
        "safety_score": round(safety_score * 100, 1) if safety_score is not None else None,
        "empathy_score": round(empathy_score, 1) if empathy_score is not None else None,
        "quality_score": round(clinical_score, 1) if clinical_score is not None else None,
    }

    formatted_md = f"# Exercise Draft\n\n{current_draft}\n\n---\n### Safety and Quality Summary\n"
    if summary["safety_score"] is not None:
        formatted_md += f"- Safety Check: {summary['safety_score']}%\n"
    if summary["empathy_score"] is not None:
        formatted_md += f"- Empathy & Clarity: {summary['empathy_score']}/5.0\n"
    if summary["quality_score"] is not None:
        formatted_md += f"- Clinical Guidance Quality: {summary['quality_score']}/5.0\n"

    return {
        "run_id": run_id,
        "status": map_plain_status(status),
        "draft": current_draft,
        "summary": summary,
        "text": formatted_md,
    }

@hosted_mcp.tool()
async def revise_exercise(run_id: str, run_token: str, request: str, ctx: Context = None) -> Dict[str, Any]:
    """Request a revision to the current exercise draft based on feedback.

Parameters:
- run_id: The session ID.
- run_token: The secret bearer token from create_exercise.
- request: Your revision instructions.
"""
    sess, err = verify_run_access(run_id, run_token)
    if err:
        return err

    db = get_db_session()
    try:
        s = db.query(ProtocolSession).filter(ProtocolSession.session_id == run_id).first()
        current_draft = (s.current_draft or "") if s else ""
        meta = dict(s.meta_data or {}) if s else {}
    finally:
        db.close()

    # Identical-text check: refuse if request is identical to current draft or prior instruction
    req_clean = request.strip() if request else ""
    draft_clean = current_draft.strip()
    last_instruction = str(meta.get("last_mcp_instruction", "")).strip()

    if not req_clean or req_clean == draft_clean or req_clean == last_instruction:
        return {
            "status": "rejected",
            "message": "I couldn't apply that change. Try rephrasing it.",
            "error": "I couldn't apply that change. Try rephrasing it.",
        }

    # Revision cap check
    max_rev = int(os.getenv("MCP_MAX_REVISIONS_PER_RUN", "3"))
    current_revisions = int(meta.get("mcp_revisions", 0))
    if current_revisions >= max_rev:
        return {
            "status": "rejected",
            "message": f"Maximum revisions ({max_rev}) reached for this exercise. You can approve the current draft or start a new exercise.",
            "error": f"Maximum revisions ({max_rev}) reached for this exercise.",
        }

    # Verify no runner is currently active
    if await registry.is_active(run_id):
        return {
            "status": "rejected",
            "message": "A revision or check is already in progress for this session.",
            "error": "Runner active",
        }

    # Clear prior recheck flags on new revision
    db = get_db_session()
    try:
        s = db.query(ProtocolSession).filter(ProtocolSession.session_id == run_id).first()
        if s:
            s.status = "revising"
            meta = dict(s.meta_data or {})
            meta.pop("recheck_required", None)
            meta.pop("recheck_message", None)
            meta["mcp_revisions"] = current_revisions + 1
            meta["last_mcp_instruction"] = req_clean
            s.meta_data = meta
            db.commit()
    finally:
        db.close()

    new_run_id = f"run_{secrets.token_urlsafe(8)}"
    await registry.acquire_or_raise(
        run_id,
        run_protocol_workflow,
        run_id=new_run_id,
        run_kind="human_revision",
        review_depth=sess.review_depth or "standard",
        human_instruction=req_clean,
    )

    # Wait up to ~20s for progress
    start_time = time.monotonic()
    current_status = "revising"
    while time.monotonic() - start_time < 20.0:
        db = get_db_session()
        try:
            s = db.query(ProtocolSession).filter(ProtocolSession.session_id == run_id).first()
            if s:
                current_status = s.status
        finally:
            db.close()

        is_active = await registry.is_active(run_id)
        if not is_active or current_status in ("awaiting_review", "approved", "failed"):
            break
        await asyncio.sleep(0.5)

    plain_stage = map_plain_status(current_status)
    return {
        "run_id": run_id,
        "run_token": run_token,
        "status": plain_stage,
        "message": "Revision started. Use get_status or get_exercise to check the updated draft.",
    }

@hosted_mcp.tool()
async def approve_exercise(run_id: str, run_token: str, ctx: Context = None) -> Dict[str, Any]:
    """Approve and finalize the current exercise draft."""
    sess, err = verify_run_access(run_id, run_token)
    if err:
        return err

    db = get_db_session()
    try:
        s = db.query(ProtocolSession).filter(ProtocolSession.session_id == run_id).first()
        meta = dict(s.meta_data or {}) if s else {}
        current_draft = s.current_draft if s else ""
        current_status = s.status if s else sess.status
    finally:
        db.close()

    # Enforce 409 recheck_required rule
    if meta.get("recheck_required"):
        return {
            "status": "rejected",
            "code": "recheck_required",
            "message": meta.get("recheck_message") or "This draft wasn't fully checked. Run the checks again.",
            "error": "This draft wasn't fully checked. Run the checks again.",
        }

    if current_status == "approved":
        return {
            "run_id": run_id,
            "status": "Approved",
            "message": "Exercise is already approved.",
            "approved_draft": current_draft,
        }

    clean_draft = normalize_protocol_markdown(current_draft or "")

    db = get_db_session()
    try:
        s = db.query(ProtocolSession).filter(ProtocolSession.session_id == run_id).first()
        if s:
            s.status = "approved"
            s.current_draft = clean_draft
            db.commit()
    finally:
        db.close()

    emit_event(
        session_id=run_id,
        run_id=f"run_approval_{int(time.time())}",
        run_kind="approval",
        draft_version=1,
        agent="Supervisor",
        event_type="approval",
        text_content="Exercise approved and signed off by user via MCP.",
        severity="info",
        data={"status": "approved"},
    )

    return {
        "run_id": run_id,
        "status": "Approved",
        "message": "Exercise approved successfully.",
        "approved_draft": clean_draft,
    }

# --- ASGI Integration Helpers ---

def get_mcp_asgi_handler():
    """Initializes and returns the StreamableHTTPASGIApp handler."""
    app = hosted_mcp.streamable_http_app()
    return app.routes[0].endpoint

def get_mcp_session_manager():
    """Returns the StreamableHTTPSessionManager for app lifespan."""
    hosted_mcp.streamable_http_app()
    return hosted_mcp.session_manager
