"""
Cerina Protocol Foundry API (Phase A)
Implements:
- A1: Single Runner Registry (/stream NEVER executes graph, 409 if active)
- A2: Events table emission synchronously before SSE tail
- A3: SSE pure tail (id: {seq}, Last-Event-ID, 15s ping, fail-safe error propagation)
- A4: Secure tokens (secrets.token_urlsafe, SHA-256 hash, 404 on mismatch, retention purge, slowapi)
- A5: Capacity Guard (DAILY_LLM_CALL_BUDGET, GET /api/capacity, 429 quota_exceeded)
- A6: Scoring Integrity & fail-closed rubrics
- A7: Loop Policy & FORCE_REVISION
- A8: Human Steering (/revise human_revision, /revalidate recheck)
- A9: Draft structure template & normalization
- A10: Crisis pre-screen & region-aware care panel
"""

import os
import re
import sys
import uuid
import json
import secrets
import asyncio
import hashlib
import logging
from datetime import datetime, timezone
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException, Request, Response, Header, Depends, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.encoders import jsonable_encoder

from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.util import get_remote_address
from slowapi.errors import RateLimitExceeded

# Configure logging: NEVER log intent text or user_id (A4)
logger = logging.getLogger("cerina")
if not logger.handlers:
    logger.setLevel(logging.INFO)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
    logger.addHandler(handler)

from database import get_db_session, init_db, ProtocolSession, Event, LLMUsage
from models import (
    ProtocolRequest,
    ProtocolResponse,
    ProtocolStatus,
    ReviseRequest,
    ApproveRequest,
    RevalidateRequest,
    ValidationResult,
    CapacityResponse,
    AgentNote,
    ErrorEnvelope,
)
from runner import registry, emit_event, run_protocol_workflow, run_recheck_workflow, RunnerAlreadyActiveError
from security import (
    generate_session_id, generate_session_token, hash_token, verify_session_access,
    purge_expired_sessions, get_capacity_status, record_llm_call
)
from crisis import screen_crisis_intent, get_crisis_resources
from normalizer import normalize_protocol_markdown

# Rate limiter setup (A4: create 5/min, revise/revalidate 10/min)
limiter = Limiter(key_func=get_remote_address)

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Initializing Cerina Protocol Foundry database and checkpointer...")
    init_db()
    
    from config import log_limits_on_startup
    log_limits_on_startup()

    try:
        from agents.workflow import init_checkpointer_async
        await init_checkpointer_async()
        logger.info("Async checkpointer initialized.")
    except Exception as e:
        logger.warning(f"Async checkpointer fallback: {e}")

    # Retention purge on startup (A4)
    try:
        purged = purge_expired_sessions()
        logger.info(f"Startup retention purge cleared {purged} expired sessions.")
    except Exception as e:
        logger.warning(f"Startup retention purge error: {e}")

    yield

    logger.info("Shutting down Cerina Protocol Foundry...")
    try:
        from agents.workflow import close_checkpointer_async
        await close_checkpointer_async()
    except Exception:
        pass

app = FastAPI(
    title="Cerina Protocol Foundry API",
    version="3.0.0",
    lifespan=lifespan
)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# CORS configuration (A4)
APP_ENV = os.getenv("APP_ENV", "development")
cors_origins_env = os.getenv("CORS_ORIGINS", "")
allowed_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()]
if not allowed_origins:
    if APP_ENV == "development":
        allowed_origins = [
            "http://localhost:3000", "http://localhost:3001", "http://localhost:5173",
            "http://127.0.0.1:3000", "http://127.0.0.1:3001", "http://127.0.0.1:5173",
            "https://cerina-protocol-foundry.vercel.app"
        ]
    else:
        allowed_origins = ["https://cerina-protocol-foundry.vercel.app"]

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_origin_regex=r"^https://.*\.vercel\.app$",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
    expose_headers=["*"],
)

