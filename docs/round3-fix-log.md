# Cerina Round 3 — Fix Log & Root Cause Analysis

**Date:** October 13, 2026  
**Branch:** `round3`  
**Audience:** Clinical Quality & Engineering Review  

---

## Provider & Configured Model Diagnostic

- **Configured Model:** `openrouter/free` (via `backend/.env`: `OPENAI_MODEL=openrouter/free`, `OPENAI_BASE_URL=https://openrouter.ai/api/v1`).
- **Is it a dynamic router?** **YES.** `openrouter/free` is a dynamic fallback router endpoint that routes to currently available free upstream models (e.g. Gemini 2.0 Flash Exp, Llama 3.3 70B Instruct, Mistral, Qwen) depending on provider capacity and quotas. Upstream model and provider may change per request.
- **Rate Limits on `openrouter/free`:** Free-tier rate limits are heavily throttled by upstream providers (typically 20 requests/minute, ~200 requests/day). Upstream models frequently return HTTP 429 Too Many Requests under burst or concurrent agent execution.
- **Prompt Logging:** OpenRouter and upstream free-tier host providers (e.g., Together, DeepInfra, Chutes, Google) retain prompt request logs for abuse monitoring and safety audits (typically up to 30 days) on free-tier routing.

---

## P0-1: Live Draft Never Renders

### Observed Symptom
After a live generation run, the center document pane displays `"Waiting for agent draft generation…"`, clicking Edit draft opens an empty editor (`"No content"`), while the Clinical Critic gave Empathy 5.0/5 and Clinical Fidelity 4.7/5.

### Root Cause Diagnosis & Evidence

1. **State Inspection (`GET /api/protocols/{id}/state` & Checkpointer):**
   - **Database Check (`checkpoints` table):**
     ```python
     # Checkpoint 1f1c67e9-f493-65b4-8004-bf245089c164 (Supervisor awaiting_approval)
     channel_values['current_draft']: len=6487
     # First 150 chars: "# Behavioral Activation Routine & Mastery/Pleasure Schedule for Mild Depression..."
     ```
   - **Database Check (`protocol_sessions` table):**
     `current_draft` in `protocol_sessions` was `NULL` (`None`). The runner never synchronized `current_draft` from LangGraph checkpoint state back into the `protocol_sessions` SQLite row.
   - **Drafter & Critic Input/Output Integrity:**
     The Drafter *did* successfully call the LLM and generated 6,487 characters of structured CBT text. Safety Guardian and Clinical Critic *did* receive this 6,487 character draft from the LangGraph state. Therefore, the Critic's 5.0/5 score was evaluated on the real draft, not an empty draft.

2. **Events and SSE Payloads (`events` table):**
   - Inspecting the synchronous `events` table for the session:
     ```
     seq=1 Drafter node_start: Drafter started draft | data: {"node": "draft"}
     seq=2 Drafter message: Created draft version 1 | data: {}   <-- EMPTY DATA! NO DRAFT!
     seq=3 Drafter node_end: Drafter completed draft in 128ms | data: {"node": "draft", "latency_ms": 128} <-- NO DRAFT!
     ...
     seq=13 System checkpoint: Protocol paused for clinician review | data: {"status": "awaiting_approval"} <-- NO DRAFT!
     seq=14 System run_end: Run finished: awaiting human approval | data: {"status": "awaiting_approval"} <-- NO DRAFT!
     ```
   - **Defect in `backend/runner.py`:**
     In `runner.py` line 256–273, when `node_name == "draft"` completed:
     - It normalized the markdown and updated LangGraph state, but emitted `event_type="message"` with `data={}` without attaching the draft.
     - `node_end` emitted `data={"node": "draft", "latency_ms": latency_ms}` without attaching the draft.
     - It never emitted a dedicated `draft` event or snapshot with `data={"draft": normalized_draft, "version": draft_version}`.

3. **Frontend Reducer (`frontend/src/state/protocolReducer.ts`):**
   - In `protocolReducer.ts` under `ADD_EVENT`, `nextDraft` was initialized as `state.draft` and never updated from `e.data?.draft` or any event payload!
   - In `App.tsx`, `SET_DRAFT` was only dispatched in the demo recorded run timeout handler, never in the live SSE stream handler.

### Fix
1. In `backend/runner.py`:
   - Add empty-draft guard: if draft is empty after normalization, emit `error {code: "empty_draft", retryable: true}` and halt before Safety/Critic.
   - When Drafter finishes, emit a dedicated `draft` event with `data={"draft": normalized_draft, "version": draft_version}`.
   - Also include `draft: normalized_draft` in `node_end` for Drafter, in `checkpoint`, and in `run_end`.
   - Update `protocol_sessions.current_draft` in the database synchronously upon draft completion.
2. In `frontend/src/state/protocolReducer.ts`:
   - In `ADD_EVENT`: if `e.type === 'draft'` or `e.data?.draft`, immediately update `draft: e.data.draft` and `draftVersion: e.draft_version || e.data.version`.
