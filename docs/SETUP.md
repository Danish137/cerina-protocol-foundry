# Setup Guide

## Prerequisites

- Python 3.10+
- Node.js 18+
- npm or yarn
- OpenAI-compatible API key (`OPENAI_API_KEY` — see `backend/env.template`)

## Backend Setup

1. **Navigate to backend directory**:
   ```bash
   cd backend
   ```

2. **Create virtual environment**:
   ```bash
   python -m venv venv
   ```

3. **Activate virtual environment**:
   - Windows: `venv\Scripts\activate`
   - macOS/Linux: `source venv/bin/activate`

4. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

5. **Set up environment variables**:
   ```bash
   cp env.template .env
   ```
   Edit `.env` and add your OpenAI-compatible API key:
   ```
   OPENAI_API_KEY=your_api_key_here
   OPENAI_BASE_URL=https://api.chatanywhere.tech/v1
   DATABASE_URL=sqlite:///./cerina_foundry.db
   ```
   
   See `backend/env.template` for all options. The backend uses `ChatOpenAI` with model `gpt-4o-mini`.

6. **Run the backend server**:
   ```bash
   uvicorn main:app --reload
   ```
   Server will run on `http://localhost:8000`

## Frontend Setup

1. **Navigate to frontend directory**:
   ```bash
   cd frontend
   ```

2. **Install dependencies**:
   ```bash
   npm install
   ```

3. **Configure API URL** (recommended for local dev):
   Create `frontend/.env.local`:
   ```
   VITE_API_URL=http://localhost:8000
   ```

4. **Run development server**:
   ```bash
   npm run dev
   ```
   Frontend will run on `http://localhost:3000`

## MCP Server Setup

1. **Navigate to MCP server directory**:
   ```bash
   cd mcp_server
   ```

2. **Create virtual environment**:
   ```bash
   python -m venv venv
   source venv/bin/activate  # Windows: venv\Scripts\activate
   ```

3. **Install dependencies**:
   ```bash
   pip install -r requirements.txt
   ```

4. **Set up environment variables** (if needed):
   ```bash
   export BACKEND_URL=http://localhost:8000
   ```

5. **Run MCP server**:
   ```bash
   python server.py
   ```

### Connecting MCP Server to Claude Desktop

1. **Find Claude Desktop config**:
   - macOS: `~/Library/Application Support/Claude/claude_desktop_config.json`
   - Windows: `%APPDATA%\Claude\claude_desktop_config.json`

2. **Add MCP server configuration**:
   ```json
   {
     "mcpServers": {
       "cerina-foundry": {
         "command": "python",
         "args": ["/path/to/mcp_server/server.py"],
         "env": {
           "BACKEND_URL": "http://localhost:8000"
         }
       }
     }
   }
   ```

3. **Restart Claude Desktop**

## Testing the System

1. **Start backend**: `cd backend && uvicorn main:app --reload`
2. **Start frontend**: `cd frontend && npm run dev`
3. **Open browser**: Navigate to `http://localhost:3000`
4. **Create a protocol**: Enter an intent like "Create an exposure hierarchy for agoraphobia"
5. **Watch agents work**: See real-time updates in the activity feed
6. **Review and approve**: When workflow halts, review the draft and approve

## Troubleshooting

### Backend Issues
- **Import errors**: Make sure virtual environment is activated
- **Database errors**: Check that SQLite file is writable
- **API key errors**: Verify `.env` has `OPENAI_API_KEY` set (see `backend/env.template`)
- **LLM API errors**: Check `OPENAI_BASE_URL` and API key validity

### Frontend Issues
- **Connection errors**: Ensure backend is running on port 8000
- **CORS errors**: Check that backend CORS settings allow frontend origin

### MCP Issues
- **Connection refused**: Ensure backend is running
- **Tool not found**: Check MCP server is properly configured in Claude Desktop

