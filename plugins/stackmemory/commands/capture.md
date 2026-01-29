---
description: "Capture current work state for session handoff"
argument-hint: "[--no-commit] [--copy] [--basic]"
allowed-tools: ["Bash(stackmemory capture:*)"]
---

# StackMemory Capture

Capture the current work state for handoff to a future session:

```!
stackmemory capture $ARGUMENTS
```

Options:
- `--no-commit` - Skip git commit
- `--copy` - Copy handoff prompt to clipboard
- `--basic` - Use basic format instead of enhanced

The capture includes:
- Active context frames
- Recent decisions
- Git status and last commit
- In-progress tasks
