# StackMemory API Reference

## Overview

StackMemory provides 30+ MCP tools and 50+ CLI commands for lossless memory management in AI coding workflows. This reference covers all available APIs with parameters, types, and usage examples.

## Table of Contents

- [MCP Tools](#mcp-tools)
  - [Context Management](#context-management)
  - [Task Management](#task-management) 
  - [Linear Integration](#linear-integration)
  - [Trace & Debug](#trace--debug)
  - [Agent Execution](#agent-execution)
- [CLI Commands](#cli-commands)
  - [Core Commands](#core-commands)
  - [Task Commands](#task-commands)
  - [Linear Commands](#linear-commands)
  - [Session Management](#session-management)
  - [Workflow & Monitoring](#workflow--monitoring)

---

## MCP Tools

### Context Management

#### `get_context`
Retrieve relevant context from the active frame stack.

**Parameters:**
- `query` (string, optional): Search query for context filtering
- `limit` (number, optional): Maximum results (default: 5)

**Returns:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Current Context Stack:\n  Frame 1: Task Name\n    Constraints: auth, validation\n    Recent: 3 events"
    }
  ],
  "metadata": {
    "relevantFrames": ["frame-id-1", "frame-id-2"],
    "query": "search-term"
  }
}
```

**Example:**
```javascript
// Get all current context
await mcp.callTool("get_context", {});

// Search for specific context
await mcp.callTool("get_context", {
  query: "authentication implementation",
  limit: 10
});
```

#### `start_frame`
Begin a new context frame (task/subtask) on the call stack.

**Parameters:**
- `name` (string, required): Frame name/goal
- `type` (string, optional): Frame type (default: "task")
  - `task` | `subtask` | `tool_scope` | `context`
- `constraints` (array, optional): Initial constraints
- `definitions` (object, optional): Initial definitions/config

**Returns:**
```json
{
  "content": [
    {
      "type": "text", 
      "text": "Started frame: API Implementation (frame-id-123)"
    }
  ],
  "metadata": {
    "frameId": "frame-id-123",
    "type": "task",
    "name": "API Implementation"
  }
}
```

**Example:**
```javascript
await mcp.callTool("start_frame", {
  name: "User Authentication System",
  type: "task",
  constraints: ["OAuth 2.0", "JWT tokens"],
  definitions: {
    "auth_endpoint": "/api/auth",
    "token_expiry": "24h"
  }
});
```

#### `close_frame`
Close the current or specified frame with optional summary.

**Parameters:**
- `summary` (string, optional): Completion summary
- `frameId` (string, optional): Specific frame to close (default: current)

**Returns:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Closed frame: API Implementation with summary: Auth endpoints completed successfully"
    }
  ]
}
```

#### `add_decision`
Record an architectural decision or important constraint.

**Parameters:**
- `content` (string, required): Decision/constraint content
- `type` (string, required): Type of entry
  - `decision` | `constraint`

**Returns:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Recorded decision: Use JWT for session management"
    }
  ]
}
```

#### `add_anchor`
Add a high-priority anchor (important fact) to the current frame.

**Parameters:**
- `type` (string, required): Anchor type
  - `FACT` | `DECISION` | `CONSTRAINT` | `INTERFACE_CONTRACT` | `TODO` | `RISK`
- `text` (string, required): Anchor content
- `priority` (number, optional): Priority level 1-10 (default: 5)

**Example:**
```javascript
await mcp.callTool("add_anchor", {
  type: "CONSTRAINT", 
  text: "Database connections must use SSL",
  priority: 9
});
```

#### `get_hot_stack`
Get current hot stack context with active frames.

**Parameters:**
- `max_events` (number, optional): Maximum recent events per frame (default: 10)

**Returns:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Hot Stack (3 frames):\n  0: Main Task (5 anchors, 12 events)\n  1: Auth Subtask (2 anchors, 4 events)"
    }
  ],
  "metadata": {
    "stack": [
      {
        "depth": 0,
        "frameId": "frame-1",
        "goal": "Main Task",
        "constraints": ["security", "performance"],
        "anchors": 5,
        "recentEvents": 12,
        "artifacts": 3
      }
    ]
  }
}
```

### Task Management

#### `create_task`
Create a new task with agent assistance capabilities.

**Parameters:**
- `title` (string, required): Task title
- `description` (string, optional): Detailed description
- `priority` (string, optional): Priority level (default: "medium")
  - `low` | `medium` | `high` | `urgent`
- `tags` (array, optional): Categorization tags
- `parent_id` (string, optional): Parent task ID
- `autoExecute` (boolean, optional): Auto-start agent execution

**Returns:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Created task: Implement user auth (task-123)"
    }
  ],
  "metadata": {
    "taskId": "task-123",
    "title": "Implement user auth",
    "priority": "high"
  }
}
```

**Example:**
```javascript
await mcp.callTool("create_task", {
  title: "Implement OAuth 2.0 authentication",
  description: "Add OAuth integration with Google and GitHub providers",
  priority: "high",
  tags: ["auth", "oauth", "security"],
  autoExecute: true
});
```

#### `update_task_status`
Update the status and progress of an existing task.

**Parameters:**
- `task_id` (string, required): Task identifier
- `status` (string, required): New status
  - `pending` | `in_progress` | `blocked` | `completed` | `cancelled`
- `progress` (number, optional): Completion percentage (0-100)

**Example:**
```javascript
await mcp.callTool("update_task_status", {
  task_id: "task-123",
  status: "in_progress", 
  progress: 75
});
```

#### `get_active_tasks`
Retrieve active tasks with filtering options.

**Parameters:**
- `status` (string, optional): Filter by status
- `priority` (string, optional): Filter by priority  
- `limit` (number, optional): Maximum results (default: 20)
- `include_completed` (boolean, optional): Include completed tasks (default: false)
- `tags` (array, optional): Filter by tags
- `search` (string, optional): Search in title/description

**Returns:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Active Tasks (5):\ntask-1: Auth API [in_progress] (high)\ntask-2: Database setup [pending] (medium)"
    }
  ],
  "metadata": {
    "tasks": [
      {
        "id": "task-1",
        "title": "Auth API",
        "status": "in_progress", 
        "priority": "high",
        "tags": ["auth", "api"],
        "created": "2024-01-15",
        "progress": 60
      }
    ],
    "totalCount": 5,
    "filters": {}
  }
}
```

#### `get_task_metrics`
Get task analytics and performance metrics.

**Returns:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Task Metrics:\n- Total: 45\n- Blocked: 3\n- Overdue: 1\n- Completion Rate: 78.2%\n- Effort Accuracy: 85.4%"
    }
  ],
  "metadata": {
    "total_tasks": 45,
    "blocked_tasks": 3,
    "overdue_tasks": 1,
    "completion_rate": 0.782,
    "avg_effort_accuracy": 0.854,
    "by_priority": {
      "urgent": 2,
      "high": 8,
      "medium": 25,
      "low": 10
    },
    "by_status": {
      "pending": 12,
      "in_progress": 8,
      "completed": 22,
      "blocked": 3
    }
  }
}
```

#### `add_task_dependency`
Add a dependency relationship between tasks.

**Parameters:**
- `task_id` (string, required): Dependent task ID
- `depends_on` (string, required): Task this depends on
- `dependency_type` (string, optional): Dependency type (default: "blocks")

**Example:**
```javascript
await mcp.callTool("add_task_dependency", {
  task_id: "task-frontend", 
  depends_on: "task-api",
  dependency_type: "blocks"
});
```

### Linear Integration

#### `linear_sync`
Synchronize tasks with Linear issue tracker.

**Parameters:**
- `direction` (string, optional): Sync direction (default: "both")
  - `both` | `to_linear` | `from_linear`
- `force` (boolean, optional): Force sync ignoring conflicts

**Returns:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Linear Sync Complete:\n- To Linear: 5 tasks\n- From Linear: 3 tasks\n- Updated: 2 tasks\n- Errors: 0"
    }
  ],
  "metadata": {
    "success": true,
    "synced": {
      "toLinear": 5,
      "fromLinear": 3, 
      "updated": 2
    },
    "conflicts": [],
    "errors": []
  }
}
```

