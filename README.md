# Cerina Protocol Foundry

An autonomous multi-agent clinical drafting system that designs, critiques, and refines evidence-based Cognitive Behavioral Therapy (CBT) protocols with deterministic safety gates, real-time streaming, and human-in-the-loop review.

---

## Architecture Overview

Cerina Protocol Foundry employs a **Supervisor-Worker Blackboard pattern** coordinated via LangGraph:

- **Protocol Drafter**: Synthesizes clinical intents into structured CBT protocols with 7 mandatory sections (Title, Introduction/Rationale, Measurable Goals, Step-by-Step Instructions, Guided Practice / Exposure, Reflection / Thought Record, Conclusion & Emergency Support).
- **Safety Guardian**: Evaluates contraindications, medication risks, and crisis hotline adherence using quote-grounded 1–5 rubrics.
- **Clinical Critic**: Evaluates therapeutic warmth, fidelity to CBT principles, structural clarity, and actionable exercises.
- **Supervisor Evaluator**: Enforces rubric thresholds, deterministic completeness checks, iteration caps, and failure-closed outage gates before routing to human approval.

### Zero Same-Family Rule
To maintain objective evaluation, the LLM router strictly forbids an AI model family from grading its own output:
- **Groq writer** (`openai/gpt-oss-120b`) -> Evaluated by **Google Gemini** or **Meta Llama**.
- **Gemini writer** (`gemini-3.1-flash-lite`) -> Evaluated by **Groq Qwen** or **Meta Llama**.

---

## Key Features

- **Observable SSE Streaming**: Real-time token streaming with automatic fallback to sequence-based polling.
- **Fail-Closed Outage Handling**: When evaluation services are unreachable, the system enters an unverified review mode, displaying explicit warning banners and blocking approval without clinician confirmation (HTTP 409 `recheck_required`).
- **Audit-Ready PDF Export**: Generates compliant, print-ready clinical PDFs with metadata, disclaimers, and optional audit appendices.
- **MCP Tool Integration**: Full Model Context Protocol server exposing `cerina_create_protocol`, `cerina_get_status`, and `cerina_approve_protocol` for external orchestrators.

---

## Project Structure

```
.
├── backend/                  # FastAPI + LangGraph asynchronous backend
│   ├── agents/               # Drafter, Safety Guardian, Clinical Critic, Supervisor
│   ├── tests/                # Test suite (85+ tests, canary suite, outage simulations)
│   ├── database.py           # SQLite persistence with WAL mode
│   ├── llm_router.py         # Multi-provider resilient router & rate limiter
│   └── main.py               # REST API & SSE streaming endpoints
├── frontend/                 # React 18 + TypeScript + Vite + TailwindCSS
│   ├── src/                  # DocumentViewer, ActionPanel, ScoreMeters, TimelineSheet
│   └── public/demo/          # Sample run replay for offline demonstration
├── mcp_server/               # Model Context Protocol server (stdio)
├── docs/                     # Technical architecture & benchmarks
│   ├── ARCHITECTURE.md       # Full blackboard & multi-agent system design
│   ├── BENCHMARKS.md         # Latency, provider limits & outage benchmark data
│   └── evidence/             # Verified run records, logs, and sample PDFs
└── scripts/                  # Operational scripts (benchmarking, audit, secret scanning)
```

---

## Quickstart

### Prerequisites
- Python 3.11+
- Node.js 18+
- API keys: `GROQ_API_KEY` and `GOOGLE_API_KEY` (optional: `OPENROUTER_API_KEY`)

### 1. Backend Setup
```bash
cd backend
python -m venv venv
# On Windows:
.\venv\Scripts\activate
# On Linux/macOS:
source venv/bin/activate

pip install -r requirements.txt
uvicorn main:app --host 0.0.0.0 --port 8000
```

### 2. Frontend Setup
```bash
cd frontend
npm install
npm run dev
# Open http://localhost:3000
```

---

## Testing & Verification

Run the comprehensive unit and live canary test suite:

```bash
# Unit test suite (mock LLM)
MOCK_LLM=true pytest backend/tests

# Outage simulation suite
pytest backend/tests/test_outage_simulation.py -s

# Banned wording compliance audit (zero violations across 5 surfaces)
python scripts/audit_banned_wording.py

# PDF evidence verification
python scripts/verify_pdf_evidence.py
```
