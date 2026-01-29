---
description: "Show StackMemory plugin help"
---

# StackMemory Plugin Help

StackMemory provides context persistence and session handoffs for Claude Code.

## Available Commands

### Session Handoffs
- `/sm-capture` - Capture current work state for handoff
- `/sm-restore` - Restore context from last handoff
- `/sm-status` - Show current StackMemory status

### Context Management
- `/sm-context` - Manage context frames and stack
- `/sm-decision` - Record key decisions
- `/sm-memory` - Store memories and observations
- `/sm-clear` - Clear context with ledger preservation

### Task Management
- `/sm-tasks` - Manage tasks (list, add, update)

### Activity
- `/sm-log` - View recent activity log

## Quick Start

1. At session start: `/sm-restore` to load previous context
2. During work: `/sm-decision` to record key decisions
3. Before ending: `/sm-capture` to save state for next session

## Full CLI

For full CLI documentation:
```bash
stackmemory --help
```

## Configuration

Initialize in a project:
```bash
stackmemory init
```

Set up MCP server for Claude Desktop:
```bash
stackmemory setup-mcp
```
