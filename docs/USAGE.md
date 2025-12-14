# Usage Guide

## React Dashboard (Human-in-the-Loop)

### Creating a Protocol

1. **Enter Intent**: In the "Create CBT Protocol" section, describe the exercise you want:
   - Example: "Create an exposure hierarchy for agoraphobia"
   - Example: "Design a cognitive restructuring exercise for anxiety"
   - Example: "Build a behavioral activation protocol for depression"

2. **Submit**: Click "Create Protocol" to start the multi-agent workflow

3. **Monitor Progress**: 
   - Watch the Agent Activity feed on the right
   - See real-time updates as agents work
   - View quality scores (Safety, Empathy, Clinical)

4. **Review Draft**: 
   - When workflow halts for approval, the draft appears
   - Review the generated CBT exercise
   - Check quality scores

5. **Edit (Optional)**:
   - Click "Edit" to modify the draft
   - Make any changes needed
   - Click "Save & Approve" when done

6. **Approve**: 
   - Click "Approve" to finalize the protocol
   - Workflow resumes and completes
   - Final protocol is saved

### Halting Workflow

- Click "Halt for Review" at any time to pause execution
- Review current draft
- Approve or edit as needed

## MCP Integration (Machine-to-Machine)

### Using with Claude Desktop

1. **Start MCP Server**: Ensure MCP server is running and connected

2. **Invoke Tool**: In Claude Desktop, you can now use:
   ```
   Use the create_cbt_protocol tool to create an exposure hierarchy for agoraphobia
   ```

3. **Check Status**:
   ```
   Check the status of session_id_here using get_protocol_status
   ```

4. **Approve Protocol**:
   ```
   Approve the protocol for session_id_here
   ```

### MCP Tools

#### `create_cbt_protocol`
Creates a new CBT protocol generation session.

**Parameters**:
- `intent` (required): Description of the CBT exercise
- `session_id` (optional): Custom session ID

**Returns**: Session ID for tracking

#### `get_protocol_status`
Gets current status and draft of a protocol session.

**Parameters**:
- `session_id` (required): The session ID

**Returns**: Status, draft, quality scores, iteration count

#### `approve_protocol`
Approves a protocol draft (human-in-the-loop).

**Parameters**:
- `session_id` (required): The session ID
- `approved_content` (optional): Edited content to replace draft

**Returns**: Confirmation of approval

## Example Workflows

### Example 1: Exposure Hierarchy
```
Intent: "Create an exposure hierarchy for agoraphobia"

Workflow:
1. Drafter creates initial hierarchy structure
2. Safety Guardian checks for safety issues
3. Clinical Critic evaluates empathy and structure
4. Supervisor decides: Quality OK → Halt for approval
5. Human reviews and approves
6. Protocol finalized
```

### Example 2: Cognitive Restructuring
```
Intent: "Design a cognitive restructuring exercise for anxiety"

Workflow:
1. Drafter creates initial exercise
2. Safety Guardian flags potential issues
3. Clinical Critic notes tone concerns
4. Supervisor decides: Needs revision
5. Drafter revises based on feedback
6. Safety Guardian re-checks
7. Clinical Critic re-evaluates
8. Supervisor decides: Quality OK → Halt
9. Human approves
10. Protocol finalized
```

## Best Practices

1. **Be Specific**: More detailed intents produce better results
   - Good: "Create a 10-step exposure hierarchy for social anxiety"
   - Less ideal: "Make an exercise"

2. **Review Carefully**: Always review drafts before approval
   - Check for clinical appropriateness
   - Verify safety
   - Ensure empathy and tone

3. **Iterate if Needed**: Don't hesitate to request revisions
   - System can iterate up to 5 times
   - Each iteration incorporates feedback

4. **Use MCP for Automation**: 
   - Integrate into larger workflows
   - Batch process multiple protocols
   - Programmatic approval workflows

