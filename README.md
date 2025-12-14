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
├── backend/           # Python backend with LangGraph agents
├── frontend/          # React TypeScript dashboard
├── mcp_server/        # MCP protocol server
└── docs/              # Architecture diagrams and documentation
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

