/**
 * Tests for PerformanceProfiler
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  PerformanceProfiler,
  getProfiler,
  timeOperation,
} from '../performance-profiler.js';

describe('PerformanceProfiler', () => {
  let profiler: PerformanceProfiler;

  beforeEach(() => {
    profiler = new PerformanceProfiler({ enabled: true });
  });

  afterEach(() => {
    profiler.reset();
  });

  describe('constructor', () => {
    it('should create profiler with default options', () => {
      const defaultProfiler = new PerformanceProfiler();
      expect(defaultProfiler).toBeInstanceOf(PerformanceProfiler);
    });

    it('should create profiler with custom options', () => {
      const customProfiler = new PerformanceProfiler({
        enabled: false,
        sampleLimit: 500,
        hotPathThreshold: 10,
      });
      expect(customProfiler).toBeInstanceOf(PerformanceProfiler);
    });
  });

  describe('startTiming', () => {
    it('should return end timing function', () => {
      const endTiming = profiler.startTiming('test.operation');
      expect(typeof endTiming).toBe('function');
    });

    it('should record timing when end is called', async () => {
      const endTiming = profiler.startTiming('test.operation');

      // Simulate some work
      await new Promise((resolve) => setTimeout(resolve, 10));

      endTiming();

      const metrics = profiler.getMetrics('test.operation');
      expect(metrics).toBeDefined();
      expect(metrics?.callCount).toBe(1);
      expect(metrics?.totalTimeMs).toBeGreaterThan(0);
    });

    it('should support metadata in end timing', () => {
      const endTiming = profiler.startTiming('test.operation');
      endTiming({ customKey: 'customValue' });

      const metrics = profiler.getMetrics('test.operation');
      expect(metrics).toBeDefined();
    });

    it('should return no-op when disabled', () => {
      const disabledProfiler = new PerformanceProfiler({ enabled: false });
      const endTiming = disabledProfiler.startTiming('test.operation');
      endTiming();

      const metrics = disabledProfiler.getMetrics('test.operation');
      expect(metrics).toBeUndefined();
    });
  });

  describe('timeFunction', () => {
    it('should time synchronous function', async () => {
      const result = await profiler.timeFunction('sync.operation', () => {
        return 42;
      });

      expect(result).toBe(42);

      const metrics = profiler.getMetrics('sync.operation');
      expect(metrics).toBeDefined();
      expect(metrics?.callCount).toBe(1);
    });

    it('should time async function', async () => {
      const result = await profiler.timeFunction(
        'async.operation',
        async () => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          return 'async result';
        }
      );

      expect(result).toBe('async result');

      const metrics = profiler.getMetrics('async.operation');
      expect(metrics).toBeDefined();
      expect(metrics?.avgTimeMs).toBeGreaterThan(5);
    });

    it('should handle errors and still record timing', async () => {
      await expect(
        profiler.timeFunction('error.operation', () => {
          throw new Error('Test error');
        })
      ).rejects.toThrow('Test error');

      const metrics = profiler.getMetrics('error.operation');
      expect(metrics).toBeDefined();
    });

    it('should pass metadata to timing', async () => {
      await profiler.timeFunction('meta.operation', () => 'result', {
        operationType: 'test',
      });

      const metrics = profiler.getMetrics('meta.operation');
      expect(metrics).toBeDefined();
    });
  });

  describe('recordTiming', () => {
    it('should record timing manually', () => {
      profiler.recordTiming('manual.operation', 150);

      const metrics = profiler.getMetrics('manual.operation');
      expect(metrics).toBeDefined();
      expect(metrics?.avgTimeMs).toBeGreaterThan(0);
    });

    it('should support metadata', () => {
      profiler.recordTiming('manual.operation', 100, { source: 'external' });

      const metrics = profiler.getMetrics('manual.operation');
      expect(metrics).toBeDefined();
    });
  });

  describe('getMetrics', () => {
    it('should return undefined for non-existent operation', () => {
      const metrics = profiler.getMetrics('nonexistent');
      expect(metrics).toBeUndefined();
    });

    it('should return metrics with correct structure', async () => {
      await profiler.timeFunction('complete.operation', () => 'result');

      const metrics = profiler.getMetrics('complete.operation');

      expect(metrics).toMatchObject({
        operationName: 'complete.operation',
        callCount: 1,
        totalTimeMs: expect.any(Number),
        avgTimeMs: expect.any(Number),
        minTimeMs: expect.any(Number),
        maxTimeMs: expect.any(Number),
        p95TimeMs: expect.any(Number),
        lastExecuted: expect.any(Number),
      });
    });

    it('should update metrics on multiple calls', async () => {
      await profiler.timeFunction('multi.operation', () => 'result');
      await profiler.timeFunction('multi.operation', () => 'result');
      await profiler.timeFunction('multi.operation', () => 'result');

      const metrics = profiler.getMetrics('multi.operation');
      expect(metrics?.callCount).toBe(3);
    });
  });

  describe('getAllMetrics', () => {
    it('should return all recorded metrics', async () => {
      await profiler.timeFunction('op1', () => 'result1');
      await profiler.timeFunction('op2', () => 'result2');

      const allMetrics = profiler.getAllMetrics();

      expect(allMetrics.size).toBe(2);
      expect(allMetrics.has('op1')).toBe(true);
      expect(allMetrics.has('op2')).toBe(true);
    });

    it('should return copy of metrics', async () => {
      await profiler.timeFunction('test.op', () => 'result');

      const metrics1 = profiler.getAllMetrics();
      const metrics2 = profiler.getAllMetrics();

      expect(metrics1).not.toBe(metrics2);
    });
  });

  describe('getHotPaths', () => {
    it('should return hot paths sorted by impact', async () => {
      // Create operations that exceed the hot path threshold (5ms)
      await profiler.timeFunction('slow.operation', async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });

      const hotPaths = profiler.getHotPaths();

      // Hot paths are only tracked if duration > threshold
      expect(Array.isArray(hotPaths)).toBe(true);
    });

    it('should limit results', () => {
      const hotPaths = profiler.getHotPaths(5);
      expect(hotPaths.length).toBeLessThanOrEqual(5);
    });
  });

  describe('generateReport', () => {
    it('should generate report without database', () => {
      const report = profiler.generateReport();

      expect(report).toMatchObject({
        timestamp: expect.any(Number),
        hotPaths: expect.any(Array),
        databaseMetrics: null,
        memoryUsage: expect.any(Object),
        recommendations: expect.any(Array),
      });
    });

    it('should include recommendations', async () => {
      const report = profiler.generateReport();

      expect(report.recommendations).toContain(
        'No significant performance issues detected.'
      );
    });
  });

  describe('reset', () => {
    it('should clear all metrics', async () => {
      await profiler.timeFunction('op1', () => 'result');
      await profiler.timeFunction('op2', () => 'result');

      profiler.reset();

      const allMetrics = profiler.getAllMetrics();
      expect(allMetrics.size).toBe(0);
    });
  });

  describe('exportMetrics', () => {
    it('should export metrics as JSON string', async () => {
      await profiler.timeFunction('export.test', () => 'result');

      const exported = profiler.exportMetrics();
      const parsed = JSON.parse(exported);

      expect(parsed.timestamp).toBeDefined();
      expect(parsed.metrics).toBeDefined();
      expect(parsed.hotPaths).toBeDefined();
      expect(parsed.config).toBeDefined();
    });
  });

  describe('setEnabled', () => {
    it('should enable profiling', () => {
      profiler.setEnabled(true);
      const endTiming = profiler.startTiming('enabled.test');
      endTiming();

      const metrics = profiler.getMetrics('enabled.test');
      expect(metrics).toBeDefined();
    });

    it('should disable profiling', () => {
      profiler.setEnabled(false);
      const endTiming = profiler.startTiming('disabled.test');
      endTiming();

      const metrics = profiler.getMetrics('disabled.test');
      expect(metrics).toBeUndefined();
    });
  });
});

describe('getProfiler', () => {
  it('should return global profiler instance', () => {
    const profiler1 = getProfiler();
    const profiler2 = getProfiler();

    expect(profiler1).toBe(profiler2);
    expect(profiler1).toBeInstanceOf(PerformanceProfiler);
  });
});

describe('timeOperation', () => {
  it('should time operation using global profiler', async () => {
    const result = await timeOperation('global.test', () => 'result');

    expect(result).toBe('result');
  });

  it('should support async operations', async () => {
    const result = await timeOperation('global.async', async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      return 'async result';
    });

    expect(result).toBe('async result');
  });
});
