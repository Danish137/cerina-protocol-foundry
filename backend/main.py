import os
import re
import sys
import uuid
import json
import asyncio
import hashlib
import logging
from datetime import datetime
from typing import Optional, List, Dict, Any
from contextlib import asynccontextmanager

from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException, BackgroundTasks, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from fastapi.encoders import jsonable_encoder

# Configure logging with single handler check
logger = logging.getLogger("cerina")
if not logger.handlers:
    logger.setLevel(logging.INFO)
    handler = logging.StreamHandler(sys.stdout)
    handler.setFormatter(logging.Formatter('%(asctime)s - %(name)s - %(levelname)s - %(message)s'))
    logger.addHandler(handler)

from agents.workflow import create_workflow
from database import get_db_session, init_db
from models import (
    ProtocolRequest,
    ProtocolResponse,
    ProtocolStatus,
    ApproveRequest,
    RevalidateRequest,
    ValidationResult,
    AgentNote,
    ErrorEnvelope,
)

# Temporary storage for session intents (until checkpoint is created)
_session_intents: Dict[str, str] = {}

def format_agent_notes(raw_notes: List[Any]) -> List[Dict[str, Any]]:
    """Normalize agent notes, strip raw prefixes, and assign clean severity."""
    formatted = []
    agent_id_map = {
        "SafetyGuardian": "safety_guardian",
        "ClinicalCritic": "clinical_critic",
        "Drafter": "drafter",
        "Supervisor": "supervisor",
        "Human": "human",
        "System": "system",
    }
    for note_item in (raw_notes or []):
        if not isinstance(note_item, dict):
            continue
        raw_agent = note_item.get("agent_name", "system")
        agent_id = agent_id_map.get(raw_agent, raw_agent.lower())
        raw_text = note_item.get("note", "").strip()
        priority = note_item.get("priority", "info")
        ts = note_item.get("timestamp")
        created_at = ts.isoformat() if isinstance(ts, datetime) else str(ts or "")

        clean_text = raw_text
        for prefix in ["IMPROVEMENT NEEDED:", "SAFETY ISSUE:", "CRITICAL:", "RECOMMENDATION:"]:
            if clean_text.upper().startswith(prefix):
                clean_text = clean_text[len(prefix):].strip()
                break

        severity = "suggestion"
        if priority == "critical" or "SAFETY ISSUE" in raw_text.upper() or "FAIL" in raw_text.upper():
            severity = "critical"
        elif priority == "warning":
            severity = "warning"
        elif priority == "info":
            severity = "info"

        formatted.append({
            "agent_id": agent_id,
            "severity": severity,
            "message": clean_text,
            "created_at": created_at
        })
    return formatted

def serialize_state_for_json(state: Any) -> Any:
    """JSON-serializable encoder using FastAPI jsonable_encoder with normalized notes."""
    if state is None:
        return None
    encoded = jsonable_encoder(state)
    if isinstance(encoded, dict) and "agent_notes" in encoded:
        encoded["agent_notes"] = format_agent_notes(state.get("agent_notes", []))
    return encoded

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Initialize database and async checkpointer on startup
    logger.info("Starting application lifespan...")
    try:
        logger.info("Initializing database...")
        init_db()
        logger.info("Database initialized successfully")
    except Exception as e:
        logger.error(f"Failed to initialize database: {e}", exc_info=True)
        raise
    
    try:
        logger.info("Initializing async checkpointer...")
        from agents.workflow import init_checkpointer_async
        await init_checkpointer_async()
        logger.info("Async checkpointer initialized successfully")
    except Exception as e:
        logger.warning(f"Could not initialize async checkpointer (this is okay): {e}")
        pass
    
    logger.info("Application startup complete")
    try:
        yield
    finally:
        logger.info("Shutting down application...")
        try:
            from agents.workflow import close_checkpointer_async
            await close_checkpointer_async()
        except Exception:
            pass
        logger.info("Application shutdown complete")


app = FastAPI(title="Cerina Protocol Foundry API", version="1.0.0", lifespan=lifespan)

# CORS configuration
APP_ENV = os.getenv("APP_ENV", "development")
cors_origins_env = os.getenv("CORS_ORIGINS", "")
allowed_origins = [o.strip() for o in cors_origins_env.split(",") if o.strip()]
if not allowed_origins:
    allowed_origins = [
        "http://localhost:3000",
        "http://localhost:3001",
        "http://localhost:3002",
        "http://localhost:5173",
        "http://localhost:5174",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:3001",
        "http://127.0.0.1:3002",
        "http://127.0.0.1:5173",
        "http://127.0.0.1:5174",
        "https://cerina-protocol-foundry.vercel.app",
    ]

