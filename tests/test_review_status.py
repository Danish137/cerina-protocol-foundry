import asyncio
import hashlib
import pytest
from fastapi.testclient import TestClient
from main import app
from database import get_db_session, ProtocolSession, Event
from runner import registry, run_protocol_workflow
from hosted_mcp import get_status, get_exercise, approve_exercise

test_client = TestClient(app)

def test_runner_failure_after_draft_must_not_be_ready_for_approval():
    """1a: When runner fails after draft exists but before safety & quality reviews finish,
    session must NOT end as ready for approval. It must require recheck.
    On current main: runner finally block sets status='awaiting_approval' without recheck_required,
    so /approve succeeds (200), MCP get_status returns 'Ready for your review', and /state says awaiting_approval.
    """
    sid = "test_run_fail_before_eval_123"
    token = "secret_tok_123"
    tok_hash = hashlib.sha256(token.encode()).hexdigest()
    draft_text = "# Test Draft\n\nDraft content created before crash."

    db = get_db_session()
    try:
        sess = ProtocolSession(
            session_id=sid,
            token_hash=tok_hash,
            user_intent="Public speaking anxiety",
            status="generating",
            current_draft=draft_text,
            review_depth="standard",
            meta_data={"source": "mcp"}
        )
        db.add(sess)
        # Emit draft event for draft_version=1
        evt_draft = Event(
            session_id=sid,
            seq=1,
            run_id=f"run_{sid}",
            run_kind="initial",
            draft_version=1,
            agent="Drafter",
            type="draft",
            text="Initial draft created",
            data={"draft": draft_text, "version": 1}
        )
        db.add(evt_draft)
        db.commit()
    finally:
        db.close()

    # Mock workflow to simulate failure right after drafting, before evaluations
    class CrashingWorkflow:
        async def aget_state(self, config):
            class MockState:
                values = {
                    "current_draft": draft_text,
                    "current_version": 1,
                    "status": "generating"
                }
            return MockState()

        async def aupdate_state(self, config, state, as_node=None):
            pass

        async def astream(self, *args, **kwargs):
            if False:
                yield {}
            # Simulate exception during review
            raise RuntimeError("LLM capacity error during safety/quality evaluation")

    from unittest.mock import patch
    with patch("agents.workflow.create_workflow", return_value=CrashingWorkflow()):
        asyncio.run(run_protocol_workflow(sid, f"run_{sid}", run_kind="initial"))

    # Check database state
    db = get_db_session()
    try:
        s = db.query(ProtocolSession).filter(ProtocolSession.session_id == sid).first()
        meta = dict(s.meta_data or {})
        status = s.status
    finally:
        db.close()

    # Query web endpoints with session token header
    headers = {"X-Session-Token": token}
    state_res = test_client.get(f"/api/protocols/{sid}/state", headers=headers)
    approve_res = test_client.post(
        f"/api/protocols/{sid}/approve",
        json={"approved_by": "TestUser", "approved_content": draft_text},
        headers=headers
    )

    # Query MCP endpoint
    mcp_status = asyncio.run(get_status(sid, token))

    # Print current behavior for proof:
    print(f"\n[CURRENT BEHAVIOR ON MAIN]")
    print(f"DB status: {status}, meta_data: {meta}")
    print(f"/state endpoint response: {state_res.json().get('status')}, recheck_required: {state_res.json().get('meta_data', {}).get('recheck_required')}")
    print(f"/approve endpoint status_code: {approve_res.status_code}")
    print(f"MCP get_status: {mcp_status.get('status')}, awaiting_review: {mcp_status.get('awaiting_review')}, message: {mcp_status.get('message')}")

    # The requirement:
    # 1. Must NOT be ready for approval without recheck_required flag
    assert meta.get("recheck_required") is True, f"Expected recheck_required=True, got {meta}"
    assert meta.get("recheck_message") is not None
    # 2. Web approve must be blocked (409 recheck_required)
    assert approve_res.status_code == 409, f"Expected 409 recheck_required, got {approve_res.status_code}"
    # 3. MCP get_status must be 'Needs recheck', not 'Ready for your review'
    assert mcp_status.get("status") == "Needs recheck", f"Expected 'Needs recheck', got {mcp_status.get('status')}"
    assert mcp_status.get("awaiting_review") is False, "Should not be awaiting_review when checks failed"