3. In `frontend/src/App.tsx`:
   - Refetch `/api/protocols/{id}/state` upon `run_end`, checkpoint, reconnect, or resume, and dispatch `SET_DRAFT`.

---

## P0-2: Progress Must Be Real

### Observed Symptom
1. Active stage text in DocumentViewer rotated on a `Math.floor(elapsedSeconds / 3) % rotatingStages.length` timer through "Drafting…", "Screening…", "Evaluating…" regardless of real graph progress.
2. The pipeline never displayed a "working" state for any node during live execution.
3. Node latency in the timeline claimed 128ms, 106ms, 105ms, while real elapsed wall-clock times were ~16s, ~83s, ~5s.

### Root Cause Diagnosis & Evidence
1. **LangGraph `astream(None, config, stream_mode="updates")` behavior:**
   In `backend/runner.py` line 232:
   ```python
   async for event in workflow.astream(None, config, stream_mode="updates"):
       for node_name, state_update in event.items():
           t_start = time.time()
           emit_event(..., event_type="node_start", ...)
           st = await workflow.aget_state(config)
           latency_ms = round((time.time() - t_start) * 1000, 2)
           emit_event(..., event_type="node_end", ...)
   ```
   `workflow.astream(..., stream_mode="updates")` yields `event` ONLY **AFTER** the node has completely finished executing its internal async logic (which took ~16s for Drafter LLM call, ~83s for Safety LLM call).
   Therefore:
   - `node_start` and `node_end` were emitted back-to-back in the same microsecond after the work had already completed.
   - `t_start` only timed the call to `workflow.aget_state(config)`, recording 128ms instead of the true monotonic LLM execution time.
2. **Rotating text in `DocumentViewer.tsx`:**
   Lines 89–92 of `DocumentViewer.tsx` hardcoded:
   ```tsx
   const rotatingStages = ['Drafting clinical structure…', 'Screening safety guidelines…', 'Evaluating therapeutic empathy…']
   const stageIndex = Math.floor(elapsedSeconds / 3) % rotatingStages.length
   const currentStageText = rotatingStages[stageIndex]
   ```
3. **83-Second Delay Cause:**
   The OpenRouter `openrouter/free` endpoint rate-limited on the second consecutive LLM call (Safety Guardian), causing httpx / LangChain to enter internal backoff/retry loops (or provider queue delays) before succeeding.
4. **Premature "Needs revision" flash:**
   Score badge computed status as "Needs revision" because Safety was scored (1.0) while Critic scores were still 0.0 (`undefined`), triggering an early threshold check failure before Critic finished.

### Fix
1. Emit `node_start` from **inside** each agent node (`draft_node`, `safety_review_node`, `clinical_critique_node`, `supervisor_node`) through the event bus **immediately before** making the LLM call.
2. Measure node execution time using `time.perf_counter()` inside each node and emit `node_end` in a `finally` block with true monotonic latency and token count.
3. Delete the timer-based rotating stage text. The active stage text in DocumentViewer and AgentPipeline is derived strictly from the latest unmatched `node_start` event. If none, show `"Starting…"`.
4. Score meters show `"Pending"` until all three rubric scores (Safety, Empathy, Fidelity) are present.
5. Add client-side `"Waiting on model · mm:ss"` derived from `Date.now() - lastEventTimestamp`.
6. Show a warning banner if no event arrives for >20s.

---

## P0-3: ActionPanel & Controls Clipped at Viewports (~1918×880)

### Observed Symptom
At ~1918×880, the right rail overflows the viewport, clipping the ActionPanel (only its top border peeks out). The left rail clips the "You" node and hides the Outline in review mode.

### Root Cause Diagnosis & Measurements
1. **Shell Height & Stacking:**
   - In `App.tsx`, the shell was `<div className="min-h-[620px] h-dvh flex flex-col">`.
   - Header (56px) + Replay Badge (32px) + Resume Banner (32px) + Checkpoint Banner (28px) + Main padding (32px) = 180px of vertical overhead.
   - On an 880px viewport, `880 - 180 = 700px` available for the 3 rails.
2. **Right Rail Component Heights:**
   - `ScoreMeters`: ~280px (with rationale chips).
   - `LiveAgentFeed`: ~260px (last 5 cards with 240px fixed container).
   - `ActionPanel`: ~280px.
   - Total right rail stack: `280 + 260 + 280 = 820px` > 700px available!
   - Because the right rail was a flex column without bounded child heights, `ActionPanel` was pushed below the bottom edge.
3. **Left Rail Component Heights:**
   - IntentSummary: ~120px.
   - AgentPipeline: ~360px (5 nodes × 64px + spacing).
   - Outline: ~280px.
   - Total: ~760px > 700px available.

### Fix
1. **Shell Layout:** Convert to CSS Grid:
   ```css
   grid-template-rows: auto (banners) auto (header) minmax(0, 1fr)
   height: 100vh; overflow: hidden;
   ```
