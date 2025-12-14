"""
MCP Server for Cerina Protocol Foundry
Exposes the LangGraph workflow as an MCP tool for machine-to-machine integration.
"""
import asyncio
import os
import sys
import logging
from typing import Any, Sequence
from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.server.models import InitializationOptions
from mcp.types import Tool, TextContent, ServerCapabilities
import httpx
from dotenv import load_dotenv

# Configure logging to stderr (MCP protocol requirement)
logging.basicConfig(
    level=logging.INFO,
    format='%(levelname)s: %(message)s',
    stream=sys.stderr
)

# Load environment variables
load_dotenv()

# Initialize MCP server
# Note: Server name should match the identifier used in Claude Desktop config
app = Server("cerina-protocol-foundry")


# Backend API URL
BACKEND_URL = os.getenv("BACKEND_URL", "http://localhost:8000")

@app.list_tools()
async def list_tools() -> list[Tool]:
    """List available MCP tools"""
    return [
        Tool(
            name="create_cbt_protocol",
            description="""Create a CBT (Cognitive Behavioral Therapy) exercise protocol using the Cerina Protocol Foundry.
            
This tool uses a multi-agent system to autonomously design, critique, and refine CBT exercises.
The system includes:
- Drafter Agent: Creates initial drafts
- Safety Guardian: Validates for safety and medical advice
- Clinical Critic: Evaluates tone, empathy, and clinical appropriateness
- Supervisor: Orchestrates the workflow

The system will iterate until quality thresholds are met, then pause for human approval.""",
            inputSchema={
                "type": "object",
                "properties": {
                    "intent": {
                        "type": "string",
                        "description": "Description of the CBT exercise to create (e.g., 'Create an exposure hierarchy for agoraphobia')"
                    },
                    "session_id": {
                        "type": "string",
                        "description": "Optional custom session ID. If not provided, one will be generated.",
                        "default": None
                    }
                },
                "required": ["intent"]
            }
        ),
        Tool(
            name="get_protocol_status",
            description="Get the current status and draft of a protocol generation session",
            inputSchema={
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "The session ID returned from create_cbt_protocol"
                    }
                },
                "required": ["session_id"]
            }
        ),
        Tool(
            name="approve_protocol",
            description="Approve a protocol draft (human-in-the-loop). Optionally provide edited content.",
            inputSchema={
                "type": "object",
                "properties": {
                    "session_id": {
                        "type": "string",
                        "description": "The session ID"
                    },
                    "approved_content": {
                        "type": "string",
                        "description": "Optional edited content. If provided, replaces the current draft.",
                        "default": None
                    }
                },
                "required": ["session_id"]
            }
        )
    ]

@app.call_tool()
async def call_tool(name: str, arguments: dict[str, Any]) -> Sequence[TextContent]:
    """Handle tool calls"""
    async with httpx.AsyncClient(timeout=30.0) as client:
        try:
            if name == "create_cbt_protocol":
                intent = arguments.get("intent")
                session_id = arguments.get("session_id")
                
                if not intent:
                    return [TextContent(
                        type="text",
                        text="Error: 'intent' parameter is required"
                    )]
                
                # Call backend API
                response = await client.post(
                    f"{BACKEND_URL}/api/protocols/create",
                    json={"intent": intent, "session_id": session_id}
                )
                response.raise_for_status()
                data = response.json()
                
                return [TextContent(
                    type="text",
                    text=f"""Protocol generation started!

Session ID: {data['session_id']}
Status: {data['status']}

The multi-agent system is now working on your request. Use get_protocol_status with this session_id to check progress and retrieve the draft when ready."""
                )]
            
            elif name == "get_protocol_status":
                session_id = arguments.get("session_id")
                
                if not session_id:
                    return [TextContent(
                        type="text",
                        text="Error: 'session_id' parameter is required"
                    )]
                
                # Get current state
                response = await client.get(
                    f"{BACKEND_URL}/api/protocols/{session_id}/state"
                )
                response.raise_for_status()
                data = response.json()
                
                state = data.get("state", {})
                status = state.get("status", "unknown")
                draft = state.get("current_draft", "No draft available yet")
                safety_score = state.get("safety_score")
                empathy_score = state.get("empathy_score")
                clinical_score = state.get("clinical_score")
                iteration = state.get("iteration_count", 0)
                halted = state.get("halted", False)
                
                status_text = f"""Protocol Status Report

Session ID: {session_id}
Status: {status}
Iteration: {iteration}
Halted for Review: {halted}

                Quality Scores:
- Safety: {f'{safety_score * 100:.1f}%' if safety_score is not None else 'N/A'}
- Empathy: {f'{empathy_score * 100:.1f}%' if empathy_score is not None else 'N/A'}
- Clinical: {f'{clinical_score * 100:.1f}%' if clinical_score is not None else 'N/A'}

Current Draft:
{draft}

"""
                
                if halted:
                    status_text += "\n⚠️ This protocol is awaiting human approval. Use approve_protocol to approve it."
                
                return [TextContent(type="text", text=status_text)]
            
            elif name == "approve_protocol":
                session_id = arguments.get("session_id")
                approved_content = arguments.get("approved_content")
                
                if not session_id:
                    return [TextContent(
                        type="text",
                        text="Error: 'session_id' parameter is required"
                    )]
                
                # Approve protocol
                response = await client.post(
                    f"{BACKEND_URL}/api/protocols/{session_id}/approve",
                    json={"approved_content": approved_content} if approved_content else {}
                )
                response.raise_for_status()
                data = response.json()
                
                return [TextContent(
                    type="text",
                    text=f"""Protocol approved!

Status: {data['status']}
Message: {data['message']}

The workflow will now continue and finalize the protocol."""
                )]
            
            else:
                return [TextContent(
                    type="text",
                    text=f"Unknown tool: {name}"
                )]
        
        except httpx.HTTPStatusError as e:
            return [TextContent(
                type="text",
                text=f"HTTP Error: {e.response.status_code} - {e.response.text}"
            )]
        except Exception as e:
            return [TextContent(
                type="text",
                text=f"Error: {str(e)}"
            )]

async def main():
    """Run the MCP server"""
    # Use stdio_server which handles the MCP protocol over stdin/stdout
    async with stdio_server() as (read_stream, write_stream):
        # MCP SDK 1.24.0 requires initialization_options parameter with capabilities
        # Create initialization options with required capabilities field
        init_options = InitializationOptions(
            server_name="cerina-protocol-foundry",
            server_version="0.1.0",
            capabilities=ServerCapabilities()
        )
        
        await app.run(
            read_stream,
            write_stream,
            init_options
        )

if __name__ == "__main__":
    asyncio.run(main())
