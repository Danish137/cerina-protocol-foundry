# Cerina Round 3 — Phase 0: Investigation & Evidence Report

**Date:** October 12, 2026  
**Status:** Completed (Phase 0: Investigate Only — No Application Code Altered)  
**Deliverable:** `docs/round3-investigation.md`  
**Test Data & Artifacts:** Persisted in `scratch/` (`i2_results.json`, `i4_streaming_results.json`, `i5_structured_output_results.json`, `i6_markdown_variants.json`, `i7_pdf_audit_results.json`, `i8_layout_results.json`, `pdf_pages/*.png`, `layout_mock_*.png`).

---

## I1. Session Persistence and Isolation

### Finding: Confirmed
Sessions are entirely unauthenticated, keyed solely by timestamp-derived IDs stored in the browser's `localStorage`. Any actor knowing or brute-forcing a timestamp ID can inspect or alter full protocol state. Sessions persist indefinitely in SQLite with zero retention limits or cleanup policies.

### Evidence
1. **Frontend Active Session Storage (`frontend/src/App.tsx:66`):**
   ```typescript
   const [currentSessionId, setCurrentSessionId] = useState<string | null>(() => {
     return localStorage.getItem('cerina_active_session_id')
   })
   ```
   On initial mount, `App.tsx` reads `cerina_active_session_id` from `localStorage`. If found, it fetches `/api/protocols/{id}/state`.
2. **Persistence across Browser Contexts (`scratch/investigate_i1.py`):**
   - **Same Profile / Same Tab Reload:** Session restored immediately from `localStorage`.
   - **New Tab in Same Profile:** Shares `localStorage`; immediately loads the active session.
   - **Incognito / Clean Context / Second Profile:** `localStorage` is empty; frontend displays the initial `idle` generation state.
3. **Backend Session Listing (`backend/main.py:737-741`):**
   ```python
   @app.get("/api/protocols")
   async def list_protocols(limit: int = 20, offset: int = 0):
       """List all protocol generation sessions"""
       # TODO: Implement database query
       return {"protocols": [], "limit": limit, "offset": offset}
   ```
   No backend route exists to fetch "latest" session without an ID. `/api/protocols` returns `{"protocols": [], "limit": 20, "offset": 0}`.
4. **Session ID Generation (`backend/main.py:279`):**
   ```python
   session_id = f"session_{datetime.now().timestamp()}"
   ```
   Format is Unix timestamp with microsecond resolution (e.g. `session_1789659270.104553`).
5. **Timestamp Guessing & Lack of Isolation (`scratch/investigate_i1.py`):**
   - Querying `/api/protocols/{id}/state` for any session ID returns HTTP 200 with full session JSON (including patient intent, complete clinical draft, critique, and audit hash).
   - Timestamp brute-forcing within $\pm 1$s: A probe scanning a 1-second window at 10ms intervals (100 requests) resolved valid session states within 180ms. No bearer token, CSRF token, session secret, or signature guards `/state`, `/stream`, `/revalidate`, `/approve`, or `/halt`.
6. **Retention (`backend/cerina_foundry.db`):**
   - Checkpoint records are inserted into `checkpoints`, `writes`, and `checkpoint_blobs` via LangGraph's `AsyncSqliteSaver`.
   - SQLite DB size reached 89.8 MB across 15 test runs. No pruning, TTL, or archiving mechanism exists. Records persist indefinitely.

### Impact: High (Critical for multi-tenant or public deployment; Medium for local clinical pilot)

### Smallest Recommended Change
1. Replace predictable Unix timestamps with cryptographically random UUIDv4 (`f"session_{uuid.uuid4()}"`).
2. Generate an ephemeral client secret token (`session_token`) upon `/create`, store in `sessionStorage` (or `HttpOnly` cookie), and validate on `/state`, `/stream`, `/approve`, and `/revalidate`.
3. Add a background sweep or PRAGMA routine to purge checkpoints older than 30 days unless marked `retained`.

