"""
Security, Session Tokens, Retention Purge, and Capacity Guard (A4, A5)
"""

import os
import hmac
import hashlib
import secrets
import logging
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

from fastapi import HTTPException, Header, Request, Depends
from sqlalchemy import text
from database import get_db_session, ProtocolSession, Event, LLMUsage

logger = logging.getLogger("cerina.security")

SESSION_TTL_DAYS = int(os.getenv("SESSION_TTL_DAYS", "7"))
DAILY_LLM_BUDGET = int(os.getenv("DAILY_LLM_CALL_BUDGET", "100"))

def generate_session_id() -> str:
    """Generate cryptographically secure 16-byte URL-safe session ID"""
    return f"session_{secrets.token_urlsafe(16)}"

def generate_session_token() -> str:
    """Generate raw secret bearer token given to client once upon create"""
    return secrets.token_urlsafe(32)

def hash_token(token: str) -> str:
    """SHA-256 hash for storage and verification"""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()

def verify_session_access(
    session_id: str,
    x_session_token: Optional[str] = Header(None, alias="X-Session-Token")
) -> ProtocolSession:
    """
    Enforces X-Session-Token check.
    Returns 404 (not 403) on missing, unknown session, or token mismatch.
    """
    if not x_session_token:
        logger.warning(f"Access denied for session {session_id}: missing X-Session-Token")
        raise HTTPException(status_code=404, detail="Session not found")

    db = get_db_session()
    try:
        session = db.query(ProtocolSession).filter(ProtocolSession.session_id == session_id).first()
        if not session or not session.token_hash:
            logger.warning(f"Access denied for session {session_id}: session does not exist")
            raise HTTPException(status_code=404, detail="Session not found")

        provided_hash = hash_token(x_session_token)
        if not hmac.compare_digest(session.token_hash, provided_hash):
            logger.warning(f"Access denied for session {session_id}: token hash mismatch")
            raise HTTPException(status_code=404, detail="Session not found")

        return session
    finally:
        db.close()

# --- Retention Purge (A4) ---

def purge_expired_sessions() -> int:
    """
    Purges sessions, events, and LangGraph checkpoints older than SESSION_TTL_DAYS.
    Executes PRAGMA wal_checkpoint(TRUNCATE).
    """
    db = get_db_session()
    try:
        cutoff = datetime.utcnow() - timedelta(days=SESSION_TTL_DAYS)
        expired_sessions = db.query(ProtocolSession).filter(ProtocolSession.updated_at < cutoff).all()
        expired_ids = [s.session_id for s in expired_sessions]

        if not expired_ids:
            logger.info("Retention purge: No expired sessions found.")
            return 0

        # Purge events
        db.query(Event).filter(Event.session_id.in_(expired_ids)).delete(synchronize_session=False)

        # Purge protocol sessions
        for s in expired_sessions:
            db.delete(s)
        db.commit()

        # Purge LangGraph checkpoints and writes
        conn = db.connection()
        for sid in expired_ids:
            try:
                conn.execute(text("DELETE FROM checkpoints WHERE thread_id = :sid"), {"sid": sid})
                conn.execute(text("DELETE FROM writes WHERE thread_id = :sid"), {"sid": sid})
            except Exception:
                pass
        db.commit()

        # Truncate WAL
        try:
            conn.execute(text("PRAGMA wal_checkpoint(TRUNCATE);"))
        except Exception:
            pass

        logger.info(f"Retention purge complete: purged {len(expired_ids)} expired sessions.")
        return len(expired_ids)
    except Exception as e:
        db.rollback()
        logger.error(f"Error during retention purge: {e}", exc_info=True)
        return 0
    finally:
        db.close()

# --- Capacity Guard (A5) ---

def record_llm_call(
    session_id: Optional[str],
    model: str,
    call_type: str,
    prompt_tokens: int = 0,
    completion_tokens: int = 0,
    latency_ms: float = 0.0
):
    """Logs an LLM call into the llm_usage table synchronously"""
    db = get_db_session()
    try:
        total = prompt_tokens + completion_tokens
        rec = LLMUsage(
            session_id=session_id,
            model=model,
            call_type=call_type,
            prompt_tokens=prompt_tokens,
            completion_tokens=completion_tokens,
            total_tokens=total,
            latency_ms=latency_ms
        )
        db.add(rec)
        db.commit()
    except Exception as e:
        db.rollback()
        logger.warning(f"Failed to record LLM usage: {e}")
    finally:
        db.close()

def get_capacity_status() -> Dict[str, Any]:
    """
    Returns daily capacity status:
    { remaining_runs_estimate, calls_used, daily_budget, resets_at, exhausted }
    """
    db = get_db_session()
    try:
        since = datetime.utcnow() - timedelta(hours=24)
        calls_used = db.query(LLMUsage).filter(LLMUsage.created_at >= since).count()
        remaining_calls = max(0, DAILY_LLM_BUDGET - calls_used)
        remaining_runs = remaining_calls // 3 # ~3 calls per standard generation
        
        # Reset is 24h from oldest recorded call, or end of day
        resets_at = (datetime.utcnow() + timedelta(hours=24)).isoformat()
        
        return {
            "daily_budget": DAILY_LLM_BUDGET,
            "calls_used": calls_used,
            "remaining_calls": remaining_calls,
            "remaining_runs_estimate": remaining_runs,
            "resets_at": resets_at,
            "exhausted": (remaining_calls <= 0)
        }
    finally:
        db.close()
