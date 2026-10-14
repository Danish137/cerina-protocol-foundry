import os
import sys
import pytest
from datetime import datetime, timedelta, timezone
from fastapi import HTTPException

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))
from database import init_db, get_db_session, ProtocolSession, Event
from security import (
    generate_session_id, generate_session_token, hash_token,
    verify_session_access, purge_expired_sessions, record_llm_call, get_capacity_status
)

def setup_module():
    init_db()

def test_session_token_verification():
    db = get_db_session()
    sid = generate_session_id()
    token = generate_session_token()
    thash = hash_token(token)

    sess = ProtocolSession(
        session_id=sid,
        token_hash=thash,
        user_intent="Test intent",
        status="idle"
    )
    db.add(sess)
    db.commit()
    db.close()

    # 1. Valid token succeeds
    verified = verify_session_access(sid, x_session_token=token)
    assert verified.session_id == sid

    # 2. Wrong token raises 404 (NOT 403 per A4)
    with pytest.raises(HTTPException) as exc:
        verify_session_access(sid, x_session_token="wrong_token_here")
    assert exc.value.status_code == 404

    # 3. Missing token raises 404
    with pytest.raises(HTTPException) as exc:
        verify_session_access(sid, x_session_token=None)
    assert exc.value.status_code == 404

def test_retention_purge():
    db = get_db_session()
    old_sid = generate_session_id()
    old_token = generate_session_token()

    # Create session 10 days old (> 7 days)
    old_date = datetime.now(timezone.utc) - timedelta(days=10)
    old_sess = ProtocolSession(
        session_id=old_sid,
        token_hash=hash_token(old_token),
        user_intent="Old intent",
        status="completed",
        updated_at=old_date
    )
    db.add(old_sess)
    db.commit()
    db.close()

    # Run purge
    purged_count = purge_expired_sessions()
    assert purged_count >= 1

    # Verify session is gone
    db = get_db_session()
    found = db.query(ProtocolSession).filter(ProtocolSession.session_id == old_sid).first()
    assert found is None
    db.close()

def test_capacity_status():
    status = get_capacity_status()
    assert "daily_budget" in status
    assert "remaining_runs_estimate" in status
    assert "calls_used" in status
    assert status["remaining_calls"] >= 0
