import os
import sys
import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from agents.state import create_initial_state, add_draft_version

def test_version_derivation_v1_v2_v3():
    """
    Requirement 4: Initial value remains 0.
    Derive version from draft-history length:
    - Initial state has current_version == 0 and empty draft_history
    - First draft is v1
    - AI revision is v2
    - Human revision is v3
    """
    # Initial state
    state = create_initial_state(user_intent="Panic exposure", session_id="test_sess")
    assert state["current_version"] == 0
    assert len(state["draft_history"]) == 0

    # 1. First draft -> v1
    state = add_draft_version(state, "# Draft 1", "Drafter")
    assert len(state["draft_history"]) == 1
    assert state["draft_history"][-1]["version"] == 1
    assert state["current_version"] == 1

    # 2. AI revision -> v2
    state["iteration_count"] = 1
    state = add_draft_version(state, "# Draft 2 (AI Revision)", "Drafter")
    assert len(state["draft_history"]) == 2
    assert state["draft_history"][-1]["version"] == 2
    assert state["current_version"] == 2

    # 3. Human revision -> v3
    state["iteration_count"] = 2
    state = add_draft_version(state, "# Draft 3 (Human Revision)", "Drafter")
    assert len(state["draft_history"]) == 3
    assert state["draft_history"][-1]["version"] == 3
    assert state["current_version"] == 3
