"""
Cerina Protocol Foundry - FastAPI Backend
Main API server for the multi-agent CBT exercise generation system.
"""

# Load environment variables first, before any other imports
from dotenv import load_dotenv
load_dotenv()

from fastapi import FastAPI, HTTPException, BackgroundTasks
from contextlib import asynccontextmanager
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from typing import Optional, List, Dict, Any
import asyncio
import json
import logging
import sys
from datetime import datetime
from typing import Any

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger(__name__)

from agents.workflow import create_workflow
from database import get_db_session, init_db
from models import ProtocolRequest, ProtocolResponse, ProtocolStatus, ApproveRequest

# Temporary storage for session intents (until checkpoint is created)
# This is used as a fallback if checkpoint creation fails in create endpoint
_session_intents: Dict[str, str] = {}

def serialize_state_for_json(state: Dict[str, Any]) -> Dict[str, Any]:
    """Convert state to JSON-serializable format by converting datetime objects to strings"""
    if not state:
        return {}
    
    serialized = {}
    for key, value in state.items():
        if isinstance(value, datetime):
            serialized[key] = value.isoformat()
        elif isinstance(value, dict):
            serialized[key] = serialize_state_for_json(value)
        elif isinstance(value, list):
            serialized[key] = [
                serialize_state_for_json(item) if isinstance(item, dict) else 
                item.isoformat() if isinstance(item, datetime) else item
                for item in value
            ]
        else:
            serialized[key] = value
    return serialized

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

# CORS middleware
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "https://cerina-protocol-foundry.vercel.app",
        "https://54.147.175.216",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Request logging middleware
@app.middleware("http")
async def log_requests(request, call_next):
    logger.info(f"=== INCOMING REQUEST ===")
    logger.info(f"Method: {request.method}")
    logger.info(f"URL: {request.url}")
    logger.info(f"Path: {request.url.path}")
    logger.info(f"Headers: {dict(request.headers)}")
    try:
        response = await call_next(request)
        logger.info(f"Response status: {response.status_code} for {request.method} {request.url.path}")
        return response
    except Exception as e:
        logger.error(f"Error processing request {request.method} {request.url.path}: {e}", exc_info=True)
        raise

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
        logger.error(f"Background: Error executing workflow for {session_id}: {e}")

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
                        
                        # Extract agent activity from state
                        agent_notes = full_state.get("agent_notes", [])
                        recent_note = agent_notes[-1] if agent_notes else None
                        agent_thought = recent_note.get("note", "") if recent_note else ""
                        
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
    If approved_content is provided, it replaces the current draft.
    """
    logger.info(f"Approve endpoint accessed for session: {session_id}")
    try:
        workflow = create_workflow()
        config = {"configurable": {"thread_id": session_id}}
        
        # Get current state
        logger.info(f"Getting current state for session: {session_id}")
        current_state = await workflow.aget_state(config)
        
        if not current_state.values:
            logger.error(f"Session not found: {session_id}")
            raise HTTPException(status_code=404, detail="Session not found")
        
        # Update with approved content if provided
        updated_state = current_state.values.copy()
        has_edits = False
        if request.approved_content:
            # Check if content actually changed
            current_draft = current_state.values.get("current_draft", "")
            if request.approved_content.strip() != current_draft.strip():
                logger.info(f"Updating draft with approved content (length: {len(request.approved_content)})")
                updated_state["current_draft"] = request.approved_content
                updated_state["human_edits"] = request.approved_content
                has_edits = True
            else:
                logger.info("Approved content is same as current draft, no edits made")
        
        # Add note to state about approval
        from agents.state import add_agent_note
        approval_message = "Protocol approved and finalized" + (" (with edits)" if has_edits else "")
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
        logger.info("State persisted successfully")
        
        # Resume workflow - invoke will continue from the updated state
        # Since human_approved is True, should_continue will route to "end"
        logger.info("Resuming workflow execution...")
        result = await workflow.ainvoke(None, config)  # Use None to load from checkpoint
        logger.info(f"Workflow completed. Final status: {result.get('status')}")
        
        # Add finalization note
        if result.get("status") == "completed":
            from agents.state import add_agent_note
            result = add_agent_note(
                result,
                "System",
                "Protocol generation completed successfully",
                priority="info"
            )
            # Update the checkpoint with the final note
            await workflow.aupdate_state(config, result)
        
        return {
            "session_id": session_id,
            "status": "approved",
            "message": "Protocol approved and workflow resumed",
            "final_state": result
        }
    except Exception as e:
        import traceback
        error_detail = f"{str(e)}\n{traceback.format_exc()}"
        logger.error(f"Error approving protocol for session {session_id}: {error_detail}")
        raise HTTPException(status_code=500, detail=str(e))

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

