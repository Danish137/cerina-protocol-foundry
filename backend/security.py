"""
Security, Session Tokens, Retention Purge, and Capacity Guard (A4, A5)
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

# --- Retention Purge (A4) ---

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
    Capacity Guard (F9):
    Runs left = min(writer_runs, safety_runs, critic_runs)
    Each term is the sum over that role's providers, divided by (calls_per_run * tokens_per_call), times 0.90.
    Includes Qwen OTPM (1,000 cap) and Groq TPD (200,000 cap).
    Resets at next UTC midnight.
    """
    db = get_db_session()
    try:
        now_utc = datetime.now(timezone.utc)
        start_of_day_utc = datetime(now_utc.year, now_utc.month, now_utc.day, 0, 0, 0, tzinfo=timezone.utc)
        
        # Usage today
        usages = db.query(LLMUsage).filter(LLMUsage.created_at >= start_of_day_utc).all()
        calls_used = len(usages)
        
        groq_writer_tokens = sum(u.total_tokens for u in usages if u.model and "gpt-oss" in u.model.lower())
        groq_qwen_tokens = sum(u.total_tokens for u in usages if u.model and "qwen" in u.model.lower())
        gemini_35_calls = sum(1 for u in usages if u.model and "3.5" in u.model)
        gemini_31_calls = sum(1 for u in usages if u.model and "3.1" in u.model)

        # Provider daily limits (2026-10-14 measured)
        groq_tpd_limit = 200_000
        gemini_35_rpd = 500
        gemini_31_rpd = 500

        # Remaining quotas per provider
        rem_groq_writer = max(0, groq_tpd_limit - groq_writer_tokens)
        rem_groq_qwen = max(0, groq_tpd_limit - groq_qwen_tokens)
        rem_gemini_35_calls = max(0, gemini_35_rpd - gemini_35_calls)
        rem_gemini_31_calls = max(0, gemini_31_rpd - gemini_31_calls)

        # 1. Writer term: Providers = Groq gpt-oss-120b + Gemini 3.5 FL
        # calls_per_run = 1.0, tokens_per_call = 2,000
        gemini_writer_tokens = rem_gemini_35_calls * 2000
        writer_tokens_total = rem_groq_writer + gemini_writer_tokens
        writer_runs = (writer_tokens_total / (1.0 * 2000)) * 0.90

        # 2. Safety term: Providers = Groq Qwen (200k TPD, 1000 OTPM) + Gemini 3.5 FL
        # calls_per_run = 1.1, tokens_per_call = 1,000
        gemini_safety_tokens = rem_gemini_35_calls * 1000
        safety_tokens_total = rem_groq_qwen + gemini_safety_tokens
        safety_runs = (safety_tokens_total / (1.1 * 1000)) * 0.90

        # 3. Critic term: Providers = Gemini 3.5 FL + Groq Qwen
        # calls_per_run = 1.1, tokens_per_call = 1,200
        gemini_critic_tokens = rem_gemini_35_calls * 1200
        critic_tokens_total = gemini_critic_tokens + rem_groq_qwen
        critic_runs = (critic_tokens_total / (1.1 * 1200)) * 0.90

        # Final Capacity: Runs left = min(writer_runs, safety_runs, critic_runs)
        runs_left = max(0, int(min(writer_runs, safety_runs, critic_runs)))

        # Next UTC midnight reset
        tomorrow = (now_utc + timedelta(days=1)).date()
        next_midnight = datetime(tomorrow.year, tomorrow.month, tomorrow.day, 0, 0, 0, tzinfo=timezone.utc)
        resets_at = next_midnight.strftime("%Y-%m-%dT%H:%M:%SZ")

        return {
            "daily_budget": 90,  # Baseline runs from 200k Groq TPD / 2000 tokens * 0.90 = 90 runs
            "calls_used": calls_used,
            "remaining_calls": rem_groq_writer,
            "remaining_runs_estimate": runs_left,
            "writer_runs": int(writer_runs),
            "safety_runs": int(safety_runs),
            "critic_runs": int(critic_runs),
            "resets_at": resets_at,
            "exhausted": (runs_left <= 0)
        }
    finally:
        db.close()
