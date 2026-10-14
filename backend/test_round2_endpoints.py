import re
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from unittest.mock import AsyncMock, MagicMock, patch
import pytest
from fastapi.testclient import TestClient
from main import app, format_agent_notes

client = TestClient(app)

def test_comment_stripping():
    content = "## Clinical CBT Protocol\n<!-- Note: make empathy higher -->\nStep 1: Mindfulness exercise.\n<!-- Another comment -->"
    clean = re.sub(r'<!--.*?-->', '', content, flags=re.DOTALL).strip()
    assert "<!-- Note: make empathy higher -->" not in clean
    assert "<!-- Another comment -->" not in clean
    assert "Step 1: Mindfulness exercise." in clean

def test_format_agent_notes_strips_prefixes_and_assigns_severity():
    raw_notes = [
        {"agent_name": "ClinicalCritic", "note": "IMPROVEMENT NEEDED: Add more grounding steps", "priority": "warning"},
        {"agent_name": "SafetyGuardian", "note": "SAFETY ISSUE: Avoid absolute directives", "priority": "critical"},
        {"agent_name": "Drafter", "note": "Draft created successfully", "priority": "info"}
    ]
    formatted = format_agent_notes(raw_notes)
    assert len(formatted) == 3
    
    assert formatted[0]["agent_id"] == "clinical_critic"
    assert formatted[0]["message"] == "Add more grounding steps"
    assert formatted[0]["severity"] == "warning"
    
    assert formatted[1]["agent_id"] == "safety_guardian"
    assert formatted[1]["message"] == "Avoid absolute directives"
    assert formatted[1]["severity"] == "critical"

    assert formatted[2]["agent_id"] == "drafter"
    assert formatted[2]["message"] == "Draft created successfully"
    assert formatted[2]["severity"] == "info"

def test_health_endpoint():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json()["status"] == "healthy"
    assert "X-Request-ID" in response.headers

@patch("main.create_workflow")
def test_approve_endpoint_with_edits_and_comment_stripping(mock_create_workflow):
    mock_workflow = MagicMock()
    mock_state = MagicMock()
    mock_state.values = {
        "current_draft": "Original draft <!-- old comment -->",
        "agent_notes": [],
        "safety_score": 0.85,
        "empathy_score": 0.80,
        "clinical_score": 0.75,
        "status": "awaiting_approval"
    }
    mock_workflow.aget_state = AsyncMock(return_value=mock_state)
    mock_workflow.aupdate_state = AsyncMock()
    mock_workflow.ainvoke = AsyncMock(return_value={
        "status": "completed",
        "current_draft": "Edited content <!-- strip me -->",
        "safety_score": 0.85,
        "empathy_score": 0.80,
        "clinical_score": 0.75
    })
    mock_create_workflow.return_value = mock_workflow

    payload = {
        "approved_content": "Edited content <!-- strip me -->",
        "edited": True,
        "validated_hash": "abc123hash",
        "approved_by": "Dr. Smith"
    }
    response = client.post("/api/protocols/test-session-123/approve", json=payload)
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "approved"
    assert data["approval_audit"]["edited"] is True
    assert data["approval_audit"]["approved_by"] == "Dr. Smith"
    assert data["approval_audit"]["revalidated"] is True
    # Verify comments were stripped from updated draft passed to state
    update_call_args = mock_workflow.aupdate_state.call_args_list[0][0][1]
    assert "<!-- strip me -->" not in update_call_args["current_draft"]
    assert update_call_args["current_draft"] == "Edited content"

@patch("main.create_workflow")
def test_revalidate_endpoint_with_list_notes(mock_create_workflow):
    mock_workflow = MagicMock()
    mock_state = MagicMock()
    mock_state.values = {
        "current_draft": "Pre-edit draft",
        "agent_notes": [
            {"agent_name": "ClinicalCritic", "note": "IMPROVEMENT NEEDED: Clarify step 2", "priority": "warning"}
        ],
        "safety_score": 0.85,
        "empathy_score": 0.75,
        "clinical_score": 0.80
    }
    mock_workflow.aget_state = AsyncMock(return_value=mock_state)
    mock_workflow.aupdate_state = AsyncMock()
    mock_create_workflow.return_value = mock_workflow

    with patch("agents.workflow.safety_guardian.review", new=AsyncMock(return_value={"safety_score": 0.95, "safety_checks": {"overall": True}})), \
         patch("agents.workflow.clinical_critic.critique", new=AsyncMock(return_value={"empathy_score": 0.85, "clinical_score": 0.80})):
        
        payload = {"draft": "Updated clinical protocol <!-- temporary comment -->"}
        response = client.post("/api/protocols/test-session-123/revalidate", json=payload)
        assert response.status_code == 200
        data = response.json()
        assert data["safety_score"] == 0.95
        assert data["empathy_score"] == 0.85
        assert "validated_hash" in data
        assert isinstance(data["agent_notes"], list)
        assert data["agent_notes"][0]["message"] == "Clarify step 2"