cors_kwargs: Dict[str, Any] = {
    "allow_origins": allowed_origins,
    "allow_credentials": False,
    "allow_methods": ["*"],
    "allow_headers": ["*"],
}
if APP_ENV == "development":
    cors_kwargs["allow_origin_regex"] = r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$"

app.add_middleware(CORSMiddleware, **cors_kwargs)

# Clean request logging middleware with request ID
@app.middleware("http")
async def log_requests(request: Request, call_next):
    req_id = uuid.uuid4().hex[:8]
    logger.info(f"[{req_id}] {request.method} {request.url.path}")
    try:
        response: Response = await call_next(request)
        response.headers["X-Request-ID"] = req_id
        logger.info(f"[{req_id}] {response.status_code} {request.method} {request.url.path}")
        return response
    except Exception as e:
        logger.error(f"[{req_id}] Error: {e}", exc_info=True)
        return JSONResponse(
            status_code=500,
            content={"code": "INTERNAL_ERROR", "message": "An unexpected error occurred. Please retry.", "retryable": True},
            headers={"X-Request-ID": req_id}
        )

# Note: startup/shutdown logic handled by the `lifespan` context manager

@app.get("/")
async def root():
    logger.info("Root endpoint accessed")
    return {"message": "Cerina Protocol Foundry API", "status": "running"}

@app.get("/health")
async def health():
    logger.info("Health check endpoint accessed")
    return {"status": "healthy", "timestamp": datetime.now().isoformat()}

async def start_workflow_background(workflow, config, session_id: str):
    """Start workflow execution in background"""
    try:
        logger.info(f"Background: Starting workflow execution for session: {session_id}")
        # Small delay to ensure checkpoint is created
        await asyncio.sleep(0.5)
        
        # Start workflow execution
        async for event in workflow.astream(None, config, stream_mode="updates"):
            logger.info(f"Background: Workflow event for {session_id}: {list(event.keys())}")
            # Workflow will run and update checkpoints automatically
            # We just need to consume the stream to trigger execution
            for node_name, state_update in event.items():
                # Check if workflow should halt
                current_state = await workflow.aget_state(config)
                if current_state.values:
                    full_state = current_state.values
                    if full_state.get("halted") or full_state.get("status") == "awaiting_approval":
                        logger.info(f"Background: Workflow halted for session: {session_id}")
                        break
        logger.info(f"Background: Workflow execution completed for session: {session_id}")
    except Exception as e:
        logger.error(f"Background: Error executing workflow for {session_id}: {e}", exc_info=True)
        try:
            from agents.state import add_agent_note
            current_state = await workflow.aget_state(config)
            err_state = current_state.values.copy() if (current_state and current_state.values) else {}
            err_state["status"] = "error"
            err_state = add_agent_note(
                err_state,
                "System",
                f"Workflow execution failed: {str(e)}",
                priority="critical"
            )
            await workflow.aupdate_state(config, err_state)
            logger.info(f"Recorded error state for session: {session_id}")
        except Exception as record_err:
            logger.error(f"Could not record error state: {record_err}")

