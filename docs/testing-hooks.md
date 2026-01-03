# Testing StackMemory Hooks & Persistence

## Quick Test

Run the automated test script:
```bash
./scripts/test-hooks-persistence.sh
```

## Manual Testing

### 1. Test Clear Hook (Context Preservation)
```bash
# Add some context
stackmemory context add "Working on feature X" --type task

# Trigger clear (simulates Claude clear)
~/.claude/hooks/on-clear

# Verify context survived
stackmemory context list --limit 5
```

### 2. Test Task Completion Hook
```bash
# Simulate task completion
export CLAUDE_TASK_SUMMARY="Implemented new API endpoint"
export CLAUDE_TASK_STATUS="completed"
~/.claude/hooks/on-task-complete

# Check if recorded
stackmemory context list --type task
```

### 3. Test Quality Gate
```bash
# Create a file with issues
echo 'console.log("debug");' > test.js

# Test quality check
export CLAUDE_ACTION="commit"
export CLAUDE_FILES="test.js"
~/.claude/hooks/on-action-blocked

# Should show quality warnings
```

### 4. Test Monitoring
```bash
# Start monitoring
stackmemory monitor start

# Do some work (add context)
stackmemory context add "Debug session" --type debug

# Check monitoring captured it
stackmemory monitor status
```

### 5. Test Shared Context Persistence
```bash
# Check shared context file
cat ~/.stackmemory/data/shared-context.json | jq '.frames | length'

# Add through CLI
stackmemory context add "Shared knowledge" --tags important,shared

# Verify in shared context
cat ~/.stackmemory/data/shared-context.json | jq '.frames[-1]'
```

### 6. Test Handoff Generation
```bash
# Generate handoff after some work
stackmemory context handoff

# Should show summary of recent work
```

## Verification Points

### Check Persistence Locations

**Global Data:**
```bash
ls -la ~/.stackmemory/data/
# Should see: shared-context.json, frames/, monitoring.json
```

**Project Context:**
```bash
ls -la ./.stackmemory/context/
# Should see: project-context.json, branch contexts
```

### Inspect Frame Data
```bash
# List all frames
stackmemory context list --json | jq '.frames[].type' | sort | uniq -c

# Show specific frame
stackmemory context show <frame-id> --json | jq
```

### Monitor Hook Activity
```bash
# Check hook logs
tail -f ~/.stackmemory/logs/hooks.log

# Watch daemon activity
stackmemory-daemon status --watch
```

## Expected Behavior

1. **on-clear**: Should preserve important context with 'clear_survival' tag
2. **on-task-complete**: Should create task frame with completion details
3. **on-action-blocked**: Should validate quality and potentially block
4. **Monitoring**: Should auto-checkpoint every 15 minutes
5. **Shared Context**: Should persist across sessions and branches
6. **Handoff**: Should generate useful summary for next session

## Troubleshooting

### Hooks Not Firing
```bash
# Check hooks are installed
ls -la ~/.claude/hooks/

# Verify executable
chmod +x ~/.claude/hooks/*

# Test directly
~/.claude/hooks/on-clear
```

### Data Not Persisting
```bash
# Check daemon is running
stackmemory-daemon status

# Restart if needed
stackmemory-daemon restart

# Check permissions
ls -la ~/.stackmemory/data/
```

### Context Not Loading
```bash
# Force reload
stackmemory context sync

# Check shared context
stackmemory context list --shared

# Rebuild index
stackmemory context reindex
```

## Integration with Claude Code

The hooks integrate with Claude Code's lifecycle:

1. **Session Start**: Auto-loads context via STACKMEMORY.md
2. **During Work**: Monitors and checkpoints progress
3. **Task Complete**: Records completion via hook
4. **Clear Command**: Preserves context via on-clear
5. **Session End**: Generates handoff for next session

Test in Claude Code by:
1. Starting a new session - should load context
2. Working on tasks - should track progress
3. Using /clear - should preserve important context
4. Completing tasks - should record achievements