/**
 * Tests for PerformanceMonitor - Consolidated
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

  describe('core operations', () => {
    it('should track operation lifecycle', () => {
      monitor.startOperation('op-1', 'test.operation', { custom: 'data' });
      const metric = monitor.endOperation('op-1', { result: 'success' });

      expect(metric).toBeDefined();
      expect(metric?.operation).toBe('test.operation');
      expect(metric?.duration).toBeDefined();
      expect(metric?.memoryDelta).toBeDefined();
      expect(metric?.metadata).toMatchObject({
        custom: 'data',
        result: 'success',
      });
    });

    it('should return undefined for unknown operation', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      expect(monitor.endOperation('unknown-op')).toBeUndefined();
      consoleSpy.mockRestore();
    });
  });

  describe('measureAsync', () => {
    it('should measure async operation and handle errors', async () => {
      const result = await monitor.measureAsync('async.op', async () => {
        await new Promise((resolve) => setTimeout(resolve, 5));
        return 'result';
      });
      expect(result).toBe('result');
      expect(monitor.getMetrics('async.op').length).toBe(1);

      await expect(
        monitor.measureAsync('async.error', async () => {
          throw new Error('Async error');
        })
      ).rejects.toThrow('Async error');
      expect(monitor.getMetrics('async.error')[0].metadata?.success).toBe(
        false
      );
    });
  });

  describe('thresholds', () => {
    it('should emit warnings on threshold violations', async () => {
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
  });

  describe('statistics', () => {
    it('should calculate statistics correctly', async () => {
      await monitor.measureAsync('stats.op', async () => 'result1');
      await monitor.measureAsync('stats.op', async () => 'result2');
      await expect(
        monitor.measureAsync('stats.op', async () => {
          throw new Error('fail');
        })
      ).rejects.toThrow();

      const stats = monitor.getStatistics('stats.op');
      expect(stats?.count).toBe(3);
      expect(stats?.successRate).toBeCloseTo(66.67, 0);
    });
  });

  describe('metrics management', () => {
    it('should clear metrics', async () => {
      await monitor.measureAsync('op1', async () => 'result');
      await monitor.measureAsync('op2', async () => 'result');

      monitor.clearMetrics('op1');
      expect(monitor.getMetrics('op1').length).toBe(0);
      expect(monitor.getMetrics('op2').length).toBe(1);

      monitor.clearMetrics();
      expect(monitor.getMetrics().length).toBe(0);
    });
  });

  describe('report generation', () => {
    it('should generate performance report', async () => {
      await monitor.measureAsync('report.op', async () => 'result');
      const report = monitor.generateReport();
      expect(report).toContain('Performance Report');
      expect(report).toContain('report.op');
    });
  });
});
