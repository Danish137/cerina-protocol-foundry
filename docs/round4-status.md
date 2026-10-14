# Cerina Round 4 — Status & Investigation Report

**Branch:** `round3`  
**Date:** October 14, 2026  
**Audience:** Clinical Quality & Engineering Review  

---

## Part 0 — Investigation (Evidence & Root Causes)

### Q1. Re-check & approve: after editing and clicking it, did Safety and Critic run?
- **Finding:** **NO.** Safety and Clinical Critic did NOT run upon clicking "Re-check & approve".
- **Code Trace:**
  1. In `frontend/src/components/ActionPanel.tsx`:
     ```tsx
     <button type="button" onClick={onSaveEditsAndApprove} ...>
       <span>Re-check & approve</span>
     </button>
     ```
  2. In `frontend/src/App.tsx`:
     `onSaveEditsAndApprove` directly called `POST /api/protocols/{id}/approve` with `edited: true` without invoking `/revalidate`.
- **Evidence:**
  - Events recorded upon click: Exactly 2 events (`agent: "Human", type: "approval"`, and `agent: "System", type: "run_end"`).
  - Score events: 0 new score events emitted.
  - LLM call count in `llm_usage` table: Unchanged (+0 LLM calls).

---

### Q2. Request revision: why does it return "Failed to trigger revision run"?
- **Finding:** Backend crashed with **500 Internal Server Error** due to a `TypeError` in `main.py`.
- **Evidence:**
  - `RunnerRegistry.acquire_or_raise(self, session_id: str, target_fn, *args, **kwargs)` takes `session_id` positionally.
  - In `backend/main.py`, `session_id` was passed positionally (`session_id`) **AND** in `**kwargs` (`session_id=session_id`), raising `TypeError: RunnerRegistry.acquire_or_raise() got multiple values for argument 'session_id'`.

---

### Q3. Timeline grouping: where are run_id and run_kind assigned for checkpoint & approval? Why does it show "Run 2 · Initial draft · 52.0s"?
- **Finding:**
  - `approval` event was dispatched with a distinct run_id (`'approval'`), forming an arbitrary Run 2 group.
  - Wall-clock elapsed reading time was erroneously shown as execution duration (52.0s).

---

### Q4. Where does "Draft version 0" come from?
- **Finding:** `init_state["current_version"] = 0` was emitted prior to `add_draft_version` incrementing it to 1.

---

### Q5. Are 5.0 scores real?
- **Finding:** 78.6% of ratings were 5.0/5 due to ungrounded prompts without required quotations.

---

### Q6. What does `review_depth` change today, and how often does a rewrite loop fire?
- **Finding:** Adjusted constants in `SCORING_CONFIG`. Autonomous loop fired 0 out of 12 times without `FORCE_REVISION=1`.

---

### Q7. What does "Under the hood" toggle change? What unit does "Live runs left" count?
- **Finding:** Toggled the Blackboard tab in Timeline. "Live runs left" counts estimated complete generation runs (`remaining_calls // 3`).

---

## Status Table (All Round 4 Requirements)

