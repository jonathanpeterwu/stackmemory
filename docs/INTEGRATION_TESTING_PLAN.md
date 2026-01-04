# Integration Testing Strategy for StackMemory

## Current State Analysis

### Existing Coverage
- **Unit Tests**: 565 passing tests (mostly mocked)
- **Integration Tests**: 2 basic files (cli & database)
- **Gap**: No real end-to-end workflows, cross-component testing, or performance validation

### Key Components Requiring Integration Testing
1. **Database Layer**: SQLite, ParadeDB adapters, connection pooling, migrations
2. **Context System**: FrameManager, SharedContextLayer, DualStackManager, ContextBridge
3. **CLI Commands**: init, status, clear, monitor, quality, workflow, handoff
4. **Retrieval System**: ContextRetriever, semantic search, pattern detection
5. **Session Management**: ClearSurvival, HandoffGenerator, monitoring
6. **Storage Tiers**: Hot/warm/cold migration, Railway/GCS integration

## Comprehensive Integration Test Structure

```
src/__tests__/integration/
├── e2e/                      # End-to-end workflows
│   ├── full-session.test.ts
│   ├── context-lifecycle.test.ts
│   ├── clear-survival.test.ts
│   └── handoff-workflow.test.ts
├── database/                 # Database layer tests
│   ├── multi-adapter.test.ts
│   ├── migration-scenarios.test.ts
│   ├── connection-pooling.test.ts
│   └── query-routing.test.ts
├── context/                  # Context system tests
│   ├── frame-operations.test.ts
│   ├── shared-context.test.ts
│   ├── dual-stack.test.ts
│   └── context-bridge.test.ts
├── cli/                      # CLI command tests
│   ├── workflow-commands.test.ts
│   ├── monitor-operations.test.ts
│   ├── quality-gates.test.ts
│   └── hooks-integration.test.ts
├── retrieval/                # Search & retrieval tests
│   ├── semantic-search.test.ts
│   ├── pattern-detection.test.ts
│   └── context-ranking.test.ts
├── performance/              # Performance tests
│   ├── load-testing.test.ts
│   ├── memory-usage.test.ts
│   └── query-performance.test.ts
├── fixtures/                 # Test data & utilities
│   ├── test-data-generator.ts
│   ├── database-fixtures.ts
│   ├── context-fixtures.ts
│   └── cli-helpers.ts
└── helpers/                  # Test utilities
    ├── test-environment.ts
    ├── database-setup.ts
    └── async-helpers.ts
```

## Test Scenarios

### 1. End-to-End Workflows

#### Full Session Lifecycle
```typescript
describe('Full Session Lifecycle', () => {
  // Initialize project → Start session → Create frames → 
  // Save context → Clear → Restore → Handoff
})
```

#### Context Persistence Across Clears
```typescript
describe('Context Survival', () => {
  // Create context → Trigger clear → Verify survival →
  // Restore context → Continue work
})
```

#### Multi-Session Collaboration
```typescript
describe('Shared Context', () => {
  // Session A creates context → Session B reads →
  // Concurrent updates → Conflict resolution
})
```

### 2. Database Integration

#### Multi-Adapter Operations
```typescript
describe('Database Adapter Coordination', () => {
  // SQLite for hot data → ParadeDB for analytics →
  // Migration between tiers → Query routing
})
```

#### Connection Pool Under Load
```typescript
describe('Connection Pool Stress', () => {
  // Max connections → Queue management →
  // Timeout handling → Recovery
})
```

### 3. CLI Workflow Testing

#### Complete Workflow Execution
```typescript
describe('TDD Workflow', () => {
  // Start workflow → Write tests → Implement →
  // Refactor → Complete → Verify artifacts
})
```

#### Hook Integration
```typescript
describe('Claude Code Hooks', () => {
  // Pre-clear hook → Post-task hook →
  // Quality gates → Auto-triggers
})
```

### 4. Performance Testing

#### Load Testing
```typescript
describe('System Under Load', () => {
  // 1000 concurrent frames → 100 searches/sec →
  // Memory usage → Response times
})
```