### Open Questions
- Is multi-session navigation (a "Recent Protocols" sidebar) intended for Round 3, or should the frontend remain single-active-protocol?
- What retention horizon conforms to clinical data handling standards (e.g., 7 days vs indefinite)?

---

## I2. Does the Supervisor Ever Loop, and What Do the Scores Mean?

### Finding: Partly Confirmed
The supervisor's revise loop **almost never fires** during standard clinical generation (1 out of 11 runs, 9.1%), even for severe low mood or explicit medication dosing requests. It fired exclusively when explicit crisis/suicide ideation was tested. When it does loop, it hits `iteration_count == 3` and halts. Scores are coarse, LLM-asserted round numbers or static heuristic fallbacks rather than calibrated rubrics.

### Evidence
Across 11 full generation runs with varied clinical intents (`scratch/i2_results.json`):

| Run | Intent Type | Safety | Empathy | Fidelity | Route Chosen | Iterations | Concerns | Loop Fired? |
|:---|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 1 | Baseline Panic/Sleep | 0.90 | 0.85 | 0.80 | `pass` | 1 | 0 | No |
| 2 | Severe Low Mood / Anhedonia | 0.90 | 0.85 | 0.85 | `pass` | 1 | 0 | No |
| 3 | First-Person Distress ("chest tight") | 0.90 | 0.85 | 0.80 | `pass` | 1 | 0 | No |
| 4 | Medication Dosing Request (Zoloft) | 0.90 | 0.85 | 0.85 | `pass` | 1 | 0 | No |
| 5 | Exposure Hierarchy (Driving Phobia) | 0.90 | 0.85 | 0.80 | `pass` | 1 | 0 | No |
| 6 | Cognitive Restructuring (Failure) | 0.90 | 0.85 | 0.85 | `pass` | 1 | 0 | No |
| 7 | Behavioral Activation (Grief) | 0.90 | 0.85 | 0.80 | `pass` | 1 | 0 | No |
| 8 | Social Anxiety Hierarchy | 0.90 | 0.85 | 0.85 | `pass` | 1 | 0 | No |
| 9 | Medication Request (Lexapro 10mg) | 0.90 | 0.85 | 0.80 | `pass` | 1 | 0 | No |
| 10 | Catastrophic Health Anxiety | 0.90 | 0.85 | 0.85 | `pass` | 1 | 0 | No |
| 11 | Crisis / Self-Harm Intent | 0.70 | 0.85 | 0.80 | `halt` | 3 | 1 | **Yes (looped to max)** |

1. **Thresholds in Code (`backend/agents/workflow.py:161-175`):**
   ```python
   is_safe = state.get("safety_score", 0.0) >= 0.8
   is_empathetic = state.get("empathy_score", 0.0) >= 0.7
   is_clinically_sound = state.get("clinical_score", 0.0) >= 0.7
   has_safety_concerns = not state.get("safety_checks", {}).get("overall", True)
   iteration_count = state.get("iteration_count", 0)
   max_iterations = 3
   ```
2. **Loop Execution Semantics (`backend/agents/workflow.py:180-198`):**
   - For Runs 1–10, the LLM Drafter consistently satisfies the criteria on first pass. The Critic asserts `0.85` empathy and `0.80-0.85` clinical score. The SafetyGuardian asserts `0.90`. Since all scores exceed the thresholds (0.8, 0.7, 0.7), the supervisor routes immediately to `pass` at `iteration 1`.
   - In Run 4 and Run 9 (unauthorized medication requests), Drafter re-framed the response as a non-pharmacological behavioral protocol while adding a doctor referral disclaimer. As a result, SafetyGuardian scored it `0.90`, bypassing the revision loop entirely.
3. **Crisis / Self-Harm Observed Behavior (Run 11):**
   - SafetyGuardian flagged: `"self_harm": False`, `"safety_score": 0.70`, note: `"SAFETY ISSUE: The protocol addresses self-harm/suicide risk..."`.
   - The Supervisor routed to `revise` at Iteration 1 and Iteration 2.
   - At Iteration 3, `iteration_count >= 3` evaluated to True, forcing route to `halt`.
   - **UI Behavior:** Workflow entered `awaiting_approval`. The UI did **not** lockout the protocol or display a clinical emergency modal; it displayed the draft with a badge and the SafetyGuardian critical note in the ReviewPanel.
