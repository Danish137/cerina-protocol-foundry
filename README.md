# Cerina Protocol Foundry

An intelligent multi-agent system that autonomously designs, critiques, and refines CBT (Cognitive Behavioral Therapy) exercises.

## Architecture

The system uses a **Supervisor-Worker** pattern with specialized agents:

- **Supervisor Agent**: Orchestrates the workflow, routes tasks, and decides when drafts are ready
- **Drafter Agent**: Creates initial CBT exercise drafts based on user intent
- **Safety Guardian**: Validates content for self-harm risks and medical advice
- **Clinical Critic**: Evaluates tone, empathy, and clinical appropriateness

## Tech Stack

- **Backend**: Python + LangGraph + FastAPI
- **Frontend**: React + TypeScript
- **MCP**: Model Context Protocol server (works with any MCP client, not just Anthropic)
- **Database**: SQLite with LangGraph checkpointers
- **LLM**: Groq (free inference - no payment required)

## Project Structure

```
.
├── backend/                      # Python FastAPI backend
│   ├── agents/                   # Multi-agent system
│   │   ├── __init__.py
│   │   ├── agents.py             # Agent implementations (Drafter, SafetyGuardian, ClinicalCritic, Supervisor)
│   │   ├── state.py              # State management (ProtocolState, Blackboard pattern)
│   │   └── workflow.py           # LangGraph workflow orchestration
│   ├── __init__.py
│   ├── database.py               # Persistence layer (SQLite)
│   ├── main.py                   # FastAPI server with API endpoints
│   ├── models.py                 # Pydantic models for API requests/responses
│   ├── utils.py                  # Utility functions and helpers
│   ├── requirements.txt          # Python dependencies
│   ├── env.template              # Environment variables template
│   └── cerina_foundry.db         # SQLite database (checkpointer storage)
│
├── frontend/                     # React TypeScript dashboard
│   ├── src/
│   │   ├── components/           # React components
│   │   │   ├── AgentActivityFeed.tsx    # Real-time agent activity display
│   │   │   ├── ProtocolCreator.tsx      # Protocol creation form
│   │   │   └── ProtocolViewer.tsx       # Draft viewer with approval UI
│   │   ├── App.tsx               # Main application component
│   │   ├── main.tsx              # Application entry point
│   │   └── index.css             # Global styles
│   ├── index.html                # HTML template
│   ├── package.json              # Node.js dependencies
│   ├── package-lock.json          # Dependency lock file
│   ├── tsconfig.json             # TypeScript configuration
│   ├── tsconfig.node.json        # TypeScript config for Node
│   ├── vite.config.ts            # Vite build configuration
│   ├── tailwind.config.js        # TailwindCSS configuration
│   └── postcss.config.js         # PostCSS configuration
│
├── mcp_server/                   # MCP (Model Context Protocol) server
│   ├── __init__.py
│   ├── server.py                 # MCP server implementation with tool definitions
│   ├── requirements.txt          # Python dependencies for MCP server
│   ├── TEST_MCP.md               # MCP testing guide
│   └── TROUBLESHOOTING.md        # MCP troubleshooting documentation
│
├── docs/                         # Documentation
│   ├── ARCHITECTURE.md           # System architecture and design
│   ├── SETUP.md                  # Detailed setup instructions
│   ├── USAGE.md                  # Usage guide and examples
│   └── MCP_CLARIFICATION.md     # MCP integration details
│
├── README.md                     # Project overview and quick start
├── QUICKSTART.md                 # 5-minute setup guide
├── PROJECT_SUMMARY.md            # Comprehensive project summary
├── IMPLEMENTATION_NOTES.md       # Implementation details and notes
├── ARCHITECTURE_DIAGRAM.txt      # ASCII architecture diagram
└── .gitignore                    # Git ignore rules
```

## Setup

### Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

### MCP Server

```bash
cd mcp_server
python -m venv venv
source venv/bin/activate
pip install -r requirements.txt
python server.py
```

## Usage

1. Start the backend API server
2. Start the React frontend
3. Use the dashboard to create CBT exercises with human-in-the-loop approval
4. Or connect via MCP client (e.g., Claude Desktop) to trigger workflows remotely