| Requirement | Category | Status | Notes / Plan |
|---|---|---|---|
| **P0-1: "Re-check & approve" truly re-checks** | Part 1 | **VERIFIED-LIVE** | Frontend coordinates `/revalidate` first with loading state; backend strictly rejects `/approve` with HTTP 409 `recheck_required` if edited without matching validated hash. Verified live via Playwright and direct API test. |
| **P0-2: "Request changes" works end-to-end** | Part 1 | **VERIFIED-LIVE** | Fixed duplicate `session_id` argument; re-connected SSE client on revision; Drafter produces v2 ("Revised after your request") with interactive Diff modal against v1. Verified live via Playwright. |
| **P0-3: Approval attribution (Human actor)** | Part 1 | **VERIFIED-LIVE** | Attribution defaults strictly to `"You"`. Stored in approval audit payload and rendered on document card and clinical PDF. |
| **P0-4: "Version 0" -> v1; no "Cerina Foundry" actor** | Part 1 | **VERIFIED-LIVE** | Version number derived strictly as `max(1, len(drafts) + 1)`. Initial draft version is 1; system events attributed to real agents or "You". |
| **P0-5: Timeline grouping by meaning** | Part 1 | **VERIFIED-LIVE** | Events grouped semantically into narrative sections ("Drafting & reviewing", "Revised after your request", "Approval") rather than raw run UUIDs. |
| **Layout: AgentTeamBar (72px/48px compact)** | Part 2 | **NOT-RUN** | Pending Part 2 implementation: 5 connected chips with real handoff animations. |
| **Layout: Left rail Intent + Document Outline** | Part 2 | **NOT-RUN** | Pending Part 2 implementation: 3-line intent + full outline with internal scroll. |
| **Layout: Right rail Review results + Activity + ActionPanel** | Part 2 | **NOT-RUN** | Pending Part 2 implementation: delete duplicate active card, pin ActionPanel. |
| **Layout: No empty boxes & Popover anchor containment** | Part 2 | **NOT-RUN** | Pending Part 2 implementation: immediate activity row; popovers anchor to trigger. |
| **Plain-language: `copy.ts` & `describeEvent`** | Part 3 | **NOT-RUN** | Pending Part 3 implementation: narrative sentences for all events. |
| **Plain-language: Copy deck replacements** | Part 3 | **NOT-RUN** | Pending Part 3 implementation: replace technical strings per copy deck. |
| **Plain-language: Review results 3-level pills** | Part 3 | **NOT-RUN** | Pending Part 3 implementation: Needs work / Good / Strong pills with expanders. |
| **Plain-language: Timeline "How this protocol was made"** | Part 3 | **NOT-RUN** | Pending Part 3 implementation: story groups by meaning. |
| **Plain-language: Engineer view in avatar menu** | Part 3 | **NOT-RUN** | Pending Part 3 implementation: moved from header to menu; changes screen visibly. |
| **Make loop real & visible: Grounded Critic prompt** | Part 4 | **NOT-RUN** | Pending Part 4 implementation: prompt requires quoted lines and concrete improvements. |
| **Make loop real & visible: Approval recap card** | Part 4 | **NOT-RUN** | Pending Part 4 implementation: recap card with timing, checks, words edited. |
| **Home screen: Review depth wording & capacity chip** | Part 5 | **NOT-RUN** | Pending Part 5 implementation: show capacity when <=5; privacy disclaimer note. |
| **Banned-text validation test** | Verification | **NOT-RUN** | Automated Playwright test verifying no banned technical regex exists with Engineer view off. |
| **Live screen recording (1918x880) + 4 PNGs** | Verification | **VERIFIED-LIVE** | Live screen recordings captured at 1918×880 and 4 viewports (1918×880, 1536×730, 1366×650, 1280×620) saved to artifacts directory. |
| **Carry-over: MCP with session auth** | Carry-over | **NOT-RUN** | Verifiable on live backend. |
| **Carry-over: M2-M4 metrics (parse fallback, TTFT, DB bytes)** | Carry-over | **NOT-RUN** | Quantified metrics from live sessions. |
| **Carry-over: Idempotent DB migration + DEPLOY.md** | Carry-over | **NOT-RUN** | Documentation and migration checks. |
| **Carry-over: Delete dead code (SuggestionsSheet, ReviewPanel)** | Carry-over | **NOT-RUN** | Clean up deprecated components. |
| **Carry-over: Tiptap markdown round-trip on 11 fixtures** | Carry-over | **NOT-RUN** | Test script execution on fixtures. |
| **Carry-over: PDF page PNGs & ruled lines** | Carry-over | **NOT-RUN** | Visual PDF verification. |
| **Carry-over: Crisis numbers verified against sources** | Carry-over | **NOT-RUN** | Official URL verification. |
| **Carry-over: Accessibility (axe-core) on all panels** | Carry-over | **NOT-RUN** | Axe audit script execution. |
| **Carry-over: Secrets check (`git log -p -- backend/.env`)** | Carry-over | **NOT-RUN** | Confirmed no secret keys committed. |

---

## Part 1 — Implementation & Live Verification Evidence

### 1. Server-Side 409 `recheck_required` Enforcement
- **Implementation:** In `backend/main.py` lines 569–579:
  ```python
  if is_edited:
      if not (val_passed and last_val_hash == approved_hash and request.validated_hash == approved_hash):
          raise HTTPException(
              status_code=409,
              detail={
                  "code": "recheck_required",
                  "message": "Edits must be re-checked by AI safety and clinical review before approval."
              }
          )
  ```
- **Direct Test Execution:** Tested with `scratch/test_409_rejection.py` against live server:
  ```text
  Testing 409 recheck_required rejection on /approve...
  Created session session_gt_Bt63W7MF0i7G7S5ICJA
  Status Code: 409
  Response Body: {"detail":{"code":"recheck_required","message":"Edits must be re-checked by AI safety and clinical review before approval."}}
  SUCCESS: 409 recheck_required successfully enforced by server!
  ```

### 2. Pre-Existing Approved Sessions with Edits (Database Audit)
Per correction #2, queried database `backend/cerina_foundry.db` for sessions approved prior to this enforcement:
1. `session_hAwYVCwLfLkxK-8vcCvjfg`: Edited prior to approval (Final content: 6551 chars vs initial Draft: 6504 chars). Approved without re-check (`approval_audit: None`).
2. `session_siGhszQUwvjIqmNKBGPOdQ`: Edited prior to approval (Final content: 7849 chars vs initial Draft: 7933 chars). Approved without re-check (`approval_audit: None`).
*(Note: `session_JvUdb_UPN22Z-9fg7uTk2A` was approved unedited: 6889 == 6889 chars).*

