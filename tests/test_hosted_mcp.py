"""
Unit tests for Hosted MCP Server (stateless StreamableHTTP at /mcp)
Tests token ownership, abuse controls, crisis screening, revision rules,
log redaction, and recheck enforcement using fakes and temporary database.
"""

import os
import sys
import logging
import io
import pytest
from unittest.mock import AsyncMock, patch

from database import get_db_session, ProtocolSession
from hosted_mcp import (
    hosted_mcp,
    create_exercise,
    get_status,
    get_exercise,
    revise_exercise,
    approve_exercise,
    verify_run_access,
    token_redaction_filter,
    TokenRedactionFilter,
    _mcp_daily_runs,
    _mcp_active_runs,
    NOT_FOUND_MESSAGE,
)
from runner import registry
from security import generate_session_id, generate_session_token, hash_token

@pytest.fixture(autouse=True)
def clean_mcp_state():
    """Reset in-memory MCP state between tests."""
    _mcp_daily_runs.clear()
    _mcp_active_runs.clear()
    yield
    _mcp_daily_runs.clear()
    _mcp_active_runs.clear()

def create_test_session(session_id: str, token: str, status="awaiting_review", draft="Test draft content", meta=None):
    """Helper to insert a test protocol session into the test database."""
    db = get_db_session()
    try:
        sess = ProtocolSession(
            session_id=session_id,
            token_hash=hash_token(token),
            user_intent="Practice mindful breathing for stress",
            status=status,
            review_depth="standard",
            current_draft=draft,
            safety_score=0.98,
            empathy_score=4.5,
            clinical_score=4.2,
            meta_data=meta or {"source": "mcp", "mcp_revisions": 0},
        )
        db.add(sess)
        db.commit()
        return sess
    finally:
        db.close()

# 1. Token ownership: wrong token returns exact 'not found' message
@pytest.mark.asyncio
async def test_token_ownership_wrong_token_returns_not_found():
    sid = generate_session_id()
    valid_token = generate_session_token()
    create_test_session(sid, valid_token)

    # Calling with wrong token
    res_status_wrong = await get_status(sid, "wrong_token_12345")
    assert res_status_wrong["status"] == "error"
    assert res_status_wrong["message"] == NOT_FOUND_MESSAGE
    assert res_status_wrong["error"] == NOT_FOUND_MESSAGE

    # Calling with non-existent session ID
    res_status_nonexistent = await get_status("session_does_not_exist", valid_token)
    assert res_status_nonexistent["status"] == "error"
    assert res_status_nonexistent["message"] == NOT_FOUND_MESSAGE
    assert res_status_nonexistent["error"] == NOT_FOUND_MESSAGE

    # Exact same message returned for get_exercise, revise_exercise, approve_exercise
    res_ex = await get_exercise(sid, "wrong_token")
    assert res_ex["message"] == NOT_FOUND_MESSAGE

    res_rev = await revise_exercise(sid, "wrong_token", "Please simplify step 2")
    assert res_rev["message"] == NOT_FOUND_MESSAGE

    res_app = await approve_exercise(sid, "wrong_token")
    assert res_app["message"] == NOT_FOUND_MESSAGE

# 2. Daily cap refusal
@pytest.mark.asyncio
async def test_daily_cap_refusal(monkeypatch):
    monkeypatch.setenv("MCP_DAILY_RUNS_PER_IP", "1")

    with patch("hosted_mcp.run_protocol_workflow", new_callable=AsyncMock):
        # First creation succeeds
        res1 = await create_exercise("Help with public speaking anxiety")
        assert "run_id" in res1
        assert "run_token" in res1

        # Complete or clear runner task so active run check passes
        sid = res1["run_id"]
        registry.release(sid)
        _mcp_active_runs.clear()

        # Second creation from same IP must be rejected due to daily cap
        res2 = await create_exercise("Help with sleep routine")
        assert res2["status"] == "rejected"
        assert "Daily limit" in res2["message"]
        assert "1" in res2["message"]

# 3. One active run per IP
@pytest.mark.asyncio
async def test_one_active_run_per_ip(monkeypatch):
    monkeypatch.setenv("MCP_DAILY_RUNS_PER_IP", "10")

    # Simulate an active background runner task
    sid = generate_session_id()
    token = generate_session_token()
    create_test_session(sid, token, status="generating")

    import asyncio
    async def fake_long_task(session_id, *args, **kwargs):
        await asyncio.sleep(10.0)

    await registry.acquire_or_raise(sid, fake_long_task)
    _mcp_active_runs["127.0.0.1"] = sid

    try:
        # Attempt to create another run while one is active
        res = await create_exercise("Another session request")
        assert res["status"] == "rejected"
        assert "already in progress" in res["message"]
    finally:
        registry.release(sid)

