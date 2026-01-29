---
description: "View recent activity log"
argument-hint: "[-n N] [--type <type>]"
allowed-tools: ["Bash(stackmemory log:*)", "Bash(stackmemory history:*)"]
---

# StackMemory Log

View recent activity:

## Recent activity (default 20 items)
```!
stackmemory log
```

## More items
```!
stackmemory log -n 50
```

## Filter by type
```!
stackmemory log --type task
```

## Follow in real-time
```!
stackmemory log --follow
```

Types:
- `task` - Task changes
- `frame` - Frame operations
- `event` - Events
- `sync` - Sync operations