def sanitize_data_dict(d: Any) -> Any:
    """Recursively removes provider, model, and family identifiers from client responses (B2)"""
    if isinstance(d, dict):
        clean = {}
        for k, v in d.items():
            if k in ["provider", "model", "drafter_provider", "drafter_model", "serving_provider", "serving_model"]:
                continue
            clean[k] = sanitize_data_dict(v)
        return clean
    elif isinstance(d, list):
        return [sanitize_data_dict(item) for item in d]
    return d

def sanitize_state_for_client(state: Any) -> Any:
    """Serializes LangGraph state while ensuring no provider/model leakage reaches the browser (B1, B2)"""
    if state is None:
        return None
    raw = jsonable_encoder(state)
    return sanitize_data_dict(raw)

def serialize_state_for_json(state: Any) -> Any:
    return sanitize_state_for_client(state)

# --- Routes ---

@app.get("/")
async def root():
    """Root health and status endpoint"""
    return {
        "status": "online",
        "service": "cerina-protocol-foundry",
        "version": "3.0.0",
        "docs": "/docs"
    }

@app.get("/health")
async def health():
    """Uptime healthcheck endpoint"""
    return {"status": "healthy"}

@app.get("/api/capacity", response_model=CapacityResponse)
async def check_capacity():
    """Capacity Guard (A5): Get remaining runs and daily budget status"""
    status = get_capacity_status()
    return CapacityResponse(**status)

@app.post("/api/protocols/create", response_model=ProtocolResponse)
@limiter.limit("5/minute")
async def create_protocol(request: Request, body: ProtocolRequest):
    """
    Creates a new protocol session with single runner ownership (A1, A4, A5, A10).
    Enforces rate limits (5/min/IP) and capacity budget.
    """
    req_id = str(uuid.uuid4())[:8]
    logger.info(f"[{req_id}] Incoming /create request: intent_len={len(body.intent)}, review_depth={body.review_depth}")

    # Simulated Outage Test Hook (Security A2: ONLY active when TEST_ALLOW_OUTAGE_SIMULATION=true, default OFF)
    if os.getenv("TEST_ALLOW_OUTAGE_SIMULATION", "").strip().lower() == "true":
        outage_hdr = request.headers.get("x-test-outage-provider")
        if outage_hdr:
            os.environ["SIMULATE_OUTAGE_PROVIDER"] = outage_hdr.strip().lower()
        else:
            os.environ.pop("SIMULATE_OUTAGE_PROVIDER", None)
    else:
        os.environ.pop("SIMULATE_OUTAGE_PROVIDER", None)

    # 1. Capacity Guard check (A5)
    cap = get_capacity_status()
    if cap["exhausted"]:
        raise HTTPException(
            status_code=429,
            detail={
                "code": "quota_exceeded",
                "message": "Today's demonstration AI generation limit has been reached. Please watch a recorded run or return when quota resets.",
                "retryable": False,
                "resets_at": cap["resets_at"]
            }
        )

    # 2. Local Crisis Pre-Screen (A10)
    is_crisis, matched_phrase = screen_crisis_intent(body.intent)
    if is_crisis and not body.clinician_bypass:
        logger.info(f"[{req_id}] Crisis intent pre-screen matched: phrase detected.")
        session_id = generate_session_id()
        session_token = generate_session_token()
        token_hash = hash_token(session_token)
        care_resources = get_crisis_resources(body.region_code or "US")

        db = get_db_session()
        try:
            sess = ProtocolSession(
                session_id=session_id,
                token_hash=token_hash,
                user_intent=body.intent,
                status="care_panel",
                review_depth=body.review_depth or "standard",
                meta_data={"crisis_detected": True, "matched_phrase": matched_phrase}
            )
            db.add(sess)
            db.commit()
        finally:
            db.close()

        # Emit major checkpoint event
        emit_event(
            session_id=session_id,
            run_id=f"run_{req_id}",
            run_kind="initial",
            draft_version=1,
            agent="System",
            event_type="checkpoint",
            text_content="Self-harm / crisis intent detected. Displaying clinical care resources.",
            severity="major",
            data={"status": "care_panel", "matched": True}
        )

        return ProtocolResponse(
            session_id=session_id,
            session_token=session_token,
            status="care_panel",
            message="Active crisis indicators identified. Clinical resources displayed.",
            run_id=f"run_{req_id}",
            care_resources=care_resources
        )

    # 3. Create Session Record
    session_id = body.session_id or generate_session_id()
    session_token = generate_session_token()
    token_hash = hash_token(session_token)
    run_id = f"run_{secrets.token_urlsafe(8)}"

    db = get_db_session()
    try:
        sess = ProtocolSession(
            session_id=session_id,
            token_hash=token_hash,
            user_intent=body.intent,
            status="generating",
            review_depth=body.review_depth or "standard",
            current_run_id=run_id
        )
        db.add(sess)
        db.commit()
    finally:
        db.close()

    # Pre-create LangGraph initial state
    from agents.workflow import create_workflow
    workflow = create_workflow()
    config = {"configurable": {"thread_id": session_id}}
    from agents.state import create_initial_state
    init_state = create_initial_state(
        user_intent=body.intent,
        session_id=session_id
    )
    init_state["review_depth"] = body.review_depth or "standard"
    init_state["current_version"] = 0
    init_state["status"] = "generating"
    
    try:
        await workflow.aupdate_state(config, init_state, as_node="draft")
    except Exception as e:
        logger.warning(f"[{req_id}] Initial aupdate_state notice: {e}")

    # 4. Acquire Single Runner Task (A1)
    try:
        await registry.acquire_or_raise(
            session_id,
            run_protocol_workflow,
            run_id=run_id,
            run_kind="initial",
            review_depth=body.review_depth or "standard"
        )
    except RunnerAlreadyActiveError:
        raise HTTPException(status_code=409, detail="A generation is already active for this session.")

    return ProtocolResponse(
        session_id=session_id,
        session_token=session_token,
        status="generating",
        message="Protocol generation initialized. Single runner task active.",
        run_id=run_id,
        review_depth=body.review_depth or "standard"
    )

