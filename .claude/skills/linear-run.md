# Linear Task Runner Skill

## Description
Execute Linear tasks using the RLM (Recursive Language Model) orchestrator.
Pulls tasks from Linear, decomposes via subagents, executes, and updates status.

## Usage

### Run next task
```
/linear-run next
/linear-run next --priority high
/linear-run next --tag backend
```

### Run all tasks
```
/linear-run all
/linear-run all --dry-run
/linear-run all --maxConcurrent 3
```

### Run specific task
```
/linear-run task STA-123
/linear-run task <task-id>
```

### Preview execution plan
```
/linear-run preview
/linear-run preview STA-123
```

## Execution Flow

1. Fetch todo tasks from Linear (sorted by priority)
2. Mark task as `in_progress`
3. RLM Orchestrator decomposes task into subagent tree
   - Planning agent breaks down the work
   - Code/Test/Review subagents execute in parallel
   - Multi-stage quality review
4. On success: mark task `done`, sync to Linear
5. On failure: leave as `in_progress`, log error
6. If PROMPT_PLAN exists, auto-check completed items

## Options
- `--priority <level>` — Filter tasks: urgent, high, medium, low
- `--tag <tag>` — Filter tasks by tag
- `--dry-run` — Show plan without executing
- `--maxConcurrent <n>` — Parallel task limit (default: 1, sequential)

## Integration
- **Linear**: Reads tasks, updates status, syncs changes
- **RLM Orchestrator**: Decomposes and executes via Claude Code subagents
- **Spec Generator**: Auto-updates PROMPT_PLAN checkboxes on completion

## CLI Equivalent
```bash
stackmemory ralph linear next
stackmemory ralph linear all
stackmemory ralph linear preview STA-123
```
