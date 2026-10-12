import sys
import os
import pytest
import asyncio
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from rubrics import evaluate_safety_rubric, evaluate_critic_rubric

@pytest.mark.asyncio
async def test_safety_rubric_success():
    mock_llm = MagicMock()
    valid_safety_payload = {
        "self_harm_handled_safely": {"passed": True, "reason": "No self-harm encouragement"},
        "no_medication_advice": {"passed": True, "reason": "No drug references"},
        "no_diagnosis": {"passed": True, "reason": "No diagnostic claims"},
        "no_contraindicated_exposure": {"passed": True, "reason": "Safe gentle exposure"},
        "referral_language_where_risk": {"passed": True, "reason": "Disclaimer present"}
    }
    mock_resp = MagicMock()
    mock_resp.content = f"```json\n{json_dumps(valid_safety_payload)}\n```"
    mock_llm.ainvoke = AsyncMock(return_value=mock_resp)

    res = await evaluate_safety_rubric(mock_llm, "Draft content", "Intent")
    assert res["score_source"] == "llm"
    assert res["safety_score"] == 1.0
    assert res["passed_checks"] == 5
    assert res["all_passed"] is True
    assert res["unverified"] is False

@pytest.mark.asyncio
async def test_safety_rubric_fail_closed():
    mock_llm = MagicMock()
    # Mock LLM returns garbage on both primary and retry
    mock_resp = MagicMock()
    mock_resp.content = "I cannot evaluate this in JSON format. Sorry!"
    mock_llm.ainvoke = AsyncMock(return_value=mock_resp)

    res = await evaluate_safety_rubric(mock_llm, "Draft content", "Intent")
    assert res["score_source"] == "unavailable"
    assert res["safety_score"] == 0.0
    assert res["unverified"] is True
    # Verify it NEVER returned 0.8 default
    assert res["safety_score"] != 0.8

@pytest.mark.asyncio
async def test_critic_rubric_fail_closed():
    mock_llm = MagicMock()
    mock_resp = MagicMock()
    mock_resp.content = "Random non-JSON response"
    mock_llm.ainvoke = AsyncMock(return_value=mock_resp)

    res = await evaluate_critic_rubric(mock_llm, "Draft content", "Intent")
    assert res["score_source"] == "unavailable"
    assert res["empathy_score"] == 0.0
    assert res["clinical_score"] == 0.0
    assert res["unverified"] is True
    # Verify it NEVER returned 0.7 default
    assert res["empathy_score"] != 0.7

def json_dumps(obj):
    import json
    return json.dumps(obj)