@app.get("/api/protocols/{session_id}/stream")
async def stream_protocol(
    request: Request,
    session_id: str,
    token: Optional[str] = Query(None),
    x_session_token: Optional[str] = Header(None, alias="X-Session-Token"),
    after: Optional[int] = Query(None)
):
    """
    Pure SSE Tail (A1, A3): NEVER executes the graph!
    Supports Last-Event-ID resume, in-process queue tail, 15s ping, and fail-safe error propagation.
    """
    # Authorization check (A4): Requires valid session token via X-Session-Token header or query token
    raw_token = x_session_token or token
    verify_session_access(session_id, raw_token)

    # Determine resume sequence ID
    last_event_id_header = request.headers.get("Last-Event-ID")
    resume_seq = 0
    if after is not None:
        resume_seq = after
    elif last_event_id_header and last_event_id_header.isdigit():
        resume_seq = int(last_event_id_header)

    async def event_tail_generator() -> AsyncGenerator[str, None]:
        # 1. Replay missed persisted events from database
        db = get_db_session()
        highest_seq_sent = resume_seq
        try:
            persisted = (
                db.query(Event)
                .filter(Event.session_id == session_id, Event.seq > resume_seq)
                .order_by(Event.seq.asc())
                .all()
            )
            for evt in persisted:
                highest_seq_sent = max(highest_seq_sent, evt.seq)
                data_payload = {
                    "session_id": evt.session_id,
                    "seq": evt.seq,
                    "run_id": evt.run_id,
                    "run_kind": evt.run_kind,
                    "draft_version": evt.draft_version,
                    "agent": evt.agent,
                    "type": evt.type,
                    "to_agent": evt.to_agent,
                    "severity": evt.severity,
                    "text": evt.text,
                    "data": sanitize_data_dict(evt.data),
                    "ts": evt.ts.strftime("%Y-%m-%dT%H:%M:%SZ") if evt.ts else datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
                }
                # Structured event
                yield f"id: {evt.seq}\nevent: {evt.type}\ndata: {json.dumps(data_payload)}\n\n"
                
                # Legacy event bridge for Phase A compatibility
                yield f"event: state_update\ndata: {json.dumps({'node': evt.agent, 'agent_thought': evt.text, 'timestamp': data_payload['ts']})}\n\n"
        finally:
            db.close()

        # 2. Subscribe to live in-process queue
        q = registry.subscribe(session_id)
        try:
            while True:
                try:
                    # Wait for live event with 15s timeout for ping (A3)
                    item = await asyncio.wait_for(q.get(), timeout=15.0)
                    
                    item_seq = item.get("seq", -1)
                    if item_seq > 0 and item_seq <= highest_seq_sent:
                        continue # Deduplicate
                    if item_seq > 0:
                        highest_seq_sent = item_seq

                    clean_item = sanitize_data_dict(item)
                    event_type = clean_item.get("type", "message")
                    event_id_line = f"id: {item_seq}\n" if item_seq > 0 else ""
                    yield f"{event_id_line}event: {event_type}\ndata: {json.dumps(clean_item)}\n\n"

                    # Legacy state_update bridge
                    yield f"event: state_update\ndata: {json.dumps({'node': clean_item.get('agent'), 'agent_thought': clean_item.get('text'), 'timestamp': clean_item.get('ts')})}\n\n"

                    # Terminal check
                    if event_type in ["run_end", "error"]:
                        if event_type == "error":
                            yield f"event: error\ndata: {json.dumps(clean_item.get('data', {}))}\n\n"
                        break

                except asyncio.TimeoutError:
                    # 15s heartbeat ping (A3)
                    yield ": ping\n\n"
                    # Check if runner is still alive
                    is_active = await registry.is_active(session_id)
                    if not is_active:
                        # Runner finished, check if terminal event already in DB
                        db = get_db_session()
                        try:
                            last_db_evt = (
                                db.query(Event)
                                .filter(Event.session_id == session_id)
                                .order_by(Event.seq.desc())
                                .first()
                            )
                            if last_db_evt and last_db_evt.type in ["run_end", "error", "checkpoint"]:
                                yield f"id: {last_db_evt.seq}\nevent: run_end\ndata: {json.dumps({'status': 'finished'})}\n\n"
                                break
                        finally:
                            db.close()
        finally:
            registry.unsubscribe(session_id, q)

    return StreamingResponse(
        event_tail_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )

