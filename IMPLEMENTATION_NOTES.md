# Implementation Notes

## Design Decisions

### 1. Supervisor-Worker Pattern
Chose this over hierarchical teams or swarm because:
- Clear responsibility boundaries
- Centralized decision-making (Supervisor)
- Easier to debug and reason about
- Natural fit for quality-gated workflows

### 2. Blackboard Pattern for State
Rich shared state enables:
- Agent-to-agent communication via notes
- Version tracking for drafts
- Quality metric persistence
- Human-in-the-loop state preservation

### 3. LangGraph Checkpointing
SQLite checkpointers provide:
- Crash recovery
- State inspection
- Workflow debugging
- Session history

### 4. SSE for Real-time Updates
Server-Sent Events chosen over WebSockets because:
- Simpler implementation
- One-way streaming sufficient
- Better for server-to-client updates
- Automatic reconnection

### 5. MCP Integration
MCP server exposes workflow as tools:
- Enables programmatic access
- Integrates with Claude Desktop
- Maintains same backend logic
- No code duplication

## Key Implementation Details

### Workflow Routing
The `should_continue` function implements autonomous routing:
- Checks halted state first
- Routes based on active agent
- Supervisor makes final decisions
- Handles revision loops

### Quality Thresholds
- Safety: 0.8 (critical - no medical advice)
- Empathy: 0.7 (important - user experience)
- Clinical: 0.7 (important - evidence-based)

These thresholds balance quality with iteration limits.

### Human-in-the-Loop
Workflow pauses at checkpoint when:
- Quality thresholds met
- Max iterations reached
- Manual halt requested

State is preserved, allowing resume after approval.

### Error Handling
- Try-catch blocks in all agent nodes
- Graceful degradation on LLM errors
- State preserved even on failures
- Logging for debugging

## Potential Improvements

1. **Streaming LLM Responses**: Currently agents wait for full responses
2. **Parallel Agent Execution**: Safety and Clinical could run in parallel
3. **Advanced Routing**: More sophisticated supervisor decision logic
4. **Caching**: Cache common CBT patterns
5. **Testing**: Unit tests for agents and workflow
6. **Monitoring**: Metrics dashboard for agent performance

## Known Limitations

1. **LLM Dependency**: Requires API key and internet connection
2. **Single-threaded**: Workflow runs sequentially (by design)
3. **SQLite**: Not optimized for high concurrency
4. **No Authentication**: API is open (add for production)

## Testing Strategy

1. **Unit Tests**: Test each agent independently
2. **Integration Tests**: Test workflow end-to-end
3. **E2E Tests**: Test React UI with backend
4. **MCP Tests**: Test MCP server with mock client

## Deployment Considerations

1. **Environment Variables**: All secrets in .env
2. **Database Migration**: SQLAlchemy handles schema
3. **CORS**: Configured for development (update for production)
4. **Logging**: Structured logging ready for production
5. **Error Handling**: Comprehensive error responses

