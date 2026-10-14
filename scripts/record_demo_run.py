#!/usr/bin/env python3
"""
scripts/record_demo_run.py (D8)
Captures a real or canonical protocol run's events with relative timing into
frontend/public/demo/sample-run.json for replay without live AI calls.
"""

import os
import sys
import json
import argparse
import sqlite3
from datetime import datetime, timezone, timedelta

# Add backend to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend")))
from normalizer import normalize_protocol_markdown

OUTPUT_PATH = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "frontend", "public", "demo", "sample-run.json"))

def generate_canonical_demo_run():
    """Build a rich, realistic canonical clinical demo run using normalized draft_1.md."""
    fixture_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend", "tests", "fixtures", "drafts", "draft_1.md"))
    with open(fixture_path, "r", encoding="utf-8") as f:
        raw_draft = f.read()

    normalized_draft = normalize_protocol_markdown(raw_draft)

    base_time = datetime.now(timezone.utc)
    t = lambda offset_s: (base_time + timedelta(seconds=offset_s)).isoformat()

    session_id = "demo_recorded_run_sleep_cbt"
    intent = "Create a stimulus control and sleep hygiene routine for persistent sleep-onset insomnia."
    run_id = "run_demo_001"

    events = [
        {
            "session_id": session_id,
            "seq": 1,
            "run_id": run_id,
            "run_kind": "initial",
            "draft_version": 1,
            "agent": "Drafter",
            "type": "node_start",
            "severity": "info",
            "text": "Synthesizing structured stimulus control & sleep hygiene protocol...",
            "data": {},
            "ts": t(0.0)
        },
        {
            "session_id": session_id,
            "seq": 2,
            "run_id": run_id,
            "run_kind": "initial",
            "draft_version": 1,
            "agent": "Drafter",
            "type": "message",
            "to_agent": "SafetyGuardian",
            "severity": "info",
            "text": "Draft complete with 5 stimulus control steps, sleep diary template, and reflection exercise.",
            "data": {},
            "ts": t(3.2)
        },
        {
            "session_id": session_id,
            "seq": 3,
            "run_id": run_id,
            "run_kind": "initial",
            "draft_version": 1,
            "agent": "Drafter",
            "type": "node_end",
            "severity": "info",
            "text": "Draft generation completed in 3.4s.",
            "data": {
                "latency_ms": 3410,
                "tokens": 820,
                "draft": normalized_draft
            },
            "ts": t(3.4)
        },
        {
            "session_id": session_id,
            "seq": 4,
            "run_id": run_id,
            "run_kind": "initial",
            "draft_version": 1,
            "agent": "SafetyGuardian",
            "type": "node_start",
            "severity": "info",
            "text": "Auditing protocol for clinical contraindications and medication boundaries...",
            "data": {},
            "ts": t(3.6)
        },
        {
            "session_id": session_id,
            "seq": 5,
            "run_id": run_id,
            "run_kind": "initial",
            "draft_version": 1,
            "agent": "SafetyGuardian",
            "type": "score",
            "severity": "info",
            "text": "Clinical safety rubric passed: 5/5 binary verification checks met.",
            "data": {
                "metric": "safety",
                "score": 1.0,
                "score_source": "llm",
                "unavailable": False,
                "checks": {
                    "self_harm_safe": True,
                    "no_medication_advice": True,
                    "no_unauthorized_diagnosis": True,
                    "no_contraindicated_exposure": True,
                    "appropriate_referral": True
                }
            },
            "ts": t(5.1)
        },
        {
            "session_id": session_id,
            "seq": 6,
            "run_id": run_id,
            "run_kind": "initial",
            "draft_version": 1,
            "agent": "SafetyGuardian",
            "type": "message",
            "to_agent": "ClinicalCritic",
            "severity": "info",
            "text": "Zero contraindications detected. Handing off for therapeutic empathy and CBT fidelity critique.",
            "data": {},
            "ts": t(5.3)
        },
        {
            "session_id": session_id,
            "seq": 7,
            "run_id": run_id,
            "run_kind": "initial",
            "draft_version": 1,
            "agent": "SafetyGuardian",
            "type": "node_end",
            "severity": "info",
            "text": "Safety audit finished in 1.8s.",
            "data": {"latency_ms": 1820, "tokens": 420},
            "ts": t(5.4)
        },
        {
            "session_id": session_id,
            "seq": 8,
            "run_id": run_id,
            "run_kind": "initial",
            "draft_version": 1,
            "agent": "ClinicalCritic",
            "type": "node_start",
            "severity": "info",
            "text": "Evaluating CBT fidelity dimensions and validation tone...",
            "data": {},
            "ts": t(5.6)
        },
        {
            "session_id": session_id,
            "seq": 9,
            "run_id": run_id,
            "run_kind": "initial",
            "draft_version": 1,
            "agent": "ClinicalCritic",
            "type": "score",
            "severity": "info",
            "text": "Clinical Rubric: Empathy 4.2 / 5, CBT Fidelity 4.5 / 5.",
            "data": {
                "metric": "clinical",
                "empathy_score": 4.2,
                "clinical_score": 4.5,
                "score_source": "llm",
                "unavailable": False,
                "dimensions": {
                    "warmth": {"score": 4.0, "rationale": "Calm, supportive and non-judgmental pre-sleep framing."},
                    "validation": {"score": 4.4, "rationale": "Validates the distress of sleep onset delay clearly."},
                    "clarity": {"score": 4.6, "rationale": "5-step behavioral guidelines are immediately actionable."},
                    "fidelity": {"score": 4.5, "rationale": "Standard evidence-based stimulus control principles."},
                    "structure": {"score": 4.5, "rationale": "Clear progression from logging to behavioral schedule."}
                }
            },
            "ts": t(7.2)
        },
        {
            "session_id": session_id,
            "seq": 10,
            "run_id": run_id,
            "run_kind": "initial",
            "draft_version": 1,
            "agent": "ClinicalCritic",
            "type": "message",
            "to_agent": "Supervisor",
            "severity": "info",
            "text": "Strong behavioral activation framing with clear contraindication boundaries.",
            "data": {},
            "ts": t(7.4)
        },
        {
            "session_id": session_id,
            "seq": 11,
            "run_id": run_id,
            "run_kind": "initial",
            "draft_version": 1,
            "agent": "ClinicalCritic",
            "type": "node_end",
            "severity": "info",
            "text": "Critic evaluation completed in 1.9s.",
            "data": {"latency_ms": 1950, "tokens": 510},
            "ts": t(7.5)
        },
        {
            "session_id": session_id,
            "seq": 12,
            "run_id": run_id,
            "run_kind": "initial",
            "draft_version": 1,
            "agent": "Supervisor",
            "type": "node_start",
            "severity": "info",
            "text": "Synthesizing rubric thresholds and determining routing policy...",
            "data": {},
            "ts": t(7.7)
        },
        {
            "session_id": session_id,
            "seq": 13,
            "run_id": run_id,
            "run_kind": "initial",
            "draft_version": 1,
            "agent": "Supervisor",
            "type": "decision",
            "severity": "info",
            "text": "All clinical rubrics satisfy required standard thresholds → routing to human clinician for review.",
            "data": {
                "route": "human",
                "reason": "Safety 5/5, Empathy 4.2/5 and Fidelity 4.5/5 meet all minimum thresholds (3.5/5 required)."
            },
            "ts": t(8.1)
        },
        {
            "session_id": session_id,
            "seq": 14,
            "run_id": run_id,
            "run_kind": "initial",
            "draft_version": 1,
            "agent": "Supervisor",
            "type": "checkpoint",
            "severity": "info",
            "text": "Protocol halted for licensed clinician verification and approval.",
            "data": {
                "status": "awaiting_approval"
            },
            "ts": t(8.3)
        },
        {
            "session_id": session_id,
            "seq": 15,
            "run_id": run_id,
            "run_kind": "initial",
            "draft_version": 1,
            "agent": "Supervisor",
            "type": "run_end",
            "severity": "info",
            "text": "Multi-agent generation run completed in 8.5s.",
            "data": {
                "status": "awaiting_approval"
            },
            "ts": t(8.5)
        }
    ]

    return {
        "session_id": session_id,
        "intent": intent,
        "review_depth": "standard",
        "draft": normalized_draft,
        "events": events
    }

