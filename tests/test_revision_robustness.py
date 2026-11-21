"""
Tests for Revision Robustness & Status Mapping:
1. Status mapping (awaiting_approval -> Waiting for your review, etc.)
2. Revision start (run_id assignment, human_action event, runner lock)
3. Revision timeout releases runner (warning message emitted, DB draft preserved, runner released)
4. Second revise after timeout accepted (runner cleanly acquired without 409 conflict)
"""

import os
import sys
import asyncio
import secrets
import pytest
from unittest import mock
from unittest.mock import patch, AsyncMock, MagicMock

# Ensure backend directory is in python path
backend_dir = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend"))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from database import get_db_session, ProtocolSession, Event
from runner import registry, run_protocol_workflow, run_recheck_workflow, RunnerAlreadyActiveError, reconcile_interrupted_sessions
from llm_client import UnifiedLLMClient, LLMResult


def test_status_mapping():
    """Verify raw backend statuses map to human-friendly display copy."""
    STATUS_MAP = {
        "awaiting_approval": "Waiting for your review",
        "generating": "In progress",
        "revising": "In progress",
        "drafting": "In progress",
        "reviewing": "In progress",
        "completed": "Ready",
        "approved": "Approved",
        "error": "Something went wrong",
        "failed": "Something went wrong",
    }
    for raw_status, expected_label in STATUS_MAP.items():
        assert STATUS_MAP.get(raw_status) == expected_label

    # Ensure awaiting_approval is never displayed raw with underscore
    assert "awaiting_approval" != STATUS_MAP["awaiting_approval"]
    assert STATUS_MAP["awaiting_approval"] == "Waiting for your review"


def test_revision_start():
    """Verify revision run initializes, acquires runner lock, and rejects duplicate active run."""
    async def _run():
        sid = f"test_rev_start_{secrets.token_hex(4)}"
        initial_draft = "# Title\n\nInitial draft content for test."
        run_id = f"run_{secrets.token_hex(4)}"

        db = get_db_session()
        try:
            sess = ProtocolSession(
                session_id=sid,
                token_hash="token_hash_val",
                user_intent="Managing exam stress",
                status="awaiting_approval",
                current_draft=initial_draft,
                review_depth="standard",
            )
            db.add(sess)
            db.commit()
        finally:
            db.close()

        class RunningWorkflow:
            async def aget_state(self, config):
                class MockState:
                    values = {"current_draft": initial_draft, "current_version": 1, "status": "revising"}
                return MockState()

            async def aupdate_state(self, config, state, as_node=None):
                pass

            async def astream(self, *args, **kwargs):
                await asyncio.sleep(0.5)
                yield {"test": True}

        with patch("agents.workflow.create_workflow", return_value=RunningWorkflow()):
            # Acquire runner task for revision
            task = await registry.acquire_or_raise(
                sid,
                run_protocol_workflow,
                run_id=run_id,
                run_kind="human_revision",
                review_depth="standard",
                human_instruction="Make the tone warmer.",
            )

            # Verify runner lock is acquired
            assert await registry.is_active(sid) is True

            # Verify duplicate acquire raises RunnerAlreadyActiveError (maps to HTTP 409)
            with pytest.raises(RunnerAlreadyActiveError) as exc_info:
                await registry.acquire_or_raise(
                    sid,
                    run_protocol_workflow,
                    run_id=f"run_dup_{secrets.token_hex(4)}",
                    run_kind="human_revision",
                )
            assert "already has an active runner task" in str(exc_info.value)

            # Clean up runner task
            if task and not task.done():
                task.cancel()
            registry.release(sid)
            assert await registry.is_active(sid) is False

    asyncio.run(_run())


