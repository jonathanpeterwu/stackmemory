# Advanced Setup

This guide covers advanced options beyond Quick Start: manual MCP configuration, available tools, and local development.

## Manual MCP configuration

Create the MCP configuration file:

```bash
mkdir -p ~/.claude
cat > ~/.claude/stackmemory-mcp.json << 'EOF'
{
  "mcpServers": {
    "stackmemory": {
      "command": "stackmemory",
      "args": ["mcp-server"],
      "env": { "NODE_ENV": "production" }
    }
  }
}
EOF
```

Update Claude config.json to include the MCP config:

```json
{
  "mcp": {
    "configFiles": ["~/.claude/stackmemory-mcp.json"]
  }
}
```

## Available MCP Tools (25)

### Context Management

| Tool | Description |
|------|-------------|
| `get_context` | Retrieve relevant context for current work |
| `add_decision` | Record a decision with rationale |
| `start_frame` | Begin a new context frame |
| `close_frame` | Close current frame with summary |
| `add_anchor` | Pin a fact (decision, constraint, interface) |
| `get_hot_stack` | Get the current active frame stack |

### Task Management

| Tool | Description |
|------|-------------|
| `create_task` | Create a new task |
| `update_task_status` | Update task status |
| `get_active_tasks` | List active tasks (with filters) |
| `get_task_metrics` | Get task analytics |
| `add_task_dependency` | Add dependency between tasks |

### Linear Integration

| Tool | Description |
|------|-------------|
| `linear_sync` | Sync with Linear |
| `linear_update_task` | Update Linear issue |
| `linear_get_tasks` | Get tasks from Linear |
| `linear_status` | Check Linear sync status |

### Trace & Debugging

| Tool | Description |
|------|-------------|
| `get_traces` | Get execution traces |
| `analyze_traces` | Analyze trace patterns |
| `start_browser_debug` | Start browser debugging session |
| `take_screenshot` | Capture browser screenshot |
| `execute_script` | Execute script in browser |
| `stop_browser_debug` | Stop browser debugging |

### Discovery & Exploration

| Tool | Description |
|------|-------------|
| `sm_discover` | Discover project structure |
| `sm_related_files` | Find related files |
| `sm_session_summary` | Get session summary |
| `sm_search` | Search across frames and context |

## plan_and_code Tool

Trigger a full plan, implement, critique loop and get a single JSON result.

Args:
- `task`: short description
- `implementer`: `codex` (default) or `claude`
- `maxIters`: retries (default 2)
- `execute`: true to actually call the implementer (otherwise dry-run)
- `record`: write plan/critique to simple context
- `recordFrame`: write a real frame + anchors

Env defaults: `STACKMEMORY_MM_PLANNER_MODEL`, `STACKMEMORY_MM_REVIEWER_MODEL`, `STACKMEMORY_MM_IMPLEMENTER`, `STACKMEMORY_MM_MAX_ITERS`

Example request (tools/call):

```json
{
  "method": "tools/call",
  "params": {
    "name": "plan_and_code",
    "arguments": {
      "task": "Refactor config loader into provider pattern",
      "implementer": "codex",
      "maxIters": 2,
      "execute": true,
      "recordFrame": true
    }
  }
}
```

## Open-Source Local Mode

### Step 1: Clone & Build

```bash
git clone https://github.com/stackmemoryai/stackmemory
cd stackmemory
npm install
npm run build
```

### Step 2: Run local MCP server

```bash
npm run mcp:start
# or for development
npm run mcp:dev
```

This creates `.stackmemory/` with SQLite storage.

### Step 3: Point your editor to local MCP

```json
{
  "mcpServers": {
    "stackmemory": {
      "command": "node",
      "args": ["dist/src/integrations/mcp/server.js"]
    }
  }
}
```

### How it works

Each interaction: ingests events, updates indices, retrieves relevant context, returns sized bundle.

### Example MCP response (simplified)

```json
{
  "hot_stack": [
    { "frame": "Debug auth redirect", "constraints": ["..."] }
  ],
  "anchors": [
    { "type": "DECISION", "text": "Use SameSite=Lax cookies" }
  ],
  "relevant_digests": [
    { "frame": "Initial auth refactor", "summary": "..." }
  ],
  "pointers": [
    "s3://logs/auth-test-0421"
  ]
}
```

## Storage

StackMemory uses SQLite (via better-sqlite3) with FTS5 full-text search for local storage. Data is organized by age:

- **Young (<24h)**: Uncompressed, complete retention
- **Mature (1-7d)**: LZ4 compression (~2.5x), selective retention
- **Old (7-30d)**: ZSTD compression (~3.5x), critical data only

## Claude Code Integration

StackMemory saves context when using Claude Code so your assistant has access to prior decisions and context.

### Quick Setup

```bash
npm install -g @stackmemoryai/stackmemory   # installs hooks automatically
cd your-project && stackmemory init          # init project
stackmemory setup-mcp                        # configure MCP
stackmemory doctor                           # verify everything works
```

### Wrapper Scripts

```bash
claude-sm          # Claude Code with StackMemory context + Prompt Forge
claude-smd         # Claude Code with --dangerously-skip-permissions
codex-sm           # Codex with StackMemory context
codex-smd          # Codex with --dangerously-skip-permissions
opencode-sm        # OpenCode with StackMemory context
```
