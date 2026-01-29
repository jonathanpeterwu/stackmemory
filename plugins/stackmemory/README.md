# StackMemory Plugin for Claude Code

Context persistence and session handoffs for Claude Code.

## Installation

### Option 1: Via StackMemory CLI

```bash
stackmemory setup-plugins
```

### Option 2: Manual Symlink

```bash
ln -s "$(npm root -g)/@stackmemoryai/stackmemory/plugins/stackmemory" ~/.claude/plugins/stackmemory
```

### Option 3: Copy

```bash
cp -r plugins/stackmemory ~/.claude/plugins/
```

## Commands

| Command | Description |
|---------|-------------|
| `/sm-status` | Show StackMemory status and context |
| `/sm-capture` | Capture work state for session handoff |
| `/sm-restore` | Restore context from last handoff |
| `/sm-decision` | Record a key decision |
| `/sm-memory` | Store a memory/observation |
| `/sm-context` | Manage context frames |
| `/sm-tasks` | Manage tasks |
| `/sm-log` | View activity log |
| `/sm-clear` | Clear context with ledger |
| `/sm-help` | Show plugin help |

## Workflow

### Starting a Session

```
/sm-restore
```

Loads the last captured handoff context.

### During Work

```
/sm-decision "Use PostgreSQL for persistence"
/sm-memory "User prefers TypeScript"
```

Record important decisions and observations.

### Ending a Session

```
/sm-capture
```

Captures current state for the next session.

## Integration with MCP

StackMemory also provides an MCP server for Claude Desktop:

```bash
stackmemory setup-mcp
```

This registers tools like `context_add`, `decision_record`, `memory_store` that can be called directly by Claude.

## Learn More

- [StackMemory Documentation](https://github.com/stackmemoryai/stackmemory)
- [Claude Code Plugins](https://docs.anthropic.com/claude-code/plugins)
