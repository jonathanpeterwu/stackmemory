# StackMemory Setup Guide

## Quick Installation

```bash
# Install globally
npm install -g @stackmemoryai/stackmemory@latest

# Initialize in project
stackmemory init
```

## MCP Integration (Claude Code)

Create `~/.claude/stackmemory-mcp.json`:

```json
{
  "mcpServers": {
    "stackmemory": {
      "command": "stackmemory",
      "args": ["mcp-server"],
      "env": { 
        "NODE_ENV": "production"
      }
    }
  }
}
```

## Railway Deployment

```bash
# Add PostgreSQL + Redis
railway add postgresql redis

# Deploy
railway up

# Set environment variables
railway variables set LINEAR_API_KEY=your_key
railway variables set REDIS_URL=redis://...
```

## Linear Integration

```bash
# Setup OAuth
stackmemory linear:auth

# Sync tasks
stackmemory linear:sync
```

## Browser Testing

```bash
# Setup browser MCP
stackmemory browser:setup

# Test page
stackmemory browser:test "https://example.com"
```

## Common Commands

```bash
stackmemory status          # Project status
stackmemory context list    # List saved contexts
stackmemory monitor start   # Start monitoring
stackmemory clear           # Clear session (with survival)
```

## Troubleshooting

- **MCP not working:** Check `~/.claude/logs/mcp.log`
- **Railway deployment fails:** Check environment variables
- **Linear sync issues:** Verify API key and permissions
- **Memory issues:** Run `stackmemory gc` to clean up

See individual guides in `/docs/guides/` for detailed instructions.