# Setup Guide

## Prerequisites

- Python 3.10+
- Node.js 18+
- npm or yarn
- Groq API key (FREE - Get from https://console.groq.com)

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
   cp .env.example .env
   ```
   Edit `.env` and add your Groq API key (get free key from https://console.groq.com):
   ```
   GROQ_API_KEY=your_groq_api_key_here
   ```
   
   **Getting a Groq API Key (Free)**:
   1. Go to https://console.groq.com
   2. Sign up for a free account (no credit card required)
   3. Navigate to API Keys section
   4. Create a new API key
   5. Copy and paste into your `.env` file

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

3. **Run development server**:
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
- **API key errors**: Verify `.env` file has GROQ_API_KEY set
- **Groq API errors**: Ensure you've signed up at https://console.groq.com and have a valid API key

### Frontend Issues
- **Connection errors**: Ensure backend is running on port 8000
- **CORS errors**: Check that backend CORS settings allow frontend origin

### MCP Issues
- **Connection refused**: Ensure backend is running
- **Tool not found**: Check MCP server is properly configured in Claude Desktop