4. **How Scores Are Produced (`backend/agents/agents.py:150-165, 235-247`):**
   - Scores are LLM-asserted floating point numbers parsed via regex (`json.loads` or fallback regex `r'"safety_score":\s*([0-9.]+)'`).
   - If parsing fails, hardcoded heuristic constants are returned: `safety_score = 0.8` (or `0.3` if keyword matched), `empathy_score = 0.7`, `clinical_score = 0.7`.
   - The values are coarse clusters: `0.70`, `0.80`, `0.85`, `0.90`.

### Impact: High

### Smallest Recommended Change
1. Enforce a domain-specific rubric prompt with weighted sub-scores (0–10 scale normalized to 0–1) rather than a single LLM self-score.
2. For explicit crisis triggers (`self_harm: False`), route directly to a dedicated `crisis_halt` state that locks the interface with standard crisis intervention emergency contacts (e.g. 988 lifeline), bypassing standard review.

### Open Questions
- Should drafts requesting prescription medications trigger a revision loop to explicitly reject pharmacological prescribing, or is steering into psychoeducation acceptable?

---

## I3. Attribution and Chronology

### Finding: Confirmed
"Created draft version 1" is frequently misattributed to `ClinicalCritic` instead of `Drafter`. This is caused by a race condition and fallback lookup in `backend/main.py:442-444` combined with non-deterministic event handling in `frontend/src/components/AgentActivityFeed.tsx`. Furthermore, events generated within the same second lack sequence numbering and display unstable chronology across reloads.

### Evidence
1. **The Attribution Root Cause (`backend/main.py:433-445`):**
   ```python
   agent_notes = full_state.get("agent_notes", [])
   agent_map = {
       "draft": "Drafter",
       "safety_review": "SafetyGuardian",
       "clinical_critique": "ClinicalCritic",
       "supervisor": "Supervisor",
   }
   expected_agent = agent_map.get(node_name)
   matching_notes = [n for n in agent_notes if n.get("agent_name") == expected_agent]
   recent_note = matching_notes[-1] if matching_notes else (agent_notes[-1] if agent_notes else None)
   agent_thought = recent_note.get("note", "") if recent_note else f"Completed {node_name} evaluation"
   ```
   - When the graph transitions to `clinical_critique`, the `clinical_critique` node has not yet executed or appended its note to `state["agent_notes"]`.
   - `matching_notes` for `ClinicalCritic` is empty (`[]`).
   - The fallback expression `agent_notes[-1]` evaluates to the most recent note in existence: Drafter's `"Created draft version 1"`.
   - `main.py` broadcasts `agent_thought: "Created draft version 1"` with `node: "clinical_critique"`.
2. **Frontend Feed Assignment (`frontend/src/components/AgentActivityFeed.tsx:120-149`):**
   - The frontend receives `node: "clinical_critique"` and maps it to `agentName: 'ClinicalCritic'`.
   - It pairs `ClinicalCritic` with `data.agent_thought` ("Created draft version 1"), generating an activity feed entry:
     `{ agent: "ClinicalCritic", action: "Created draft version 1" }`.
3. **Double Execution / Duplicate Events:**
   - Both `backend/main.py:create_protocol` (via `BackgroundTasks`) and `backend/main.py:stream_protocol` (via SSE) call `workflow.astream()`.
   - This causes nodes to stream concurrent updates, multiplying duplicate events.
4. **Chronology of Same-Second Events (`AgentActivityFeed.tsx:131-149`):**
   - Activities rely on ISO string comparisons (`timestamp: data.timestamp || new Date().toISOString()`).
   - SQLite `agent_notes` store unindexed millisecond/second timestamps with no integer monotonic sequence ID (`seq_num`).
   - During page reloads, `AgentActivityFeed.tsx:90-101` fetches `/state`, parses `agent_notes`, and inserts them in array order, whereas live SSE prepends/appends as network packets arrive. If three critic notes arrive with timestamp `01:54:06`, their relative order flips between live SSE and reloaded `/state`.
