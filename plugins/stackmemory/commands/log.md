---
description: "View recent activity log"
argument-hint: "[--limit N] [--type <type>]"
allowed-tools: ["Bash(stackmemory log:*)", "Bash(stackmemory history:*)"]
---

# StackMemory Log

View recent activity:

## Recent activity (default 10 items)
```!
stackmemory log recent
```

## More items
```!
stackmemory log recent --limit 20
```

## Filter by type
```!
stackmemory log recent --type decision
```

Types:
- `decision` - Recorded decisions
- `observation` - Observations
- `task` - Task changes
- `context` - Context operations