@app.post("/api/protocols/create", response_model=ProtocolResponse)
async def create_protocol(request: ProtocolRequest, background_tasks: BackgroundTasks):
    """
    Create a new CBT protocol. Returns immediately with a session ID.
    The workflow runs asynchronously and can be monitored via /api/protocols/{session_id}/stream
    """
    logger.info(f"Received create protocol request: intent='{request.intent[:50]}...'")
    try:
        from agents.state import create_initial_state
        
        logger.info("Creating workflow instance...")
        # Create workflow instance
        workflow = create_workflow()
        logger.info("Workflow created successfully")
        
        # Initialize state
        session_id = request.session_id or f"session_{datetime.now().timestamp()}"
        logger.info(f"Session ID: {session_id}")
        
        # Store intent temporarily in case checkpoint creation fails
        _session_intents[session_id] = request.intent
        logger.info("Stored intent in temporary storage")
        
        logger.info("Creating initial state...")
        initial_state = create_initial_state(
            user_intent=request.intent,
            session_id=session_id,
            max_iterations=5
        )
        logger.info("Initial state created")
        
        # Store initial state - workflow will run when stream endpoint is accessed
        # We'll just return the session_id, and stream endpoint will handle execution
        config = {"configurable": {"thread_id": session_id}}
        
        # Try to create checkpoint with initial state
        # This is optional - if it fails, stream endpoint will create it
        checkpoint_created = False
        try:
            logger.info("Attempting to create checkpoint...")
            # Try to create a checkpoint entry
            if hasattr(workflow, 'aupdate_state'):
                try:
                    await workflow.aupdate_state(config, initial_state)
                    checkpoint_created = True
                    logger.info("Checkpoint created successfully")
                except (AttributeError, TypeError, Exception) as update_error:
                    # aupdate_state might not be available or might fail
                    # This is okay - stream endpoint will handle it
                    logger.warning(f"Could not pre-create checkpoint: {update_error}")
                    pass
            else:
                logger.info("Workflow does not have aupdate_state method")
        except Exception as e:
            # This is not critical - stream endpoint will create the state
            logger.warning(f"Checkpoint creation skipped, stream will handle it: {e}")
            pass
        
        # Clean up temporary storage if checkpoint was created successfully
        if checkpoint_created:
            _session_intents.pop(session_id, None)
            logger.info("Cleaned up temporary intent storage")
        
        logger.info(f"Protocol creation successful. Session ID: {session_id}")
        
        # Start workflow execution in background for MCP/API usage
        # (React UI will trigger via stream endpoint, but MCP needs it to start automatically)
        background_tasks.add_task(start_workflow_background, workflow, config, session_id)
        
        return ProtocolResponse(
            session_id=session_id,
            status="initializing",
            message="Protocol generation initialized. Workflow execution started."
        )
    except Exception as e:
        import traceback
        error_detail = f"{str(e)}\n{traceback.format_exc()}"
        logger.error(f"ERROR creating protocol: {error_detail}")
        print(f"ERROR creating protocol: {error_detail}", file=sys.stderr)
        raise HTTPException(status_code=500, detail=f"Failed to create protocol: {str(e)}")

