---
description: "Manage tasks from StackMemory"
argument-hint: "<subcommand> [args]"
allowed-tools: ["Bash(stackmemory tasks:*)", "Bash(stackmemory task:*)"]
---

# StackMemory Tasks

Manage tasks:

## List tasks
```!
stackmemory tasks list
```

## List by state
```!
stackmemory tasks list --state in_progress
```

## Add a task
```!
stackmemory tasks add "Implement user authentication"
```

## Update task status
```!
stackmemory tasks update <id> --status completed
```

## Sync with Linear (if configured)
```!
stackmemory linear sync
```

Subcommands:
- `list` - List tasks (--state pending|in_progress|completed)
- `add` - Add a new task
- `update` - Update task status
- `show` - Show task details
