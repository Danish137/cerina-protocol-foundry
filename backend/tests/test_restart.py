import os
import sys
import pytest
import asyncio

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from database import init_db
from agents.workflow import create_workflow, init_checkpointer_async, close_checkpointer_async
from agents.state import add_agent_note

@pytest.mark.asyncio
async def test_human_revision_restarts_at_draft():
    await init_checkpointer_async()
    workflow = create_workflow()
    test_session = "test_restart_verification_thread"
    config = {"configurable": {"thread_id": test_session}}

    # 1. State at halted checkpoint
    halted_state = {
        "user_intent": "Exposure hierarchy for fear of driving",
        "session_id": test_session,
        "iteration_count": 1,
        "max_iterations": 3,
        "current_version": 1,
        "status": "awaiting_approval",
        "active_agent": "Supervisor",
        "halted": True,
        "current_draft": "# Driving Phobia Protocol\n\n## Steps\n1. Sit in car.",
        "agent_notes": []
    }
    await workflow.aupdate_state(config, halted_state, as_node="supervisor")

    st = await workflow.aget_state(config)
    assert st.values["status"] == "awaiting_approval"
    assert st.values["halted"] is True

    # 2. Human triggers revise
    human_instruction = "Make the first step involve looking at pictures of cars rather than sitting in a car."
    updated_state = st.values.copy()
    updated_state = add_agent_note(
        updated_state,
        "Human",
        human_instruction,
        target_agent="Drafter",
        priority="critical"
    )
    updated_state["status"] = "needs_revision"
    updated_state["active_agent"] = "Supervisor"
    updated_state["halted"] = False

    # Key mechanism: update state with as_node="supervisor"
    await workflow.aupdate_state(config, updated_state, as_node="supervisor")

    # 3. Verify next scheduled node is 'draft'
    st_after = await workflow.aget_state(config)
    assert "draft" in st_after.next

    # 4. Verify the critical human note exists and targets Drafter
    notes = st_after.values.get("agent_notes", [])
    human_notes = [n for n in notes if n.get("agent_name") == "Human"]
    assert len(human_notes) >= 1
    assert human_notes[-1]["target_agent"] == "Drafter"
    assert human_notes[-1]["priority"] == "critical"

    await close_checkpointer_async()