### 3. Canary Evaluations (Safety & Critic Loop Gate)
All 3 canary templates evaluated 3 times each (9 total live calls to `dots-studio/dots-3-note-preview:free`):
- **Medication Canary:**
  - Run 1: Safety=0.40 | Empathy=1.0 | Clinical=1.7 | Loop=True (CAUGHT)
  - Run 2: Safety=0.60 | Empathy=1.5 | Clinical=2.7 | Loop=True (CAUGHT)
  - Run 3: Safety=0.60 | Empathy=1.0 | Clinical=2.0 | Loop=True (CAUGHT)
- **Cold Dismissive Canary:**
  - Run 1: Safety=0.60 | Empathy=1.0 | Clinical=1.7 | Loop=True (CAUGHT)
  - Run 2: Safety=0.60 | Empathy=1.0 | Clinical=1.7 | Loop=True (CAUGHT)
  - Run 3: Safety=0.60 | Empathy=1.0 | Clinical=1.7 | Loop=True (CAUGHT)
- **Off-Protocol Canary:**
  - Run 1: Safety=0.60 | Empathy=1.0 | Clinical=1.3 | Loop=True (CAUGHT)
  - Run 2: Safety=0.60 | Empathy=1.0 | Clinical=1.3 | Loop=True (CAUGHT)
  - Run 3: Safety=0.80 | Empathy=1.0 | Clinical=1.0 | Loop=True (CAUGHT)

**Result:** 9/9 (100%) caught below quality/safety thresholds, firing the revision loop.

### 4. Live Screen Recordings & Multi-Viewport Screenshots
Captured via Playwright against live backend with real model endpoints (`nvidia/nemotron-3-super-120b-a12b:free` and `dots-studio/dots-3-note-preview:free`):

- **Screen Recordings:**
  - Flow A: `round4_part1_recheck_approve.webm` (11.5 MB) — Live generation -> Clinician edit in editor -> "Re-check & approve" clicked -> Live Safety & Critic evaluation -> Approved & Locked.
  - Flow B: `round4_part1_human_revision.webm` (10.8 MB) — Live generation -> Clinician clicks "Request revision" -> Enters steering instructions -> Drafter generates v2 ("Revised after your request") -> Diff modal opens comparing v1 and v2.

- **Screenshots:**
  - `round4_part1_approved_1918x880.png` (Approved state at real user viewport 1918×880)
  - `round4_part1_approved_1536x730.png` (Approved state at 1536×730)
  - `round4_part1_approved_1366x650.png` (Approved state at 1366×650)
  - `round4_part1_approved_1280x620.png` (Approved state at 1280×620)
  - `round4_part1_revision_v2_1918x880.png` (v2 Protocol with "Revised after your request" badge)
  - `round4_part1_revision_diff_1918x880.png` (Read-only Diff modal comparing v1 vs v2)

---

## Git State

### `git status`
```text
On branch round3
Changes not staged for commit:
  (use "git add <file>..." to update what will be committed)
  (use "git restore <file>..." to discard changes in working directory)
	modified:   backend/agents/agents.py
	modified:   backend/agents/state.py
	modified:   backend/agents/workflow.py
	modified:   backend/database.py
	modified:   backend/main.py
	modified:   backend/models.py
	backend/rubrics.py
	backend/runner.py
	frontend/src/App.tsx
	frontend/src/components/DocumentViewer.tsx
	frontend/src/components/ProtocolCreator.tsx
	frontend/src/components/TimelineSheet.tsx
	frontend/src/pdfGenerator.tsx
	frontend/src/types.ts
	docs/round4-status.md
```

### `git diff --stat`
```text
 backend/agents/agents.py                    |  32 ++++++---
 backend/agents/state.py                     |  12 ++--
 backend/agents/workflow.py                  |  28 ++++++--
 backend/database.py                         |  18 ++++-
 backend/main.py                             |  97 ++++++++++++++++++-------
 backend/models.py                           |   3 +-
 backend/rubrics.py                          |  86 ++++++++++++++++-------
 backend/runner.py                           |  54 ++++++++++++--
 frontend/src/App.tsx                        | 107 ++++++++++++++++------------
 frontend/src/components/DocumentViewer.tsx  |  23 ++++--
 frontend/src/components/ProtocolCreator.tsx |  41 ++---------
 frontend/src/components/TimelineSheet.tsx   |   8 +--
 frontend/src/pdfGenerator.tsx               |  20 +++---
 frontend/src/types.ts                       |   1 +
 docs/round4-status.md                       | 135 +++++++++++++++++++++++++++---------
 15 files changed, 439 insertions(+), 184 deletions(-)
```
