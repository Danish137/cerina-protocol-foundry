"""
Pydantic models for API requests and responses
Cerina Protocol Foundry (Phase A Updates)
"""

from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from datetime import datetime, timezone
from enum import Enum

class ProtocolStatus(str, Enum):
    INITIALIZING = "initializing"
    GENERATING = "generating"
    AWAITING_APPROVAL = "awaiting_approval"
    APPROVED = "approved"
    COMPLETED = "completed"
    FAILED = "failed"
    HALTED = "halted"
    CARE_PANEL = "care_panel"

class AgentNote(BaseModel):
    agent_id: str
    severity: str = "suggestion"  # "suggestion" | "warning" | "critical" | "info"
    message: str
    created_at: Optional[str] = None

class ProtocolRequest(BaseModel):
    intent: str = Field(..., description="User intent for the CBT exercise")
    session_id: Optional[str] = Field(None, description="Optional custom session ID")
    review_depth: Optional[str] = Field("standard", description="standard | thorough (A7)")
    clinician_bypass: Optional[bool] = Field(False, description="True if clinician confirms designing protocol on high-risk topic (A10)")
    region_code: Optional[str] = Field("US", description="Region for crisis resources (US, IN, GB, IE)")
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)

class ProtocolResponse(BaseModel):
    session_id: str
    session_token: Optional[str] = Field(None, description="Secret token required for session authorization")
    status: str
    message: str
    run_id: Optional[str] = None
    review_depth: Optional[str] = "standard"
    care_resources: Optional[Dict[str, Any]] = None
    timestamp: Optional[str] = Field(default_factory=lambda: datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))

class ReviseRequest(BaseModel):
    instruction: Optional[str] = Field(None, description="Clinician instruction for revision")
    concern_ids: Optional[List[str]] = Field(default_factory=list, description="List of concern IDs to address")

class ApproveRequest(BaseModel):
    approved_content: Optional[str] = Field(None, description="Optional edited content to replace the draft")
    edited: bool = Field(False, description="True if clinician made modifications")
    validated_hash: Optional[str] = Field(None, description="Hash of the revalidated content")
    approved_by: Optional[str] = Field("You", description="Identifier of the approving clinician")

class RevalidateRequest(BaseModel):
    draft: str = Field(..., description="The edited CBT protocol draft to revalidate")

class ValidationResult(BaseModel):
    session_id: str
    safety_score: Optional[float] = None
    empathy_score: Optional[float] = None
    clinical_score: Optional[float] = None
    safety_checks: Dict[str, bool] = Field(default_factory=dict)
    agent_notes: List[AgentNote] = Field(default_factory=list)
    validated_hash: Optional[str] = None
    passed: bool = Field(True, description="True if validation passed quality thresholds")

class CapacityResponse(BaseModel):
    daily_budget: int
    calls_used: int
    remaining_calls: int
    remaining_runs_estimate: int
    resets_at: str
    exhausted: bool

class ErrorEnvelope(BaseModel):
    code: str
    message: str
    retryable: bool = False
