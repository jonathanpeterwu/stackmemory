# Testing Documentation

## Test Suite Overview

StackMemory uses Vitest for testing with 421 passing tests across 26 test files.

## Running Tests

```bash
# Run all tests
npm test

# Run without watching
npm run test:run

# Run specific test file
npm test frame-manager

# Run with coverage
npm run test:coverage
```

## Test Structure

```
src/
├── core/
│   ├── __tests__/         # Core functionality tests
│   ├── context/__tests__/  # Context management tests
│   └── frame/__tests__/    # Frame manager tests
├── features/
│   └── tasks/__tests__/    # Task management tests
└── integrations/
    └── linear/__tests__/   # Linear integration tests
```

## Performance Testing

### Real Performance Metrics

Test script location: `scripts/testing/real-performance-test.js`

#### Measured Operations
- Task listing: 502-530ms
- Task creation: 500-522ms  
- Context commands: ~400ms
- Database operations: ~500ms

#### Storage Metrics
- Database size: 588KB typical
- Task storage: 214KB for ~250 tasks
- Frame depth: 10,000+ supported

### Running Performance Tests

```bash
# Run performance test
node scripts/testing/real-performance-test.js

# Results saved to
test-results/real-performance-results.json
```

## Integration Testing

### Database Tests
- SQLite adapter with connection pooling
- Schema migrations and versioning
- Transaction handling

### Linear Integration Tests
- OAuth authentication flow
- Bidirectional sync operations
- Webhook handling

### MCP Server Tests
- Tool registration and execution
- Context retrieval operations
- Frame lifecycle management

## Testing Hooks

Location: `docs/testing-hooks.md`

Hooks for Claude Code integration testing:
- Pre-commit validation
- Post-task completion checks
- Session lifecycle hooks

## Test Coverage

Current coverage targets:
- Statements: >80%
- Branches: >75%
- Functions: >80%
- Lines: >80%

## Common Test Patterns

### Frame Testing
```javascript
const frame = frameManager.startFrame({
  type: 'task',
  name: 'test-frame'
});
// Test frame operations
frameManager.closeFrame(frame.frameId);
```

### Task Testing
```javascript
const task = await taskStore.createTask({
  title: 'Test task',
  priority: 'medium'
});
// Test task operations
await taskStore.updateTaskStatus(task.id, 'completed');
```

### Context Testing
```javascript
const context = await retriever.getRelevantContext(
  'test query',
  10000 // token budget
);
// Verify context relevance
```