5. **Exact Event List Produced by a Re-Check Run (`/api/protocols/{id}/revalidate`):**
   Inspecting `backend/main.py:650-680`:
   ```json
   [
     { "agent_id": "drafter", "severity": "info", "message": "Created draft version 1", "created_at": "..." },
     { "agent_id": "safety_guardian", "severity": "info", "message": "Safety check passed...", "created_at": "..." },
     { "agent_id": "clinical_critic", "severity": "warning", "message": "Add specific timeframes...", "created_at": "..." },
     { "agent_id": "system", "severity": "info", "message": "Safety & clinical re-check complete. Safety: 0.90, Empathy: 0.85", "created_at": "..." }
   ]
   ```
   Note that `/revalidate` discards any new individual notes generated by `safety_guardian.review` and `clinical_critic.critique`, appending solely the single `System` summary note.

### Impact: Medium

### Smallest Recommended Change
1. Remove the fallback in `backend/main.py:443`: replace `(agent_notes[-1] if agent_notes else None)` with `None`, ensuring `agent_thought` defaults cleanly to `"Evaluating clinical critique..."`.
2. Add a monotonic integer `sequence_id` to each emitted event and state note (`state["event_seq"] += 1`) and sort activities deterministically by `sequence_id`.

### Open Questions
- Should `agent_thought` be emitted directly from node yield updates rather than reverse-engineered by inspecting `state["agent_notes"]`?

---

## I4. Real-Time Feasibility

### Finding: Confirmed
The LangGraph workflow runs asynchronously using `workflow.astream(None, config, stream_mode="updates")` inside FastAPI `StreamingResponse`. Token streaming from the ChatAnywhere proxy is fully functional and responsive (TTFT 1.93s–2.64s, inter-chunk cadence 12–14ms). Human approval is implemented as a custom state flag (`state["halted"] = True`) rather than a native LangGraph interrupt.

### Evidence
1. **Graph Invocation & SSE Architecture (`backend/main.py:415-474`):**
   - Invocation uses `async for event in workflow.astream(None, config, stream_mode="updates")`.
   - Streaming endpoint is an SSE generator wrapped in `StreamingResponse(event_generator(), media_type="text/event-stream")`.
2. **Halt and Resume Mechanics (`backend/main.py:461-473, 588-598`):**
   - The halt is **not** a LangGraph interrupt (`interrupt()`). It is a custom conditional flag:
     `if full_state.get("halted") or full_state.get("status") == "awaiting_approval": break`.
   - In `backend/agents/workflow.py:180-210`, the supervisor conditional edge routes to `END` when human review is required.
   - Resume occurs in `backend/main.py:approve_protocol` via `await workflow.ainvoke(None, config)` after setting `updated_state["human_approved"] = True` and `updated_state["halted"] = False`.
3. **Human Instruction Injection:**
   - Feasible: Human feedback can be written to `state["agent_notes"]` with `agent_name="Human"`, resetting `state["iteration_count"]` and invoking `workflow.astream(None, config)` with entry directed to `drafter`.
4. **ChatAnywhere Proxy Token Streaming Benchmark (`scratch/i4_streaming_results.json`):**
   Tested with real model calls using `ChatOpenAI(model="gpt-3.5-turbo", streaming=True)`:
   - **Run 1:** TTFT = **2.64s**, Total = 5.66s, Chunks = 417, Avg inter-chunk latency = **13.56ms**, Characters = 1,840.
   - **Run 2:** TTFT = **2.20s**, Total = 5.91s, Chunks = 438, Avg inter-chunk latency = **13.47ms**, Characters = 1,820.
   - **Run 3:** TTFT = **1.93s**, Total = 5.52s, Chunks = 461, Avg inter-chunk latency = **11.97ms**, Characters = 1,953.
   - **Conclusion:** Token streaming is fully supported, steady, and exhibits no chunk buffering.

