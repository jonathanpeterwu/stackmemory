/**
 * Tests for ClaudeCodeTaskCoordinator
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ClaudeCodeTaskCoordinator } from '../task-coordinator.js';
import { ClaudeCodeAgent } from '../agent-bridge.js';

describe('ClaudeCodeTaskCoordinator', () => {
  let coordinator: ClaudeCodeTaskCoordinator;

  const mockWorkerAgent: ClaudeCodeAgent = {
    name: 'test-worker',
    type: 'worker',
    description: 'Test worker agent',
    capabilities: ['test_capability'],
    costMultiplier: 0.2,
    complexity: 'medium',
    specializations: ['testing'],
  };

  const mockOracleAgent: ClaudeCodeAgent = {
    name: 'test-oracle',
    type: 'oracle',
    description: 'Test oracle agent',
    capabilities: ['strategic_planning'],
    costMultiplier: 1.0,
    complexity: 'very_high',
    specializations: ['architecture'],
  };

  beforeEach(() => {
    coordinator = new ClaudeCodeTaskCoordinator();
  });

  afterEach(async () => {
    await coordinator.cleanup();
  });

  describe('constructor', () => {
    it('should create coordinator with initial metrics', () => {
      const metrics = coordinator.getCoordinationMetrics();

      expect(metrics.totalTasks).toBe(0);
      expect(metrics.completedTasks).toBe(0);
      expect(metrics.failedTasks).toBe(0);
      expect(metrics.successRate).toBe(0);
    });
  });

  describe('executeTask', () => {
    it('should execute task successfully', async () => {
      const result = await coordinator.executeTask(
        'test-worker',
        mockWorkerAgent,
        'Test prompt',
        { maxRetries: 0, timeout: 10000 }
      );

      expect(result).toBeDefined();
      expect(typeof result).toBe('string');
    }, 15000);

    it('should track task in metrics', async () => {
      await coordinator.executeTask(
        'test-worker',
        mockWorkerAgent,
        'Test prompt',
        { maxRetries: 0, timeout: 10000 }
      );

      const metrics = coordinator.getCoordinationMetrics();

      expect(metrics.totalTasks).toBe(1);
      expect(metrics.completedTasks).toBe(1);
    }, 15000);

    it('should track agent utilization', async () => {
      await coordinator.executeTask('test-worker', mockWorkerAgent, 'Task 1', {
        maxRetries: 0,
        timeout: 10000,
      });
      await coordinator.executeTask('test-worker', mockWorkerAgent, 'Task 2', {
        maxRetries: 0,
        timeout: 10000,
      });

      const metrics = coordinator.getCoordinationMetrics();

      expect(metrics.agentUtilization['test-worker']).toBe(2);
    }, 15000);

    it('should calculate cost', async () => {
      await coordinator.executeTask(
        'test-worker',
        mockWorkerAgent,
        'Test prompt',
        { maxRetries: 0, timeout: 10000 }
      );

      const metrics = coordinator.getCoordinationMetrics();

      expect(metrics.totalCost).toBeGreaterThanOrEqual(0);
    }, 15000);
  });

  describe('getCoordinationMetrics', () => {
    it('should return comprehensive metrics', async () => {
      await coordinator.executeTask(
        'test-worker',
        mockWorkerAgent,
        'Test task',
        { maxRetries: 0, timeout: 10000 }
      );

      const metrics = coordinator.getCoordinationMetrics();

      expect(metrics).toMatchObject({
        totalTasks: expect.any(Number),
        completedTasks: expect.any(Number),
        failedTasks: expect.any(Number),
        averageExecutionTime: expect.any(Number),
        totalCost: expect.any(Number),
        successRate: expect.any(Number),
        agentUtilization: expect.any(Object),
        activeTasks: expect.any(Number),
        recentErrors: expect.any(Array),
        performanceTrend: expect.stringMatching(/improving|stable|degrading/),
      });
    }, 15000);

    it('should calculate success rate correctly', async () => {
      await coordinator.executeTask(
        'test-worker',
        mockWorkerAgent,
        'Success task',
        { maxRetries: 0, timeout: 10000 }
      );

      const metrics = coordinator.getCoordinationMetrics();

      expect(metrics.successRate).toBe(1);
    }, 15000);
  });

  describe('getActiveTaskStatus', () => {
    it('should return empty array when no active tasks', () => {
      const status = coordinator.getActiveTaskStatus();

      expect(status).toEqual([]);
    });
  });

  describe('cancelTask', () => {
    it('should return false for non-existent task', async () => {
      const result = await coordinator.cancelTask('nonexistent-task');

      expect(result).toBe(false);
    });
  });

  describe('cleanup', () => {
    it('should reset metrics', async () => {
      await coordinator.executeTask(
        'test-worker',
        mockWorkerAgent,
        'Pre-cleanup task',
        { maxRetries: 0, timeout: 10000 }
      );

      await coordinator.cleanup();

      const metrics = coordinator.getCoordinationMetrics();

      expect(metrics.totalTasks).toBe(0);
      expect(metrics.completedTasks).toBe(0);
    }, 50000);

    it('should clear active tasks', async () => {
      await coordinator.cleanup();

      const active = coordinator.getActiveTaskStatus();

      expect(active.length).toBe(0);
    }, 50000);
  });
});