@app.get("/api/protocols/{session_id}/stream")
async def stream_protocol(session_id: str):
    """
    Stream real-time updates from the agent workflow.
    Returns Server-Sent Events (SSE) with state updates.
    """
    logger.info(f"Stream endpoint accessed for session: {session_id}")
    async def event_generator():
        try:
            from agents.state import create_initial_state
            
            logger.info(f"Creating workflow for session: {session_id}")
            workflow = create_workflow()
            config = {"configurable": {"thread_id": session_id}}
            
            # Get current state first
            logger.info(f"Getting current state for session: {session_id}")
            current_state = await workflow.aget_state(config)
            logger.info(f"Current state retrieved: {current_state.values is not None}")
            
            # Check if workflow is already completed or halted
            if current_state.values:
                status = current_state.values.get("status", "")
                halted = current_state.values.get("halted", False)
                if status in ["completed"]:
                    # Workflow is done - just send current state
                    serialized_state = serialize_state_for_json(current_state.values)
                    yield {
                        "event": "complete",
                        "data": json.dumps({
                            "state": serialized_state,
                            "timestamp": datetime.now().isoformat()
                        })
                    }
                    return
                elif halted or status == "awaiting_approval":
                    # Workflow is halted - send halted event with current state
                    serialized_state = serialize_state_for_json(current_state.values)
                    yield {
                        "event": "halted",
                        "data": json.dumps({
                            "state": serialized_state,
                            "message": "Workflow paused for human review",
                            "timestamp": datetime.now().isoformat()
                        })
                    }
                    # Keep connection open but don't execute workflow
                    # Wait for user to approve
                    return
            
            # Determine initial state - if workflow hasn't run, we need to start it
            if not current_state.values or current_state.values.get("status") == "initializing":
                logger.info(f"No checkpoint found or status is initializing for session: {session_id}")
                # Workflow hasn't started - we need to create initial state
                if current_state.values:
                    initial_state = current_state.values
                    logger.info("Using state from checkpoint")
                else:
                    # No state found in checkpoint - try to get from temporary storage
                    if session_id in _session_intents:
                        user_intent = _session_intents[session_id]
                        logger.info(f"Creating initial state from temporary storage for intent: {user_intent[:50]}...")
                        from agents.state import create_initial_state
                        initial_state = create_initial_state(
                            user_intent=user_intent,
                            session_id=session_id,
                            max_iterations=5
                        )
                        # Create checkpoint with initial state
                        logger.info("Creating checkpoint with initial state...")
                        await workflow.aupdate_state(config, initial_state)
                        logger.info("Checkpoint created successfully")
                        # Clean up temporary storage
                        _session_intents.pop(session_id, None)
                    else:
                        # No state found and no temporary storage
                        logger.error(f"No initial state found for session: {session_id}")
                        yield {
                            "event": "error",
                            "data": json.dumps({"error": "No initial state found. Please create protocol first using /api/protocols/create endpoint."})
                        }
                        return
            else:
                # Workflow has state - continue from current
                initial_state = current_state.values
                logger.info(f"Continuing workflow from checkpoint. Status: {initial_state.get('status')}")
                
                # If already halted, don't execute
                if initial_state.get("halted") or initial_state.get("status") == "awaiting_approval":
                    logger.info("Workflow is already halted")
                    serialized_state = serialize_state_for_json(initial_state)
                    yield {
                        "event": "halted",
                        "data": json.dumps({
                            "state": serialized_state,
                            "message": "Workflow is already paused for human review",
                            "timestamp": datetime.now().isoformat()
                        })
                    }
                    return
            
            # Stream workflow execution - this will run/continue the workflow and emit events
            # Only stream if workflow is not already completed or halted
            if initial_state.get("status") not in ["completed", "awaiting_approval"]:
                logger.info(f"Starting workflow execution for session: {session_id}")
                logger.info(f"Initial state status: {initial_state.get('status')}")
                logger.info(f"Initial state has draft: {bool(initial_state.get('current_draft'))}")
                
                # Use astream with None to continue from checkpoint
                # The checkpoint already has the state, so we pass None
                async for event in workflow.astream(None, config, stream_mode="updates"):
                    logger.info(f"Received workflow event: {list(event.keys())}")
                    for node_name, state_update in event.items():
                        logger.info(f"Processing node: {node_name}")
                        # Get the full current state after this update
                        current_full_state = await workflow.aget_state(config)
                        full_state = current_full_state.values if current_full_state else {}
                        
                        logger.info(f"Node {node_name} - Status: {full_state.get('status')}, Active Agent: {full_state.get('active_agent')}")
                        
                        # Extract agent activity from state correctly matched to current node
                        agent_notes = full_state.get("agent_notes", [])
                        agent_map = {
                            "draft": "Drafter",
                            "safety_review": "SafetyGuardian",
                            "clinical_critique": "ClinicalCritic",
                            "supervisor": "Supervisor",
                        }
                        expected_agent = agent_map.get(node_name)
                        matching_notes = [n for n in agent_notes if n.get("agent_name") == expected_agent]
                        recent_note = matching_notes[-1] if matching_notes else (agent_notes[-1] if agent_notes else None)
                        agent_thought = recent_note.get("note", "") if recent_note else f"Completed {node_name} evaluation"
                        
                        # Send node execution event with full state
                        logger.info(f"Sending state_update event for node: {node_name}")
                        # Serialize state to make datetime objects JSON-compatible
                        serialized_state = serialize_state_for_json(full_state)
                        yield {
                            "event": "state_update",
                            "data": json.dumps({
                                "node": node_name,
                                "state": serialized_state,  # Send serialized full state
                                "agent_thought": agent_thought,
                                "active_agent": full_state.get("active_agent"),
                                "timestamp": datetime.now().isoformat()
                            })
                        }
                        
                        # Check if workflow should halt (either manually or by supervisor)
                        if full_state.get("halted") or full_state.get("status") == "awaiting_approval":
                            logger.info(f"Workflow halted at node: {node_name}")
                            # Send halt event
                            yield {
                                "event": "halted",
                                "data": json.dumps({
                                    "state": serialized_state,
                                    "message": "Workflow paused for human review",
                                    "timestamp": datetime.now().isoformat()
                                })
                            }
                            break
            else:
                logger.info(f"Workflow not executed - status is: {initial_state.get('status')}")
            
            # Send final state
            logger.info(f"Getting final state for session: {session_id}")
            final_state = await workflow.aget_state(config)
            final_state_values = final_state.values if final_state else {}
            serialized_final_state = serialize_state_for_json(final_state_values)
            yield {
                "event": "complete",
                "data": json.dumps({
                    "state": serialized_final_state,
                    "timestamp": datetime.now().isoformat()
                })
            }
        except Exception as e:
            import traceback
            error_detail = f"{str(e)}\n{traceback.format_exc()}"
            logger.error(f"Error in stream endpoint for session {session_id}: {error_detail}")
            yield {
                "event": "error",
                "data": json.dumps({"error": str(e), "detail": error_detail})
            }
    
    async def format_sse(data: Dict[str, Any]):
        """Format data as SSE"""
        event = data.get("event", "message")
        payload = data.get("data", "")
        return f"event: {event}\ndata: {payload}\n\n"
    
    async def generate():
        async for event_data in event_generator():
            yield await format_sse(event_data)
    
    return StreamingResponse(generate(), media_type="text/event-stream")