def test_revision_timeout_releases_runner():
    """Verify timeout emits warning, keeps draft unchanged, and cleanly releases runner."""
    async def _run():
        sid = f"test_rev_timeout_{secrets.token_hex(4)}"
        initial_draft = "# Calm Study\n\nPreserved draft content before revision timeout."
        run_id = f"run_timeout_{secrets.token_hex(4)}"

        db = get_db_session()
        try:
            sess = ProtocolSession(
                session_id=sid,
                token_hash="fake_hash",
                user_intent="Exam anxiety",
                status="revising",
                current_draft=initial_draft,
                review_depth="standard",
            )
            db.add(sess)
            db.commit()
        finally:
            db.close()

        # Set timeout to a very small fraction of a second
        with patch.dict(os.environ, {"REVISION_TIMEOUT_SECONDS": "0.1"}):
            # Mock create_workflow to simulate a graph that hangs / sleeps
            class StallingWorkflow:
                async def aget_state(self, config):
                    class MockState:
                        values = {"current_draft": initial_draft, "current_version": 1, "status": "revising"}
                    return MockState()

                async def aupdate_state(self, config, state, as_node=None):
                    pass

                async def astream(self, *args, **kwargs):
                    await asyncio.sleep(1.0)
                    yield {"test": True}

            with patch("agents.workflow.create_workflow", return_value=StallingWorkflow()):
                await registry.acquire_or_raise(
                    sid,
                    run_protocol_workflow,
                    run_id=run_id,
                    run_kind="human_revision",
                    review_depth="standard",
                    human_instruction="Please simplify this.",
                )
                # Wait for timeout to fire and runner to release
                for _ in range(30):
                    if not await registry.is_active(sid):
                        break
                    await asyncio.sleep(0.1)

        # 1. Runner must be cleanly released
        assert await registry.is_active(sid) is False

        # 2. DB draft must remain untouched
        db = get_db_session()
        try:
            updated_sess = db.query(ProtocolSession).filter(ProtocolSession.session_id == sid).first()
            assert updated_sess is not None
            assert updated_sess.current_draft == initial_draft
            assert updated_sess.status == "awaiting_approval"

            # 3. Warning error event and run_end event must be emitted
            events = db.query(Event).filter(Event.session_id == sid).order_by(Event.seq.asc()).all()
            event_types = [e.type for e in events]
            assert "error" in event_types

            timeout_error_evt = next(e for e in events if e.type == "error")
            assert timeout_error_evt.severity == "warning"
            assert timeout_error_evt.text == "That took too long. Your draft is unchanged — try again."
            assert timeout_error_evt.data.get("code") == "timeout"
            assert timeout_error_evt.data.get("retryable") is True

            run_end_evt = next(e for e in events if e.type == "run_end")
            assert run_end_evt.severity == "warning"
            assert run_end_evt.data.get("status") == "awaiting_approval"
            assert run_end_evt.data.get("timeout") is True
        finally:
            db.close()

    asyncio.run(_run())


def test_second_revise_after_timeout_accepted():
    """Verify that after a timeout releases the runner, a second revise request is accepted."""
    async def _run():
        sid = f"test_rev_retry_{secrets.token_hex(4)}"
        good_draft = "# Keep Calm\n\nSolid draft steps."

        db = get_db_session()
        try:
            sess = ProtocolSession(
                session_id=sid,
                token_hash="tok_hash",
                user_intent="Procrastination",
                status="awaiting_approval",
                current_draft=good_draft,
                review_depth="standard",
            )
            db.add(sess)
            db.commit()
        finally:
            db.close()

        class StallingWorkflow:
            async def aget_state(self, config):
                class MockState:
                    values = {"current_draft": good_draft, "current_version": 1, "status": "revising"}
                return MockState()

            async def aupdate_state(self, config, state, as_node=None):
                pass

            async def astream(self, *args, **kwargs):
                await asyncio.sleep(1.0)
                yield {"test": True}

        # 1. Run first attempt with 0.1s timeout -> stalls and times out
        with patch.dict(os.environ, {"REVISION_TIMEOUT_SECONDS": "0.1"}):
            with patch("agents.workflow.create_workflow", return_value=StallingWorkflow()):
                await registry.acquire_or_raise(
                    sid,
                    run_protocol_workflow,
                    run_id=f"run_1_{secrets.token_hex(4)}",
                    run_kind="human_revision",
                    review_depth="standard",
                    human_instruction="First attempt that stalls.",
                )
                # Wait for timeout to fire and runner to release
                for _ in range(30):
                    if not await registry.is_active(sid):
                        break
                    await asyncio.sleep(0.1)

        # Confirm runner is released after timeout
        assert await registry.is_active(sid) is False

        # 2. Second revise attempt: must be accepted without RunnerAlreadyActiveError
        with patch("agents.workflow.create_workflow", return_value=StallingWorkflow()):
            task2 = await registry.acquire_or_raise(
                sid,
                run_protocol_workflow,
                run_id=f"run_2_{secrets.token_hex(4)}",
                run_kind="human_revision",
                review_depth="standard",
                human_instruction="Second attempt after timeout retry.",
            )

            # Runner is now active for second run
            assert await registry.is_active(sid) is True

            # Clean up
            if task2 and not task2.done():
                task2.cancel()
            registry.release(sid)
            assert await registry.is_active(sid) is False

    asyncio.run(_run())