@app.get("/api/protocols/{session_id}/events")
async def get_protocol_events(
    session_id: str,
    after: int = Query(0),
    x_session_token: Optional[str] = Header(None, alias="X-Session-Token")
):
    """Retrieve persisted event log starting after sequence ID (A3)"""
    verify_session_access(session_id, x_session_token)
    db = get_db_session()
    try:
        events = (
            db.query(Event)
            .filter(Event.session_id == session_id, Event.seq > after)
            .order_by(Event.seq.asc())
            .all()
        )
        return {
            "session_id": session_id,
            "after": after,
            "events": [
                {
                    "seq": e.seq,
                    "run_id": e.run_id,
                    "run_kind": e.run_kind,
                    "draft_version": e.draft_version,
                    "agent": e.agent,
                    "type": e.type,
                    "to_agent": e.to_agent,
                    "severity": e.severity,
                    "text": e.text,
                    "data": sanitize_data_dict(e.data),
                    "ts": e.ts.strftime("%Y-%m-%dT%H:%M:%SZ") if e.ts else ""
                }
                for e in events
            ]
        }
    finally:
        db.close()

@app.post("/api/protocols/{session_id}/revise")
@limiter.limit("10/minute")
async def revise_protocol(
    request: Request,
    session_id: str,
    body: ReviseRequest,
    x_session_token: Optional[str] = Header(None, alias="X-Session-Token")
):
    """Human steering: starts a human_revision run on existing thread (A8)"""
    sess = verify_session_access(session_id, x_session_token)
    run_id = f"run_{secrets.token_urlsafe(8)}"

    instruction = body.instruction or "Please refine the draft based on clinical concerns."
    try:
        await registry.acquire_or_raise(
            session_id,
            run_protocol_workflow,
            run_id=run_id,
            run_kind="human_revision",
            review_depth=sess.review_depth or "standard",
            human_instruction=instruction
        )
    except RunnerAlreadyActiveError:
        raise HTTPException(status_code=409, detail="A generation is already active for this session.")

    return {
        "session_id": session_id,
        "run_id": run_id,
        "status": "revising",
        "message": "Human revision run started."
    }