def test_mcp_get_exercise_summary_populated_for_completed_run():
    """1b: Normal completed run -> MCP get_exercise summary currently has null safety/quality scores
    because runner never wrote them to ProtocolSession columns.
    The fix should read the latest valid score events (same source web app uses).
    """
    sid = "test_completed_run_scores_456"
    token = "secret_tok_456"
    tok_hash = hashlib.sha256(token.encode()).hexdigest()
    draft_text = "# Calming Exercise\n\nTake deep breaths."

    db = get_db_session()
    try:
        sess = ProtocolSession(
            session_id=sid,
            token_hash=tok_hash,
            user_intent="Calm down",
            status="awaiting_approval",
            current_draft=draft_text,
            review_depth="standard",
            meta_data={"source": "mcp"}
            # Notice safety_score, empathy_score, clinical_score left NULL as runner currently does!
        )
        db.add(sess)
        # Emit real score events as produced by SafetyGuardian and ClinicalCritic
        evt_draft = Event(
            session_id=sid,
            seq=1,
            run_id=f"run_{sid}",
            run_kind="initial",
            draft_version=1,
            agent="Drafter",
            type="draft",
            text="Initial draft",
            data={"draft": draft_text, "version": 1}
        )
        evt_safety = Event(
            session_id=sid,
            seq=2,
            run_id=f"run_{sid}",
            run_kind="initial",
            draft_version=1,
            agent="SafetyGuardian",
            type="score",
            text="Safety checks passed: 5/5",
            data={
                "metric": "safety",
                "score": 1.0,
                "checks_passed": 5,
                "checks": {"self_harm": True, "no_medication": True, "no_diagnosis": True, "no_contraindicated_exposure": True, "referral_language": True},
                "unavailable": False
            }
        )
        evt_critic = Event(
            session_id=sid,
            seq=3,
            run_id=f"run_{sid}",
            run_kind="initial",
            draft_version=1,
            agent="ClinicalCritic",
            type="score",
            text="Empathy: 4.5/5, Exercise quality: 4.2/5",
            data={
                "metric": "clinical",
                "empathy_score": 4.5,
                "clinical_score": 4.2,
                "dimensions": {},
                "unavailable": False
            }
        )
        db.add_all([evt_draft, evt_safety, evt_critic])
        db.commit()
    finally:
        db.close()

    # Call MCP get_exercise
    ex_res = asyncio.run(get_exercise(sid, token))
    summary = ex_res.get("summary")
    print(f"\n[CURRENT MCP get_exercise SUMMARY ON MAIN]")
    print(f"Summary: {summary}")
    print(f"Text:\n{ex_res.get('text')}")

    # Summary must have non-null scores from the valid evaluations
    assert summary is not None, "Summary must not be None"
    assert summary.get("safety_score") == 100.0, f"Expected 100.0, got {summary.get('safety_score')}"
    assert summary.get("quality_score") == 4.2, f"Expected 4.2, got {summary.get('quality_score')}"
    assert summary.get("empathy_score") == 4.5, f"Expected 4.5, got {summary.get('empathy_score')}"