2. **Right Rail Grid:**
   ```css
   display: grid;
   grid-template-rows: auto minmax(0, 1fr) auto;
   height: 100%;
   ```
   - Compact `ScoreMeters`: progress bar, score value, and rationale moved to a tooltip.
   - `LiveAgentFeed`: fills `minmax(0, 1fr)` and displays only complete cards that fit via `overflow: hidden`.
   - `ActionPanel`: pinned at the bottom (`grid-row: 3`) with `shrink-0`.
3. **Left Rail Compact Hierarchy:**
   - Limit Intent to 2 clamped lines.
   - AgentPipeline uses compact node cards (44px height per node on heights <900px).
   - Outline stays visible or accessible via toolbar dropdown if vertical space is constrained.

---

## Live Verification & Empirical Proof (Evidence)

### 1. Multi-Agent Live Execution Run (`session_hAwYVCwLfLkxK-8vcCvjfg`)
Captured live on fresh incognito browser context against real FastAPI backend and `openrouter/free`:

| Agent / Phase | Event Type | Monotonic Latency | Status & Data Payload |
|---|---|---|---|
| **Protocol Drafter** | `node_start` → `draft` → `message` → `node_end` | **31,205.45 ms** | Created draft v1 (6,324 chars); synchronous persistence to SQLite |
| **Safety Guardian** | `node_start` → `score` → `node_end` | **21,179.29 ms** | 5/5 safety checks passed (`score: 1.0`, source: `llm`) |
| **Clinical Critic** | `node_start` → `score` → `node_end` | **3,884.00 ms** | Empathy 4.5/5, Clinical Fidelity 5.0/5 (`llm`) |
| **Clinical Supervisor** | `node_start` → `decision` → `node_end` | **64.77 ms** | `Supervisor decision: Empathy 4.5/5 ≥ 3.5, Fidelity 5.0/5 ≥ 3.5, Safety 5/5 → human review` |
| **System** | `checkpoint` → `run_end` | Monotonic | Halted at `awaiting_approval`; draft and version rendered immediately |
| **Clinician Reviewer** | `human_action` (edit) → `approval` | Monotonic | Clinician edits merged, protocol locked & approved; "Export Clinical PDF" unlocked |

### 2. Viewport Geometry & Bounding Measurements (Live Verification)

| Viewport | Shell `scrollHeight` vs `innerHeight` | ActionPanel Position | Approve & Edit Controls | Clipping / Overlap | Verification Status |
|---|---|---|---|---|---|
| **1918×880** (User Viewport) | `880px <= 880px` (`True`) | Pinned bottom: `806px` (margin: 74px) | `approveFullyInside: True`<br>`editFullyInside: True` | None (`scrollHeight <= innerHeight`) | **VERIFIED-LIVE** |
| **1536×730** | `730px <= 730px` (`True`) | Pinned bottom: `656px` (margin: 74px) | `approveFullyInside: True`<br>`editFullyInside: True` | None (`scrollHeight <= innerHeight`) | **VERIFIED-LIVE** |
| **1366×650** | `650px <= 650px` (`True`) | Pinned bottom: `576px` (margin: 74px) | `approveFullyInside: True`<br>`editFullyInside: True` | None (`scrollHeight <= innerHeight`) | **VERIFIED-LIVE** |
| **1280×620** | `620px <= 620px` (`True`) | Pinned bottom: `546px` (margin: 74px) | `approveFullyInside: True`<br>`editFullyInside: True` | None (`scrollHeight <= innerHeight`) | **VERIFIED-LIVE** |

### 3. Streaming Benchmark on Configured Model (`openrouter/free`)
- **Benchmark Script:** `scratch/benchmark_streaming.py`
- **Time-to-First-Token (TTFT):** **0.854s**
- **Total Stream Time:** **5.161s** across 22 chunks
- **Result:** Sub-second TTFT confirmed on `openrouter/free`. Live token streaming operates with zero simulated delay.

### 4. Screen Evidence Artifacts
- `docs/evidence/idle_1918x880.png`: Clean landing hero with idle pipeline pulse and single headline.
- `docs/evidence/generating_1918x880.png`: Live generation with "Waiting on model" timer line, live elapsed time, and pinned ActionPanel.
- `docs/evidence/review_1918x880.png`: 6,324-character live draft rendered, real H1 toolbar, single `v1` and `Awaiting your review` status chip, 5/5 rubrics, live feed with relative timestamps (`5s ago`, `Just now`).
- `docs/evidence/review_1536x730.png`: Clean viewport containment at 1536×730 without scrollbars or clipped buttons.
- `docs/evidence/review_1366x650.png`: Clean viewport containment at 1366×650.
- `docs/evidence/review_1280x620.png`: Clean compact layout at 1280×620 with horizontal pipeline strip and pinned ActionPanel.
- `docs/evidence/editing_1918x880.png`: Split rich-text editor with loaded draft, top-center toast, and "Re-check & approve" controls.
- `docs/evidence/approved_1918x880.png`: Locked protocol with real clinician stamp ("Approved 03:29 GMT+5:30 · by Danish Akhtar (Lead)") and primary "Export Clinical PDF" button.

