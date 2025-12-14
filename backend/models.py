"""
Pydantic models for API requests and responses
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