def test_is_valid_evaluation_wrong_name_regression():
    """Step 3: Wrong-name regression test for is_valid_evaluation using real event names.
    Proves that if an event used generic/display names ('Safety', 'QualityReviewer') instead of
    real event names ('SafetyGuardian', 'ClinicalCritic'), it fails validation.
    """
    from runner import is_valid_evaluation
    sid = "test_wrong_names_sid_789"
    db = get_db_session()
    try:
        # Case A: Wrong agent names
        evt_wrong_safety = Event(
            session_id=sid,
            seq=1,
            run_id=f"run_{sid}",
            run_kind="initial",
            draft_version=1,
            agent="Safety", # WRONG name
            type="score",
            text="Safety score",
            data={"score": 1.0, "unavailable": False}
        )
        evt_wrong_critic = Event(
            session_id=sid,
            seq=2,
            run_id=f"run_{sid}",
            run_kind="initial",
            draft_version=1,
            agent="QualityReviewer", # WRONG name
            type="score",
            text="Critic score",
            data={"empathy_score": 4.5, "clinical_score": 4.0, "unavailable": False}
        )
        db.add_all([evt_wrong_safety, evt_wrong_critic])
        db.commit()

        eval_wrong = is_valid_evaluation(db, sid, draft_version=1)
        assert eval_wrong["fully_checked"] is False, "Wrong names must not validate"
        assert eval_wrong["safety_done"] is False
        assert eval_wrong["quality_done"] is False

        # Case B: Correct agent names ('SafetyGuardian' and 'ClinicalCritic')
        evt_correct_safety = Event(
            session_id=sid,
            seq=3,
            run_id=f"run_{sid}",
            run_kind="initial",
            draft_version=2,
            agent="SafetyGuardian", # REAL name
            type="score",
            text="Safety checks passed: 5/5",
            data={"score": 1.0, "unavailable": False}
        )
        evt_correct_critic = Event(
            session_id=sid,
            seq=4,
            run_id=f"run_{sid}",
            run_kind="initial",
            draft_version=2,
            agent="ClinicalCritic", # REAL name
            type="score",
            text="Empathy: 4.8/5, Quality: 4.6/5",
            data={"empathy_score": 4.8, "clinical_score": 4.6, "unavailable": False}
        )
        db.add_all([evt_correct_safety, evt_correct_critic])
        db.commit()

        eval_correct = is_valid_evaluation(db, sid, draft_version=2)
        assert eval_correct["fully_checked"] is True, "Real names must validate"
        assert eval_correct["safety_done"] is True
        assert eval_correct["quality_done"] is True
        assert eval_correct["safety_score"] == 1.0
        assert eval_correct["empathy_score"] == 4.8
        assert eval_correct["clinical_score"] == 4.6
    finally:
        db.close()


def test_recheck_required_blocks_mcp_approve_with_plain_message():
    """Step 3: recheck_required blocks MCP approve with the plain message:
    'Your exercise needs another safety check. Ask for a small change with revise_exercise, or start a new exercise.'
    """
    sid = "test_recheck_block_approve_999"
    token = "secret_tok_999"
    tok_hash = hashlib.sha256(token.encode()).hexdigest()
    draft_text = "# Draft Needing Recheck\n\nSteps here."

    db = get_db_session()
    try:
        sess = ProtocolSession(
            session_id=sid,
            token_hash=tok_hash,
            user_intent="Sleep anxiety",
            status="awaiting_approval",
            current_draft=draft_text,
            review_depth="standard",
            meta_data={"recheck_required": True}
        )
        db.add(sess)
        db.commit()
    finally:
        db.close()

    res = asyncio.run(approve_exercise(sid, token))
    assert res.get("status") == "rejected"
    assert res.get("code") == "recheck_required"
    expected_msg = "Your exercise needs another safety check. Ask for a small change with revise_exercise, or start a new exercise."
    assert res.get("message") == expected_msg
    assert res.get("error") == expected_msg


