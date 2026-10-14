Ran command: `git log --oneline -n 30`
Searched for "/state"
Searched for "/stream"
Viewed ARCHITECTURE_DIAGRAM.txt:1-60
Viewed ARCHITECTURE.md:1-100
Searched for "polling"
Viewed tech_info.md:595-645
Ran command: `git log -p -S "setInterval" frontend/`
Ran command: `git log --oneline frontend/src/components/AgentActivityFeed.tsx`
Searched for "setInterval"
Viewed AgentActivityFeed.tsx:40-140
Viewed ProtocolViewer.tsx:140-250
Viewed main.py:250-320
Viewed main.py:380-480
Ran command: `git log -p -S "poll" -- backend/ main.py frontend/`
Ran command: `git show --stat e343fe4`
Ran command: `git diff 6a91685..e343fe4 frontend/src/components/AgentActivityFeed.tsx`
Ran command: `git show 6a91685:frontend/src/components/AgentActivityFeed.tsx`
Ran command: `git show 6a91685:frontend/src/components/AgentActivityFeed.tsx | Select -First 100`
Ran command: `git show 6a91685:frontend/src/components/AgentActivityFeed.tsx | Select-Object -Skip 100 -First 70`
Ran command: `git log -p -S "fetchState" frontend/src/components/ProtocolViewer.tsx`
Searched for "current workflow state"
Searched for "live SSE events"
Ran command: `git log --reverse --format="%h %ad %s" --date=short`
Ran command: `git show --stat be670f6`
Ran command: `git diff be670f6~1..be670f6 frontend/src/components/ProtocolViewer.tsx`
Ran command: `git diff e343fe4~1..e343fe4 frontend/src/components/ProtocolViewer.tsx`
Viewed App.tsx:220-260

### 1. Why Did You Add Polling and How Is It Designed & Working Now?

