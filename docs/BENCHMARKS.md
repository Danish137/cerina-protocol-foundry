# Benchmarks & Development Metrics

> **Important:** All runtime numbers below are **from my development data, not a controlled evaluation**. No personal user situations are quoted; only aggregate counts and timings from a read-only temporary copy of the local development database (`cerina_foundry.db`) are reported.

---

## 1. Development Database Aggregates

Computed from a read-only copy of `cerina_foundry.db` (`16,396,288` bytes):

### Session Counts & Outcomes

```sql
SELECT CASE WHEN session_id LIKE 'test_%' THEN 'test_%'
            WHEN session_id LIKE 'session_%' THEN 'session_%'
            ELSE 'other' END AS pfx,
       COUNT(*)
FROM protocol_sessions
GROUP BY pfx;

SELECT status, COUNT(*)
FROM protocol_sessions
WHERE session_id NOT LIKE 'test_%'
GROUP BY status;
```

* **Total rows in `protocol_sessions`:** `115` (`38` `session_%` runs, `77` `test_%` test fixtures)
* **Non-test (`session_%`, `n = 38`) status breakdown:**
  * `awaiting_approval`: `27`
  * `approved`: `5`
  * `care_panel` (crisis screen): `4`
  * `error`: `2`

### LLM Calls per Session

```sql
SELECT COUNT(*) AS calls
FROM llm_usage
WHERE session_id IS NOT NULL AND session_id NOT LIKE 'test_%'
GROUP BY session_id;
```

* **Total `llm_usage` rows:** `324`
* **Non-test sessions with recorded usage (`n = 90`):** `min = 1`, **`p50 = 3.0`**, **`p95 = 6`**, `max = 42`

### Revision Rate

```sql
SELECT COUNT(DISTINCT session_id) FROM events;
SELECT COUNT(DISTINCT session_id)
FROM events
WHERE run_kind IN ('revision', 'human_revision') OR draft_version > 1;
```

* **Sessions with events:** `114`
* **Sessions with a revision or `draft_version > 1`:** `53 / 114` (**`46.5%`**)

### Time to First Draft & Time to Ready (from `events.ts`)

```sql
SELECT session_id,
       MIN(ts) AS t_start,
       MIN(CASE WHEN type = 'draft' THEN ts END) AS t_first_draft,
       MIN(CASE WHEN type = 'checkpoint' THEN ts END) AS t_first_ready
FROM events
WHERE session_id NOT LIKE 'test_%'
GROUP BY session_id;
```

Filtering to positive durations (`> 0s` and `< 600s`, excluding seeded/zero-delta fixtures):

* **Time to first draft (`n = 26`):** `min = 2.77s`, **`p50 = 3.91s`**, **`p95 = 7.37s`**, `max = 10.52s`
* **Time to ready (`checkpoint`, `n = 29`):** `min = 0.04s`, **`p50 = 9.25s`**, **`p95 = 19.38s`**, `max = 20.75s`

### Safety Pass Rate & Score Ranges (Valid `score` Events)

Filtering out `unverified = true` and `score_source = 'unavailable'` across `events`:

```sql
SELECT data FROM events WHERE agent = 'SafetyGuardian' AND type = 'score';
SELECT data FROM events WHERE agent = 'ClinicalCritic' AND type = 'score';
```

* **Safety pass rate (`score >= 0.8`, `n = 64` valid events):** `58 / 64` (**`90.6%`**), range `0.0 – 1.0`
* **Empathy scores (`n = 64` valid events):** range `0.0 – 5.0`, mean **`3.78`**
* **Quality scores (`n = 64` valid events):** range `0.0 – 5.0`, mean **`4.04`**

---

## 2. Automated Test Counts & Frontend Bundle Size

* **Backend tests (`pytest --collect-only -q tests/`):** **`25` tests** (`tests/test_hosted_mcp.py`: 13, `tests/test_review_status.py`: 6, `tests/test_revision_robustness.py`: 6) — all run with fakes/temp DBs and zero real LLM calls.
* **Frontend tests (`npm --prefix frontend test -- --run`):** **`25` tests** across 6 test files (`CarePanel.test.tsx`, `ErrorBoundary.test.tsx`, `Header.test.tsx`, `protocolReducer.test.ts`, `dateFormatter.test.ts`, `regionDetection.test.ts`).
* **Frontend production bundle (`frontend/dist/assets`):**
  * Main JS (`index-*.js`): `1,325,061` bytes (`~1.33 MB`)
  * Lazy PDF renderer JS (`pdfGenerator-*.js`): `1,255,624` bytes (`~1.26 MB`)
  * Stylesheet (`index-*.css`): `57,720` bytes (`~57.7 kB`)

---

## 3. Capacity Guard Arithmetic

From [`backend/security.py`](../backend/security.py#L143-L220) and [`backend/config.py`](../backend/config.py):

* **Writer baseline:** `200,000` daily tokens / `1,900` estimated tokens per call = **`105`** baseline writer calls/day (`daily_budget = 105`), with secondary writer family fallback (`500` RPD) when primary is exhausted.
* **Safety & Quality reviewer limits:** `500` requests/day per role (`safety_calls_per_run = 1.0`, `critic_calls_per_run = 1.0`).
* **Remaining runs formula:**
  $$\text{remaining\_runs\_estimate} = \left\lfloor \min(\text{writer\_runs},\ \text{safety\_runs},\ \text{critic\_runs}) \times 0.90 \right\rfloor$$
  The `0.90` factor reserves a 10% safety margin for retries and revisions before UTC midnight reset.

---

## 4. How a Proper Evaluation Would Work

To move from development telemetry to a controlled evaluation:

1. **Fixed prompt suite (30 prompts):** Stratify 30 fixed inputs across common CBT topics (worry, insomnia, procrastination, social anxiety), edge-case safety traps (medication requests, contraindicated exposure, subtle distress), and crisis-keyword boundaries.
2. **Human blind grading:** Have 2+ qualified human raters score all 30 outputs on the same 5-point safety and quality rubrics without seeing the automated scores, then measure inter-rater agreement (e.g., Cohen's kappa / Spearman rank correlation) against the automated reviewer family.
3. **Regression gating:** Re-run the 30-prompt suite on a pinned snapshot whenever prompts, normalizer rules, or model-family assignments change, tracking pass rate, quote-grounding validity, P50/P95 latency, and token cost per run.
