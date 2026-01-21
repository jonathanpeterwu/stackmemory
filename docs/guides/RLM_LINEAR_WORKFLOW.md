# RLM + Linear Task Workflow

## Quick Start: Using RLM for Linear Tasks

### Step 1: Sync Linear Tasks
```bash
# Pull latest tasks from Linear
npm run linear:sync

# View available tasks
stackmemory tasks list --status todo --limit 10
```

### Step 2: Pick a Task and Use RLM
```bash
# Basic format
stackmemory skills rlm "[TASK-ID] Task description from Linear"

# Real example
stackmemory skills rlm "[STA-102] Implement Two-Tier Storage System with Redis hot tier for recent traces and S3 cold tier for archival"
```

### Step 3: RLM Will Automatically:
1. **Decompose** the task into subtasks
2. **Plan** the implementation approach
3. **Execute** subtasks (currently mock mode)
4. **Review** the implementation (3 stages)
5. **Verify** quality threshold (85%+)
6. **Save** context to database

## Working Examples

### Example 1: API Endpoint Implementation
```bash
stackmemory skills rlm "Create REST API endpoint for user profile management with CRUD operations, validation, and authentication"
```

### Example 2: Bug Fix with Root Cause Analysis
```bash
stackmemory skills rlm "Debug and fix memory leak in frame manager during long sessions - investigate root cause and implement solution"
```

### Example 3: Refactoring Task
```bash
stackmemory skills rlm "Refactor Linear sync service to use GraphQL instead of REST API while maintaining backward compatibility"
```

### Example 4: Test Suite Creation
```bash
stackmemory skills rlm "Create comprehensive test suite for dual-stack manager including unit tests, integration tests, and performance benchmarks"
```

## Current Capabilities (Mock Mode)

The RLM currently operates in **mock mode** for testing, which means:
- ✅ Task decomposition works
- ✅ Planning phase executes
- ✅ Review stages run
- ✅ Quality metrics calculated
- ✅ Context persisted to database
- ⚠️ Actual code generation is simulated
- ⚠️ Subagents return mock responses

## Production Mode (Future)

To enable real AI-powered execution:

1. Set API credentials:
```bash
export ANTHROPIC_API_KEY="your-key"
```

2. Disable mock mode in code:
```typescript
// In src/integrations/claude-code/subagent-client.ts
const client = new ClaudeCodeSubagentClient(false); // false = real mode
```

## Monitoring RLM Execution

### Check Progress
```bash
# View execution status
stackmemory status

# List created frames
stackmemory context list

# View specific frame details
stackmemory context get <frame-id>
```

### Debug Mode
```bash
# Enable debug output
export DEBUG_TRACE=true
export STACKMEMORY_DEBUG=true
stackmemory skills rlm "Your task"
```

## Integration with Linear

### Complete Workflow
```bash
# 1. Morning sync
npm run linear:sync

# 2. Pick highest priority task
stackmemory tasks list --status todo --priority high

# 3. Work on it with RLM
stackmemory skills rlm "[STA-XXX] Full task description"

# 4. Review results
stackmemory status
stackmemory context list

# 5. Update Linear (when real mode enabled)
# The system will automatically update Linear task status
```

## Tips for Best Results

1. **Include Task ID**: Always prefix with [STA-XXX] for tracking
2. **Full Description**: Copy complete task description from Linear
3. **Add Constraints**: Mention specific requirements or limitations
4. **Specify Tech Stack**: Include libraries/frameworks to use
5. **Define Success**: Clear acceptance criteria

## Troubleshooting

### Common Issues

1. **"Cannot find module"**: Run `npm install` and `npm run build`
2. **"Database error"**: Check `stackmemory status`
3. **"No tasks found"**: Run `npm run linear:sync`
4. **Quality threshold not met**: Task too vague, add more details

### Test RLM System
```bash
# Run comprehensive tests
./scripts/test-rlm-comprehensive.sh

# Should see: ✨ All tests passed! (100% success rate)
```

## Summary

The RLM orchestrator transforms complex Linear tasks into manageable, quality-assured implementations through:
- Intelligent task decomposition
- Parallel execution where possible
- Multi-stage quality reviews
- Persistent context for collaboration

Use it for any Linear task that would benefit from systematic breakdown and quality assurance!