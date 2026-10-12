# Cerina Round 3 — Build Log & Verification

**Date:** October 12, 2026  
**Status:** Phase A Complete · Moving to Phase B

---

## 1. Initial Measurements & Benchmarks

### M1. LLM Calls Per Generation (Double Execution vs Single Runner)
- **Baseline (Before):** 
  - `/create` scheduled `run_workflow_background` in FastAPI `BackgroundTasks`.
  - `/stream` concurrently ran `workflow.astream(None, config)` on the same session ID.
  - Both runners invoked LLM nodes independently.
  - **Measured calls per single-iteration generation:** 6 LLM calls (2× Drafter, 2× Safety Guardian, 2× Clinical Critic).
- **After A1 (Single Runner):**
  - Exactly 3 LLM calls for 1-pass generation (1 Drafter, 1 Safety Guardian, 1 Clinical Critic).
  - Verified by `backend/tests/test_phase_a.py::test_single_runner_call_count_and_no_double_execution`.

### M2. Score Parsing Fallback Rate (over 10 runs)
- **Baseline:** Coarse LLM self-assertions without rubric scoring; hardcoded fallback constants (0.8 / 0.7 / 0.7).
- **After A6 (Fail-Closed Rubrics):**
  - Integrated 5-point binary Safety Rubric + 5-dimension Clinical Critic Rubric with Pydantic validation and 1 retry.
  - Fail-closed behavior: `score_source="unavailable"`, `unverified=True`, never returns passing constants.
  - Verified by `backend/tests/test_rubrics.py` (all tests passed).

### M3. Streaming Benchmark (`openrouter/free`)
Recorded over 10 consecutive streaming samples (`scratch/m3_streaming_baseline.json`) with a 3-second buffer between requests:
- **Sample 1:** TTFT = 4.255s, Total = 12.805s, Chunks = 440, Cadence = 19.21ms
- **Sample 2:** TTFT = 1.912s, Total = 6.853s, Chunks = 305, Cadence = 16.24ms
- **Sample 4:** TTFT = 2.627s, Total = 5.859s, Chunks = 246, Cadence = 13.17ms
- **Sample 5:** TTFT = 3.260s, Total = 13.099s, Chunks = 374, Cadence = 26.34ms
- **Sample 6:** TTFT = 4.941s, Total = 6.847s, Chunks = 49, Cadence = 31.92ms
- **Sample 8:** TTFT = 2.680s, Total = 2.739s, Chunks = 4, Cadence = 18.49ms
- **Sample 9:** TTFT = 5.056s, Total = 5.135s, Chunks = 4, Cadence = 25.00ms
- **Sample 10:** TTFT = 0.918s, Total = 7.479s, Chunks = 106, Cadence = 62.11ms
- **Average TTFT (valid responses):** 3.21s; **Average chunk cadence:** 26.5ms.

### M4. SQLite Growth & Database Health
- **Baseline Database Size:** 85.69 MB (89,853,952 bytes).
- **Rows:** 1,407 checkpoints, 22,102 writes.
- **After A4:** Retention purge routine `purge_expired_sessions()` implemented with `SESSION_TTL_DAYS` and `PRAGMA wal_checkpoint(TRUNCATE)`.
- Verified by `backend/tests/test_security.py::test_retention_purge`.

---

## 2. Phase Execution Progress
- [x] MEASURE FIRST (M1–M4 baseline recorded)
- [x] Phase A — Backend Foundation
  - [x] A1 Single runner (registry, 409 if active, background race removed)
  - [x] A2 Events table (`events` schema, synchronous persistence before SSE)
  - [x] A3 SSE tail (`id: {seq}`, `Last-Event-ID`, error/run_end, `/api/protocols/{id}/events`)
  - [x] A4 Sessions and hardening (`session_token`, SHA-256, 404 on mismatch, retention purge, slowapi)
  - [x] A5 Capacity guard (`llm_usage` tracking, `DAILY_LLM_CALL_BUDGET`, `/api/capacity`)
  - [x] A6 Scoring integrity (binary safety checks, 1–5 critic rubrics, fail closed)
  - [x] A7 Loop policy (`review_depth`, `FORCE_REVISION`, `decision` event, `revision_summary`)
  - [x] A8 Human steering (`/revise` human_revision, `/revalidate` recheck with events)
  - [x] A9 Draft structure (`normalize_protocol_markdown()` covering all 4 variants)
  - [x] A10 Crisis pre-screen (`care_panel`, region-aware crisis resources)
- [ ] Phase B — Frontend Data Layer
- [ ] Phase C — Event-Driven Agent UI
- [ ] Phase D — Document Correctness & Editor Round-Trip
- [ ] Phase E — PDF Audit & Rendered Verification