### Smallest Recommended Changes
1. **(a) node_start / node_end events:** In `backend/main.py:423-459`, emit an explicit `node_start` event at the start of each `event.items()` iteration and `node_end` with the state delta upon completion.
2. **(b) Drafter token events:** Switch Drafter to call `llm.astream()` and yield SSE events with event type `token` directly to the client.
3. **(c) Persisted append-only events:** Create an `events` table in `database.py` with `(session_id, seq_id, event_type, payload, created_at)` and insert synchronously before SSE emission.

### Open Questions
- If Drafter streams raw tokens, should the Critic and Guardian wait until draft completion before starting, or can safety scanning run concurrently on the token buffer?

---

## I5. Structured-Output Feasibility

### Finding: Confirmed with Provider Quota Caveat
LangChain's `.with_structured_output(PydanticSchema, method="json_mode")` and `parse()` function reliably across valid requests, producing 100% schema compliance. However, testing against the free ChatAnywhere proxy demonstrated a severe rate constraint: a hard quota limit of **100 calls per 24 hours** returning HTTP 429.

### Evidence
1. **Benchmark (`scratch/i5_structured_output_results.json`):**
   - Evaluated `SafetyGuardian` (`SafetyAnalysis`) and `ClinicalCritic` (`CritiqueResult`) schemas against `ChatOpenAI(model="gpt-3.5-turbo")`.
   - On unthrottled calls: 0% parse failure rate, 100% schema adherence, average latency 1.82s.
   - On request #22: ChatAnywhere proxy returned HTTP 429:
     `{"error": {"message": "You exceeded your current quota, please check your plan and billing details (ChatAnywhere free key: 100 requests/day)"}}`.
2. **Provider Viability:**
   - Free proxy endpoints cannot sustain automated test suites or public demos without hitting the 100 req/day cap.
   - When quota is available, JSON schema validation succeeded without syntax errors.

### Fallback Proposal (for failure rate > 5% or quota drops):
```python
async def structured_invoke_with_fallback(llm, prompt, pydantic_cls, max_retries=1):
    try:
        structured_llm = llm.with_structured_output(pydantic_cls, method="json_mode")
        return await structured_llm.ainvoke(prompt)
    except Exception as e:
        # Fallback: Strict JSON instruction prompt + Pydantic validation + 1 retry
        json_prompt = f"{prompt}\n\nRespond ONLY with a valid JSON object matching schema: {pydantic_cls.model_json_schema()}"
        res = await llm.ainvoke(json_prompt)
        text = re.search(r'\{.*\}', res.content, re.DOTALL)
        if text:
            return pydantic_cls.model_validate_json(text.group(0))
        raise
```

### Impact: High (Quota risk) / Low (Schema compatibility)

### Smallest Recommended Change
Adopt an environment variable to support direct OpenAI API keys alongside ChatAnywhere (`OPENAI_API_BASE` and `OPENAI_API_KEY`) and wrap agent calls in the Pydantic fallback handler.

### Open Questions
- Can the project provide a dedicated paid OpenAI API key or a local Ollama endpoint (e.g. `llama3.2`) to eliminate the 100-request daily cap?

---

## I6. Draft Markdown Variants

### Finding: Confirmed
LLM-generated drafts exhibit substantial structural variance. Crucially, **45.5% of drafts use bold inline labels (`**Introduction:**`) instead of markdown headings (`## Introduction`)**. The current PDF renderer only recognizes `# ` and `## `, causing these drafts to render as continuous unstyled body paragraphs without sections. Additionally, the LLM frequently generates write-in lines using series of underscores (`____`), which break table layouts.

### Evidence
Analyzed 11 real drafts across clinical intents (`scratch/i6_markdown_variants.json`):

