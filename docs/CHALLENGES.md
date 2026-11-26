# Engineering Challenges

Real issues hit during development and resolved across PRs #1–#6.

---

### 1. Revision hung forever after a clean end-of-stream (`PR #2`, `0cbf23d`)

* **Symptom:** After requesting a revision, the UI sometimes stayed stuck in *"In progress"* indefinitely even though the backend had already finished.
* **Root cause:** When the SSE stream closed cleanly without a terminal error event, the old SSE client treated it as a normal end and stopped listening without polling `/state` or `/events`.
* **Fix:** Updated [`frontend/src/services/sseClient.ts`](../frontend/src/services/sseClient.ts) to poll saved state/events after stream close or drop, added per-call and overall revision timeouts in [`backend/runner.py`](../backend/runner.py), and ensured `registry.release()` runs in `finally`.
* **How I proved it:** Added `test_revision_timeout_releases_runner` and `test_second_revise_after_timeout_accepted` in [`tests/test_revision_robustness.py`](../tests/test_revision_robustness.py).
* **Lesson:** Never treat an HTTP 200 SSE stream closing as proof that a background workflow finished; always reconcile against durable server state.

---

### 2. Blank white screen in CarePanel with empty resources (`PR #3` `155c21c` & `PR #4` `6029002`)

* **Symptom:** Opening the care/crisis view without an active session or with a partial/empty `{}` care payload threw `Cannot read properties of undefined (reading 'country')` and crashed the entire React tree to a blank white screen.
* **Root cause:** `CarePanel.tsx` assumed `careResources.primary_helpline.country` was always populated, and there was no React `ErrorBoundary` wrapping the app or `CarePanel`.
* **Fix:** Added defensive null/partial-payload handling in [`frontend/src/components/CarePanel.tsx`](../frontend/src/components/CarePanel.tsx), added timezone-based region ordering, and wrapped both the app content and `CarePanel` in [`frontend/src/components/ErrorBoundary.tsx`](../frontend/src/components/ErrorBoundary.tsx) with a static crisis-help block.
* **How I proved it:** Reproduced the original crash by temporarily restoring `0cbf23d:frontend/src/components/CarePanel.tsx` and running `vitest` (`CarePanel.test.tsx` failed with the exact `reading 'country'` `TypeError`), then restored the fix and verified all tests pass.
* **Lesson:** Crisis help must never depend on runtime API state; always keep a static fallback inside an ErrorBoundary.

---

### 3. Review status could say "Ready" without finished reviews (`PR #6`, `e22419c`)

* **Symptom:** (a) If a runner failed after a draft existed but before safety/quality scores were written, `finally` still set `status = "awaiting_approval"` without `recheck_required`. (b) MCP `get_exercise` returned `null` summary scores because it read unfilled columns on `protocol_sessions` instead of `score` events.
* **Root cause:** Two separate status/score paths had drifted: `runner.py`'s `finally` block defaulted to `awaiting_approval`, and `hosted_mcp.py` read `ProtocolSession.safety_score` instead of the `events` table that the web app used.
* **Fix:** Extracted a single shared helper `is_valid_evaluation(db, session_id, draft_version)` in [`backend/runner.py`](../backend/runner.py) used by startup reconciliation, the runner `finally` block, and [`backend/hosted_mcp.py`](../backend/hosted_mcp.py) (`get_status`, `get_exercise`, `approve_exercise`).
* **How I proved it:** Wrote failing tests first in [`tests/test_review_status.py`](../tests/test_review_status.py), verified the fix, and ran a mutation check re-introducing the old default `db_sess.status = "awaiting_approval"` to confirm the test caught it.
* **Lesson:** Derive readiness and review summaries from one source of truth rather than duplicating status heuristics across REST and MCP handlers.

---

### 4. Interrupted-run reconciliation on server restart (`0cbf23d`, `PR #6` `e22419c`)

* **Symptom:** Container restarts left in-flight sessions stuck in `generating` or `revising` forever, or failed to mark unverified drafts as `recheck_required`.
* **Root cause:** In-memory `RunnerRegistry` state is lost on process restart, leaving SQLite rows in transient statuses.
* **Fix:** Added `reconcile_interrupted_sessions()` at startup ([`backend/runner.py`](../backend/runner.py)) using `is_valid_evaluation()`: sessions with no draft become `failed`; sessions with a draft but incomplete checks become `awaiting_approval` with `recheck_required = True`; fully checked drafts stay approvable.
* **How I proved it:** Tested all three recovery branches in `test_interrupted_run_startup_reconciliation` ([`tests/test_revision_robustness.py`](../tests/test_revision_robustness.py)).
* **Lesson:** In-memory task registries must be paired with startup database reconciliation.

---

### 5. Preview deploys blocked by CORS (`ddb9c95`)

* **Symptom:** Vercel preview deployments could not call the Railway backend API (`OPTIONS` / `GET` blocked by CORS).
* **Root cause:** `CORSMiddleware` initially listed only `localhost` and the production Vercel URL, missing `*.vercel.app` preview URLs.
* **Fix:** Added `allow_origin_regex=r"^https://.*\.vercel\.app$"` in [`backend/main.py`](../backend/main.py#L177) (and allowed Vercel origin in [`backend/hosted_mcp.py`](../backend/hosted_mcp.py)).
* **How I proved it:** Verified production and preview origin matching against `CORSMiddleware` configuration and live `/health` + frontend requests.
* **Lesson:** Match preview deploy URL patterns explicitly in CORS alongside the primary production origin.

---

### 6. Squash merges vs. local branches (`PR #1`–`PR #6`)

* **Symptom:** After squash-merging a PR on GitHub, `git branch -d <branch>` refused to delete the local branch because Git did not see the branch commits as ancestors of `main`.
* **Root cause:** Squash merges create a single new commit on `main` rather than preserving the feature branch's commit SHAs.
* **Fix:** Verified `gh pr list --state merged --head <branch>` before deleting remote branches and using `git branch -D <branch>` locally, followed by `git fetch --prune origin`.
* **How I proved it:** Verified clean `main` with `git branch -a` and `git status -sb` after each PR cleanup.
* **Lesson:** Always confirm the PR merge state before force-deleting unmerged-looking local squash branches.

---

### 7. Secret-scan false negatives without a positive control

* **Symptom:** A regex secret scan returning zero matches can give false confidence if the pattern itself is broken or overly restrictive.
* **Root cause:** Running `Select-String` / `grep` without testing that a known dummy token triggers a match hides silent pattern bugs (e.g., escaping or regex dialect differences).
* **Fix:** Always run a positive-control check (e.g., `"sk-test12345"` against the exact secret-scan pattern) alongside scanning the diff/repo.
* **How I proved it:** Verified positive-control match output before accepting a clean zero-match scan on `git diff`.
* **Lesson:** Any security or leak check that reports "0 findings" needs a positive control to prove the detector actually fires.
