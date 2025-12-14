# Testing the MCP Server

## Prerequisites

1. **Backend must be running**: The MCP server connects to the backend API at `http://localhost:8000`
2. **Python environment**: Make sure you have the MCP dependencies installed

## Quick Test (Without Claude Desktop)

You can test the MCP server directly using a simple Python script:

### 1. Start the Backend
```bash
cd backend
uvicorn main:app --reload
```

### 2. Test MCP Server Directly

Create a test script `test_mcp.py` in the `mcp_server` directory:

```python
import asyncio
import json
import sys
from mcp.server.stdio import stdio_server
from mcp.server import Server
from mcp.types import Tool, TextContent
import httpx

# This simulates what an MCP client would do
async def test_mcp_server():
    # Test the tools
    server = Server("cerina-protocol-foundry")
    
    # List tools
    tools = await server.list_tools()
    print("Available tools:", [t.name for t in tools])
    
    # Test create_cbt_protocol
    result = await server.call_tool("create_cbt_protocol", {
        "intent": "Create a sleep hygiene protocol"
    })
    print("Create result:", result[0].text)
    
    # Extract session_id from result
    # (In real usage, you'd parse this properly)
    session_id = "session_123"  # Replace with actual session_id
    
    # Test get_protocol_status
    result = await server.call_tool("get_protocol_status", {
        "session_id": session_id
    })
    print("Status result:", result[0].text)

if __name__ == "__main__":
    asyncio.run(test_mcp_server())
```

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
        "C:/Users/msi-laptop/Desktop/Cerina-Protocol-Foundary/mcp_server/server.py"
      ],
      "env": {
        "BACKEND_URL": "http://localhost:8000"
      }
    }
  }
}
```

**Important**: Replace the path with your actual path to `server.py`

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
- Make sure you've installed MCP dependencies: `pip install -r requirements.txt`
- Check Python version: `python --version` (should be 3.10+)

## Manual Testing (Without MCP Client)

You can test the backend API directly to verify it works:

```bash
# Create a protocol
curl -X POST http://localhost:8000/api/protocols/create \
  -H "Content-Type: application/json" \
  -d '{"intent": "Create a sleep hygiene protocol"}'

# Get status (replace SESSION_ID)
curl http://localhost:8000/api/protocols/SESSION_ID/state

# Approve (replace SESSION_ID)
curl -X POST http://localhost:8000/api/protocols/SESSION_ID/approve \
  -H "Content-Type: application/json" \
  -d '{}'
```

## Expected Workflow

1. **Create Protocol**: `create_cbt_protocol` → Returns session_id
2. **Check Status**: `get_protocol_status` → Shows progress and draft
3. **Wait for Halt**: System automatically halts when ready
4. **Approve**: `approve_protocol` → Finalizes the protocol
5. **Check Final Status**: `get_protocol_status` → Shows completed protocol