#### `linear_update_task`
Update a Linear issue directly.

**Parameters:**
- `linear_id` (string, required): Linear issue ID or identifier
- `status` (string, optional): New status
- `assignee_id` (string, optional): Assignee user ID
- `priority` (number, optional): Priority level (1-4)
- `labels` (array, optional): Issue labels

#### `linear_get_tasks`
Retrieve issues from Linear.

**Parameters:**
- `team_id` (string, optional): Filter by team
- `assignee_id` (string, optional): Filter by assignee
- `state` (string, optional): Filter by state (default: "active")
- `limit` (number, optional): Maximum results (default: 20)
- `search` (string, optional): Search query

#### `linear_status`
Check Linear integration connection status.

**Returns:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Linear Integration Status:\n✓ Connected as: John Doe\n✓ Teams: 3\n✓ Last sync: 2024-01-15 14:30\n✓ Synced tasks: 127\n✓ Sync errors: 0"
    }
  ],
  "metadata": {
    "connected": true,
    "user": {"name": "John Doe", "email": "john@company.com"},
    "teams": [{"id": "team-1", "name": "Engineering"}],
    "syncStats": {
      "lastSync": "2024-01-15T14:30:00Z",
      "totalSynced": 127,
      "errors": 0
    }
  }
}
```

### Trace & Debug

#### `get_traces`
Retrieve execution traces with filtering.

**Parameters:**
- `limit` (number, optional): Maximum results (default: 20)
- `pattern` (string, optional): Filter by pattern
- `start_time` (string, optional): Start time (ISO string)
- `end_time` (string, optional): End time (ISO string)
- `include_context` (boolean, optional): Include full trace context

#### `analyze_traces`
Analyze trace patterns for insights.

**Parameters:**
- `trace_id` (string, optional): Specific trace to analyze
- `analysis_type` (string, optional): Analysis type (default: "performance")
  - `performance` | `patterns` | `errors`
- `include_recommendations` (boolean, optional): Include recommendations (default: true)

#### `start_browser_debug`
Start a browser debugging session.

**Parameters:**
- `url` (string, required): URL to navigate to
- `headless` (boolean, optional): Run in headless mode (default: false)
- `width` (number, optional): Browser width (default: 1280)
- `height` (number, optional): Browser height (default: 720)
- `capture_screenshots` (boolean, optional): Auto-capture screenshots (default: true)

#### `take_screenshot`
Capture a screenshot during debugging.

**Parameters:**
- `session_id` (string, required): Browser session ID
- `selector` (string, optional): CSS selector for element screenshot
- `full_page` (boolean, optional): Capture full page (default: false)

#### `execute_script`
Execute JavaScript in the browser.

**Parameters:**
- `session_id` (string, required): Browser session ID
- `script` (string, required): JavaScript code to execute
- `args` (array, optional): Script arguments

#### `stop_browser_debug`
Stop a browser debugging session.

**Parameters:**
- `session_id` (string, required): Session ID to stop

### Agent Execution

#### `execute_task`
Execute a task using AI agent with verification loops.

**Parameters:**
- `taskId` (string, required): Task ID to execute
- `maxTurns` (number, optional): Maximum agent turns (default: 10, max: 20)

#### `agent_turn`
Execute a single turn in an active agent session.

**Parameters:**
- `sessionId` (string, required): Active session ID
- `action` (string, required): Action to perform
- `context` (object, optional): Additional context for the action

#### `breakdown_task`
Break down a complex task into subtasks.

**Parameters:**
- `taskId` (string, required): Task ID to break down

#### `list_active_sessions`
List all active agent execution sessions.

**Returns:**
```json
{
  "content": [
    {
      "type": "text",
      "text": "Active sessions (2):\n- session-1: Task task-123 (Turn 3, running)\n- session-2: Task task-456 (Turn 1, waiting)"
    }
  ]
}
```

#### `retry_session`
Retry a failed session with learned context.

**Parameters:**
- `sessionId` (string, required): Session ID to retry

#### `session_feedback`
Get feedback from the last agent turn.

**Parameters:**
- `sessionId` (string, required): Session ID

---

## CLI Commands

### Core Commands

#### `stackmemory init`
Initialize StackMemory in the current project.

```bash
stackmemory init
```

Creates `.stackmemory/` directory with context database and configuration.

#### `stackmemory status`
Show current StackMemory status and active frames.

```bash
stackmemory status [options]