@app.get("/api/protocols/{session_id}/state")
async def get_protocol_state(session_id: str):
    """Get current state of a protocol generation session"""
    try:
        workflow = create_workflow()
        config = {"configurable": {"thread_id": session_id}}
        
        state = await workflow.aget_state(config)
        
        # Serialize state to make datetime objects JSON-compatible
        serialized_state = serialize_state_for_json(state.values) if state.values else None
        
        return {
            "session_id": session_id,
            "state": serialized_state,
            "next": state.next,
            "metadata": state.metadata
        }
    except Exception as e:
        raise HTTPException(status_code=404, detail=f"Session not found: {str(e)}")

@app.post("/api/protocols/{session_id}/approve")
async def approve_protocol(session_id: str, request: ApproveRequest):
    """
    Human-in-the-loop: Approve the current draft and continue workflow.
    Strips HTML comments server-side and stores approval audit metadata.
    """
    logger.info(f"Approve endpoint accessed for session: {session_id}")
    try:
        workflow = create_workflow()
        config = {"configurable": {"thread_id": session_id}}
        
        current_state = await workflow.aget_state(config)
        if not current_state.values:
            logger.error(f"Session not found: {session_id}")
            raise HTTPException(status_code=404, detail="Session not found")
        
        updated_state = current_state.values.copy()
        current_draft_raw = current_state.values.get("current_draft", "") or ""
        
        # Strip HTML comments server-side
        clean_current_draft = re.sub(r'<!--.*?-->', '', current_draft_raw, flags=re.DOTALL).strip()
        
        has_edits = request.edited
        if request.approved_content is not None:
            clean_approved = re.sub(r'<!--.*?-->', '', request.approved_content, flags=re.DOTALL).strip()
            if clean_approved != clean_current_draft:
                has_edits = True
            updated_state["current_draft"] = clean_approved
            updated_state["human_edits"] = clean_approved
        else:
            updated_state["current_draft"] = clean_current_draft

        # Audit record
        audit = {
            "approved_by": request.approved_by or "Clinical Supervisor",
            "approved_at": datetime.now().isoformat(),
            "scores_at_approval": {
                "safety": updated_state.get("safety_score"),
                "empathy": updated_state.get("empathy_score"),
                "clinical": updated_state.get("clinical_score"),
            },
            "edited": has_edits,
            "validated_hash": request.validated_hash,
            "revalidated": bool(request.validated_hash),
        }
        updated_state["approval_audit"] = audit

        # Add note to state about approval
        from agents.state import add_agent_note
        approval_message = "Protocol approved and finalized" + (" (with clinical edits)" if has_edits else "")
        updated_state = add_agent_note(
            updated_state,
            "Human",
            approval_message,
            priority="info"
        )
        
        updated_state["human_approved"] = True
        updated_state["halted"] = False
        updated_state["status"] = "approved"
        
        # Persist the approved state
        logger.info("Persisting approved state to checkpoint...")
        await workflow.aupdate_state(config, updated_state)
        
        # Resume workflow
        logger.info("Resuming workflow execution...")
        result = await workflow.ainvoke(None, config)
        
        # Ensure draft in final result also has stripped comments and audit
        if result:
            if result.get("current_draft"):
                result["current_draft"] = re.sub(r'<!--.*?-->', '', result["current_draft"], flags=re.DOTALL).strip()
            result["approval_audit"] = audit
            if result.get("status") == "completed":
                result = add_agent_note(
                    result,
                    "System",
                    "Protocol generation completed successfully",
                    priority="info"
                )
            await workflow.aupdate_state(config, result)
        
        return {
            "session_id": session_id,
            "status": "approved",
            "message": "Protocol approved and workflow resumed",
            "approval_audit": audit,
            "final_state": serialize_state_for_json(result)
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error approving protocol for session {session_id}: {e}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"code": "APPROVE_FAILED", "message": "Failed to approve protocol. Please retry.", "retryable": True}
        )

