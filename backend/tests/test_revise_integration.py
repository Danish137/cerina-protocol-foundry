import os
import sys
import pytest
import asyncio
from unittest.mock import AsyncMock, patch, MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from httpx import AsyncClient, ASGITransport
from main import app
from runner import registry
from database import get_db_session, ProtocolSession, Event
from security import generate_session_id, generate_session_token, hash_token

@pytest.mark.asyncio
async def test_revise_integration_real_app_and_registry():
    """
    Integration test for /revise through the real FastAPI app and RunnerRegistry.
    Verifies:
    1. Route returns 200 (not 500 TypeError).
    2. RunnerRegistry acquires the task.
    3. Drafter receives instruction.
    4. Draft v1 is retained in draft_history and v2 is generated.
    """

    session_id = f"test_revise_{generate_session_id()}"
    token = generate_session_token()
    token_hash = hash_token(token)

    # 1. Seed database session at awaiting_approval checkpoint
    v1_content = "# Driving Anxiety Protocol\n\n## Introduction\nExposure for driving fears.\n\n## Goals\n1. Drive on highway.\n\n## Steps\n### Step 1: Sit in Driver Seat\nSit in the parked car for 10 minutes.\n\n## Practice\nPractice daily.\n\n## Reflection\nRate anxiety.\n\n## Conclusion\nStay safe."
    db = get_db_session()
    try:
        sess = ProtocolSession(
            session_id=session_id,
            token_hash=token_hash,
            user_intent="Exposure hierarchy for fear of driving",
            status="awaiting_approval",
            current_draft=v1_content
        )
        db.add(sess)
        db.commit()
    finally:
        db.close()

    # Seed LangGraph initial state with v1 in draft_history
    from agents.workflow import create_workflow, init_checkpointer_async
    await init_checkpointer_async()
    workflow = create_workflow()
    config = {"configurable": {"thread_id": session_id}}
    from agents.state import create_initial_state, add_draft_version
    init_st = create_initial_state(user_intent="Exposure hierarchy for fear of driving", session_id=session_id)
    init_st["status"] = "awaiting_approval"
    init_st["halted"] = True
    init_st = add_draft_version(init_st, v1_content, "Drafter")
    assert len(init_st["draft_history"]) == 1
    assert init_st["current_version"] == 1
    await workflow.aupdate_state(config, init_st, as_node="supervisor")

    # 2. Fake LLM returning revised v2 addressing instruction
    v2_content = "# Driving Anxiety Protocol\n\n## Introduction\nRevised exposure hierarchy for driving.\n\n## Goals\n1. Look at car photos.\n\n## Steps\n### Step 1: Look at Pictures of Cars\nBegin by browsing pictures of parked cars to establish tolerance before entering a vehicle.\n\n## Practice\nDaily photo review.\n\n## Reflection\nRate anxiety.\n\n## Conclusion\nGentle progression."
    
    mock_draft_result = {
        "current_draft": v2_content,
        "active_agent": "Drafter",
        "status": "drafting",
        "revision_summary": [{"responding_to": "Make step 1 look at pictures", "change": "Replaced sitting in car with picture review"}]
    }

    mock_safety_result = {
        "safety_checks": {"self_harm": True, "no_medication": True, "no_diagnosis": True, "no_contraindicated_exposure": True, "referral_language": True},
        "safety_score": 1.0,
        "score_source": "fake_llm",
        "all_passed": True,
        "model": "fake_judge"
    }

    mock_critic_result = {
        "empathy_score": 4.5,
        "clinical_score": 4.5,
        "score_source": "fake_llm",
        "model": "fake_judge",
        "weaknesses": []
    }

    mock_supervisor_result = {
        "status": "awaiting_approval",
        "next_agent": "HALT",
        "halted": True,
        "reason": "Quality thresholds met."
    }

    with patch("agents.workflow.drafter.draft", new_callable=AsyncMock, return_value=mock_draft_result) as mock_draft, \
         patch("agents.workflow.safety_guardian.review", new_callable=AsyncMock, return_value=mock_safety_result), \
         patch("agents.workflow.clinical_critic.critique", new_callable=AsyncMock, return_value=mock_critic_result), \
         patch("agents.workflow.supervisor.decide", new_callable=AsyncMock, return_value=mock_supervisor_result):

        # Call real /revise route through AsyncClient
        human_instruction = "Make the first step involve looking at pictures of cars rather than sitting in a car."
        headers = {"X-Session-Token": token}
        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://testserver") as client:
            response = await client.post(
                f"/api/protocols/{session_id}/revise",
                json={"instruction": human_instruction},
                headers=headers
            )

        # Assert no 500 TypeError!
        assert response.status_code == 200, f"Expected 200, got {response.status_code}: {response.text}"
        data = response.json()
        assert data["session_id"] == session_id
        assert data["status"] == "revising"
        assert "run_id" in data

        # Wait for the runner registry task to finish
        t = registry.get_task(session_id)
        if t:
            await t
        else:
            for _ in range(50):
                if not await registry.is_active(session_id):
                    break
                await asyncio.sleep(0.05)

        # Verify state after human revision run
        st_after = await workflow.aget_state(config)
        vals = st_after.values

        # v1 kept in draft_history, v2 is current
        assert len(vals["draft_history"]) == 2, f"Expected 2 drafts in history, got {len(vals['draft_history'])}"
        assert vals["draft_history"][0]["version"] == 1
        assert "Sit in the parked car" in vals["draft_history"][0]["content"]
        assert vals["draft_history"][1]["version"] == 2
        assert "Look at Pictures of Cars" in vals["draft_history"][1]["content"]
        assert vals["current_version"] == 2

        # Verify drafter was called with state containing the human instruction
        assert mock_draft.called
        called_state = mock_draft.call_args[0][0]
        notes = called_state.get("agent_notes", [])
        human_notes = [n for n in notes if n.get("agent_name") == "Human"]
        assert len(human_notes) >= 1
        assert human_notes[-1]["note"] == human_instruction
        assert human_notes[-1]["target_agent"] == "Drafter"