@app.post("/api/protocols/{session_id}/revalidate", response_model=ValidationResult)
@limiter.limit("10/minute")
async def revalidate_protocol(
    request: Request,
    session_id: str,
    body: RevalidateRequest,
    x_session_token: Optional[str] = Header(None, alias="X-Session-Token")
):
    """Recheck run on edited draft (Safety -> Critic) without restarting drafting (A8)"""
    verify_session_access(session_id, x_session_token)
    run_id = f"run_{secrets.token_urlsafe(8)}"

    try:
        task = await registry.acquire_or_raise(
            session_id,
            run_recheck_workflow,
            run_id=run_id,
            edited_draft=body.draft
        )
        await task
    except RunnerAlreadyActiveError:
        raise HTTPException(status_code=409, detail="A re-check is already in progress.")

    from agents.workflow import create_workflow
    workflow = create_workflow()
    config = {"configurable": {"thread_id": session_id}}
    st = await workflow.aget_state(config)
    vals = st.values if st else {}
    
    clean_draft = normalize_protocol_markdown(body.draft)
    v_hash = hashlib.sha256(clean_draft.encode("utf-8")).hexdigest()[:16]

    db = get_db_session()
    try:
        db_sess = db.query(ProtocolSession).filter(ProtocolSession.session_id == session_id).first()
        meta = dict(db_sess.meta_data or {}) if db_sess else {}
    finally:
        db.close()

    val_passed = bool(meta.get("validation_passed", True))
    val_scores = meta.get("validated_scores", {})
    safety_score = val_scores.get("safety", vals.get("safety_score", 0.9))
    empathy_score = val_scores.get("empathy", vals.get("empathy_score", 4.0))
    clinical_score = val_scores.get("clinical", vals.get("clinical_score", 4.0))

    return ValidationResult(
        session_id=session_id,
        safety_score=safety_score,
        empathy_score=empathy_score,
        clinical_score=clinical_score,
        safety_checks=vals.get("safety_checks", {}),
        agent_notes=[],
        validated_hash=v_hash,
        passed=val_passed
    )

