# Claude Integration Guide

## MCP Server Setup

StackMemory integrates with Claude Code through the Model Context Protocol (MCP).

### Installation

```bash
# Install StackMemory
npm install -g @stackmemoryai/stackmemory@latest

# Initialize in your project
stackmemory init
```

### Configuration

Create MCP configuration at `~/.claude/stackmemory-mcp.json`:

```json
{
  "mcpServers": {
    "stackmemory": {
      "command": "stackmemory",
      "args": ["mcp-server"],
      "env": { "NODE_ENV": "production" }
    }
  }
}
```

Update Claude config at `~/.claude/config.json`:

```json
{
  "mcp": {
    "configFiles": ["~/.claude/stackmemory-mcp.json"]
  }
}
```

## Available MCP Tools

### Context Management
- `get_context` - Retrieve relevant context for current work
- `start_frame` - Begin new context frame
- `close_frame` - Close current frame with summary
- `add_decision` - Record architectural decision
- `add_anchor` - Pin important fact or constraint

### Task Management  
- `create_task` - Create new task
- `update_task_status` - Update task status
- `get_active_tasks` - List active tasks
- `get_task_metrics` - Task analytics

### Linear Integration
- `linear_sync` - Sync with Linear
- `linear_update_task` - Update Linear issue
- `linear_get_tasks` - Get Linear tasks
- `linear_status` - Check sync status

### Advanced Features
- `smart_context` - LLM-driven context retrieval
- `get_summary` - Generate work summary
- `search_frames` - Search historical frames

## Claude Skills

Enhanced workflow automation commands:

### Available Skills

#### `/handoff`
Generate comprehensive handoff document for team transitions.

```
/handoff
```

#### `/checkpoint` 
Create recovery checkpoint for current work state.

```
/checkpoint "feature-complete"
```

#### `/dig`
Deep search through historical context.

```
/dig "authentication implementation"
```

### Enabling Skills

```bash
stackmemory skills:enable
```

## Worktree Support

For git worktree workflows:

```bash
# Initialize worktree support
stackmemory worktree init

# List worktree contexts
stackmemory worktree list

# Switch context
stackmemory worktree switch feature-branch
```

## Pre-commit Integration

Add to `.git/hooks/pre-commit`:

```bash
#!/bin/bash
stackmemory context add decision "$(git diff --cached)"
```

## Session Hooks

### Auto-start
Add to `~/.claude/hooks/session-start.sh`:

```bash
#!/bin/bash
stackmemory context push "claude-session-$(date +%s)"
```

### Auto-save
Add to `~/.claude/hooks/session-end.sh`:

```bash
#!/bin/bash
stackmemory context pop
```

## Clear Survival

StackMemory preserves context across `/clear` operations:

- Automatic detection of context overflow
- Compression at 70% capacity
- Full restoration after clear
- Zero context loss

## Troubleshooting

### MCP Server Not Starting
```bash
# Check if installed
stackmemory --version

# Verify MCP config
cat ~/.claude/stackmemory-mcp.json

# Test MCP server
stackmemory mcp-server
```

### Context Commands Hanging
- Fixed in v0.3.4+
- CLI commands now skip async operations
- Use `stackmemory context show` to verify

### Database Issues
- Database location: `.stackmemory/context.db`
- Check permissions: `ls -la .stackmemory/`
- Reinitialize if needed: `stackmemory init --force`