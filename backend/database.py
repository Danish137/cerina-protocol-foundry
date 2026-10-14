"""
Database setup, models, and utilities for persistence (A2, A4, A5)
"""

import os
from datetime import datetime, timezone
from sqlalchemy import (
    create_engine, Column, Integer, String, Text, DateTime, Float, JSON,
    UniqueConstraint, Index, text
)
from sqlalchemy.orm import declarative_base, sessionmaker

Base = declarative_base()

def utcnow_dt():
    return datetime.now(timezone.utc)

class ProtocolSession(Base):
    """Database model for protocol generation sessions"""
    __tablename__ = "protocol_sessions"
    
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, unique=True, index=True)
    token_hash = Column(String, index=True, nullable=True) # SHA-256 of session_token
    user_intent = Column(Text)
    status = Column(String) # idle | generating | review | editing | approving | approved | care_panel | error
    review_depth = Column(String, default="standard") # standard | thorough
    current_run_id = Column(String, nullable=True)
    current_draft = Column(Text, nullable=True)
    final_protocol = Column(Text, nullable=True)
    safety_score = Column(Float, nullable=True)
    empathy_score = Column(Float, nullable=True)
    clinical_score = Column(Float, nullable=True)
    iteration_count = Column(Integer, default=0)
    created_at = Column(DateTime, default=utcnow_dt)
    updated_at = Column(DateTime, default=utcnow_dt, onupdate=utcnow_dt)
    meta_data = Column(JSON, default=dict)

class Event(Base):
    """
    Events table (A2)
    events(session_id, seq, run_id, run_kind, draft_version, agent, type, to_agent, severity, text, data JSON, ts)
    PK / Unique: (session_id, seq)
    Types: node_start, node_end, token, message, score, decision, checkpoint, human_action, approval, run_end, error
    run_kind: initial | revision | recheck | human_revision
    """
    __tablename__ = "events"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String, index=True, nullable=False)
    seq = Column(Integer, nullable=False)
    run_id = Column(String, nullable=False)
    run_kind = Column(String, nullable=False, default="initial")
    draft_version = Column(Integer, default=1)
    agent = Column(String, nullable=False) # Drafter | SafetyGuardian | ClinicalCritic | Supervisor | Human | System
    type = Column(String, nullable=False) # node_start | node_end | token | message | score | decision | checkpoint | human_action | approval | run_end | error
    to_agent = Column(String, nullable=True)
    severity = Column(String, default="info") # info | warning | major | critical
    text = Column(Text, nullable=False)
    data = Column(JSON, default=dict)
    ts = Column(DateTime, default=utcnow_dt)

    __table_args__ = (
        UniqueConstraint("session_id", "seq", name="uq_session_seq"),
        Index("ix_session_seq", "session_id", "seq"),
    )

class LLMUsage(Base):
    """Capacity Guard (A5): Track every LLM call to enforce daily budgets"""
    __tablename__ = "llm_usage"

    id = Column(Integer, primary_key=True, autoincrement=True)
    session_id = Column(String, index=True, nullable=True)
    run_id = Column(String, nullable=True)
    model = Column(String, nullable=False)
    call_type = Column(String, nullable=False) # draft | safety | critic | retry
    prompt_tokens = Column(Integer, default=0)
    completion_tokens = Column(Integer, default=0)
    total_tokens = Column(Integer, default=0)
    latency_ms = Column(Float, default=0.0)
    created_at = Column(DateTime, default=utcnow_dt)

class AgentActivity(Base):
    """Legacy activity log retained for backward compatibility"""
    __tablename__ = "agent_activities"
    
    id = Column(Integer, primary_key=True, index=True)
    session_id = Column(String, index=True)
    agent_name = Column(String)
    action = Column(String)
    reasoning = Column(Text, nullable=True)
    timestamp = Column(DateTime, default=utcnow_dt)
    state_snapshot = Column(JSON, nullable=True)

from sqlalchemy.pool import NullPool

# Database setup
engine = None
SessionLocal = None

def init_db():
    """Initialize database connection and create tables"""
    global engine, SessionLocal
    if engine is not None and SessionLocal is not None:
        return engine, SessionLocal
    
    db_url = os.getenv("DATABASE_URL", "sqlite:///./cerina_foundry.db")
    
    # Handle SQLite path
    if db_url.startswith("sqlite:///"):
        db_path = db_url.replace("sqlite:///", "")
        if db_path and db_path != ":memory:":
            os.makedirs(os.path.dirname(db_path) if os.path.dirname(db_path) else ".", exist_ok=True)
        engine = create_engine(
            db_url,
            poolclass=NullPool,
            connect_args={"check_same_thread": False, "timeout": 30.0}
        )
    else:
        engine = create_engine(db_url)
    
    # Enable WAL mode for SQLite
    if "sqlite" in db_url:
        try:
            with engine.connect() as conn:
                conn.execute(text("PRAGMA journal_mode=WAL;"))
                conn.commit()
        except Exception:
            pass

    # Create tables
    Base.metadata.create_all(bind=engine)

    # Lightweight SQLite column migrations
    with engine.connect() as conn:
        for col_def in [
            ("token_hash", "TEXT"),
            ("review_depth", "TEXT DEFAULT 'standard'"),
            ("current_run_id", "TEXT")
        ]:
            try:
                conn.execute(text(f"ALTER TABLE protocol_sessions ADD COLUMN {col_def[0]} {col_def[1]};"))
                conn.commit()
            except Exception:
                pass
    
    # Create session factory
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    
    return engine, SessionLocal

def get_db_session():
    """Get database session"""
    if SessionLocal is None:
        init_db()
    return SessionLocal()