def test_runner_failure_without_draft_marks_failed():
    """Step 2: If runner fails before any draft exists, session marks failed,
    get_status returns 'Failed' and message 'Something went wrong. Please start a new exercise.'
    """
    sid = "test_nodraft_failure_111"
    token = "secret_tok_111"
    tok_hash = hashlib.sha256(token.encode()).hexdigest()

    db = get_db_session()
    try:
        sess = ProtocolSession(
            session_id=sid,
            token_hash=tok_hash,
            user_intent="Intent without draft",
            status="generating",
            current_draft=None,
            review_depth="standard",
            meta_data={"source": "mcp"}
        )
        db.add(sess)
        db.commit()
    finally:
        db.close()

    class ImmediateCrashWorkflow:
        async def aget_state(self, config):
            class MockState:
                values = {"status": "generating"}
            return MockState()
        async def aupdate_state(self, config, state, as_node=None):
            pass
        async def astream(self, *args, **kwargs):
            if False:
                yield {}
            raise RuntimeError("Crashed on drafter startup")

    from unittest.mock import patch
    with patch("agents.workflow.create_workflow", return_value=ImmediateCrashWorkflow()):
        asyncio.run(run_protocol_workflow(sid, f"run_{sid}", run_kind="initial"))

    db = get_db_session()
    try:
        s = db.query(ProtocolSession).filter(ProtocolSession.session_id == sid).first()
        assert s.status == "failed"
    finally:
        db.close()

    mcp_st = asyncio.run(get_status(sid, token))
    assert mcp_st.get("status") == "Failed"
    assert mcp_st.get("message") == "Something went wrong. Please start a new exercise."
    assert mcp_st.get("awaiting_review") is False


def test_web_behavior_unchanged_status_and_keys():
    """Step 2: Web behaviour must otherwise be unchanged: same status codes and response keys."""
    sid = "test_web_compat_222"
    token = "secret_tok_222"
    tok_hash = hashlib.sha256(token.encode()).hexdigest()
    draft = "# Completed Draft\n\nFull steps."

    db = get_db_session()
    try:
        sess = ProtocolSession(
            session_id=sid,
            token_hash=tok_hash,
            user_intent="Exam anxiety",
            status="awaiting_approval",
            current_draft=draft,
            review_depth="standard",
            meta_data={}
        )
        db.add(sess)
        evt_draft = Event(
            session_id=sid,
            seq=1,
            run_id=f"run_{sid}",
            run_kind="initial",
            draft_version=1,
            agent="Drafter",
            type="draft",
            text="Initial draft",
            data={"draft": draft, "version": 1}
        )
        evt_safety = Event(
            session_id=sid,
            seq=2,
            run_id=f"run_{sid}",
            run_kind="initial",
            draft_version=1,
            agent="SafetyGuardian",
            type="score",
            text="Safety checks passed: 5/5",
            data={"score": 1.0, "unavailable": False}
        )
        evt_critic = Event(
            session_id=sid,
            seq=3,
            run_id=f"run_{sid}",
            run_kind="initial",
            draft_version=1,
            agent="ClinicalCritic",
            type="score",
            text="Empathy: 4.5/5, Quality: 4.5/5",
            data={"empathy_score": 4.5, "clinical_score": 4.5, "unavailable": False}
        )
        db.add_all([evt_draft, evt_safety, evt_critic])
        db.commit()
    finally:
        db.close()

    headers = {"X-Session-Token": token}
    # 1. GET /api/protocols/{session_id}/state
    res_get = test_client.get(f"/api/protocols/{sid}/state", headers=headers)
    assert res_get.status_code == 200
    data = res_get.json()
    assert "session_id" in data
    assert "state" in data
    st_data = data["state"]
    expected_keys = {"session_id", "status", "current_draft", "current_version", "recheck_required"}
    for k in expected_keys:
        assert k in st_data, f"Missing key {k} in GET /api/protocols/{sid}/state response"
    assert st_data["status"] == "awaiting_approval"
    assert st_data["recheck_required"] is False

    # 2. POST /api/protocols/{session_id}/approve
    res_app = test_client.post(
        f"/api/protocols/{sid}/approve",
        json={"approved_by": "TestUser", "approved_content": draft},
        headers=headers
    )
    assert res_app.status_code == 200
    app_data = res_app.json()
    for k in {"session_id", "status", "message", "approval_audit"}:
        assert k in app_data, f"Missing key {k} in POST /approve response"
    assert app_data["status"] == "approved"
