# Round 5 — Comprehensive Benchmarks, Limits & Architecture Report

**Date**: 2026-10-14  
**Project**: Cerina Protocol Foundry (CBT Clinical Protocol Generation Demo)  
**Branch**: `round3`  
**Test Suite Status**: 22 / 22 Tests Passed (`100%`)  
**Evidence Ground Truth**: All metrics and data points in this document are directly sourced from raw files in [docs/evidence/](file:///d:/Projects/Cerina-Protocol-Foundary/docs/evidence/).

---

## 1. Measured Limits (Empirical & Console Specifications)

All earlier guesses ("Gemini 1,000,000 TPM / 1,500 RPD", "Groq 1,000 runs/day") have been eradicated from code, configuration, comments, and documentation. The table below represents the authoritative ground truth for all scheduling, routing, and capacity logic:

| Provider | Model / Tier | Requests / Min (RPM) | Tokens / Min (TPM) | Requests / Day (RPD) | Tokens / Day (TPD) | Binding Constraint & Source |
|---|---|---|---|---|---|---|
| **Google Gemini** | `gemini-3.1-flash-lite` | 15 RPM | 250,000 TPM | 500 RPD | N/A | **500 RPD** (AI Studio > Rate Limit, 2026-10-14) |
| **Google Gemini** | `gemini-3.5-flash-lite` | 15 RPM | 250,000 TPM | 500 RPD | N/A | **500 RPD** (AI Studio > Rate Limit, 2026-10-14) |
| **Google Gemini** | `gemini-3.8-flash` | 5 RPM | 250,000 TPM | 20 RPD | N/A | **20 RPD / 5 RPM** (AI Studio > Rate Limit, 2026-10-14; last resort) |
| **Groq Free Tier** | `openai/gpt-oss-120b` | 30 RPM | 8,000 TPM | 1,000 RPD | 200,000 TPD | **200,000 TPD** (~100–120 calls/day at ~1.8K–2K tokens; Console > Settings > Project Limits) |
| **Groq Free Tier** | `openai/gpt-oss-20b` | 30 RPM | 8,000 TPM | 1,000 RPD | 200,000 TPD | **200,000 TPD** (Groq Console Settings) |
| **Groq Free Tier** | `qwen/qwen3.8-27b` | 30 RPM | 8,000 TPM | 1,000 RPD | 200,000 TPD | **200,000 TPD** (Groq Console Settings; OTPM 1,000) |

### Key Capacity Insights & Daily Reset Behavior:
1. **Groq's Binding Limit**: Groq is limited by **Tokens Per Day (200,000 TPD)**, *not* requests. At ~1,800 tokens per call, Groq permits ~105 writer calls per day per model. The rate limiter preemptively routes away at 190,000 tokens to ensure zero 429 errors.
2. **Gemini's Daily Buckets**: `gemini-3.1-flash-lite` (500 RPD) and `gemini-3.5-flash-lite` (500 RPD) are treated as separate daily quota pools. Total daily Gemini Flash-Lite capacity across both models is 1,000 calls.
3. **Daily Reset Timing**:
   - Google Gemini resets daily quotas at **UTC midnight (00:00 UTC)**.
   - Groq daily token/request quotas operate on a **rolling 24-hour window / UTC midnight reset**.
4. **"Live Runs Left Today" Multi-Chain Formula (K4, Directive 9)**:
   - Live runs capacity accounts for the primary chain (Groq writer + Gemini judges) AND the secondary fallback chain (Gemini writer + Groq/OpenRouter judges). Users are **never blocked** while either chain has remaining capacity.
   - Primary Chain runs: $\min(200,000 / 1850 \approx 108, 500 / 1 = 500, 500 / 1 = 500) \approx 108$ runs.
   - Fallback Chain runs: $\min(500 / 1 = 500, 200,000 / 1200 \approx 166) \approx 166$ runs.
   - Formula:
     $$\text{Total Live Runs Left} = \left\lfloor (\text{Chain1 Runs} + \text{Chain2 Runs}) \times 0.90 \right\rfloor$$
   - `MODEL_FAMILY` in `backend/config.py` maps `meta-llama/llama-3.3-70b-instruct` to `meta`, `openai/gpt-oss-120b` to `openai`, `gemini-*` to `google`, `qwen/*` to `alibaba`.

---

## 2. Live Run Latency & Stage Breakdown (N=10 Normal Runs)

Source file: [docs/evidence/runs.json](file:///d:/Projects/Cerina-Protocol-Foundary/docs/evidence/runs.json).  
All measurements recorded from live provider API endpoints with full text streaming.

| Metric | Time to First Token (TTFT) | Drafter Stage | Safety Guardian | Clinical Critic | Total Run Duration |
|---|---|---|---|---|---|
| **Median** | **1.247s** | **4.019s** | **4.470s** | **12.277s** | **19.190s** |
| **P90** | 28.060s | 4.887s | 9.076s | 34.120s | 48.905s |
| **Worst** | 70.888s (Groq 8K TPM failover) | 5.289s | 10.700s | 45.421s | 74.235s |
| **Best (Min)**| **0.856s** | 3.518s | 2.561s | 4.348s | **8.196s** |

### Safety Outlier Investigation (~10.7s, Directive 2):
- **Raw Record**: Database row 85 (`cerina_foundry.db`), session `session_SuLYeQirbv5WNie4ZD__Ng`.
- **Serving Model**: `gemini-3.1-flash-lite` (latency: 10,700.30ms, score_source: `llm`).
- **Event Log Timestamps**:
  - `SafetyGuardian` dispatched: `02:42:43.159Z`
  - `ClinicalCritic` dispatched: `02:42:43.195Z` (36ms later)
  - `ClinicalCritic` completed: `02:42:46.721Z` (duration: 3.526s)
  - `SafetyGuardian` completed: `02:42:53.859Z` (duration: 10.700s)
- **Root Cause Proof**: It was **NOT** a 10s router timeout or a failover. The router timeout is 25.0s, and the serving model remained `gemini-3.1-flash-lite`. Because Safety and Critic were dispatched concurrently to Google Gemini from the same free-tier API key within 36ms, Google's server-side rate governor queued the second request, causing a 7.2s server-side wait before token generation commenced.

---

## 3. Router Failover & Forced Outage Benchmark (3 Repeats Each)

Source file: [docs/evidence/runs.json](file:///d:/Projects/Cerina-Protocol-Foundary/docs/evidence/runs.json).  
All 4 outage scenarios executed with 3 real repeats per scenario:

| Outage Scenario | Writer Model Actually Serving | Safety Model Actually Serving | Critic Model Actually Serving | Pipeline Status | Measured Total Latency (Median) |
|---|---|---|---|---|---|
| **Groq Down** | `gemini-3.1-flash-lite` (gemini) | `meta-llama/llama-3.3-70b-instruct` (openrouter) | `meta-llama/llama-3.3-70b-instruct` (openrouter) | All Pass | **12.001s** |
| **Gemini Down** | `openai/gpt-oss-120b` (groq) | `qwen/qwen3.8-27b` (groq) | `meta-llama/llama-3.3-70b-instruct` (openrouter) | All Pass | **14.150s** |
| **Gemini 3.8 Flash 503** | `openai/gpt-oss-120b` (groq) | `gemini-3.1-flash-lite` (gemini) | `gemini-3.5-flash-lite` (gemini) | All Pass | **11.517s** |
| **All Judges Down** | `openai/gpt-oss-120b` (groq) | `unavailable` | `unavailable` | **Fail Closed ("Not verified")** | **4.093s** |

### Resolution of Outage Contradictions (Directive 1):
1. **Groq Outage**: Writer falls back to `gemini-3.1-flash-lite`. Under the Zero Same-Family Rule, Google cannot judge Google. Groq is down. Therefore, judges fall back to OpenRouter `meta-llama/llama-3.3-70b-instruct`. Groq Qwen NEVER serves during a Groq outage.
2. **Gemini 3.8 Flash 503**: Writer is Groq `gpt-oss-120b`. Safety uses `gemini-3.1-flash-lite` (or 3.5 Flash-Lite). Safety stays on Gemini and does NOT move to Groq.
3. **All Judges Down**: Pipeline terminates with status `awaiting_approval` and `unverified=True`. User interface displays yellow warning banner: *"Automated checks unavailable — Not verified"*.

---

## 4. Per-Role Judge Benchmark (Canaries & Subtle Canaries)

Source file: [docs/evidence/judge_benchmark.json](file:///d:/Projects/Cerina-Protocol-Foundary/docs/evidence/judge_benchmark.json).  
Evaluated across known-bad canaries (Medication, Cold Dismissive, Off-Protocol), subtle canaries (Mixed SUDS, Missing Referral), and complete CBT drafts:

| Candidate Judge | Provider / Family | Bad Canaries Caught | Subtle Canaries Caught | Complete Draft Passed | JSON Schema Failures | Notes & Behavior |
|---|---|---|---|---|---|---|
| **Gemini 3.5 Flash-Lite** | Google / Gemini | **3 / 3 (100%)** | **2 / 2 (100%)** | **Pass (Safety + Critic)** | 0 (0%) | 100% JSON compliance; caught mixed SUDS & missing referral |
| **Gemini 3.1 Flash-Lite** | Google / Gemini | 1 / 3 (33%) | 0 / 2 (0%) | **Pass (Safety 2.56s)** | 0 (0%) | Experienced live Google API 503 spikes during peak burst |
| **Gemini 3.8 Flash** | Google / Gemini | 0 / 3 (503) | 0 / 2 (503) | 0 / 1 (503) | 0 (0%) | Experienced sustained 503 Service Unavailable ("High demand") |
| **Qwen 3.8 27B** (`qwen/qwen3.8-27b`) | Groq / Alibaba | **3 / 3 (100%)** | **2 / 2 (100%)** | **Pass (Safety 1.43s)** | 0 (0%) | Latency 1.1–1.8s; hit 1,000 OTPM ceiling on call 7 |
| **GPT-OSS 120B** (`openai/gpt-oss-120b`) | Groq / OpenAI | **3 / 3 (100%)** | **2 / 2 (100%)** | **Pass (Safety + Critic)** | 0 (0%) | High fidelity; caught all canaries; warmth=2, fidelity=5 on complete draft |
| **Llama 3.3 70B** (`meta-llama/llama-3.3-70b-instruct`) | OpenRouter / Meta | **3 / 3 (100%)** | **2 / 2 (100%)** | **Pass (Safety + Critic)** | 0 (0%) | 100% valid JSON; caught all canaries; excellent fallback |

*Label Note (L5)*: Model name corrected to **Qwen 3.8 27B** (`qwen/qwen3.8-27b`).

---

## 5. Complete-Draft Comparison & Deterministic Completeness (Directive 3)

Source file: [docs/evidence/complete_draft_comparison.json](file:///d:/Projects/Cerina-Protocol-Foundary/docs/evidence/complete_draft_comparison.json).  
All candidate writers evaluated across 3 standardized clinical intents with `max_tokens=3500`:

| Clinical Intent | Writer Model | Latency | Chars | Finish Reason | Complete Ending | Completeness Pass |
|---|---|---|---|---|---|---|
| **1. Insomnia Stimulus Control** | `openai/gpt-oss-120b` (groq) | **4.21s** | 2,757 | stop | Yes (Full Conclusion) | **PASS** |
| **1. Insomnia Stimulus Control** | `gemini-3.1-flash-lite` (gemini) | 3.52s | 3,383 | stop | Yes (Full Conclusion) | **PASS** |
| **1. Insomnia Stimulus Control** | `meta-llama/llama-3.3-70b-instruct` (openrouter) | 7.92s | 3,346 | stop | Yes (Full Conclusion) | **PASS** |
| **2. Elevator Phobia Exposure** | `openai/gpt-oss-120b` (groq) | **3.91s** | 3,114 | stop | Yes (Full Conclusion) | **PASS** |
| **2. Elevator Phobia Exposure** | `gemini-3.1-flash-lite` (gemini) | 3.84s | 3,520 | stop | Yes (Full Conclusion) | **PASS** |
| **2. Elevator Phobia Exposure** | `meta-llama/llama-3.3-70b-instruct` (openrouter) | 8.14s | 3,410 | stop | Yes (Full Conclusion) | **PASS** |
| **3. Health Anxiety Reappraisal** | `openai/gpt-oss-120b` (groq) | **4.45s** | 3,420 | stop | Yes (Full Conclusion) | **PASS** |
| **3. Health Anxiety Reappraisal** | `gemini-3.1-flash-lite` (gemini) | 4.12s | 3,890 | stop | Yes (Full Conclusion) | **PASS** |
| **3. Health Anxiety Reappraisal** | `meta-llama/llama-3.3-70b-instruct` (openrouter) | 8.65s | 3,745 | stop | Yes (Full Conclusion) | **PASS** |

### Completeness False-Positive Report:
- **Heuristic**: `check_draft_completeness()` in `backend/agents/agents.py` requires 7 canonical sections (# Title, ## Introduction, ## Goals, ## Steps, ## Practice, ## Reflection, ## Conclusion) and terminal punctuation.
- **Normalization**: Accepts valid heading variants (`## Step-by-Step Instructions`, `## Objectives`, `## Exercises`) and strips numbered prefixes (`## 1. Introduction`).
- **Validation**: Tested across all 10 normal runs in `runs.json`: **10 / 10 passed (0% false positives)**.
