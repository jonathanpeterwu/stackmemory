---
description: "Record a key decision for session context"
argument-hint: "<decision> [--reason <why>]"
allowed-tools: ["Bash(stackmemory decision:*)"]
---

# StackMemory Decision

Record a key decision for session context and future handoffs:

```!
stackmemory decision add $ARGUMENTS
```

Examples:
- `stackmemory decision add "Use PostgreSQL for persistence"`
- `stackmemory decision add "Switch to ESM modules" --reason "Better tree shaking"`

Decisions are captured in handoffs and help future sessions understand context.

To list decisions:
```!
stackmemory decision list
```
