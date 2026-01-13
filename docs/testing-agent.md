# Testing Agent

The Testing Agent is a sophisticated automated test generation and execution system for StackMemory. It analyzes code to generate comprehensive test suites, including unit tests, integration tests, edge case tests, and performance benchmarks.

## Features

### 🔍 Code Analysis
- **AST Parsing**: Uses TypeScript compiler API to understand code structure
- **Function Detection**: Automatically identifies functions, classes, and methods
- **Type Analysis**: Infers parameter types and return types for better test generation
- **Dependency Mapping**: Tracks external dependencies and module interactions

### 🧪 Test Generation
- **Unit Tests**: Generate tests for individual functions and classes
- **Integration Tests**: Test module interactions and API endpoints
- **Edge Case Tests**: Comprehensive boundary value and error condition testing
- **Performance Benchmarks**: Automated performance testing with metrics

### 📊 Coverage Analysis
- **Real-time Coverage**: Analyze existing test coverage from vitest reports
- **Gap Detection**: Identify uncovered lines, branches, and functions
- **Coverage Improvement**: Generate tests specifically for uncovered code
- **Threshold Enforcement**: Fail builds when coverage falls below thresholds

### 🎯 Mock and Fixture Generation
- **Smart Mocking**: Generate mocks based on schema analysis
- **Test Fixtures**: Create realistic test data for components
- **Data Factories**: Generate multiple mock instances with variations
- **Type-safe Mocks**: Ensure generated mocks match TypeScript interfaces

## CLI Commands

### Generate Tests

```bash
# Generate unit tests for a file
stackmemory test generate src/core/frame-manager.ts

# Generate integration tests for a module
stackmemory test generate src/integrations/linear --type integration

# Generate with edge cases
stackmemory test generate src/utils/parser.ts --edge-cases

# Preview tests without saving
stackmemory test generate src/api/routes.ts --dry-run
```

### Coverage Analysis

```bash
# Analyze current coverage
stackmemory test coverage

# Generate tests for uncovered code
stackmemory test coverage --generate-missing

# Set custom threshold
stackmemory test coverage --threshold 90

# Target specific file
stackmemory test coverage --target src/core/
```

### Run Tests

```bash
# Run all tests
stackmemory test run

# Run specific pattern
stackmemory test run "**/*.integration.test.ts"

# Run with coverage
stackmemory test run --coverage

# Watch mode
stackmemory test run --watch
```

### Performance Benchmarking

```bash
# Benchmark a function
stackmemory test benchmark src/core/parser.ts --function parseQuery

# Set performance threshold
stackmemory test benchmark src/utils/hash.ts --threshold 10ms

# Multiple iterations
stackmemory test benchmark src/crypto/encrypt.ts --iterations 10000
```

### Mock Generation

```bash
# Generate mocks from schema
stackmemory test mock schemas/user.json --count 5

# Save to file
stackmemory test mock schemas/api.json --output mocks/api-data.json
```

### Create Fixtures

```bash
# Create fixtures for component
stackmemory test fixtures UserComponent --output src/__fixtures__
```

## Configuration

The Testing Agent respects your existing Vitest configuration in `vitest.config.ts`:

```typescript
// vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    coverage: {
      provider: 'v8',
      thresholds: {
        statements: 80,
        branches: 80,
        functions: 80,
        lines: 80,
      },
    },
  },
});
```

## Test Generation Examples

### Unit Test Example

**Input**: `src/utils/validator.ts`
```typescript
export function validateEmail(email: string): boolean {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  return emailRegex.test(email);
}

export class UserValidator {
  validateUser(user: { name: string; email: string }): boolean {
    return user.name.length > 0 && this.validateEmail(user.email);
  }
}
```

**Generated**: `src/__tests__/utils/validator.test.ts`
```typescript
import { describe, it, expect } from 'vitest';
import { validateEmail, UserValidator } from '../../utils/validator.js';

describe('validator', () => {
  it('should execute validateEmail successfully with valid input', () => {
    // Arrange
    const email = 'test@example.com';

    // Act
    const result = validateEmail(email);

    // Assert
    expect(result).toBe(true);
  });

  it('should handle invalid email format', () => {
    // Arrange
    const email = 'invalid-email';

    // Act
    const result = validateEmail(email);

    // Assert
    expect(result).toBe(false);
  });

  it('should create instance of UserValidator', () => {
    // Act
    const instance = new UserValidator();

    // Assert
    expect(instance).toBeInstanceOf(UserValidator);
  });

  it('should validate complete user object', () => {
    // Arrange
    const instance = new UserValidator();
    const user = { name: 'John Doe', email: 'john@example.com' };

    // Act
    const result = instance.validateUser(user);

    // Assert
    expect(result).toBe(true);
  });
});
```

