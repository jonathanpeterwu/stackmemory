---
description: "Manage context frames and stack"
argument-hint: "<subcommand> [args]"
allowed-tools: ["Bash(stackmemory context:*)", "Bash(stackmemory ctx:*)"]
---

# StackMemory Context

Manage the context stack:

## View current context
```!
stackmemory context show
```

## Load recent context
```!
stackmemory context load --recent
```

## Add context observation
```!
stackmemory context add observation "User is working on auth feature"
```

## Add context decision
```!
stackmemory context add decision "Use JWT for authentication"
```

## Clear context (with preservation)
```!
stackmemory context clear --save
```

Subcommands:
- `show` - Display current context stack
- `load` - Load context from storage
- `add` - Add observation or decision
- `clear` - Clear context with optional ledger save