Options:
  --all              Show all active frames across sessions
  --project          Show all active frames in current project  
  --session <id>     Show frames for specific session
```

**Example output:**
```
📊 StackMemory Status:
   Session: abc12345 (active, 25min old)
   Project: my-app
   Branch: feature/auth

   Database Statistics (this project):
     Frames: 45 (3 active, 42 closed)
     Events: 234
     Sessions: 8
     Cached contexts: 15 (global)

   Current Session:
     Stack depth: 3
     Active frames: 3
     └─ Main Development [task]
       └─ Authentication System [task] 
         └─ OAuth Integration [subtask]
```

#### `stackmemory update-check`
Check for StackMemory updates.

```bash
stackmemory update-check
```

#### `stackmemory mcp-server`
Start StackMemory MCP server for Claude Desktop integration.

```bash
stackmemory mcp-server [options]

Options:
  -p, --project <path>    Project root directory (default: current)
```

### Task Commands

#### `stackmemory tasks list`
List and filter tasks.

```bash
stackmemory tasks list [options]

Aliases: task ls

Options:
  -s, --status <status>     Filter by status (pending, in_progress, completed, blocked)
  -p, --priority <priority> Filter by priority (urgent, high, medium, low)
  -q, --query <text>       Search in title/description
  -l, --limit <n>          Limit results (default: 20)
  -a, --all                Include completed tasks