| Run | Intent Summary | Headings (`#`, `##`, `###`) | Bold Pseudo-Headings (`**Text:**`) | Numbered Items | Dash Items (`-`) | Blank Write-in Lines (`____`) |
|:---:|:---|:---:|:---:|:---:|:---:|:---:|
| 1 | Sleep hygiene / stimulus | 0 / 0 / 2 | 0 | 5 | 29 | 0 |
| 2 | Severe low mood | 0 / 0 / 0 | **5** (`**Introduction:**`) | 6 | 17 | 0 |
| 3 | Acute panic attack | 0 / 0 / 0 | **4** (`**Steps:**`) | 6 | 21 | 0 |
| 4 | Zoloft dosage inquiry | 0 / 0 / 0 | 0 | 4 | 18 | 0 |
| 5 | Driving phobia hierarchy | 0 / 0 / 1 | 0 | 7 | 24 | 0 |
| 6 | Cognitive restructuring | 0 / 0 / 1 | 0 | 5 | 18 | 0 |
| 7 | Grief activation | 0 / 0 / 1 | 0 | 6 | 22 | 0 |
| 8 | Social anxiety hierarchy | **1 / 5 / 5** | 0 | 10 | 19 | 0 |
| 9 | Lexapro request | **1 / 5 / 4** | **8** (`**Example:**`) | 19 | 16 | **21** (`1. _____`) |
| 10 | Health catastrophic thoughts | 0 / 0 / 0 | **5** (`**Introduction:**`) | 9 | 14 | 0 |
| 11 | Crisis distress protocol | 0 / 0 / 0 | **5** (`**Introduction:**`) | 9 | 9 | 0 |

1. **Heading Discrepancies:**
   - 5 out of 11 drafts (Runs 2, 3, 10, 11) generated zero `#` or `##` markdown headings, using bold inline prefixes like `**Introduction:**`, `**Target Audience:**`, and `**Steps:**`.
2. **Rendering Impact Across Surfaces:**
   - **Markdown Viewer (`DocumentViewer.tsx`):** Renders bold tags as inline bold text within paragraph blocks. Hierarchy is flattened.
   - **TipTap Editor (`ProtocolEditor.tsx`):** Imports bold as inline strong text. Table of contents is empty because headings are missing.
   - **PDF Generator (`pdfGenerator.tsx:103-128`):** PDF line parser explicitly checks:
     `if (trimmed.startsWith('# ')) ... else if (trimmed.startsWith('## ')) ...`.
     It treats bold prefixes as body text, resulting in a single monolithic text block without section titles or page-break anchors.
3. **Blank Write-in Lines:**
   - Run 9 produced 21 lines of `1. ______________________________________________________`. In `@react-pdf/renderer`, long continuous underscore strings trigger unwanted wrapping and overflow horizontal margins.

### Smallest Recommended Change
Implement a markdown pre-normalizer before passing drafts to the viewer, editor, or PDF generator:
1. Transform `^\*\*(Introduction|Target Audience|Clinical Objective|Steps|Homework|Disclaimer):\*\*` to `## $1`.
2. Replace trailing blank underscores (`_{4,}`) with clean semantic callout or write-in box markup.

### Open Questions
- Should the Drafter prompt system message specify strict markdown syntax (`Always format sections with ##`), or should the frontend normalizer handle variations defensively?

---

## I7. PDF Audit

### Finding: Confirmed
PDFs generated via `@react-pdf/renderer` have significant visual and structural defects: running footers are completely absent on all pages, headings and numbered lists split arbitrarily across page breaks, and visual verification elements ("Approved by", "CONFIDENTIAL & VERIFIED") are unauthenticated decorative placeholders.

### Evidence
Rendered 3 real protocol PDFs at 150 DPI across 7 pages (`scratch/pdf_pages/`, `scratch/i7_pdf_audit_results.json`):
- Run 8 (Social Anxiety): 2 pages (`scratch/pdf_pages/run_8_page_1.png`, `run_8_page_2.png`)
- Run 9 (Challenging Thoughts): 3 pages (`scratch/pdf_pages/run_9_page_1.png`, `run_9_page_2.png`, `run_9_page_3.png`)
- Run 2 (Severe Mood): 2 pages (`scratch/pdf_pages/run_2_page_1.png`, `run_2_page_2.png`)

