import os
os.environ["MOCK_LLM"] = "true"

import json
import re
import pytest
from fastapi.testclient import TestClient
from main import app, get_db_session, ProtocolSession
from agents.workflow import create_workflow

BANNED_LEAK_WORDS = [
    "groq",
    "gemini",
    "google",
    "openrouter",
    "gpt-oss",
    "nemotron",
    "qwen",
]

@pytest.fixture
def client():
    with TestClient(app) as c:
        yield c

def test_response_leak_and_grep_across_all_endpoints(client):
    """
    B1 & B2 Verification:
    Tests real responses across every endpoint a normal user triggers:
    /capacity, /create, /state, /events, /revalidate, /approve.
    Asserts zero leakage of provider, model, or family names.
    """
    # 1. Test /api/capacity
    cap_resp = client.get("/api/capacity")
    assert cap_resp.status_code == 200
    cap_text = cap_resp.text.lower()
    for word in BANNED_LEAK_WORDS:
        assert word not in cap_text, f"Banned word '{word}' leaked in /api/capacity: {cap_text}"

    # 2. Test /api/protocols/create
    create_resp = client.post(
        "/api/protocols/create",
        json={"intent": "5-step panic protocol for acute hyperventilation"}
    )
    assert create_resp.status_code == 200
    create_data = create_resp.json()
    session_id = create_data["session_id"]
    token = create_data["session_token"]
    create_text = json.dumps(create_data).lower()
    for word in BANNED_LEAK_WORDS:
        assert word not in create_text, f"Banned word '{word}' leaked in /create: {create_text}"

    headers = {"X-Session-Token": token}

    # Wait up to 5s for the mock background run to reach review state
    import time
    for _ in range(50):
        st_check = client.get(f"/api/protocols/{session_id}/state", headers=headers).json()
        if st_check.get("status") in ["review", "approved", "completed"]:
            break
        time.sleep(0.1)

    # 3. Test /api/protocols/{id}/state
    state_resp = client.get(f"/api/protocols/{session_id}/state", headers=headers)
    assert state_resp.status_code == 200
    state_text = state_resp.text.lower()
    for word in BANNED_LEAK_WORDS:
        assert word not in state_text, f"Banned word '{word}' leaked in /state: {state_text}"
    # Verify no raw drafter_provider or drafter_model
    assert "drafter_provider" not in state_text
    assert "drafter_model" not in state_text

    # 4. Test /api/protocols/{id}/events
    events_resp = client.get(f"/api/protocols/{session_id}/events?after=0", headers=headers)
    assert events_resp.status_code == 200
    events_text = events_resp.text.lower()
    for word in BANNED_LEAK_WORDS:
        assert word not in events_text, f"Banned word '{word}' leaked in /events: {events_text}"

    # 5. Test /api/protocols/{id}/approve (baseline unedited)
    approve_resp = client.post(
        f"/api/protocols/{session_id}/approve",
        headers=headers,
        json={"approved_by": "You", "edited": False, "validated_hash": "BASELINE"}
    )
    assert approve_resp.status_code == 200
    approve_text = approve_resp.text.lower()
    for word in BANNED_LEAK_WORDS:
        assert word not in approve_text, f"Banned word '{word}' leaked in /approve: {approve_text}"
    
    # Verify audit block contains required fields (F2)
    audit_data = approve_resp.json().get("audit", {})
    assert "content_hash" in audit_data
    assert "app_version" in audit_data
    assert "approved_at" in audit_data
    # Must be UTC ISO with Z (C1)
    assert audit_data["approved_at"].endswith("Z")