```

**Example:**
```bash
# List all active high priority tasks
stackmemory tasks list --priority high

# Search for authentication tasks
stackmemory tasks list --query auth --limit 10

# Show all tasks including completed
stackmemory tasks list --all
```

#### `stackmemory tasks create`
Create a new task.

```bash
stackmemory tasks create <title> [options]

Options:
  -d, --description <desc>  Task description
  -p, --priority <priority> Priority level (urgent, high, medium, low)
  -t, --tags <tags>        Comma-separated tags
  --parent <id>            Parent task ID
  --assign <user>          Assign to user
  --due <date>             Due date (YYYY-MM-DD)
```

**Example:**
```bash
stackmemory tasks create "Implement OAuth authentication" \
  --description "Add Google and GitHub OAuth providers" \
  --priority high \
  --tags "auth,oauth,security"
```

#### `stackmemory tasks update`
Update an existing task.

```bash
stackmemory tasks update <id> [options]

Options:
  -s, --status <status>     Update status
  -p, --priority <priority> Update priority
  -t, --title <title>      Update title
  -d, --description <desc>  Update description
  --progress <percent>      Set completion progress (0-100)
  --assign <user>          Assign to user
  --tags <tags>            Update tags (comma-separated)
```

#### `stackmemory tasks show`
Show detailed task information.

```bash
stackmemory tasks show <id> [options]

Options:
  --history     Show task history
  --comments    Show comments
  --timeline    Show timeline view
```

#### `stackmemory tasks delete`
Delete a task.

```bash
stackmemory tasks delete <id> [options]

Options:
  --force       Force deletion without confirmation
```

### Linear Commands

#### `stackmemory linear setup`
Set up Linear OAuth integration.

```bash
stackmemory linear setup
```

Interactive OAuth setup with Linear. Provides authorization URL and instructions.

#### `stackmemory linear authorize`
Complete Linear OAuth authorization.

```bash
stackmemory linear authorize <code>

Arguments:
  code    Authorization code from Linear OAuth flow
```

#### `stackmemory linear status`
Show Linear integration status.

```bash
stackmemory linear status
```

**Example output:**
```
📊 Linear Integration Status:
   Configured: ✅
   Client ID: abcd1234...
   Tokens: ✅ Valid
   Token expires: 1425 minutes

🧪 Testing connection...
   Connection: ✅ OK
```

#### `stackmemory linear sync`
Synchronize tasks with Linear.

```bash
stackmemory linear sync [options]

Options:
  -d, --direction <direction>  Sync direction: bidirectional, to_linear, from_linear (default: bidirectional)
