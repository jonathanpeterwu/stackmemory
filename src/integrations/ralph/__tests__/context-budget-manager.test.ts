/**
 * Tests for Context Budget Manager
 */

import { ContextBudgetManager } from '../context/context-budget-manager.js';
import { IterationContext, TaskContext, HistoryContext, EnvironmentContext, MemoryContext } from '../types.js';

describe('ContextBudgetManager', () => {
  let manager: ContextBudgetManager;

  beforeEach(() => {
    manager = new ContextBudgetManager({
      maxTokens: 1000,
      compressionEnabled: true,
      adaptiveBudgeting: false,
    });
  });

  describe('estimateTokens', () => {
    it('should estimate tokens for text', () => {
      const text = 'This is a test string with some words';
      const tokens = manager.estimateTokens(text);
      
      expect(tokens).toBeGreaterThan(0);
      expect(tokens).toBeLessThan(text.length); // Should be less than character count
    });

    it('should return 0 for empty text', () => {
      expect(manager.estimateTokens('')).toBe(0);
    });

    it('should estimate higher for code content', () => {
      const codeText = 'function test() { return "hello"; }';
      const normalText = 'This is just normal text content';
      
      const codeTokens = manager.estimateTokens(codeText);
      const normalTokens = manager.estimateTokens(normalText);
      
      // Code should have higher token density
      expect(codeTokens / codeText.length).toBeGreaterThanOrEqual(normalTokens / normalText.length);
    });
  });

  describe('allocateBudget', () => {
    it('should return context unchanged if within budget', () => {
      const context = createTestContext();
      const result = manager.allocateBudget(context);
      
      expect(result).toEqual(context);
    });

    it('should reduce context if over budget', () => {
      const largeContext = createLargeTestContext();
      const result = manager.allocateBudget(largeContext);
      
      // Should have fewer items
      expect(result.history.recentIterations.length).toBeLessThanOrEqual(
        largeContext.history.recentIterations.length
      );
      expect(result.history.gitCommits.length).toBeLessThanOrEqual(
        largeContext.history.gitCommits.length
      );
    });

    it('should maintain task context with highest priority', () => {
      const largeContext = createLargeTestContext();
      const result = manager.allocateBudget(largeContext);
      
      // Task context should be preserved
      expect(result.task.description).toBe(largeContext.task.description);
      expect(result.task.criteria.length).toBeGreaterThan(0);
    });
  });

  describe('compressContext', () => {
    it('should compress context when enabled', () => {
      const context = createLargeTestContext();
      const compressed = manager.compressContext(context);
      
      // Should have fewer items
      expect(compressed.history.recentIterations.length).toBeLessThanOrEqual(5);
      expect(compressed.history.gitCommits.length).toBeLessThanOrEqual(10);
      expect(compressed.memory.relevantFrames.length).toBeLessThanOrEqual(5);
    });

    it('should preserve essential task information', () => {
      const context = createTestContext();
      const compressed = manager.compressContext(context);
      
      expect(compressed.task.description).toBeDefined();
      expect(compressed.task.criteria.length).toBeGreaterThan(0);
    });

    it('should truncate long descriptions', () => {
      const context = createTestContext();
      context.task.description = 'A'.repeat(1000); // Very long description
      
      const compressed = manager.compressContext(context);
      
      expect(compressed.task.description.length).toBeLessThan(1000);
      expect(compressed.task.description).toMatch(/\.\.\.$/); // Should end with ellipsis
    });
  });

  describe('getUsage', () => {
    it('should return usage statistics', () => {
      const context = createTestContext();
      manager.allocateBudget(context); // This calculates usage
      
      const usage = manager.getUsage();
      
      expect(usage.used).toBeGreaterThan(0);
      expect(usage.available).toBeGreaterThan(0);
      expect(usage.categories).toHaveProperty('task');
      expect(usage.categories).toHaveProperty('history');
    });
  });
});

function createTestContext(): IterationContext {
  return {
    task: {
      description: 'Test task description',
      criteria: ['Criterion 1', 'Criterion 2', 'Criterion 3'],
      currentIteration: 1,
      priority: 'medium',
    },
    history: {
      recentIterations: [
        { iteration: 1, timestamp: Date.now(), changesCount: 5, success: true, summary: 'First iteration' },
      ],
      gitCommits: [
        { hash: 'abc123', message: 'Test commit', author: 'test', timestamp: Date.now(), files: ['test.js'] },
      ],
      changedFiles: ['file1.js', 'file2.js'],
      testResults: [
        { suite: 'unit', passed: 10, failed: 0, skipped: 1, duration: 1000 },
      ],
    },
    environment: {
      projectPath: '/test/project',
      branch: 'main',
      dependencies: { 'package1': '1.0.0' },
      configuration: { setting1: 'value1' },
    },
    memory: {
      relevantFrames: [],
      decisions: [
        { id: '1', iteration: 1, description: 'Test decision', rationale: 'Test rationale', impact: 'medium', timestamp: Date.now() },
      ],
      patterns: [
        { id: '1', name: 'Test pattern', description: 'Test pattern desc', occurrences: 3, successRate: 0.8, lastUsed: Date.now() },
      ],
      blockers: [],
    },
    tokenCount: 0,
  };
}

function createLargeTestContext(): IterationContext {
  const context = createTestContext();
  
  // Add many iterations
  for (let i = 2; i <= 20; i++) {
    context.history.recentIterations.push({
      iteration: i,
      timestamp: Date.now() - (i * 1000),
      changesCount: Math.floor(Math.random() * 10),
      success: Math.random() > 0.2,
      summary: `Iteration ${i} summary with some details`,
    });
  }
  
  // Add many git commits
  for (let i = 2; i <= 30; i++) {
    context.history.gitCommits.push({
      hash: `commit${i}`,
      message: `Commit message ${i} with detailed description`,
      author: 'developer',
      timestamp: Date.now() - (i * 1000),
      files: [`file${i}.js`, `test${i}.js`],
    });
  }
  
  // Add many dependencies
  for (let i = 1; i <= 50; i++) {
    context.environment.dependencies[`package${i}`] = `${i}.0.0`;
  }
  
  return context;
}