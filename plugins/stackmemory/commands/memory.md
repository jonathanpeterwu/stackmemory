---
description: "Store a memory for session context"
argument-hint: "<memory> [--type <observation|pattern|preference>]"
allowed-tools: ["Bash(stackmemory memory:*)"]
---

# StackMemory Memory

Store a memory for session context:

```!
stackmemory memory add $ARGUMENTS
```

Memory types:
- `observation` - Something noticed during work
- `pattern` - A recurring pattern identified
- `preference` - A user or project preference

Examples:
- `stackmemory memory add "User prefers concise responses"`
- `stackmemory memory add "Tests run slowly on this machine" --type observation`

To list memories:
```!
stackmemory memory list
```