```

**Example:**
```bash
# Bidirectional sync
stackmemory linear sync

# Only push to Linear
stackmemory linear sync --direction to_linear

# Only pull from Linear  
stackmemory linear sync --direction from_linear
```

#### `stackmemory linear auto-sync`
Manage automatic synchronization.

```bash
stackmemory linear auto-sync [options]

Options:
  --start                    Start auto-sync service
  --stop                     Stop auto-sync service  
  --status                   Show auto-sync status
  --interval <minutes>       Set sync interval in minutes (default: 5)
  --direction <direction>    Set sync direction (default: bidirectional)
  --quiet-start <hour>       Start of quiet hours 0-23 (default: 22)
  --quiet-end <hour>         End of quiet hours 0-23 (default: 7)
```

**Example:**
```bash
# Start auto-sync every 10 minutes
stackmemory linear auto-sync --start --interval 10

# Check status
stackmemory linear auto-sync --status

# Stop auto-sync
stackmemory linear auto-sync --stop
```

#### `stackmemory linear force-sync`
Force immediate synchronization.

```bash
stackmemory linear force-sync
```

#### `stackmemory linear update`
Update a Linear issue directly.

```bash
stackmemory linear update <issueId> [options]

Options:
  -s, --status <status>        New status (todo, in-progress, done, canceled)
  -t, --title <title>          Update task title
  -d, --description <desc>     Update task description  
  -p, --priority <priority>    Set priority (1=urgent, 2=high, 3=medium, 4=low)
```

#### `stackmemory linear config`
Configure auto-sync settings.

```bash
stackmemory linear config [options]

Options:
  --show                              Show current configuration
  --set-interval <minutes>            Set sync interval in minutes
  --set-direction <direction>         Set sync direction
  --set-conflict-resolution <strategy> Set conflict resolution strategy
  --set-quiet-start <hour>            Set start of quiet hours (0-23)
  --set-quiet-end <hour>              Set end of quiet hours (0-23)  
  --enable                            Enable auto-sync
  --disable                           Disable auto-sync
  --reset                             Reset to default configuration
```

### Session Management

#### `stackmemory sessions list`
List all sessions.

```bash
stackmemory sessions list [options]

Options:
  --active      Show only active sessions
  --project     Show sessions for current project only
  --format      Output format (table, json, csv)
```

#### `stackmemory sessions create`
Create a new session.

```bash
stackmemory sessions create [options]

Options:
  --name <name>         Session name
  --branch <branch>     Git branch
  --project <project>   Project ID
```

#### `stackmemory sessions switch`
Switch to a different session.

```bash
stackmemory sessions switch <sessionId>
```

#### `stackmemory sessions close`
Close a session.

```bash
stackmemory sessions close <sessionId> [options]

Options:
  --force       Force close without saving
  --summary     Provide closing summary
```

### Context Management

#### `stackmemory context save`
Save current context to shared memory.

```bash
stackmemory context save <content> [options]

Options:
  --type <type>         Context type (decision, constraint, learning, code, error)
  --importance <score>  Importance score 0-1 (default: 0.5)
  --tags <tags>         Comma-separated tags
```

#### `stackmemory context load`
Load relevant context.

```bash
stackmemory context load <query> [options]

Options:
  --limit <n>           Maximum results (default: 10)
  --format <format>     Output format (text, json, yaml)
  --frame <frameId>     Load from specific frame
```

#### `stackmemory context frames`
Manage context frames.

```bash
stackmemory context frames <action> [options]

Actions:
  list          List active frames
  create        Create new frame  
  close         Close current frame
  switch        Switch to different frame

Options:
  --name <name>         Frame name (for create)
  --type <type>         Frame type (task, subtask, tool_scope, context)
  --summary <text>      Closing summary (for close)
```

### Workflow & Monitoring

#### `stackmemory analytics`
Launch task analytics dashboard.

```bash
stackmemory analytics [options]

Options:
  -p, --port <port>      Port for dashboard server (default: 3000)
  -o, --open             Open dashboard in browser
  --export <format>      Export metrics (json, csv)
  --sync                 Sync with Linear before launching
  --view                 Show analytics in terminal