### Integration Test Example

**Generated**: `src/__tests__/integration/api.integration.test.ts`
```typescript
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import { app } from '../../api/server.js';

describe('API Integration', () => {
  beforeEach(() => {
    // Setup integration test environment
  });

  afterEach(() => {
    // Cleanup integration test environment
  });

  it('should handle user registration flow', async () => {
    // Arrange
    const userData = {
      name: 'Test User',
      email: 'test@example.com',
      password: 'securepass'
    };

    // Act
    const response = await request(app)
      .post('/api/users/register')
      .send(userData);

    // Assert
    expect(response.status).toBe(201);
    expect(response.body.user.email).toBe(userData.email);
  });
});
```

### Performance Benchmark Example

**Generated**: `src/__tests__/benchmarks/parser.bench.ts`
```typescript
import { bench, describe } from 'vitest';
import { parseQuery } from '../../utils/parser.js';

describe('parseQuery performance', () => {
  bench('parseQuery execution time', () => {
    parseQuery('SELECT * FROM users WHERE id = 1');
  });

  bench('complex query parsing', () => {
    parseQuery(`
      SELECT u.id, u.name, p.title 
      FROM users u 
      JOIN posts p ON u.id = p.user_id 
      WHERE u.created_at > '2023-01-01'
    `);
  });
});
```

## Advanced Features

### Smart Type Detection

The Testing Agent analyzes TypeScript types to generate appropriate test data:

```typescript
// Detected: (user: User, options?: { strict: boolean }) => Promise<ValidationResult>
function validateUser(user: User, options?: { strict: boolean }): Promise<ValidationResult> {
  // implementation
}

// Generated test automatically creates:
const user = { id: 1, name: 'Test User', email: 'test@example.com' };
const options = { strict: true };
const result = await validateUser(user, options);
```

### Error Handling Detection

Automatically generates tests for try-catch blocks and error conditions:

```typescript
async function processData(data: unknown): Promise<ProcessedData> {
  try {
    return await transformData(data);
  } catch (error) {
    logger.error('Processing failed', { error });
    throw new ProcessingError('Failed to process data');
  }
}

// Generates tests for:
// - Normal execution
// - Error conditions
// - Error type verification
```

### Mock Generation

Creates intelligent mocks based on interface analysis:

```typescript
interface ApiResponse<T> {
  data: T;
  status: number;
  message: string;
}

// Generates:
export const mockApiResponse = {
  data: { id: 1, name: 'Mock Data' },
  status: 200,
  message: 'Success'
};
```

## Integration with RLM Orchestrator

The Testing Agent integrates with the RLM (Recursive Language Model) orchestrator as a specialized agent type:

```typescript
// Agent registration
const testingAgent = new TestingAgent(projectRoot);
const agentManager = new AgentTaskManager(taskStore, frameManager);

// Task creation for test generation
const task = await taskStore.createTask({
  type: 'agent',
  agentType: AgentType.TESTING,
  title: 'Generate tests for FrameManager',
  description: 'Create comprehensive test suite',
  metadata: {
    targetPath: 'src/core/context/frame-manager.ts',
    testType: 'unit',
    includeEdgeCases: true
  }
});
```

## Quality Assurance

### Generated Test Quality
- **Readable**: Clear test names and descriptions
- **Maintainable**: Follows AAA pattern (Arrange, Act, Assert)
- **Comprehensive**: Covers happy path, edge cases, and errors
- **Deterministic**: No flaky tests or random dependencies

### Best Practices
- Uses proper setup/teardown for database tests
- Mocks external dependencies appropriately
- Tests both success and failure scenarios
- Includes performance considerations

### Coverage Goals
- **Statements**: 80%+ coverage target
- **Branches**: All conditional paths tested
- **Functions**: Every exported function tested
- **Lines**: Critical business logic covered

## Examples in StackMemory

The Testing Agent has generated comprehensive test suites for:

1. **FrameManager**: Unit tests with database setup/teardown
2. **Linear Integration**: Integration tests with API mocking
3. **Performance Benchmarks**: Memory and execution time tests

These examples demonstrate the agent's capability to:
- Handle complex database interactions
- Mock external API dependencies
- Generate realistic test data
- Create performance baselines

## Future Enhancements

- **AI-Powered Test Cases**: Use LLM to generate more sophisticated test scenarios
- **Visual Testing**: Screenshot and UI component testing
- **Mutation Testing**: Verify test quality by introducing code mutations
- **Continuous Testing**: Integrate with CI/CD for automatic test generation
- **Cross-Platform Testing**: Browser and Node.js environment support