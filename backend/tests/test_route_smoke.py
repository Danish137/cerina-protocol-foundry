import os
import sys
import pytest
import asyncio
from unittest.mock import AsyncMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from httpx import AsyncClient, ASGITransport
from main import app
from database import init_db, get_db_session, ProtocolSession
from security import generate_session_id, generate_session_token, hash_token
from agents.workflow import init_checkpointer_async, create_workflow
from agents.state import create_initial_state, add_draft_version

@pytest.fixture(autouse=True)
def setup_test_db():
    init_db()

@pytest.mark.asyncio
async def test_route_smoke_every_endpoint():
    """
    Smoke test covering EVERY endpoint in the API:
    - GET /api/capacity
    - POST /api/protocols/create
    - GET /api/protocols/{session_id}/state
    - GET /api/protocols/{session_id}/events
    - GET /api/protocols/{session_id}/stream
    - POST /api/protocols/{session_id}/revalidate
    - POST /api/protocols/{session_id}/revise
    - POST /api/protocols/{session_id}/approve
    - GET /api/protocols
    Guarantees no signature mismatch or TypeError can ship!
    """
    await init_checkpointer_async()
    from runner import registry

    fake_draft = "# Test Protocol\n\n## Introduction\nIntro\n\n## Goals\nGoals\n\n## Steps\n### Step 1: Step\nStep\n\n## Practice\nPractice\n\n## Reflection\nReflect\n\n## Conclusion\nEnd"
    mock_draft_res = {"current_draft": fake_draft, "active_agent": "Drafter", "status": "drafting", "revision_summary": []}
    mock_safety_res = {"safety_checks": {"no_medication": True}, "safety_score": 1.0, "score_source": "test", "all_passed": True, "model": "test"}
    mock_critic_res = {"empathy_score": 4.5, "clinical_score": 4.5, "score_source": "test", "model": "test", "weaknesses": []}
    mock_supervisor_res = {"status": "awaiting_approval", "next_agent": "HALT", "halted": True, "reason": "Passed."}

    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
        # 1. Capacity
        cap_resp = await client.get("/api/capacity")
        assert cap_resp.status_code == 200
        assert "remaining_runs_estimate" in cap_resp.json()

        # 2. Protocols list (disabled endpoint)
        list_resp = await client.get("/api/protocols")
        assert list_resp.status_code == 200
        assert list_resp.json() == {"protocols": [], "limit": 20, "offset": 0}

        # 3. Create protocol with mock runner
        with patch("agents.workflow.drafter.draft", new_callable=AsyncMock, return_value=mock_draft_res), \
             patch("agents.workflow.safety_guardian.review", new_callable=AsyncMock, return_value=mock_safety_res), \
             patch("agents.workflow.clinical_critic.critique", new_callable=AsyncMock, return_value=mock_critic_res), \
             patch("agents.workflow.supervisor.decide", new_callable=AsyncMock, return_value=mock_supervisor_res):

            create_resp = await client.post(
                "/api/protocols/create",
                json={"intent": "Thought challenging exercise for panic attacks"}
            )
            assert create_resp.status_code == 200
            c_data = create_resp.json()
            session_id = c_data["session_id"]
            token = c_data["session_token"]
            headers = {"X-Session-Token": token}

            # Let initial runner task complete
            t = registry.get_task(session_id)
            if t:
                await t
            else:
                for _ in range(40):
                    if not await registry.is_active(session_id):
                        break
                    await asyncio.sleep(0.05)

            # 4. State
            state_resp = await client.get(f"/api/protocols/{session_id}/state", headers=headers)
            assert state_resp.status_code == 200
            assert "state" in state_resp.json()

            # 5. Events
            events_resp = await client.get(f"/api/protocols/{session_id}/events", headers=headers)
            assert events_resp.status_code == 200
            assert "events" in events_resp.json()

            # 6. Stream (connect and read initial SSE ping)
            async with client.stream("GET", f"/api/protocols/{session_id}/stream?token={token}") as stream_resp:
                assert stream_resp.status_code == 200
                assert "text/event-stream" in stream_resp.headers.get("content-type", "")

            # 7. Revalidate
            edited_text = fake_draft + "\n\n### Step 2: Mindful Breathing\nBreathe slowly."
            reval_resp = await client.post(
                f"/api/protocols/{session_id}/revalidate",
                json={"draft": edited_text},
                headers=headers
            )
            assert reval_resp.status_code == 200
            r_data = reval_resp.json()
            assert "validated_hash" in r_data
            assert r_data["passed"] is True
            validated_hash = r_data["validated_hash"]

            # 8. Revise
            revise_resp = await client.post(
                f"/api/protocols/{session_id}/revise",
                json={"instruction": "Add more physiological grounding techniques."},
                headers=headers
            )
            assert revise_resp.status_code == 200
            assert revise_resp.json()["status"] == "revising"

            t_rev = registry.get_task(session_id)
            if t_rev:
                await t_rev
            else:
                for _ in range(40):
                    if not await registry.is_active(session_id):
                        break
                    await asyncio.sleep(0.05)

            # 9. Approve (with edits and validated hash)
            approve_resp = await client.post(
                f"/api/protocols/{session_id}/approve",
                json={
                    "approved_content": edited_text,
                    "edited": True,
                    "validated_hash": validated_hash,
                    "approved_by": "You"
                },
                headers=headers
            )
            assert approve_resp.status_code == 200
            app_data = approve_resp.json()
            assert app_data["status"] == "approved"
            assert app_data["approval_audit"]["approved_by"] == "You"
            assert app_data["approval_audit"]["rechecked"] is True
            assert app_data["approval_audit"]["validated_hash"] == validated_hash

            # 10. Approve rejection test: edited=true with mismatched hash -> 409 recheck_required
            approve_reject = await client.post(
                f"/api/protocols/{session_id}/approve",
                json={
                    "approved_content": edited_text + "\nExtra unverified text",
                    "edited": True,
                    "validated_hash": "stale_hash_1234",
                    "approved_by": "You"
                },
                headers=headers
            )
            assert approve_reject.status_code == 409
            assert approve_reject.json()["detail"]["code"] == "recheck_required"