#### Large Dataset Handling
```typescript
describe('Scale Testing', () => {
  // 100K frames → Complex queries →
  // Pagination → Memory efficiency
})
```

## Implementation Plan

### Phase 1: Foundation (Week 1)
- [ ] Set up test environment with real databases
- [ ] Create test data generators
- [ ] Build helper utilities
- [ ] Implement basic e2e tests

### Phase 2: Core Integration (Week 2)
- [ ] Database adapter coordination tests
- [ ] Context system integration tests
- [ ] CLI workflow tests
- [ ] Retrieval system tests

### Phase 3: Advanced Scenarios (Week 3)
- [ ] Performance & load testing
- [ ] Error recovery scenarios
- [ ] Edge cases & failure modes
- [ ] Security & permissions testing

### Phase 4: Continuous Integration (Week 4)
- [ ] CI/CD pipeline integration
- [ ] Test reporting & metrics
- [ ] Documentation
- [ ] Maintenance procedures

## Test Data Strategy

### Fixtures
```typescript
// Realistic test data generators
export const generateTestFrames = (count: number) => {
  // Generate diverse frame types with relationships
}

export const generateTestProject = () => {
  // Complete project structure with history
}
```

### Database Seeding
```typescript
export const seedDatabase = async (adapter: DatabaseAdapter) => {
  // Populate with realistic data volumes
  // Include edge cases & problematic data
}
```

## Success Metrics

### Coverage Goals
- **Line Coverage**: >80% for critical paths
- **Branch Coverage**: >70% overall
- **Integration Coverage**: 100% of user workflows

### Performance Baselines
- **Frame Creation**: <10ms per frame
- **Search Queries**: <100ms for 10K frames
- **Context Retrieval**: <50ms average
- **CLI Commands**: <500ms response time

### Reliability Targets
- **Test Stability**: <1% flakiness rate
- **CI Runtime**: <5 minutes for integration suite
- **Error Recovery**: 100% graceful degradation

## Testing Best Practices

### Test Isolation
- Each test gets fresh database
- No shared state between tests
- Proper cleanup in afterEach

### Realistic Scenarios
- Use production-like data volumes
- Simulate real user workflows
- Test error conditions

### Performance Awareness
- Measure & baseline performance
- Detect regressions early
- Profile memory usage

### Documentation
- Clear test descriptions
- Document complex scenarios
- Maintain test data catalog

## Next Steps

1. **Immediate**: Create test environment setup script
2. **Today**: Implement first e2e workflow test
3. **This Week**: Build core integration test suite
4. **Ongoing**: Expand coverage with each feature

## Example Implementation

```typescript
// src/__tests__/integration/e2e/full-session.test.ts
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TestEnvironment } from '../helpers/test-environment';
import { generateTestProject } from '../fixtures/test-data-generator';

describe('Full Session Lifecycle', () => {
  let env: TestEnvironment;

  beforeEach(async () => {
    env = await TestEnvironment.create();
    await env.initializeProject();
  });

  afterEach(async () => {
    await env.cleanup();
  });

  it('should handle complete development session', async () => {
    // Initialize
    const project = await env.createProject('test-app');
    
    // Start session
    const session = await env.startSession();
    
    // Create frames
    const frames = await session.recordActivity([
      { type: 'file_edit', file: 'app.ts' },
      { type: 'test_run', status: 'pass' },
      { type: 'commit', message: 'Add feature' }
    ]);
    
    // Save context
    const context = await session.saveContext();
    expect(context.frames).toHaveLength(3);
    
    // Simulate clear
    await env.simulateClear();
    
    // Restore and verify
    const restored = await env.restoreContext();
    expect(restored.frames).toEqual(context.frames);
    
    // Generate handoff
    const handoff = await session.generateHandoff();
    expect(handoff).toContain('## Session Summary');
    expect(handoff).toContain('Add feature');
  });
});
```

This plan provides a comprehensive roadmap for building robust integration tests that validate real-world usage patterns and ensure system reliability.