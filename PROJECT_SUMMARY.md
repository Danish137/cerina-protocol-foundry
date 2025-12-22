# Cerina Protocol Foundry - Project Summary

## Overview

A complete multi-agent system for autonomously designing, critiquing, and refining CBT (Cognitive Behavioral Therapy) exercises. Built with LangGraph, React, and MCP (Model Context Protocol).

## Key Features

✅ **Multi-Agent Architecture**: Supervisor-Worker pattern with 4 specialized agents
✅ **Deep State Management**: Blackboard pattern for agent collaboration
✅ **Persistence**: SQLite checkpointing for crash recovery
✅ **Human-in-the-Loop**: Interruptible workflow with approval mechanism
✅ **Real-time Visualization**: React dashboard with SSE streaming
✅ **MCP Integration**: Machine-to-machine API via Model Context Protocol
✅ **Autonomous Decision-Making**: Agents self-correct and iterate

## Architecture Highlights

### Agents

1. **Supervisor**: Orchestrates workflow, evaluates quality, routes tasks
2. **Drafter**: Creates and revises CBT exercise drafts
3. **Safety Guardian**: Validates safety, checks for self-harm/medical advice
4. **Clinical Critic**: Evaluates empathy, tone, and clinical appropriateness

### State Management

- Rich TypedDict state with versioned drafts
- Agent notes (blackboard) for inter-agent communication
- Quality metrics (safety, empathy, clinical scores)
- Iteration tracking and limits

### Workflow

1. User submits intent
2. Drafter creates initial draft
3. Safety Guardian reviews
4. Clinical Critic evaluates
5. Supervisor decides: approve, revise, or halt
6. Human reviews and approves
7. Protocol finalized

## Project Structure

```
.
├── backend/              # Python FastAPI backend
│   ├── agents/          # Multi-agent system
│   │   ├── agents.py    # Agent implementations
│   │   ├── state.py     # State management
│   │   └── workflow.py  # LangGraph workflow
│   ├── database.py      # Persistence layer
│   ├── main.py          # FastAPI server
│   └── models.py        # Pydantic models
├── frontend/            # React TypeScript dashboard
│   └── src/
│       ├── components/  # UI components
│       └── App.tsx      # Main app
├── mcp_server/          # MCP protocol server
│   └── server.py        # MCP tool definitions
└── docs/                # Documentation
```

## Technology Stack

- **Backend**: Python 3.10+, LangGraph, FastAPI, SQLAlchemy
- **Frontend**: React 18, TypeScript, Vite, TailwindCSS
- **MCP**: mcp-python SDK (works with any MCP client, not just Anthropic)
- **Database**: SQLite with LangGraph checkpointers
- **LLM**: Groq (free inference - Llama 3.1 70B, no payment required)

## Evaluation Criteria Met

✅ **Architectural Ambition**: Non-trivial Supervisor-Worker with autonomous routing
✅ **State Hygiene**: Rich blackboard pattern with agent notes and versioning
✅ **Persistence**: Full checkpointing with resume capability
✅ **MCP Integration**: Complete MCP server with 3 tools
✅ **AI Leverage**: Comprehensive system built with AI assistance

## Getting Started

See `QUICKSTART.md` for setup guide.