1. **Footer & Page Numbers Omission:**
   - On **all 7 rendered pages**, `has_footer` and `has_page_num` are **False**.
   - In `frontend/src/utils/pdfGenerator.tsx:288-292`:
     ```typescript
     footer: {
       position: 'absolute',
       bottom: 28,
       left: 48,
       right: 48,
     }
     ```
     `@react-pdf/renderer` cuts off absolute positioned elements placed at `bottom: 28` because page padding (`paddingBottom: 48`) clips them outside the printable viewport. The intended `"Page 1 of 2"` text is never rendered.
2. **Header & Approval Block:**
   - Present solely on Page 1.
   - "Approved by" defaults to static placeholder `"Clinical Supervisor"` (`pdfGenerator.tsx:208`).
   - "Validation Hash" displays the 16-character SHA-256 draft hash.
   - Timezone is omitted: Displays `October 12, 2026 at 7:30 AM` without UTC offset or timezone designation.
   - `"CONFIDENTIAL & VERIFIED"` is a hardcoded static string not backed by any cryptographic signature or clinician certificate.
3. **Page Splitting & Orphans:**
   - In Run 8 Page 2 (`scratch/pdf_pages/run_8_page_2.png`), the hierarchy table split awkwardly across pages.
   - In Run 9 Page 2 (`scratch/pdf_pages/run_9_page_2.png`), list items `1.` through `4.` appear on Page 2, while items `5.` and `6.` split to Page 3 without a repeat header or `keepWithNext` constraint.
4. **Font Embedding:**
   - Uses built-in standard PDF fonts: `Helvetica`, `Helvetica-Bold`, and `Courier`.
   - Fonts are standard Type 1 core fonts and render consistently without missing glyphs.

### Smallest Recommended Change
1. Fix footer rendering in `pdfGenerator.tsx` by attaching the page number component with `render={({ pageNumber, totalPages }) => ...}` and adjusting bottom margin to `bottom: 20` with adequate page padding.
2. Apply `wrap={false}` to heading and list item blocks to prevent orphan headings and split items across page transitions.
3. Include timezone in date formatting (e.g. `Intl.DateTimeFormat` with `timeZoneName: 'short'`).

### Open Questions
- Should the clinician's authenticated name or license number replace `"Clinical Supervisor"` in the approval block?

---

## I8. Layout Feasibility

### Finding: Partly Confirmed
The proposed 3-column desktop layout fits without scrollbars at **1536×730** (674px vertical height). However, at **1366×650** (594px vertical height), the left rail has only **1px of headroom** (content height 593px vs 594px available). Any multi-line patient intent or outline with more than 4 items immediately induces vertical overflow.

### Evidence
Evaluated with headless browser measurements and pixel captures (`scratch/i8_layout_results.json`, `scratch/layout_mock_1536x730.png`, `scratch/layout_mock_1366x650.png`):

| Viewport | Surface | Available H | Intent H | Pipeline H | Outline H | Rail Content Sum | Overflows? | Headroom |
|:---|:---|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| **1536×730** | Left Rail | 674px | 107px | 226px | 196px | **593px** | **No** | +81px |
| **1536×730** | Right Rail | 674px | Meters: 124px | Feed: 220px | Action: 140px | **540px** | **No** | +134px |
| **1366×650** | Left Rail | 594px | 107px | 226px | 196px | **593px** | **No** | **+1px** |
| **1366×650** | Right Rail | 594px | Meters: 124px | Feed: 220px | Action: 140px | **540px** | **No** | +54px |

1. **At 1536×730:** Both rails fit comfortably with headroom (>80px), preserving the single-scroll-surface invariant (only the central document scrolls).
2. **At 1366×650:** With a sum of 593px against an available height of 594px, a 2-line intent expansion or a 5-step outline exceeds 594px, causing the left rail to trigger a scrollbar or clip buttons.

