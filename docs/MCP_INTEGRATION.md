# MCP (Model Context Protocol) Integration

## Overview

StackMemory provides 20+ MCP tools for integration with Claude Code and other MCP-enabled editors.

## Setup

### Basic Configuration

Create `~/.claude/stackmemory-mcp.json`:

```json
{
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
```

### Claude Config

Update `~/.claude/config.json`:

```json
{
  "mcp": {
    "configFiles": ["~/.claude/stackmemory-mcp.json"]
  }
}
```

## Available Tools

### Context Management
| Tool | Description |
|------|-------------|
| `get_context` | Retrieve relevant context |
| `start_frame` | Begin new context frame |
| `close_frame` | Close frame with summary |
| `add_decision` | Record architectural decision |
| `add_anchor` | Pin important constraint |
| `add_observation` | Record observation |
| `add_error` | Log error with context |

### Task Management
| Tool | Description |
|------|-------------|
| `create_task` | Create new task |
| `update_task_status` | Update task status |
| `get_active_tasks` | List active tasks |
| `get_task_metrics` | Task analytics |
| `assign_task` | Assign to team member |

### Search & Retrieval
| Tool | Description |
|------|-------------|
| `smart_context` | Intelligent context retrieval |
| `search_frames` | Search frame history |
| `get_summary` | Generate work summary |
| `find_similar` | Find similar frames |

### Linear Integration
| Tool | Description |
|------|-------------|
| `linear_sync` | Sync with Linear |
| `linear_update_task` | Update Linear issue |
| `linear_get_tasks` | Get Linear tasks |
| `linear_status` | Check sync status |

### Team Collaboration
| Tool | Description |
|------|-------------|
| `handoff_create` | Create handoff document |
| `handoff_load` | Load handoff |
| `share_context` | Share with team |

## Server Options

### Development Mode
```bash
stackmemory mcp-server --dev
```

### Custom Port
```bash
stackmemory mcp-server --port 8080
```

### Verbose Logging
```bash
LOG_LEVEL=debug stackmemory mcp-server
```

## Protocol Details

### Request Format
```json
{
  "jsonrpc": "2.0",
  "method": "tools/call",
  "params": {
    "name": "get_context",
    "arguments": {
      "query": "authentication implementation"
    }
  },
  "id": 1
}
```

### Response Format
```json
{
  "jsonrpc": "2.0",
  "result": {
    "frames": [...],
    "totalTokens": 5432,
    "relevanceScore": 0.92
  },
  "id": 1
}
```

## Performance

- Tool response time: <500ms average
- Token budget: 10,000-50,000 per request
- Concurrent requests: Supported
- Connection: Local socket (fastest)

## Hosting Options

### Local (Default)
- Runs on same machine
- No network latency
- Full feature set

### Remote (Future)
- Cloud-hosted MCP server
- Multi-user support
- Central management

## Troubleshooting

### Server Not Starting
```bash
# Check installation
stackmemory --version

# Test server directly
stackmemory mcp-server --test

# Check logs
tail -f ~/.stackmemory/logs/mcp-server.log
```

### Tools Not Available
- Verify MCP config in Claude
- Restart Claude Code
- Check server is running: `ps aux | grep stackmemory`

### Performance Issues
- Reduce token budget in requests
- Enable caching: `CACHE_ENABLED=true`
- Check database size: `du -h .stackmemory/`