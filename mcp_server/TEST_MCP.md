# Testing the MCP Server

## Prerequisites

Before testing the MCP server, ensure you have:

1. **Backend running**: The MCP server connects to the backend API at `http://localhost:8000`
2. **MCP Server setup**: Follow the [Quick Start Guide](../QUICKSTART.md) for initial setup

> 💡 **Quick Setup**: If you haven't set up the project yet, see [QUICKSTART.md](../QUICKSTART.md) for complete setup instructions.

## MCP Server Setup

The MCP server (`server.py`) is already created. To set it up:

```bash
cd mcp_server
python -m venv venv

# Windows
venv\Scripts\activate

# macOS/Linux
source venv/bin/activate

pip install -r requirements.txt

# Set backend URL (optional, defaults to http://localhost:8000)
export BACKEND_URL=http://localhost:8000  # Windows: set BACKEND_URL=http://localhost:8000
```

> 📝 **Note**: The MCP server uses stdio (standard input/output) to communicate with MCP clients. You don't need to run it manually - it will be started by your MCP client (e.g., Claude Desktop) when needed.

## Testing with Claude Desktop

### 1. Install Claude Desktop
Download from: https://claude.ai/download

### 2. Configure Claude Desktop

Find the config file:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

Add this configuration:

```json
{
  "mcpServers": {
    "cerina-foundry": {
      "command": "python",
      "args": [
        "/absolute/path/to/Cerina-Protocol-Foundary/mcp_server/server.py"
      ],
      "env": {
        "BACKEND_URL": "http://localhost:8000"
      }
    }
  }
}
```

**Important**: 
- Replace `/absolute/path/to/Cerina-Protocol-Foundary` with your actual project path
- Use forward slashes `/` in the path, even on Windows
- Use the full absolute path to `server.py`
- If Python is not in your PATH, use the full path to Python: `"C:/Python/python.exe"` instead of `"python"`

### 3. Restart Claude Desktop

After adding the configuration, restart Claude Desktop completely.

### 4. Test in Claude Desktop

Open Claude Desktop and try:

```
Ask Cerina Foundry to create a sleep hygiene protocol
```

Or more explicitly:

```
Use the create_cbt_protocol tool with intent "Create a sleep hygiene protocol for insomnia"
```

## Testing the Tools

### Tool 1: create_cbt_protocol

**Purpose**: Start a new protocol generation session

**Example**:
```
Use create_cbt_protocol with intent "Create an exposure hierarchy for agoraphobia"
```

**Expected Response**:
- Session ID
- Status message
- Instructions to check status

### Tool 2: get_protocol_status

**Purpose**: Check the current status and get the draft

**Example**:
```
Check the status of session_id_here using get_protocol_status
```

**Expected Response**:
- Current status
- Quality scores (Safety, Empathy, Clinical)
- Current draft content
- Whether it's halted for review

### Tool 3: approve_protocol

**Purpose**: Approve a halted protocol (human-in-the-loop)

**Example**:
```
Approve the protocol for session_id_here
```

Or with edits:
```
Approve the protocol for session_id_here with approved_content "edited content here"
```

## Troubleshooting

### MCP Server Not Found
- Check that the path to `server.py` is correct
- Make sure Python is in your PATH
- Try using full path to Python: `"C:/Python/python.exe"` instead of `"python"`

### Backend Connection Error
- Ensure backend is running on `http://localhost:8000`
- Check `BACKEND_URL` in the config matches your backend URL
- Test backend directly: `curl http://localhost:8000/health`

### Tools Not Appearing
- Restart Claude Desktop completely
- Check Claude Desktop logs for errors
- Verify the MCP server starts without errors when run directly

### Import Errors
- Make sure you've installed MCP dependencies: `pip install -r requirements.txt` in the `mcp_server` directory
- Check Python version: `python --version` (should be 3.10+)
- Ensure virtual environment is activated before installing dependencies

### MCP Server Not Starting
- Verify the path to `server.py` is correct in Claude Desktop config
- Test the server manually: `python mcp_server/server.py` (should not error, but will wait for stdio input)
- Check that all dependencies are installed correctly

## Manual Testing (Without MCP Client)

You can test the backend API directly to verify it works. This is useful for debugging:

```bash
# Create a protocol
curl -X POST http://localhost:8000/api/protocols/create \
  -H "Content-Type: application/json" \
  -d '{"intent": "Create a sleep hygiene protocol"}'

# Get status (replace SESSION_ID with the session_id from the create response)
curl http://localhost:8000/api/protocols/SESSION_ID/state

# Approve (replace SESSION_ID)
curl -X POST http://localhost:8000/api/protocols/SESSION_ID/approve \
  -H "Content-Type: application/json" \
  -d '{}'
```

> 💡 **Tip**: You can also use the web UI at `http://localhost:3000` (see [QUICKSTART.md](../QUICKSTART.md)) to test the system without MCP.

## Expected Workflow

1. **Create Protocol**: `create_cbt_protocol` → Returns session_id
2. **Check Status**: `get_protocol_status` → Shows progress and draft
3. **Wait for Halt**: System automatically halts when ready
4. **Approve**: `approve_protocol` → Finalizes the protocol
5. **Check Final Status**: `get_protocol_status` → Shows completed protocol

