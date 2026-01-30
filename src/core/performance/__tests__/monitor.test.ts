/**
 * Tests for PerformanceMonitor
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PerformanceMonitor } from '../monitor.js';

describe('PerformanceMonitor', () => {
  let monitor: PerformanceMonitor;

  beforeEach(() => {
    monitor = new PerformanceMonitor();
  });

  afterEach(() => {
    monitor.stopMonitoring();
    monitor.clearMetrics();
  });

  describe('constructor', () => {
    it('should create monitor with default thresholds', () => {
      expect(monitor).toBeInstanceOf(PerformanceMonitor);
    });
  });

  describe('startMonitoring / stopMonitoring', () => {
    it('should start monitoring', () => {
      const handler = vi.fn();
      monitor.on('monitoring.started', handler);

      monitor.startMonitoring();

      expect(handler).toHaveBeenCalled();
    });

    it('should not start twice', () => {
      monitor.startMonitoring();
      monitor.startMonitoring(); // Should be no-op

      expect(true).toBe(true); // No error thrown
    });

    it('should stop monitoring', () => {
      monitor.startMonitoring();
      monitor.stopMonitoring();

      expect(true).toBe(true); // No error thrown
    });

    it('should handle stop when not monitoring', () => {
      monitor.stopMonitoring(); // Should be no-op

      expect(true).toBe(true);
    });
  });

  describe('startOperation / endOperation', () => {
    it('should track operation', () => {
      monitor.startOperation('op-1', 'test.operation');
      const metric = monitor.endOperation('op-1');

      expect(metric).toBeDefined();
      expect(metric?.operation).toBe('test.operation');
      expect(metric?.duration).toBeDefined();
    });

    it('should track operation with metadata', () => {
      monitor.startOperation('op-2', 'test.operation', { custom: 'data' });
      const metric = monitor.endOperation('op-2', { result: 'success' });

      expect(metric?.metadata).toMatchObject({
        custom: 'data',
        result: 'success',
      });
    });

    it('should return undefined for unknown operation', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

      const metric = monitor.endOperation('unknown-op');

      expect(metric).toBeUndefined();
      expect(consoleSpy).toHaveBeenCalled();

      consoleSpy.mockRestore();
    });

    it('should track memory usage', () => {
      monitor.startOperation('mem-op', 'memory.test');
      const metric = monitor.endOperation('mem-op');

      expect(metric?.memoryBefore).toBeDefined();
      expect(metric?.memoryAfter).toBeDefined();
      expect(metric?.memoryDelta).toBeDefined();
    });
  });

  describe('measureAsync', () => {
    it('should measure async operation', async () => {
      const result = await monitor.measureAsync('async.op', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 'async result';
      });

      expect(result).toBe('async result');

      const metrics = monitor.getMetrics('async.op');
      expect(metrics.length).toBe(1);
      expect(metrics[0].duration).toBeGreaterThan(5);
    });

    it('should handle async errors', async () => {
      await expect(
        monitor.measureAsync('async.error', async () => {
          throw new Error('Async error');
        })
      ).rejects.toThrow('Async error');

      const metrics = monitor.getMetrics('async.error');
      expect(metrics.length).toBe(1);
      expect(metrics[0].metadata?.success).toBe(false);
    });

    it('should pass metadata', async () => {
      await monitor.measureAsync('async.meta', async () => 'result', {
        type: 'test',
      });

      const metrics = monitor.getMetrics('async.meta');
      expect(metrics[0].metadata?.type).toBe('test');
    });
  });

  describe('measure', () => {
    it('should measure sync operation', () => {
      const result = monitor.measure('sync.op', () => {
        let sum = 0;
        for (let i = 0; i < 1000; i++) {
          sum += i;
        }
        return sum;
      });

      expect(result).toBe(499500);

      const metrics = monitor.getMetrics('sync.op');
      expect(metrics.length).toBe(1);
    });

    it('should handle sync errors', () => {
      expect(() =>
        monitor.measure('sync.error', () => {
          throw new Error('Sync error');
        })
      ).toThrow('Sync error');

      const metrics = monitor.getMetrics('sync.error');
      expect(metrics.length).toBe(1);
      expect(metrics[0].metadata?.success).toBe(false);
    });
  });

  describe('addThreshold', () => {
    it('should add custom threshold', () => {
      monitor.addThreshold({
        operation: 'custom.op',
        maxDuration: 100,
        action: 'warn',
      });

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('threshold checks', () => {
    it('should emit warning on duration threshold violation', async () => {
      const handler = vi.fn();
      monitor.on('threshold.warning', handler);

      monitor.addThreshold({
        operation: 'slow.op',
        maxDuration: 1,
        action: 'warn',
      });

      await monitor.measureAsync('slow.op', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      expect(handler).toHaveBeenCalled();
    });

    it('should emit error on threshold violation with error action', async () => {
      const handler = vi.fn();
      monitor.on('threshold.error', handler);

      monitor.addThreshold({
        operation: 'critical.op',
        maxDuration: 1,
        action: 'error',
      });

      await monitor.measureAsync('critical.op', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      expect(handler).toHaveBeenCalled();
    });

    it('should emit optimize on threshold violation with optimize action', async () => {
      const handler = vi.fn();
      monitor.on('threshold.optimize', handler);

      monitor.addThreshold({
        operation: 'optimize.op',
        maxDuration: 1,
        action: 'optimize',
      });

      await monitor.measureAsync('optimize.op', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('getMetrics', () => {
    it('should return metrics for specific operation', async () => {
      await monitor.measureAsync('specific.op', async () => 'result');

      const metrics = monitor.getMetrics('specific.op');

      expect(metrics.length).toBe(1);
      expect(metrics[0].operation).toBe('specific.op');
    });

    it('should return all metrics when no operation specified', async () => {
      await monitor.measureAsync('op1', async () => 'result1');
      await monitor.measureAsync('op2', async () => 'result2');

      const allMetrics = monitor.getMetrics();

      expect(allMetrics.length).toBe(2);
    });

    it('should return empty array for non-existent operation', () => {
      const metrics = monitor.getMetrics('nonexistent');
      expect(metrics).toEqual([]);
    });
  });

  describe('getStatistics', () => {
    it('should calculate statistics for operation', async () => {
      await monitor.measureAsync('stats.op', async () => 'result1');
      await monitor.measureAsync('stats.op', async () => 'result2');
      await monitor.measureAsync('stats.op', async () => 'result3');

      const stats = monitor.getStatistics('stats.op');

      expect(stats).toBeDefined();
      expect(stats?.count).toBe(3);
      expect(stats?.avgDuration).toBeGreaterThan(0);
      expect(stats?.successRate).toBe(100);
    });

    it('should return undefined for non-existent operation', () => {
      const stats = monitor.getStatistics('nonexistent');
      expect(stats).toBeUndefined();
    });

    it('should calculate success rate correctly', async () => {
      await monitor.measureAsync('mixed.op', async () => 'success');

      await expect(
        monitor.measureAsync('mixed.op', async () => {
          throw new Error('failure');
        })
      ).rejects.toThrow();

      const stats = monitor.getStatistics('mixed.op');
      expect(stats?.successRate).toBe(50);
    });
  });

  describe('clearMetrics', () => {
    it('should clear all metrics', async () => {
      await monitor.measureAsync('clear.op1', async () => 'result');
      await monitor.measureAsync('clear.op2', async () => 'result');

      monitor.clearMetrics();

      const metrics = monitor.getMetrics();
      expect(metrics.length).toBe(0);
    });

    it('should clear specific operation metrics', async () => {
      await monitor.measureAsync('keep.op', async () => 'result');
      await monitor.measureAsync('clear.op', async () => 'result');

      monitor.clearMetrics('clear.op');

      expect(monitor.getMetrics('keep.op').length).toBe(1);
      expect(monitor.getMetrics('clear.op').length).toBe(0);
    });
  });

  describe('getActiveOperations', () => {
    it('should return active operations', () => {
      monitor.startOperation('active-1', 'test.op1');
      monitor.startOperation('active-2', 'test.op2');

      const active = monitor.getActiveOperations();

      expect(active).toContain('active-1');
      expect(active).toContain('active-2');

      monitor.endOperation('active-1');
      monitor.endOperation('active-2');
    });

    it('should update after operation ends', () => {
      monitor.startOperation('temp-op', 'test.op');

      let active = monitor.getActiveOperations();
      expect(active).toContain('temp-op');

      monitor.endOperation('temp-op');

      active = monitor.getActiveOperations();
      expect(active).not.toContain('temp-op');
    });
  });

  describe('generateReport', () => {
    it('should generate performance report', async () => {
      await monitor.measureAsync('report.op1', async () => 'result1');
      await monitor.measureAsync('report.op2', async () => 'result2');

      const report = monitor.generateReport();

      expect(report).toContain('Performance Report');
      expect(report).toContain('report.op1');
      expect(report).toContain('report.op2');
    });

    it('should include statistics in report', async () => {
      await monitor.measureAsync('detailed.op', async () => 'result');
      await monitor.measureAsync('detailed.op', async () => 'result');

      const report = monitor.generateReport();

      expect(report).toContain('Count:');
      expect(report).toContain('Avg Duration:');
      expect(report).toContain('Success Rate:');
    });
  });

  describe('events', () => {
    it('should emit operation.started event', () => {
      const handler = vi.fn();
      monitor.on('operation.started', handler);

      monitor.startOperation('event-op', 'test.operation');

      expect(handler).toHaveBeenCalledWith({
        operationId: 'event-op',
        operation: 'test.operation',
        metadata: undefined,
      });

      monitor.endOperation('event-op');
    });

    it('should emit operation.completed event', () => {
      const handler = vi.fn();
      monitor.on('operation.completed', handler);

      monitor.startOperation('complete-op', 'test.operation');
      monitor.endOperation('complete-op');

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          operationId: 'complete-op',
        })
      );
    });

    it('should emit monitoring.started event', () => {
      const handler = vi.fn();
      monitor.on('monitoring.started', handler);

      monitor.startMonitoring();

      expect(handler).toHaveBeenCalled();
    });

    it('should emit monitoring.stopped event', () => {
      const handler = vi.fn();
      monitor.startMonitoring();
      monitor.on('monitoring.stopped', handler);

      monitor.stopMonitoring();

      expect(handler).toHaveBeenCalled();
    });
  });
});
