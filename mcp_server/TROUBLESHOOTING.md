# MCP Server Troubleshooting

## Error: "dict object has no attribute 'capabilities'"

This error typically occurs when there's a version mismatch or initialization issue with the MCP SDK.

### Solution 1: Reinstall MCP Dependencies

```bash
cd mcp_server
pip uninstall mcp -y
pip install mcp>=1.0.0,<2.0.0
```

### Solution 2: Check Python Version

MCP requires Python 3.10+:

```bash
python --version
```

### Solution 3: Verify Installation

```bash
cd mcp_server
python -c "from mcp.server import Server; print('MCP installed correctly')"
```

### Solution 4: Test Server Directly

Run the server and check for errors:

```bash
cd mcp_server
python server.py
```

If you see errors, they'll help identify the issue.

### Solution 5: Check Claude Desktop Config

Ensure your Claude Desktop config is correct:

**Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

```json
{
  "mcpServers": {
    "cerina-foundry": {
      "command": "python",
      "args": [
        "C:/full/path/to/Cerina-Protocol-Foundary/mcp_server/server.py"
      ],
      "env": {
        "BACKEND_URL": "http://localhost:8000"
      }
    }
  }
}
```

**Important**:
- Use forward slashes `/` in the path, even on Windows
- Use the full absolute path to `server.py`
- Make sure Python is in your PATH, or use full path: `"C:/Python/python.exe"`

### Solution 6: Check Backend is Running

The MCP server requires the backend to be running:

```bash
cd backend
uvicorn main:app --reload
```

Test backend health:
```bash
curl http://localhost:8000/health
```

### Solution 7: Check Logs

Claude Desktop logs errors to:
- **Windows**: Check Event Viewer or Claude Desktop's log files
- Look for MCP-related errors in the console

### Solution 8: Alternative - Use MCP Inspector

You can test the MCP server using the MCP Inspector tool:

```bash
npx @modelcontextprotocol/inspector python mcp_server/server.py
```

This will help identify protocol-level issues.

## Common Issues

### Issue: "Module not found: mcp"
**Solution**: Install dependencies:
```bash
cd mcp_server
pip install -r requirements.txt
```

### Issue: "Connection refused" or "Backend not found"
**Solution**: Ensure backend is running on port 8000

### Issue: Tools not appearing in Claude Desktop
**Solution**: 
1. Restart Claude Desktop completely
2. Check config file syntax (valid JSON)
3. Verify Python path is correct

### Issue: Server starts but tools don't work
**Solution**: Check backend logs for API errors