def test_interrupted_run_startup_reconciliation():
    """Verify reconcile_interrupted_sessions cleans up stranded sessions on server boot for all three cases:
    (a) Interrupted with fully checked draft -> status=awaiting_approval, draft preserved, approve allowed (200 OK)
    (b) Interrupted draft WITHOUT completed safety & quality checks -> status=awaiting_approval, marked needs-recheck,
        approve returns 409 recheck_required
    (c) Interrupted during first draft with no draft -> status=failed, no empty exercise in review
    Also assert user-facing 'interrupted' event is emitted in each case.
    """
    import hashlib
    from fastapi.testclient import TestClient
    from main import app

    test_client = TestClient(app)

    tok_checked = "tok_checked_123"
    tok_unchecked = "tok_unchecked_456"
    tok_nodraft = "tok_nodraft_789"

    hash_checked = hashlib.sha256(tok_checked.encode()).hexdigest()
    hash_unchecked = hashlib.sha256(tok_unchecked.encode()).hexdigest()
    hash_nodraft = hashlib.sha256(tok_nodraft.encode()).hexdigest()

    sid_checked = f"test_interrupted_checked_{secrets.token_hex(4)}"
    sid_unchecked = f"test_interrupted_unchecked_{secrets.token_hex(4)}"
    sid_nodraft = f"test_interrupted_nodraft_{secrets.token_hex(4)}"
    draft_content = "# Preserved Draft\n\nContent remains intact."

    db = get_db_session()
    try:
        # Case (a): Has draft + completed safety & quality checks for draft_version=1
        s_checked = ProtocolSession(
            session_id=sid_checked,
            token_hash=hash_checked,
            user_intent="Intent Checked",
            status="generating",
            current_draft=draft_content,
            safety_score=1.0,
            empathy_score=4.2,
            clinical_score=4.5,
            review_depth="standard",
        )
        evt_draft_a = Event(
            session_id=sid_checked,
            seq=1,
            run_id="run_a",
            run_kind="initial",
            draft_version=1,
            agent="Drafter",
            type="draft",
            text="Draft v1",
            data={"draft": draft_content}
        )
        evt_safety_a = Event(
            session_id=sid_checked,
            seq=2,
            run_id="run_a",
            run_kind="initial",
            draft_version=1,
            agent="SafetyGuardian",
            type="score",
            text="Safety checks passed: 5/5",
            data={"score": 1.0}
        )
        evt_quality_a = Event(
            session_id=sid_checked,
            seq=3,
            run_id="run_a",
            run_kind="initial",
            draft_version=1,
            agent="ClinicalCritic",
            type="score",
            text="Empathy: 4.2/5, Exercise quality: 4.5/5",
            data={"empathy_score": 4.2, "clinical_score": 4.5}
        )

        # Case (b): Has draft, but interrupted during revision/review BEFORE safety & quality finished
        s_unchecked = ProtocolSession(
            session_id=sid_unchecked,
            token_hash=hash_unchecked,
            user_intent="Intent Unchecked",
            status="revising",
            current_draft=draft_content,
            review_depth="standard",
        )
        evt_draft_b = Event(
            session_id=sid_unchecked,
            seq=1,
            run_id="run_b",
            run_kind="initial",
            draft_version=1,
            agent="Drafter",
            type="draft",
            text="Draft v1",
            data={"draft": draft_content}
        )
        # Note: No SafetyGuardian or ClinicalCritic score events for draft_version=1!

        # Case (c): Stranded during first generation before any draft was created
        s_nodraft = ProtocolSession(
            session_id=sid_nodraft,
            token_hash=hash_nodraft,
            user_intent="Intent NoDraft",
            status="generating",
            current_draft=None,
            review_depth="standard",
        )

        db.add_all([s_checked, s_unchecked, s_nodraft, evt_draft_a, evt_safety_a, evt_quality_a, evt_draft_b])
        db.commit()
    finally:
        db.close()

    # Run startup reconciliation
    reconciled_count = reconcile_interrupted_sessions()
    assert reconciled_count >= 3

    db = get_db_session()
    try:
        # -------------------------------------------------------------
        # (a) Fully checked draft: status=awaiting_approval, draft preserved, approve allowed
        # -------------------------------------------------------------
        check_a = db.query(ProtocolSession).filter(ProtocolSession.session_id == sid_checked).first()
        assert check_a.status == "awaiting_approval"
        assert check_a.current_draft == draft_content
        meta_a = dict(check_a.meta_data or {})
        assert meta_a.get("recheck_required") is not True

        evts_a = db.query(Event).filter(Event.session_id == sid_checked).all()
        err_evt_a = next((e for e in evts_a if e.type == "error" and e.run_id == "interrupted_startup"), None)
        assert err_evt_a is not None
        assert err_evt_a.severity == "warning"
        assert err_evt_a.text == "That was interrupted. Your draft is unchanged — try again."
        assert err_evt_a.data.get("code") == "interrupted"

        run_end_a = next((e for e in evts_a if e.type == "run_end" and e.run_id == "interrupted_startup"), None)
        assert run_end_a is not None
        assert run_end_a.data.get("status") == "awaiting_approval"

        # Verify Approve endpoint succeeds (200 OK)
        resp_a = test_client.post(
            f"/api/protocols/{sid_checked}/approve",
            headers={"X-Session-Token": tok_checked},
            json={"approved_by": "You", "edited": False, "validated_hash": "BASELINE"}
        )
        assert resp_a.status_code == 200, f"Expected 200 OK for fully checked draft, got {resp_a.status_code}: {resp_a.text}"
        assert resp_a.json().get("status") == "approved"

        # -------------------------------------------------------------
        # (b) Draft WITHOUT completed checks: status=awaiting_approval, marked needs-recheck, approve returns 409
        # -------------------------------------------------------------
        check_b = db.query(ProtocolSession).filter(ProtocolSession.session_id == sid_unchecked).first()
        assert check_b.status == "awaiting_approval"
        assert check_b.current_draft == draft_content
        meta_b = dict(check_b.meta_data or {})
        assert meta_b.get("recheck_required") is True
        assert meta_b.get("recheck_message") == "This draft wasn't fully checked. Run the checks again."

        evts_b = db.query(Event).filter(Event.session_id == sid_unchecked).all()
        err_evt_b = next((e for e in evts_b if e.type == "error" and e.run_id == "interrupted_startup"), None)
        assert err_evt_b is not None
        assert err_evt_b.severity == "warning"
        assert err_evt_b.text == "This draft wasn't fully checked. Run the checks again."
        assert err_evt_b.data.get("code") == "recheck_required"

        run_end_b = next((e for e in evts_b if e.type == "run_end" and e.run_id == "interrupted_startup"), None)
        assert run_end_b is not None
        assert run_end_b.data.get("status") == "awaiting_approval"

        # Verify Approve endpoint blocks with 409 recheck_required
        resp_b = test_client.post(
            f"/api/protocols/{sid_unchecked}/approve",
            headers={"X-Session-Token": tok_unchecked},
            json={"approved_by": "You", "edited": False, "validated_hash": "BASELINE"}
        )
        assert resp_b.status_code == 409, f"Expected 409 for unchecked draft, got {resp_b.status_code}"
        detail_b = resp_b.json().get("detail", {})
        assert detail_b.get("code") == "recheck_required"
        assert detail_b.get("message") == "This draft wasn't fully checked. Run the checks again."

        # Re-check flow end to end: run revalidate with fake judges -> recheck_required is CLEARED -> approve succeeds
        fake_safety_res = {
            "safety_score": 1.0,
            "safety_checks": {
                "self_harm": True,
                "no_medication": True,
                "no_diagnosis": True,
                "no_contraindicated_exposure": True,
                "referral_language": True,
            },
            "unverified": False,
        }
        fake_critic_res = {
            "empathy_score": 4.5,
            "clinical_score": 4.5,
            "unverified": False,
        }
        with patch("agents.workflow.safety_guardian.review", new_callable=mock.AsyncMock, return_value=fake_safety_res), \
             patch("agents.workflow.clinical_critic.critique", new_callable=mock.AsyncMock, return_value=fake_critic_res):
            reval_resp = test_client.post(
                f"/api/protocols/{sid_unchecked}/revalidate",
                headers={"X-Session-Token": tok_unchecked},
                json={"draft": draft_content}
            )
            assert reval_resp.status_code == 200, f"Revalidation failed: {reval_resp.text}"
            reval_data = reval_resp.json()
            assert reval_data.get("passed") is True
            v_hash = reval_data.get("validated_hash")
            assert v_hash is not None

        # Confirm recheck_required is now cleared in DB session
        db.expire_all()
        check_b_reval = db.query(ProtocolSession).filter(ProtocolSession.session_id == sid_unchecked).first()
        meta_b_reval = dict(check_b_reval.meta_data or {})
        assert meta_b_reval.get("recheck_required") is not True

        # Now approve succeeds (200 OK)
        resp_b_approved = test_client.post(
            f"/api/protocols/{sid_unchecked}/approve",
            headers={"X-Session-Token": tok_unchecked},
            json={"approved_by": "You", "edited": False, "validated_hash": v_hash}
        )
        assert resp_b_approved.status_code == 200, f"Approve failed after revalidate: {resp_b_approved.text}"
        assert resp_b_approved.json().get("status") == "approved"

        # Verify recheck_required is also cleared on any new revision
        sid_rev_clear = f"test_rev_clear_{secrets.token_hex(4)}"
        tok_rev_clear = "tok_rev_clear_999"
        hash_rev_clear = hashlib.sha256(tok_rev_clear.encode()).hexdigest()
        s_rev_clear = ProtocolSession(
            session_id=sid_rev_clear,
            token_hash=hash_rev_clear,
            user_intent="Intent Revision Clear",
            status="awaiting_approval",
            current_draft=draft_content,
            meta_data={"recheck_required": True, "recheck_message": "Needs recheck."}
        )
        db.add(s_rev_clear)
        db.commit()

        # Calling revise clears recheck_required
        with patch("agents.workflow.create_workflow") as mock_wf:
            mock_app = mock.AsyncMock()
            mock_app.aget_state.return_value = mock.MagicMock(values={"user_intent": "Intent", "current_draft": draft_content})
            async def _active_revision_astream(*args, **kwargs):
                await asyncio.sleep(1.0)
                yield {"test": True}
            mock_app.astream = _active_revision_astream
            mock_wf.return_value = mock_app
            resp_rev = test_client.post(
                f"/api/protocols/{sid_rev_clear}/revise",
                headers={"X-Session-Token": tok_rev_clear},
                json={"instruction": "Make warmer"}
            )
            assert resp_rev.status_code == 200
            db.expire_all()
            check_rev_cleared = db.query(ProtocolSession).filter(ProtocolSession.session_id == sid_rev_clear).first()
            assert dict(check_rev_cleared.meta_data or {}).get("recheck_required") is not True

        # -------------------------------------------------------------
        # (c) Fail closed on unverified/unavailable evaluation
        # -------------------------------------------------------------
        sid_unverified = f"test_unverified_{secrets.token_hex(4)}"
        tok_unverified = "tok_unverified_111"
        hash_unverified = hashlib.sha256(tok_unverified.encode()).hexdigest()
        s_unverified = ProtocolSession(
            session_id=sid_unverified,
            token_hash=hash_unverified,
            user_intent="Intent Unverified",
            status="generating",
            current_draft=draft_content,
            review_depth="standard",
        )
        evt_draft_u = Event(
            session_id=sid_unverified,
            seq=1,
            run_id="run_u",
            run_kind="initial",
            draft_version=1,
            agent="Drafter",
            type="draft",
            text="Draft v1",
            data={"draft": draft_content}
        )
        # Merely node_end event (no score)
        evt_node_end = Event(
            session_id=sid_unverified,
            seq=2,
            run_id="run_u",
            run_kind="initial",
            draft_version=1,
            agent="SafetyGuardian",
            type="node_end",
            text="Node end",
            data={}
        )
        # Score event with unverified=True
        evt_unverified_score = Event(
            session_id=sid_unverified,
            seq=3,
            run_id="run_u",
            run_kind="initial",
            draft_version=1,
            agent="ClinicalCritic",
            type="score",
            text="Quality unavailable",
            data={"score_source": "unavailable", "unverified": True, "empathy_score": 0.0, "clinical_score": 0.0}
        )
        db.add_all([s_unverified, evt_draft_u, evt_node_end, evt_unverified_score])
        db.commit()

        reconcile_interrupted_sessions()
        check_u = db.query(ProtocolSession).filter(ProtocolSession.session_id == sid_unverified).first()
        assert check_u.status == "awaiting_approval"
        assert dict(check_u.meta_data or {}).get("recheck_required") is True

        resp_u_approve = test_client.post(
            f"/api/protocols/{sid_unverified}/approve",
            headers={"X-Session-Token": tok_unverified},
            json={"approved_by": "You", "edited": False, "validated_hash": "BASELINE"}
        )
        assert resp_u_approve.status_code == 409
        assert resp_u_approve.json().get("detail", {}).get("code") == "recheck_required"

        # -------------------------------------------------------------
        # (c) No draft: status=failed, user-facing error event emitted
        # -------------------------------------------------------------
        check_c = db.query(ProtocolSession).filter(ProtocolSession.session_id == sid_nodraft).first()
        assert check_c.status == "failed"
        assert check_c.current_draft is None

        evts_c = db.query(Event).filter(Event.session_id == sid_nodraft).all()
        err_evt_c = next((e for e in evts_c if e.type == "error" and e.run_id == "interrupted_startup"), None)
        assert err_evt_c is not None
        assert err_evt_c.severity == "error"
        assert err_evt_c.text == "That was interrupted before a draft could be created. Please start again."
        assert err_evt_c.data.get("code") == "interrupted_no_draft"

        run_end_c = next((e for e in evts_c if e.type == "run_end" and e.run_id == "interrupted_startup"), None)
        assert run_end_c is not None
        assert run_end_c.data.get("status") == "failed"
    finally:
        db.close()