@app.post("/api/protocols/{session_id}/revalidate", response_model=ValidationResult)
async def revalidate_protocol(session_id: str, request: RevalidateRequest):
    """
    Human-in-the-loop: Re-run Safety Guardian and Clinical Critic on edited draft content
    without restarting the entire workflow. Returns updated scores and normalized agent notes.
    """
    logger.info(f"Revalidate endpoint accessed for session: {session_id}")
    try:
        workflow = create_workflow()
        config = {"configurable": {"thread_id": session_id}}
        current_state = await workflow.aget_state(config)
        
        if not current_state.values:
            raise HTTPException(status_code=404, detail="Session not found")
        
        state_copy = current_state.values.copy()
        clean_draft = re.sub(r'<!--.*?-->', '', request.draft, flags=re.DOTALL).strip()
        state_copy["current_draft"] = clean_draft
        
        from agents.workflow import safety_guardian, clinical_critic
        safety_result = await safety_guardian.review(state_copy)
        if "safety_checks" in safety_result:
            state_copy.setdefault("safety_checks", {})
            state_copy["safety_checks"].update(safety_result["safety_checks"])
        if "safety_score" in safety_result:
            state_copy["safety_score"] = safety_result["safety_score"]
            
        clinical_result = await clinical_critic.critique(state_copy)
        if "empathy_score" in clinical_result:
            state_copy["empathy_score"] = clinical_result["empathy_score"]
        if "clinical_score" in clinical_result:
            state_copy["clinical_score"] = clinical_result["clinical_score"]
            
        from agents.state import add_agent_note
        state_copy = add_agent_note(
            state_copy,
            "System",
            f"Safety & clinical re-check complete. Safety: {state_copy.get('safety_score', 0.8):.2f}, Empathy: {state_copy.get('empathy_score', 0.7):.2f}",
            priority="info"
        )
        
        validated_hash = hashlib.sha256(clean_draft.encode("utf-8")).hexdigest()[:16]
        state_copy["validated_hash"] = validated_hash
        
        # Persist updated metrics to checkpoint
        await workflow.aupdate_state(config, state_copy)
        
        raw_notes = state_copy.get("agent_notes", [])
        clean_notes = format_agent_notes(raw_notes)
        
        return ValidationResult(
            session_id=session_id,
            safety_score=state_copy.get("safety_score"),
            empathy_score=state_copy.get("empathy_score"),
            clinical_score=state_copy.get("clinical_score"),
            safety_checks=state_copy.get("safety_checks", {}),
            agent_notes=[AgentNote(**n) for n in clean_notes],
            validated_hash=validated_hash
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error revalidating protocol: {str(e)}", exc_info=True)
        raise HTTPException(
            status_code=500,
            detail={"code": "REVALIDATE_FAILED", "message": "Failed to revalidate draft against clinical safety thresholds. Please retry.", "retryable": True}
        )

@app.post("/api/protocols/{session_id}/halt")
async def halt_protocol(session_id: str):
    """Pause workflow execution for human review"""
    try:
        workflow = create_workflow()
        config = {"configurable": {"thread_id": session_id}}
        
        # Get current state
        current_state = await workflow.aget_state(config)
        
        if not current_state.values:
            raise HTTPException(status_code=404, detail="Session not found")
        
        # Update state to halt
        updated_state = current_state.values.copy()
        updated_state["status"] = "awaiting_approval"
        updated_state["halted"] = True
        
        # Add note to state about halt
        from agents.state import add_agent_note
        updated_state = add_agent_note(
            updated_state,
            "Human",
            "Workflow halted for review",
            priority="warning"
        )
        
        # Persist the halted state to checkpoint
        await workflow.aupdate_state(config, updated_state)
        
        return {
            "session_id": session_id,
            "status": "halted",
            "current_draft": updated_state.get("current_draft"),
            "message": "Workflow paused for human review"
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/api/protocols")
async def list_protocols(limit: int = 20, offset: int = 0):
    """List all protocol generation sessions"""
    # TODO: Implement database query
    return {"protocols": [], "limit": limit, "offset": offset}

if __name__ == "__main__":
    import uvicorn
    logger.info("Starting Cerina Protocol Foundry API server...")
    logger.info("Server will be available at http://0.0.0.0:8000")
    uvicorn.run(
        app, 
        host="0.0.0.0", 
        port=8000,
        log_level="info",
        access_log=True
    )