# 4. Revision cap refusal
@pytest.mark.asyncio
async def test_revision_cap_refusal(monkeypatch):
    monkeypatch.setenv("MCP_MAX_REVISIONS_PER_RUN", "3")
    sid = generate_session_id()
    token = generate_session_token()
    create_test_session(sid, token, meta={"source": "mcp", "mcp_revisions": 3, "last_mcp_instruction": "initial"})

    res = await revise_exercise(sid, token, "Make it shorter and simpler please")
    assert res["status"] == "rejected"
    assert "Maximum revisions (3) reached" in res["message"]

# 5. Crisis input returns crisis resources and starts no run
@pytest.mark.asyncio
async def test_crisis_input_returns_resources_and_no_run():
    db_before = get_db_session()
    count_before = db_before.query(ProtocolSession).count()
    db_before.close()

    res = await create_exercise("I want to end my life and kill myself")

    assert res["status"] == "care_panel"
    assert "Immediate crisis support is available" in res["message"]
    assert "care_resources" in res
    assert "run_id" not in res
    assert "run_token" not in res

    # Verify no session record was created for the crisis attempt
    db_after = get_db_session()
    count_after = db_after.query(ProtocolSession).count()
    db_after.close()
    assert count_after == count_before

# 6. Token redaction filter in logs
def test_token_redaction_filter():
    filt = TokenRedactionFilter()
    secret_token = "secret_session_bearer_token_xyz_9876543210"
    filt.register_token(secret_token)

    logger = logging.getLogger("test_redaction_logger")
    logger.setLevel(logging.INFO)
    stream = io.StringIO()
    handler = logging.StreamHandler(stream)
    handler.setFormatter(logging.Formatter("%(message)s"))
    handler.addFilter(filt)
    logger.addHandler(handler)

    try:
        logger.info(f"Processing session with token={secret_token} for client")
        output = stream.getvalue()

        assert secret_token not in output
        assert "[REDACTED_TOKEN]" in output
    finally:
        logger.removeHandler(handler)

# 7. Identical revision message
@pytest.mark.asyncio
async def test_identical_revision_message():
    sid = generate_session_id()
    token = generate_session_token()
    draft_text = "Step 1: Notice your physical sensations. Step 2: Breathe deeply."
    create_test_session(sid, token, draft=draft_text, meta={"source": "mcp", "mcp_revisions": 0, "last_mcp_instruction": "Make it calmer"})

    # 1. Request matching exact draft text
    res_draft_match = await revise_exercise(sid, token, draft_text)
    assert res_draft_match["status"] == "rejected"
    assert res_draft_match["message"] == "I couldn't apply that change. Try rephrasing it."

    # 2. Request matching previous instruction
    res_instr_match = await revise_exercise(sid, token, "Make it calmer")
    assert res_instr_match["status"] == "rejected"
    assert res_instr_match["message"] == "I couldn't apply that change. Try rephrasing it."

    # 3. Empty request
    res_empty = await revise_exercise(sid, token, "   ")
    assert res_empty["status"] == "rejected"
    assert res_empty["message"] == "I couldn't apply that change. Try rephrasing it."

# 8. Approve 409 recheck_required path
@pytest.mark.asyncio
async def test_approve_recheck_required_enforcement():
    sid = generate_session_id()
    token = generate_session_token()
    create_test_session(
        sid,
        token,
        status="awaiting_review",
        meta={"recheck_required": True, "recheck_message": "This draft wasn't fully checked. Run the checks again."}
    )

    # Approval blocked when recheck_required
    res_blocked = await approve_exercise(sid, token)
    assert res_blocked["status"] == "rejected"
    assert res_blocked["code"] == "recheck_required"
    assert res_blocked["message"] == "This draft wasn't fully checked. Run the checks again."

    # Now clear the recheck_required flag (as after successful re-check or revision)
    db = get_db_session()
    try:
        sess = db.query(ProtocolSession).filter(ProtocolSession.session_id == sid).first()
        meta = dict(sess.meta_data or {})
        meta.pop("recheck_required", None)
        sess.meta_data = meta
        db.commit()
    finally:
        db.close()

    # Approval succeeds
    res_approved = await approve_exercise(sid, token)
    assert res_approved["status"] == "Approved"
    assert res_approved["message"] == "Exercise approved successfully."

    db = get_db_session()
    try:
        sess = db.query(ProtocolSession).filter(ProtocolSession.session_id == sid).first()
        assert sess.status == "approved"
    finally:
        db.close()