#### Why Polling Was Added
When you built the system in the initial commit (`6a91685`), you used **Server-Sent Events (SSE)** via `/stream` to broadcast live execution events as LangGraph agents ran. However, SSE alone was not sufficient for a Human-in-the-Loop (HITL) multi-agent system. You added a **2-second polling loop** on `/state` in [AgentActivityFeed.tsx](file:///d:/Projects/Cerina-Protocol-Foundary/frontend/src/components/AgentActivityFeed.tsx) for four concrete reasons:

1. **Catching Asynchronous Out-of-Band State Mutations (Human & System Notes):**
   * While agents execute, LangGraph streams node progress over SSE. But when the workflow halts for Human-in-the-Loop review (`status: "awaiting_approval"` or `halted: true`), **the LangGraph execution loop stops ticking and the SSE stream goes idle**.
   * When a human reviews the draft and clicks **Approve** (or edits and approves), or triggers a manual halt, the frontend sends a REST `POST /api/protocols/{id}/approve` request. 
   * This REST endpoint writes an audit note into the LangGraph checkpoint state (`agent_notes: [{ agent_name: "Human", note: "Protocol approved and finalized" }]`). 
   * Because that write happened via a REST POST request outside the active agent execution generator, **the SSE stream did not emit a fresh node event**.
   * Your code in `AgentActivityFeed.tsx` explicitly included this inline comment:
     ```typescript
     // Set up polling to check for new notes periodically (especially after approval)
     const pollInterval = setInterval(() => {
       fetchCurrentState()
     }, 2000) // Poll every 2 seconds
     ```
2. **Resilience Against Dropped SSE Connections (Network Fail-Safe):**
   * SSE is a persistent, unidirectional HTTP connection. Across remote deployments (EC2, Railway, reverse proxies, corporate VPNs), long-lived SSE connections frequently time out, buffer chunks, or silently disconnect.
   * Polling `/state` serves as a reconciliation heartbeat: even if the SSE stream stalls or drops, the activity feed reconciles with the database checkpoint.
3. **Session Rehydration on Page Load & Tab Refresh:**
   * SSE only pushes events that occur *while the connection is open*. If a clinician refreshes the page or reopens an existing session, an SSE stream alone won't retroactively emit historical agent notes. Polling `/state` immediately backfills past agent notes into the feed.
4. **Machine-to-Machine / MCP Integration Support:**
   * MCP clients (e.g. Claude Desktop via `mcp_server/server.py`) cannot consume SSE streams. They rely exclusively on polling `GET /api/protocols/{session_id}/state` to monitor progress.

---

#### How Polling Is Designed and Working Now

In the latest commit ([AgentActivityFeed.tsx](file:///d:/Projects/Cerina-Protocol-Foundary/frontend/src/components/AgentActivityFeed.tsx#L49-L97)):

```
[AgentActivityFeed Mounts]
        │
        ├──> Immediate call: fetchCurrentState() (GET /api/protocols/{sessionId}/state)
        │
        ├──> setInterval(() => fetchCurrentState(), 2000) ──> runs every 2s
        │
        └──> new EventSource(/api/protocols/{sessionId}/stream) ──> listens for live events
```

1. **Lifecycle Management:**
   * Inside `useEffect`, an immediate `fetchCurrentState()` call runs as soon as `sessionId` is present.
   * A timer `setInterval(fetchCurrentState, 2000)` runs in the background.
   * On unmount or session change, `clearInterval(pollInterval)` tears down the timer to prevent memory leaks.
2. **State Processing & Deduplication:**
   * `fetchCurrentState()` calls `GET ${API_BASE_URL}/api/protocols/${sessionId}/state`.
   * It extracts `state.agent_notes` (an array of notes from Drafter, Safety Guardian, Clinical Critic, Supervisor, Human, System).
   * It passes notes to `addNotesToActivities(agentNotes)`. To prevent UI flickering, it deduplicates entries against existing actions before appending new items.
3. **Halt Detection Fallback:**
   * If `state.halted || state.status === 'awaiting_approval'`, it checks if a pause banner has been recorded. If not, it injects a warning priority activity: `"Workflow paused for your review"`.

---

### 2. Working Mechanism & Implementation of `/state` Polling vs `/stream` SSE

```
/state polling                             /stream
      │                                       │
      │ HTTP GET                              │ Persistent EventSource (SSE)
      ▼                                       ▼
current workflow state                   live SSE events
(Canonical SQLite Checkpoint)            (LangGraph Execution Graph)
```

#### A. `/state` Polling: The Current Workflow State

* **Backend Implementation:** [`@app.get("/api/protocols/{session_id}/state")`](file:///d:/Projects/Cerina-Protocol-Foundary/backend/main.py#L450-L470)
  ```python
  workflow = create_workflow()
  config = {"configurable": {"thread_id": session_id}}
  state = await workflow.aget_state(config)
  ```
* **Working Mechanism:**
  1. It queries LangGraph's persistent **SQLite Checkpointer** (`SqliteSaver`) using the `thread_id` (the session ID).
  2. It does **not** execute any agents or trigger graph transitions. It reads the current snapshot of the shared Blackboard state (`current_draft`, `draft_history`, `agent_notes`, `safety_score`, `empathy_score`, `clinical_score`, `status`, `iteration_count`).
  3. It returns a serialized JSON snapshot.
* **Who Uses It:**
  * **[AgentActivityFeed.tsx](file:///d:/Projects/Cerina-Protocol-Foundary/frontend/src/components/AgentActivityFeed.tsx):** Polls every 2 seconds to pick up human approvals and background system notes.
  * **[ProtocolViewer.tsx](file:///d:/Projects/Cerina-Protocol-Foundary/frontend/src/components/ProtocolViewer.tsx):** Fetches state on initial mount, immediately after clicking Approve, and after clicking Halt.
  * **[App.tsx](file:///d:/Projects/Cerina-Protocol-Foundary/frontend/src/App.tsx):** Uses `/state` on app load to restore the saved active session from `localStorage`.
  * **[mcp_server/server.py](file:///d:/Projects/Cerina-Protocol-Foundary/mcp_server/server.py):** MCP tool `get_protocol_status` calls `/state` to report draft progress to Claude Desktop.

---

#### B. `/stream`: Live SSE Events

* **Backend Implementation:** [`@app.get("/api/protocols/{session_id}/stream")`](file:///d:/Projects/Cerina-Protocol-Foundary/backend/main.py#L261-L448)
  ```python
  # Async generator iterating LangGraph's execution stream
  async for event in workflow.astream(initial_state, config, stream_mode="values"):
      yield await format_sse({
          "event": "state_update",
          "data": json.dumps({"node": node_name, "state": serialized_state, ...})
      })
  ```
* **Working Mechanism:**
  1. The browser initiates a persistent HTTP GET connection with header `Accept: text/event-stream`.
  2. FastAPI returns a `StreamingResponse` with media type `text/event-stream`.
  3. The backend drives graph execution using `workflow.astream(...)`. As each agent node runs (`draft` ➔ `safety_review` ➔ `clinical_critique` ➔ `supervisor`), the generator yields SSE frames formatted as:
     ```http
     event: state_update
     data: {"node": "safety_review", "state": {...}, "agent_thought": "...", "timestamp": "..."}
     ```
  4. Specific workflow control events are emitted:
     * `state_update`: Sent when each node completes.
     * `halted`: Emitted when the supervisor determines quality thresholds are met or manual halt is triggered, signaling the browser to show the approval UI.
     * `complete`: Emitted when all iterations finish and the workflow terminates.
* **Who Uses It:**
  * **[ProtocolViewer.tsx](file:///d:/Projects/Cerina-Protocol-Foundary/frontend/src/components/ProtocolViewer.tsx):** Listens to `state_update` and `halted` to update scores and stream in draft iterations live.
  * **[AgentActivityFeed.tsx](file:///d:/Projects/Cerina-Protocol-Foundary/frontend/src/components/AgentActivityFeed.tsx):** Listens to `state_update` to display real-time timeline dots and agent rationale as agents think.

---

### 3. Chronological Evolution: From Development Till the Latest Commit

| Commit | Date | Changes to `/state` Polling & `/stream` Architecture |
| :--- | :--- | :--- |
| **`6a91685`**<br>*(Initial commit)* | **2025-12-15** | • **Dual-channel architecture created**:<br>&nbsp;&nbsp;- FastAPI added `StreamingResponse` for SSE `/stream` wrapping `workflow.astream`.<br>&nbsp;&nbsp;- `/state` added to inspect SQLite checkpointer via `workflow.aget_state`.<br>• `AgentActivityFeed.tsx` introduced dual consumption: `EventSource(/stream)` + `setInterval(fetchCurrentState, 2000)` polling specifically to detect Human review notes after `/approve`.<br>• `ProtocolViewer.tsx` used `fetchState()` on mount and after approval, reconnecting `/stream` after a 500ms delay. |
| **`b47ca41` ➔ `d4774e8`**<br>*(Architecture & Docs)* | **Dec 2025 – Jan 2026** | • Documented the dual-channel design in [docs/ARCHITECTURE.md](file:///d:/Projects/Cerina-Protocol-Foundary/docs/ARCHITECTURE.md) and [ARCHITECTURE_DIAGRAM.txt](file:///d:/Projects/Cerina-Protocol-Foundary/ARCHITECTURE_DIAGRAM.txt).<br>• Highlighted that the React Dashboard uses HTTP REST (`/state`, `/approve`, `/halt`) + SSE (`/stream`), whereas the MCP Client operates strictly via REST (`/state`, `/approve`). |
| **`be670f6`**<br>*(Frontend Stabilization)* | **2026-02-03** | • **Protected draft editing from stream overwrites**: In `ProtocolViewer.tsx`, streaming updates could clash with manual edits in the textarea. Polling and SSE updates were guarded with `isEditingRef` so background updates do not overwrite a clinician's active typing.<br>• Added PDF export relying directly on the latest stable snapshot. |
| **`f9cf309`**<br>*(EC2 & CORS Fix)* | **2026-02-04** | • Migrated relative frontend URLs (`/api/...`) to absolute base URLs (`${API_BASE_URL}/api/...`).<br>• Configured CORS on the FastAPI backend for SSE and polling to work reliably when deployed across AWS EC2 (`http://54.147.175.216:8000`). |
| **`e343fe4`**<br>*(Clinical UI Overhaul)* | **2026-09-17** | • **Refined polling synchronization**: Cleaned up `AgentActivityFeed` deduplication logic and timeline rendering.<br>• **Prevented race conditions on mount**: Added a 400ms debounce in `ProtocolViewer.tsx` (`fetchState().then(() => open EventSource)`).<br>• **Session persistence in `App.tsx`**: Added `localStorage` session recovery using `GET /state` on page reload. |
| **`cf21031`**<br>*(Latest Commit)* | **2026-09-18** | • Deployed backend to Railway while keeping the dual-channel model intact. |

### Summary Comparison

| Dimension | `/state` (Polling / Snapshot) | `/stream` (SSE Events) |
| :--- | :--- | :--- |
| **Protocol** | Standard HTTP GET (Request-Response) | Persistent HTTP connection (`text/event-stream`) |
| **Timing** | Polled every 2s in activity feed; on-demand on mount/actions | Pushed continuously by the backend during node execution |
| **Primary Purpose** | **Ground Truth & Consistency**: SQLite checkpoint state, Human approval notes, session rehydration, MCP client queries | **Live Interactivity**: Real-time agent thought stream, execution progress bars, immediate feedback |
| **Role during HITL pause** | **Active**: Continues polling to detect human action or state changes | **Idle**: Suspended because LangGraph has paused execution |