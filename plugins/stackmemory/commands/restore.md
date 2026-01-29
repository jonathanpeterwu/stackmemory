---
description: "Restore context from last session handoff"
allowed-tools: ["Bash(stackmemory restore:*)"]
---

# StackMemory Restore

Restore context from the last captured handoff:

```!
stackmemory restore
```

This will:
1. Load the last handoff document
2. Display the session context
3. Show any uncommitted changes
4. Copy the prompt to clipboard (unless --no-copy)

Use this at the start of a new session to resume where you left off.