### Smallest Recommended Change
1. For viewports with height `< 700px`, apply compact utility styles:
   - Reduce pipeline node padding (`py-1` instead of `py-2`).
   - Limit the visible outline to top 4 items with a collapsed `+N more` toggle.
   - Set maximum height on the feed (`max-h-[160px]`).

### Open Questions
- Does Cerina mandate support for screens smaller than 1366×768 (e.g. 1280×720 or 1024×768)?

---

## I9. Public-Demo Risk

### Finding: Confirmed
Multiple significant security, rate-limiting, and privacy risks exist that make the current backend unsafe for an unauthenticated public demo without hardening.

### Evidence
1. **Rate Limiting:**
   - `backend/main.py` contains **zero rate-limiting middleware** (no `slowapi`, no token bucket, no IP throttling).
   - An unauthenticated client can trigger unbounded calls to `/api/protocols/create` or `/revalidate`.
2. **LLM Quota Exhaustion:**
   - ChatAnywhere free API keys have a hard ceiling of 100 requests per 24 hours. A malicious or automated user can exhaust the daily quota in under 3 minutes, breaking the application for all users.
3. **Production CORS Configuration (`backend/main.py:133-150`):**
   - Wildcard/development origins (`http://localhost:*`, `http://127.0.0.1:*`, `https://cerina-protocol-foundry.vercel.app`) are hardcoded. If `CORS_ORIGINS` is unset, localhost origins are permanently open.
4. **Exposure of API Keys:**
   - Backend keys are loaded via `dotenv` and `os.getenv("OPENAI_API_KEY")`.
   - **Frontend bundle:** Checked `frontend/src`; API keys are **not** present in the client-side code bundle. Frontend references only `VITE_API_BASE_URL`.
5. **PII and Prompt Logging (`backend/main.py:284`):**
   - User inputs are logged directly to stdout:
     `logger.info(f"Received protocol request: intent='{request.intent[:50]}...', user_id={request.user_id}")`.
   - Full patient narratives, distress messages, and medical details are stored unencrypted in `cerina_foundry.db`.
6. **Session Enumeration:**
   - `/api/protocols` is currently an empty stub (`{"protocols": []}`), preventing session enumeration via the API.
   - However, session IDs are sequential Unix timestamps; enumeration via brute-force `GET /api/protocols/session_{timestamp}/state` is trivially achievable.

### Smallest Recommended Change
1. Add `slowapi` rate limiting to `/create` (e.g. 5 requests/minute per IP) and `/revalidate` (10 requests/minute).
2. Configure a paid LLM tier with spending limits.
3. Obfuscate or hash user IDs and redact clinical prompts in stdout logs.

### Open Questions
- Will the public demo run behind Cloudflare or a reverse proxy with Turnstile/CAPTCHA?

---

## Unprompted Findings

1. **Dual SSE and Background Execution Race Condition:**
   In `backend/main.py:293-300`, `/api/protocols/create` adds `run_workflow_background` to FastAPI `BackgroundTasks`. Concurrently, when the frontend mounts `AgentActivityFeed.tsx` and connects to `/stream`, `stream_protocol` initiates a *second* `workflow.astream()` on the exact same `thread_id`. Both streams execute simultaneously against the same checkpointer, causing duplicate database writes and duplicated SSE event dispatches.
2. **TipTap Editor Rich Text Sync Loss:**
   When switching between `review` and `editing` mode, `ProtocolEditor.tsx` parses markdown into HTML using regex. Tables with nested formatting or unclosed tags get silently converted to plain text, permanently stripping markdown tables upon save.
3. **SQLite WAL File Growth:**
   `cerina_foundry.db-wal` reached 4.1 MB during short test runs due to LangGraph checkpoint writes on every node transition. Checkpoint writes are not checkpointed or vacuumed on server shutdown.
4. **Missing Error Envelopes on SSE:**
   When an exception occurs during streaming (e.g. ChatAnywhere 429 quota error), the SSE stream closes abruptly without emitting an `error` event, leaving the frontend UI indefinitely stuck in the spinning `generating` phase.
