# MCP Integration Clarification

## Important: MCP Does NOT Require Anthropic

The **Model Context Protocol (MCP)** is an open protocol standard that works with **any MCP-compatible client**, not just Anthropic's Claude Desktop.

## What is MCP?

MCP is a protocol for connecting AI assistants to external tools and data sources. It's similar to how REST APIs work - it's a standard that multiple clients can implement.

## MCP Clients

You can use our MCP server with:

1. **Claude Desktop** (Anthropic's implementation)
2. **Any MCP-compatible client** that implements the MCP protocol
3. **Custom MCP clients** you build yourself
4. **Future MCP clients** from other vendors

## Our MCP Server

Our MCP server (`mcp_server/server.py`) is a **standard MCP implementation** that:
- Exposes our LangGraph workflow as MCP tools
- Works with any MCP client
- Does NOT require Anthropic API keys
- Does NOT require any payment

## LLM Backend

The backend uses an **OpenAI-compatible API** (`ChatOpenAI` with `gpt-4o-mini`). Configure via `OPENAI_API_KEY` and optional `OPENAI_BASE_URL` in `backend/.env`. See `backend/env.template` and [`tech_info.md`](../tech_info.md) for details.

## Testing MCP Integration

To test the MCP integration:

1. **Option 1: Claude Desktop** (if you have it)
   - Configure our MCP server in Claude Desktop settings
   - Use Claude Desktop to call our tools

2. **Option 2: Custom MCP Client**
   - Build your own MCP client
   - Connect to our MCP server via stdio
   - Call our tools programmatically

3. **Option 3: Direct API** (simpler for testing)
   - Use the FastAPI endpoints directly
   - Same functionality, different interface

## Summary

- ✅ MCP is a protocol standard (like REST)
- ✅ Works with any MCP-compatible client
- ✅ Does NOT require Anthropic
- ✅ Backend uses OpenAI-compatible LLM API (see `backend/env.template`)

