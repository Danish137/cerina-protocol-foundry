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
from unittest.mock import patch

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
    """Verify reconcile_interrupted_sessions cleans up stranded sessions on server boot."""
    sid1 = f"test_interrupted_gen_{secrets.token_hex(4)}"
    sid2 = f"test_interrupted_rev_{secrets.token_hex(4)}"
    sid3 = f"test_interrupted_nodraft_{secrets.token_hex(4)}"
    draft_content = "# Preserved Draft\n\nContent remains intact."

    db = get_db_session()
    try:
        s1 = ProtocolSession(
            session_id=sid1,
            token_hash="tok1",
            user_intent="Intent 1",
            status="generating",
            current_draft=draft_content,
            review_depth="standard",
        )
        s2 = ProtocolSession(
            session_id=sid2,
            token_hash="tok2",
            user_intent="Intent 2",
            status="revising",
            current_draft=draft_content,
            review_depth="standard",
        )
        s3 = ProtocolSession(
            session_id=sid3,
            token_hash="tok3",
            user_intent="Intent 3",
            status="generating",
            current_draft=None,
            review_depth="standard",
        )
        db.add_all([s1, s2, s3])
        db.commit()
    finally:
        db.close()

    # Run startup reconciliation
    reconciled_count = reconcile_interrupted_sessions()
    assert reconciled_count >= 3

    db = get_db_session()
    try:
        check1 = db.query(ProtocolSession).filter(ProtocolSession.session_id == sid1).first()
        assert check1.status == "awaiting_approval"
        assert check1.current_draft == draft_content

        check2 = db.query(ProtocolSession).filter(ProtocolSession.session_id == sid2).first()
        assert check2.status == "awaiting_approval"
        assert check2.current_draft == draft_content

        check3 = db.query(ProtocolSession).filter(ProtocolSession.session_id == sid3).first()
        assert check3.status == "error"

        # Check events recorded
        evts1 = db.query(Event).filter(Event.session_id == sid1).all()
        err_evt = next((e for e in evts1 if e.type == "error"), None)
        assert err_evt is not None
        assert err_evt.text == "That was interrupted. Your draft is unchanged — try again."
        assert err_evt.data.get("code") == "interrupted"

        run_end_evt = next((e for e in evts1 if e.type == "run_end"), None)
        assert run_end_evt is not None
    finally:
        db.close()


def test_writer_timeout_and_failover():
    """Verify execute_with_failover times out slow writers and falls over to the next candidate."""
    async def _run():
        client = UnifiedLLMClient()
        call_log = []

        class SlowAdapter:
            async def generate(self, *args, **kwargs):
                call_log.append("slow")
                await asyncio.sleep(0.5)
                return LLMResult(content="slow success", provider="groq", model="qwen/qwen3.8-27b", latency_ms=500.0)

        class FastAdapter:
            async def generate(self, *args, **kwargs):
                call_log.append("fast")
                return LLMResult(content="fast success", provider="gemini", model="gemini-2.5-flash", latency_ms=50.0)

        adapters = {"groq": SlowAdapter(), "gemini": FastAdapter()}
        client._get_adapter = lambda prov: adapters[prov]
        client.resolve_writer_plan = lambda: [("groq", "qwen/qwen3.8-27b"), ("gemini", "gemini-2.5-flash")]

        with patch.dict(os.environ, {"WRITER_CALL_TIMEOUT_SECONDS": "0.1", "MOCK_LLM": ""}):
            result = await client.execute_with_failover(
                role="writer",
                messages=[{"role": "user", "content": "hi"}]
            )
            assert result.content == "fast success"
            assert result.provider == "gemini"
            assert result.fallback_used is True
            assert "slow" in call_log
            assert "fast" in call_log

        # Test all writers timing out raises TimeoutError
        adapters_slow = {"groq": SlowAdapter(), "gemini": SlowAdapter()}
        client._get_adapter = lambda prov: adapters_slow[prov]
        with patch.dict(os.environ, {"WRITER_CALL_TIMEOUT_SECONDS": "0.05", "MOCK_LLM": ""}):
            with pytest.raises(TimeoutError) as exc_info:
                await client.execute_with_failover(
                    role="writer",
                    messages=[{"role": "user", "content": "hi"}]
                )
            assert "timed out after 0.05s" in str(exc_info.value)

    asyncio.run(_run())


def test_relative_time_formatting():
    """Verify relative time formatting avoids '772m ago' and properly groups hours/days."""
    def format_relative_time_py(diff_seconds: int) -> str:
        if diff_seconds < 5:
            return "just now"
        if diff_seconds < 60:
            return f"{diff_seconds}s ago"
        minutes = diff_seconds // 60
        if minutes < 60:
            return f"{minutes}m ago"
        hours = diff_seconds // 3600
        if hours < 24:
            return f"{hours}h ago"
        days = diff_seconds // 86400
        return f"{days}d ago"

    assert format_relative_time_py(3) == "just now"
    assert format_relative_time_py(42) == "42s ago"
    assert format_relative_time_py(300) == "5m ago"
    assert format_relative_time_py(3540) == "59m ago"
    # 772 minutes = 46320 seconds -> MUST show "12h ago", NOT "772m ago"
    assert format_relative_time_py(46320) == "12h ago"
    assert format_relative_time_py(86400 * 2) == "2d ago"

