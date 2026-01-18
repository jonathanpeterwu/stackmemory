# RLM (Recursive Language Model) Orchestrator Usage Guide

## Overview
The RLM orchestrator is a powerful multi-agent system that decomposes complex tasks into manageable subtasks, executes them in parallel when possible, and ensures quality through multi-stage review.

## Basic Usage

### 1. Command Line Interface
```bash
# Basic usage
stackmemory skills rlm "Your task description here"

# With verbose output
stackmemory skills rlm "Your task description here" --verbose

# Examples of tasks suitable for RLM
stackmemory skills rlm "Implement a new REST API endpoint for user authentication with JWT tokens"
stackmemory skills rlm "Refactor the database connection pool to improve performance"
stackmemory skills rlm "Create comprehensive unit tests for the Linear integration"
```

### 2. Working with Linear Tasks

#### Step 1: Find a Linear Task
```bash
# List available tasks
stackmemory tasks list --status todo

# Or sync from Linear first
npm run linear:sync
stackmemory linear list --status todo
```

#### Step 2: Use RLM to Work on the Task
```bash
# Example: Working on a specific Linear task
stackmemory skills rlm "Complete STA-101: Implement Phase 4 Two-Tier Storage System with Redis hot tier and S3 cold tier"

# The RLM will:
# 1. Decompose the task into subtasks
# 2. Create a planning phase
# 3. Execute implementation in parallel where possible
# 4. Run multi-stage reviews
# 5. Ensure quality thresholds are met
```

## Example Tasks Perfect for RLM

### 1. Feature Implementation
```bash
stackmemory skills rlm "Implement a real-time notification system with WebSocket support, message queuing, and persistence"
```

### 2. Bug Fixing with Root Cause Analysis
```bash
stackmemory skills rlm "Debug and fix the memory leak in the frame manager that occurs during long-running sessions"
```

### 3. Refactoring
```bash
stackmemory skills rlm "Refactor the Linear sync service to use the GraphQL API instead of REST, maintaining backward compatibility"
```

### 4. Test Creation
```bash
stackmemory skills rlm "Create comprehensive integration tests for the dual-stack manager including edge cases and performance benchmarks"
```

### 5. Documentation
```bash
stackmemory skills rlm "Generate complete API documentation for all MCP server endpoints with examples and error responses"
```

## RLM Execution Flow

1. **Task Analysis**: RLM analyzes the complexity and requirements
2. **Decomposition**: Breaks down into subtasks with dependencies
3. **Planning**: Creates execution plan with parallel/sequential stages
4. **Execution**: Runs subagents (currently in mock mode for testing)
5. **Review**: Multi-stage review process (3 iterations)
6. **Quality Check**: Ensures 90% quality threshold
7. **Persistence**: Saves frames and context to database

## Monitoring RLM Execution

### View Progress
```bash
# Watch RLM execution in real-time
stackmemory skills rlm "Your task" --verbose

# Check saved frames after execution
stackmemory status
stackmemory context list
```

### View Execution Metrics
The RLM provides detailed metrics after execution:
- Total execution time
- Token usage (estimated)
- Cost estimation
- Quality scores
- Number of review iterations

## Advanced Usage

### 1. Complex Multi-Phase Tasks
```bash
# RLM excels at complex, multi-phase tasks
stackmemory skills rlm "
Phase 1: Analyze current authentication system
Phase 2: Design OAuth2 integration with multiple providers
Phase 3: Implement with proper error handling and rate limiting
Phase 4: Add comprehensive tests and documentation
"
```

### 2. Integration with Linear
```bash
# First, get task details
stackmemory tasks list --limit 10

# Then use RLM with the full task context
stackmemory skills rlm "Work on [STA-XXX]: [Full task description from Linear]"
```

### 3. Collaborative Features
The RLM creates frames that can be:
- Shared across sessions
- Handed off to other developers
- Reviewed and improved iteratively

## Testing RLM Functionality

Run the comprehensive test suite:
```bash
# Basic tests
./scripts/test-rlm-basic.sh

# Comprehensive tests (23 test cases)
./scripts/test-rlm-comprehensive.sh

# End-to-end tests
./scripts/test-rlm-e2e.sh
```

## Current Limitations

1. **Mock Mode**: Currently uses mock subagent responses for testing
2. **No Real AI**: Actual Claude API integration pending
3. **Limited Parallelism**: Sequential execution in mock mode

## Next Steps for Production

To use RLM in production with real AI agents:

1. Set up Claude API credentials:
   ```bash
   export ANTHROPIC_API_KEY="your-api-key"
   ```

2. Configure subagent endpoints in `src/integrations/claude-code/subagent-client.ts`

3. Disable mock mode:
   ```typescript
   const client = new ClaudeCodeSubagentClient(false); // false = real mode
   ```

## Tips for Best Results

1. **Be Specific**: Provide detailed task descriptions
2. **Include Context**: Mention relevant files, dependencies, or constraints
3. **Set Goals**: Clearly state what success looks like
4. **Use Examples**: Provide examples of expected input/output

## Example: Complete Workflow

```bash
# 1. Sync with Linear
npm run linear:sync

# 2. Find a task
stackmemory tasks list --status todo

# 3. Pick a task (e.g., STA-102)
# Let's say it's "Implement rate limiting for API endpoints"

# 4. Use RLM to work on it
stackmemory skills rlm "
Implement rate limiting for API endpoints (STA-102):
- Use Redis for distributed rate limiting
- Implement sliding window algorithm
- Add configurable limits per endpoint
- Include bypass for admin users
- Add monitoring and alerting
- Create unit and integration tests
"

# 5. Monitor execution
# Watch the output for progress updates

# 6. Review results
stackmemory status
stackmemory context list

# 7. Update Linear
npm run linear:sync
```

## Troubleshooting

### If RLM fails to execute:
1. Check database connection: `stackmemory status`
2. Verify environment: `npm run test:run`
3. Check logs: `stackmemory log --tail 50`

### For debugging:
```bash
# Enable debug mode
export DEBUG_TRACE=true
export STACKMEMORY_DEBUG=true
stackmemory skills rlm "Your task"
```

## Summary

The RLM orchestrator is designed to handle complex software engineering tasks by:
- Breaking them down intelligently
- Executing subtasks efficiently
- Ensuring high quality through reviews
- Persisting context for collaboration

Use it for any task that would benefit from systematic decomposition and quality assurance.