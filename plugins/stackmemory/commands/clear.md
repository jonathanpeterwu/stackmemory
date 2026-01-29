---
description: "Clear context with ledger preservation"
argument-hint: "[--save] [--restore] [--check]"
allowed-tools: ["Bash(stackmemory clear:*)"]
---

# StackMemory Clear

Manage context clearing with ledger preservation:

## Check context usage
```!
stackmemory clear --check
```

## Save to ledger before clearing
```!
stackmemory clear --save
```

## Restore from ledger
```!
stackmemory clear --restore
```

The ledger system preserves important context across /clear operations,
allowing continuity between conversation resets.