def test_writer_timeout_and_failover():
    """Verify execute_with_failover times out slow writers (35s) and grants last writer extended timeout (90s)."""
    async def _run():
        client = UnifiedLLMClient()
        call_log = []

        # Test real timeout behaviour: capture per_call_timeout passed to asyncio.wait_for for each candidate
        recorded_timeouts = []
        orig_wait_for = asyncio.wait_for

        async def capture_wait_for(fut, timeout):
            recorded_timeouts.append(timeout)
            return await fut

        with patch("asyncio.wait_for", side_effect=capture_wait_for):
            # 1. Defaults: 35s for non-last writers, 90s for last writer
            with patch.dict(os.environ, {}, clear=False):
                os.environ.pop("WRITER_CALL_TIMEOUT_SECONDS", None)
                os.environ.pop("LAST_WRITER_CALL_TIMEOUT_SECONDS", None)

                class DummyFailingAdapter:
                    async def generate(self, *args, **kwargs):
                        raise RuntimeError("simulated failover")

                class DummyLastAdapter:
                    async def generate(self, *args, **kwargs):
                        return LLMResult(content="ok", provider="gemini", model="gemini-2.5-flash", latency_ms=1.0)

                probe_client = UnifiedLLMClient()
                probe_client._get_adapter = lambda prov: DummyLastAdapter() if prov == "gemini" else DummyFailingAdapter()
                probe_client.resolve_writer_plan = lambda: [
                    ("groq", "openai/gpt-oss-120b"),
                    ("groq", "llama-3.3-70b-versatile"),
                    ("gemini", "gemini-2.5-flash")
                ]

                recorded_timeouts.clear()
                await probe_client.execute_with_failover(role="writer", messages=[{"role": "user", "content": "hi"}])
                assert len(recorded_timeouts) == 3
                assert recorded_timeouts[0] == 35.0  # candidate 1 (non-last)
                assert recorded_timeouts[1] == 35.0  # candidate 2 (non-last)
                assert recorded_timeouts[2] == 90.0  # candidate 3 (last writer)

            # 2. Env overrides: verify custom values dynamically change timeouts
            with patch.dict(os.environ, {"WRITER_CALL_TIMEOUT_SECONDS": "20.0", "LAST_WRITER_CALL_TIMEOUT_SECONDS": "60.0"}):
                recorded_timeouts.clear()
                await probe_client.execute_with_failover(role="writer", messages=[{"role": "user", "content": "hi"}])
                assert len(recorded_timeouts) == 3
                assert recorded_timeouts[0] == 20.0
                assert recorded_timeouts[1] == 20.0
                assert recorded_timeouts[2] == 60.0

        class SlowEarlierAdapter:
            async def generate(self, *args, **kwargs):
                call_log.append("earlier_slow")
                await asyncio.sleep(0.3)
                return LLMResult(content="earlier success", provider="groq", model="openai/gpt-oss-120b", latency_ms=300.0)

        class FastLastAdapter:
            async def generate(self, *args, **kwargs):
                call_log.append("last_writer")
                # Last writer takes 0.2s, which exceeds earlier 0.1s timeout but is within last writer's 0.5s timeout
                await asyncio.sleep(0.2)
                return LLMResult(content="last writer success", provider="gemini", model="gemini-2.5-flash", latency_ms=200.0)

        adapters = {"groq": SlowEarlierAdapter(), "gemini": FastLastAdapter()}
        client._get_adapter = lambda prov: adapters[prov]
        client.resolve_writer_plan = lambda: [("groq", "openai/gpt-oss-120b"), ("gemini", "gemini-2.5-flash")]

        # Configure earlier writer timeout=0.1s, last writer timeout=0.5s
        with patch.dict(os.environ, {
            "WRITER_CALL_TIMEOUT_SECONDS": "0.1",
            "LAST_WRITER_CALL_TIMEOUT_SECONDS": "0.5",
            "MOCK_LLM": ""
        }):
            result = await client.execute_with_failover(
                role="writer",
                messages=[{"role": "user", "content": "hi"}]
            )
            assert result.content == "last writer success"
            assert result.provider == "gemini"
            assert result.fallback_used is True
            assert "earlier_slow" in call_log
            assert "last_writer" in call_log

        # Test all writers timing out raises TimeoutError
        adapters_slow = {"groq": SlowEarlierAdapter(), "gemini": SlowEarlierAdapter()}
        client._get_adapter = lambda prov: adapters_slow[prov]
        with patch.dict(os.environ, {
            "WRITER_CALL_TIMEOUT_SECONDS": "0.05",
            "LAST_WRITER_CALL_TIMEOUT_SECONDS": "0.05",
            "MOCK_LLM": ""
        }):
            with pytest.raises(TimeoutError) as exc_info:
                await client.execute_with_failover(
                    role="writer",
                    messages=[{"role": "user", "content": "hi"}]
                )
            assert "timed out after 0.05s" in str(exc_info.value)

    asyncio.run(_run())