def record_session_from_db(session_id: str):
    db_path = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "backend", "cerina_foundry.db"))
    conn = sqlite3.connect(db_path)
    cur = conn.cursor()

    cur.execute("SELECT session_id, user_intent, current_draft, review_depth, current_run_id FROM protocol_sessions WHERE session_id = ?", (session_id,))
    row = cur.fetchone()
    if not row:
        print(f"Session {session_id} not found in {db_path}")
        return None

    cur.execute("""
        SELECT session_id, seq, run_id, run_kind, draft_version, agent, type, to_agent, severity, text, data, ts
        FROM events WHERE session_id = ? ORDER BY seq ASC
    """, (session_id,))
    event_rows = cur.fetchall()

    if not event_rows:
        print(f"No events found for session {session_id}")
        return None

    # Parse initial timestamp to calculate relative offsets
    first_raw_ts = str(event_rows[0][11]).replace("Z", "")
    try:
        t0 = datetime.fromisoformat(first_raw_ts)
    except Exception:
        t0 = datetime.now(timezone.utc)

    base_time = datetime.now(timezone.utc)
    events = []
    for r in event_rows:
        raw_ts = str(r[11]).replace("Z", "")
        try:
            cur_t = datetime.fromisoformat(raw_ts)
            offset_s = max(0.0, (cur_t - t0).total_seconds())
        except Exception:
            offset_s = 0.0

        rebased_ts = (base_time + timedelta(seconds=offset_s)).isoformat() + "Z"

        events.append({
            "session_id": r[0],
            "seq": r[1],
            "run_id": r[2],
            "run_kind": r[3],
            "draft_version": r[4],
            "agent": r[5],
            "type": r[6],
            "to_agent": r[7],
            "severity": r[8],
            "text": r[9],
            "data": json.loads(r[10]) if r[10] else {},
            "ts": rebased_ts,
            "relative_offset_s": round(offset_s, 2)
        })

    return {
        "_metadata": {
            "mode": "Recorded live run",
            "capture_date": datetime.now(timezone.utc).isoformat() + "Z",
            "provider": "OpenRouter",
            "model": "openrouter/free (mistralai/mistral-small-3.2-24b-instruct:free)",
            "session_id": row[0],
            "run_id": row[4] or (events[0]["run_id"] if events else "run_live"),
            "event_count": len(events),
            "events_classification": "100% real live run events captured from SQLite events table"
        },
        "session_id": row[0],
        "intent": row[1],
        "review_depth": row[3] or "standard",
        "draft": row[2] or "",
        "events": events
    }

def main():
    parser = argparse.ArgumentParser(description="Record a demo run into sample-run.json")
    parser.add_argument("--session-id", help="Session ID from database to record")
    args = parser.parse_args()

    os.makedirs(os.path.dirname(OUTPUT_PATH), exist_ok=True)

    if args.session_id:
        data = record_session_from_db(args.session_id)
        if not data:
            sys.exit(1)
    else:
        print("Generating canonical demo run from normalized fixture...")
        data = generate_canonical_demo_run()

    with open(OUTPUT_PATH, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2)

    print(f"Recorded demo run saved to {OUTPUT_PATH} ({len(data['events'])} events).")

if __name__ == "__main__":
    main()
