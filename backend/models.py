"""
Pydantic models for API requests and responses
Cerina Protocol Foundry
"""

from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from datetime import datetime
from enum import Enum

class ProtocolStatus(str, Enum):
    INITIALIZING = "initializing"
    RUNNING = "running"
    AWAITING_APPROVAL = "awaiting_approval"
    APPROVED = "approved"
    COMPLETED = "completed"
    FAILED = "failed"
    HALTED = "halted"

class AgentNote(BaseModel):
    agent_id: str
    severity: str = "suggestion"  # "suggestion" | "warning" | "critical" | "info"
    message: str
    created_at: Optional[str] = None

class ProtocolRequest(BaseModel):
    intent: str = Field(..., description="User intent for the CBT exercise")
    session_id: Optional[str] = Field(None, description="Optional custom session ID")
    metadata: Optional[Dict[str, Any]] = Field(default_factory=dict)

class ProtocolResponse(BaseModel):
    session_id: str
    status: str
    message: str
    timestamp: Optional[datetime] = Field(default_factory=datetime.now)

class AgentAction(BaseModel):
    agent_name: str
    action: str
    reasoning: str
    timestamp: datetime = Field(default_factory=datetime.now)

class ProtocolDraft(BaseModel):
    content: str
    version: int
    safety_score: Optional[float] = None
    empathy_score: Optional[float] = None
    iteration: int = 0

class ApproveRequest(BaseModel):
    approved_content: Optional[str] = Field(None, description="Optional edited content to replace the draft")
    edited: bool = Field(False, description="True if clinician made modifications")
    validated_hash: Optional[str] = Field(None, description="Hash of the revalidated content")
    approved_by: Optional[str] = Field("Clinical Supervisor", description="Identifier of the approving clinician")

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

class ErrorEnvelope(BaseModel):
    code: str
    message: str
    retryable: bool = False
