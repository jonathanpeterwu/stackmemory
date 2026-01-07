# Linear Integration

## Overview

StackMemory provides bidirectional synchronization with Linear for task management.

## Setup

### OAuth Authentication

```bash
# Start OAuth flow
stackmemory linear:auth

# This will:
# 1. Start local OAuth server on port 3000
# 2. Open browser for Linear authorization
# 3. Save tokens to .stackmemory/linear-tokens.json
```

### Configuration

Configure in `.stackmemory/linear-config.json`:

```json
{
  "teamId": "YOUR_TEAM_ID",
  "projectId": "YOUR_PROJECT_ID",
  "autoSync": true,
  "syncInterval": 300000,
  "labelPrefix": "STA-"
}
```

## Usage

### Manual Sync

```bash
# Sync all tasks
stackmemory linear:sync

# Sync specific task
stackmemory linear:sync --task STA-123
```

### Auto-Sync

```bash
# Enable auto-sync
stackmemory linear:auto-sync enable

# Check status
stackmemory linear:status
```

### Task Operations

```bash
# List Linear tasks
stackmemory linear:list

# Create task in Linear
stackmemory linear:create "Task title" --priority high

# Update task
stackmemory linear:update STA-123 --status completed
```

## MCP Tools

Available in Claude Code:

- `linear_sync` - Sync with Linear
- `linear_update_task` - Update Linear issue  
- `linear_get_tasks` - Get tasks from Linear
- `linear_status` - Check sync status

## Architecture

### Sync Engine
- Bidirectional sync every 5 minutes
- Conflict resolution (Linear wins)
- Incremental updates only
- Cached for performance

### Data Mapping

```
StackMemory Task ←→ Linear Issue
- title ←→ title
- status ←→ state
- priority ←→ priority
- description ←→ description
- id ←→ identifier
```

### Storage
- Mappings: `.stackmemory/linear-mappings.json`
- Tokens: `.stackmemory/linear-tokens.json`
- Config: `.stackmemory/linear-config.json`

## Webhook Support

For real-time updates, configure Linear webhook:

1. Go to Linear Settings → API → Webhooks
2. Add webhook URL: `https://your-domain/webhook/linear`
3. Select events: Issue created, updated, deleted

## Troubleshooting

### Auth Issues
```bash
# Re-authenticate
stackmemory linear:auth --force

# Check token validity
stackmemory linear:status --verbose
```

### Sync Issues
```bash
# Clear cache and resync
rm .stackmemory/linear-mappings.json
stackmemory linear:sync --full

# Check sync logs
tail -f .stackmemory/logs/linear-sync.log
```

## Metrics

- Sync latency: <2 seconds average
- Success rate: 99%+
- Tasks synced: 1000+ per day typical