```

#### `stackmemory dashboard`
Display monitoring dashboard in terminal.

```bash
stackmemory dashboard [options]

Options:
  -w, --watch            Auto-refresh dashboard
  -i, --interval <sec>   Refresh interval in seconds (default: 5)
```

#### `stackmemory monitor`
Monitor system performance and health.

```bash
stackmemory monitor [options]

Options:
  --start               Start monitoring service
  --stop                Stop monitoring service
  --status              Show monitoring status
  --alerts              Show active alerts
  --metrics             Show current metrics
```

#### `stackmemory workflow`
Manage automated workflows.

```bash
stackmemory workflow <action> [options]

Actions:
  list          List available workflows
  run           Run a specific workflow
  create        Create new workflow
  edit          Edit existing workflow
  delete        Delete workflow

Options:
  --name <name>         Workflow name
  --trigger <trigger>   Workflow trigger
  --config <file>       Workflow configuration file
```

#### `stackmemory clear`
Clear cached data and temporary files.

```bash
stackmemory clear [options]

Options:
  --cache               Clear cached data
  --logs                Clear log files  
  --temp                Clear temporary files
  --all                 Clear everything
  --force               Don't ask for confirmation
```

#### `stackmemory search`
Search across tasks, contexts, and frames.

```bash
stackmemory search <query> [options]

Options:
  --type <type>         Search type (tasks, contexts, frames, all)
  --limit <n>           Maximum results (default: 20)
  --format <format>     Output format (table, json, csv)
  --case-sensitive      Case-sensitive search
```

#### `stackmemory log`
Show and filter application logs.

```bash
stackmemory log [options]

Options:
  --level <level>       Log level (error, warn, info, debug)
  --since <time>        Show logs since time (e.g., '1h', '30m', '2024-01-15')
  --tail <n>            Show last n lines (default: 100)
  --follow              Follow log output
  --format <format>     Output format (text, json)
```

---

## Authentication & Configuration

### Environment Variables

- `LINEAR_API_KEY`: Linear API key (alternative to OAuth)
- `STACKMEMORY_PROJECT`: Override project root directory
- `LOG_LEVEL`: Logging level (error, warn, info, debug)
- `NODE_ENV`: Environment (development, production)

### Configuration Files

- `~/.stackmemory/config.json`: Global configuration
- `.stackmemory/config.json`: Project-specific configuration
- `.stackmemory/linear-auth.json`: Linear authentication tokens

### MCP Server Configuration

Add to Claude Desktop config (`~/.claude/config.json`):

```json
{
  "mcp": {
    "mcpServers": {
      "stackmemory": {
        "command": "stackmemory",
        "args": ["mcp-server"],
        "env": {
          "NODE_ENV": "production",
          "LOG_LEVEL": "info"
        }
      }
    }
  }
}
```

---

## Error Handling

### Common Error Codes

- `AUTH_ERROR`: Authentication/authorization failed
- `NOT_FOUND`: Resource not found
- `VALIDATION_ERROR`: Invalid parameters provided
- `CONFLICT`: Operation conflicts with current state
- `RATE_LIMITED`: API rate limit exceeded
- `NETWORK_ERROR`: Network connectivity issue

### Error Response Format

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid task priority. Must be one of: low, medium, high, urgent",
    "details": {
      "field": "priority",
      "provided": "invalid-priority",
      "allowed": ["low", "medium", "high", "urgent"]
    }
  }
}
```

---

## Best Practices

### MCP Tools
- Always check authentication status before Linear operations
- Use appropriate frame types for context organization
- Set meaningful priorities for anchors (7-10 for critical info)
- Include context in agent turns for better results

### CLI Usage
- Initialize StackMemory (`stackmemory init`) before using project features
- Use `--dry-run` flags when available for destructive operations
- Set up auto-sync for continuous Linear integration
- Use tags consistently for better task organization

### Performance
- Limit context queries to avoid large responses
- Use pagination for large result sets  
- Close frames when tasks are complete
- Regular cleanup with `stackmemory clear` command

### Security
- Store API keys in environment variables, not config files
- Use OAuth instead of API keys when possible
- Limit MCP server access to project directories only
- Review and rotate authentication tokens regularly