@app.post("/api/protocols/{session_id}/approve")
async def approve_protocol(
    session_id: str,
    request: ApproveRequest,
    x_session_token: Optional[str] = Header(None, alias="X-Session-Token")
):
    """Clinician sign-off and protocol finalization with strict re-check enforcement (Q1)"""
    sess = verify_session_access(session_id, x_session_token)

    from agents.workflow import create_workflow
    workflow = create_workflow()
    config = {"configurable": {"thread_id": session_id}}
    st = await workflow.aget_state(config)
    
    if not st.values:
        raise HTTPException(status_code=404, detail="Session not found")
        
    updated_state = st.values.copy()
    current_draft_raw = updated_state.get("current_draft", "")
    clean_draft = normalize_protocol_markdown(request.approved_content or current_draft_raw)
    approved_hash = hashlib.sha256(clean_draft.encode("utf-8")).hexdigest()[:16]
    current_draft_hash = hashlib.sha256(normalize_protocol_markdown(current_draft_raw).encode("utf-8")).hexdigest()[:16]
    
    is_edited = bool(request.edited or (request.approved_content is not None and approved_hash != current_draft_hash))

    # Read validation records from DB session
    db = get_db_session()
    try:
        db_sess = db.query(ProtocolSession).filter(ProtocolSession.session_id == session_id).first()
        db_meta = dict(db_sess.meta_data or {}) if db_sess else {}
    finally:
        db.close()

    last_val_hash = db_meta.get("last_validated_hash") or updated_state.get("validated_hash")
    val_passed = bool(db_meta.get("validation_passed") if "validation_passed" in db_meta else updated_state.get("validation_passed", False))

    # Server-side enforcement (Q1): If edited, require passing validation matching approved content hash
    if is_edited:
        if not (val_passed and last_val_hash == approved_hash and request.validated_hash == approved_hash):
            raise HTTPException(
                status_code=409,
                detail={
                    "code": "recheck_required",
                    "message": "Edits must be re-checked by AI safety and clinical review before approval."
                }
            )

    rechecked = bool(is_edited and val_passed and last_val_hash == approved_hash)
    approver = request.approved_by or "You"
    
    scores_at_approval = {
        "safety": updated_state.get("safety_score"),
        "empathy": updated_state.get("empathy_score"),
        "clinical": updated_state.get("clinical_score")
    }

    audit = {
        "approved_by": approver,
        "approved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "edited": is_edited,
        "rechecked": rechecked,
        "validated_hash": approved_hash if (not is_edited or rechecked) else (last_val_hash or ""),
        "scores_at_approval": scores_at_approval,
        "content_hash": approved_hash,
        "app_version": "3.0.0"
    }

    updated_state["current_draft"] = clean_draft
    updated_state["human_approved"] = True
    updated_state["halted"] = False
    updated_state["status"] = "approved"
    updated_state["approval_audit"] = audit
    await workflow.aupdate_state(config, updated_state, as_node="supervisor")

    # Update database session
    db = get_db_session()
    try:
        db_sess = db.query(ProtocolSession).filter(ProtocolSession.session_id == session_id).first()
        if db_sess:
            meta = dict(db_sess.meta_data or {})
            meta["approval_audit"] = audit
            db_sess.meta_data = meta
            db_sess.status = "approved"
            db_sess.final_protocol = clean_draft
            db.commit()
    finally:
        db.close()

    emit_event(
        session_id=session_id,
        run_id=sess.current_run_id or "run_final",
        run_kind="approval",
        draft_version=len(updated_state.get("draft_history", [])) or updated_state.get("current_version", 1),
        agent="Human",
        event_type="approval",
        text_content=f"Protocol approved by {approver}",
        severity="info",
        data=audit
    )

    emit_event(
        session_id=session_id,
        run_id=sess.current_run_id or "run_final",
        run_kind="approval",
        draft_version=len(updated_state.get("draft_history", [])) or updated_state.get("current_version", 1),
        agent="System",
        event_type="run_end",
        text_content="Workflow completed and protocol finalized.",
        severity="info",
        data={"status": "approved", "audit": audit}
    )

    return {
        "session_id": session_id,
        "status": "approved",
        "message": "Protocol approved and finalized",
        "approval_audit": audit,
        "audit": audit,
        "final_state": serialize_state_for_json(updated_state)
    }

@app.get("/api/protocols/{session_id}/state")
async def get_protocol_state(
    session_id: str,
    x_session_token: Optional[str] = Header(None, alias="X-Session-Token")
):
    """Retrieve full session state (requires valid session token)"""
    verify_session_access(session_id, x_session_token)
    
    from agents.workflow import create_workflow
    workflow = create_workflow()
    config = {"configurable": {"thread_id": session_id}}
    st = await workflow.aget_state(config)
    
    if not st or not st.values:
        db = get_db_session()
        try:
            sess = db.query(ProtocolSession).filter(ProtocolSession.session_id == session_id).first()
            if sess and sess.current_draft:
                return {
                    "session_id": session_id,
                    "state": {
                        "session_id": session_id,
                        "user_intent": sess.user_intent,
                        "status": sess.status,
                        "current_draft": sess.current_draft,
                        "current_version": 1
                    }
                }
        finally:
            db.close()
        raise HTTPException(status_code=404, detail="Session state not found")
        
    return {
        "session_id": session_id,
        "state": serialize_state_for_json(st.values)
    }

@app.get("/api/protocols")
async def list_protocols(limit: int = 20, offset: int = 0):
    """Disabled endpoint (A4): never enumerates sessions publicly"""
    return {"protocols": [], "limit": limit, "offset": offset}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
