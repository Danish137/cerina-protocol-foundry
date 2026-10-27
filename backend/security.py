"""
Security, Session Tokens, Retention Purge, and Capacity Guard
"""

import os
import hmac
import hashlib
import secrets
import logging
from datetime import datetime, timedelta, timezone
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

# --- Retention Purge ---

def purge_expired_sessions() -> int:
    """
    Purges sessions, events, and LangGraph checkpoints older than SESSION_TTL_DAYS.
    Executes PRAGMA wal_checkpoint(TRUNCATE).
    """
    db = get_db_session()
    try:
        cutoff = datetime.now(timezone.utc) - timedelta(days=SESSION_TTL_DAYS)
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

# --- Capacity Guard ---

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
    Capacity Guard:
    Runs left = min(writer_runs, safety_runs, critic_runs) * 0.90
    Each role's runs = its remaining quota across ALL its models, divided by the tokens or calls that role uses per run.
    Writer role is governed by Groq gpt-oss-120b + gpt-oss-20b (200,000 TPD limit / 1,900 tokens per call = ~105 calls/day)
    with Gemini as fallback.
    Resets at next UTC midnight.
    """
    db = get_db_session()
    try:
        now_utc = datetime.now(timezone.utc)
        start_of_day_utc = datetime(now_utc.year, now_utc.month, now_utc.day, 0, 0, 0, tzinfo=timezone.utc)
        
        # Usage today
        usages = db.query(LLMUsage).filter(LLMUsage.created_at >= start_of_day_utc).all()
        calls_used = len(usages)
        
        groq_writer_tokens = sum(
            u.total_tokens for u in usages
            if u.model and ("gpt-oss" in u.model.lower() or "groq" in u.model.lower())
        )
        gemini_writer_calls = sum(
            1 for u in usages
            if u.call_type in ("writer", "drafter") and u.model and "gemini" in u.model.lower()
        )
        gemini_safety_calls = sum(
            1 for u in usages
            if (u.call_type in ("safety", "judge") or (u.model and "gemini" in u.model.lower() and "safety" in (u.call_type or "")))
        )
        gemini_critic_calls = sum(
            1 for u in usages
            if (u.call_type in ("critic", "clinical") or (u.model and "gemini" in u.model.lower() and "critic" in (u.call_type or "")))
        )

        # Provider daily limits (2026-10-14 measured)
        groq_tpd_limit = 200_000
        gemini_rpd_limit = 500
        writer_tokens_per_run = 1900.0  # 200,000 TPD / 1,900 tokens = 105.26 calls/day
        safety_calls_per_run = 1.0
        critic_calls_per_run = 1.0

        # Remaining quotas per role across its models
        rem_groq_writer_tokens = max(0, groq_tpd_limit - groq_writer_tokens)
        writer_groq_runs = rem_groq_writer_tokens / writer_tokens_per_run
        rem_gemini_writer = max(0, gemini_rpd_limit - gemini_writer_calls)

        # Writer runs: primary is Groq (120b + 20b), fallback Gemini if Groq exhausted
        writer_runs = writer_groq_runs if writer_groq_runs > 0 else float(rem_gemini_writer)

        # Safety & Critic roles: primary is Gemini (500 RPD)
        rem_safety_calls = max(0, gemini_rpd_limit - gemini_safety_calls)
        safety_runs = rem_safety_calls / safety_calls_per_run

        rem_critic_calls = max(0, gemini_rpd_limit - gemini_critic_calls)
        critic_runs = rem_critic_calls / critic_calls_per_run

        # Runs left = min(writer_runs, safety_runs, critic_runs) * 0.90
        bottleneck_runs = min(writer_runs, safety_runs, critic_runs)
        runs_left = max(0, int(bottleneck_runs * 0.90))

        # Next UTC midnight reset
        tomorrow = (now_utc + timedelta(days=1)).date()
        next_midnight = datetime(tomorrow.year, tomorrow.month, tomorrow.day, 0, 0, 0, tzinfo=timezone.utc)
        resets_at = next_midnight.strftime("%Y-%m-%dT%H:%M:%SZ")

        return {
            "daily_budget": 105,  # Baseline ~105 Groq calls/day (200k TPD / 1900 tokens)
            "calls_used": calls_used,
            "remaining_tokens": rem_groq_writer_tokens,
            "remaining_calls": int(writer_runs),
            "remaining_runs_estimate": runs_left,
            "writer_runs": int(writer_runs),
            "safety_runs": int(safety_runs),
            "critic_runs": int(critic_runs),
            "resets_at": resets_at,
            "exhausted": (runs_left <= 0)
        }
    finally:
        db.close()
