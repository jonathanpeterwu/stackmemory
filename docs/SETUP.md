# Advanced Setup

This guide covers advanced options beyond Quick Start: manual MCP configuration, hosted mode, ChromaDB, and available tools.

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

## Hosted mode (cloud storage)

```bash
stackmemory onboard
# Select "Hosted" when prompted
# Or set DATABASE_URL environment variable
```

## ChromaDB for semantic search

```bash
stackmemory init --chromadb
# Prompts for ChromaDB API key
```

## Available MCP tools in Claude Code

| Tool                 | Description                                |
| -------------------- | ------------------------------------------ |
| `get_context`        | Retrieve relevant context for current work |
| `add_decision`       | Record a decision with rationale           |
| `start_frame`        | Begin a new context frame                  |
| `close_frame`        | Close current frame with summary           |
| `create_task`        | Create a new task                          |
| `update_task_status` | Update task status                         |
| `get_active_tasks`   | List active tasks (with filters)           |
| `get_task_metrics`   | Get task analytics                         |
| `linear_sync`        | Sync with Linear                           |
| `linear_update_task` | Update Linear issue                        |
| `linear_get_tasks`   | Get tasks from Linear                      |

### Quick: plan_and_code (planning + coding)

- Trigger a full plan → implement → critique loop and get a single JSON result.
- Tool: `plan_and_code`
- Args:
  - `task`: short description
  - `implementer`: `codex` (default) or `claude`
  - `maxIters`: retries (default 2)
  - `execute`: true to actually call the implementer (otherwise dry‑run)
  - `record`: write plan/critique to simple context
  - `recordFrame`: write a real frame + anchors
- Env defaults: `STACKMEMORY_MM_PLANNER_MODEL`, `STACKMEMORY_MM_REVIEWER_MODEL`, `STACKMEMORY_MM_IMPLEMENTER`, `STACKMEMORY_MM_MAX_ITERS`

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

CLI equivalents for quick checks:

```bash
# Quiet JSON (UI-friendly)
stackmemory build --task "Refactor config loader" --json

# Execute implementer and record as frame
stackmemory skills spike --task "Refactor" --execute --max-iters 3 --json --record-frame
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

Each interaction: ingests events → updates indices → retrieves relevant context → returns sized bundle.

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

## Storage & limits

### Two-Tier Storage System (v0.3.15+)

StackMemory implements an intelligent two-tier storage architecture:

#### Local Storage Tiers
- Young (<24h): Uncompressed, complete retention in memory/Redis
- Mature (1-7d): LZ4 compression (~2.5x), selective retention
- Old (7-30d): ZSTD compression (~3.5x), critical data only

#### Remote Storage
- Archive (>30d): Infinite retention in S3 + TimeSeries DB
- Migration: Automatic background migration based on age, size, and importance
- Offline Queue: Persistent retry logic for failed uploads

### Hosted limits

- Free: 1 project; up to 2GB local storage; up to 100GB retrieval egress/month
- Paid: per-project pricing; unlimited storage/retrieval; team/org features

## Claude Code Integration

StackMemory can save context when using Claude Code so your assistant has access to prior decisions and context.

### Quick Setup

```bash
# Add alias (example)
echo 'alias claude="~/Dev/stackmemory/scripts/claude-code-wrapper.sh"' >> ~/.zshrc
source ~/.zshrc

# Use: claude (saves context on exit)
```

### Integration Methods

```bash
# 1. Shell wrapper (recommended)
claude [--auto-sync] [--sync-interval=10]

# 2. Linear auto-sync daemon
./scripts/linear-auto-sync.sh start [interval]
```
