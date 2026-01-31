/**
 * Tests for PerformanceProfiler - Consolidated
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
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

  describe('timing operations', () => {
    it('should record timing with startTiming/endTiming', async () => {
      const endTiming = profiler.startTiming('test.operation');
      await new Promise((resolve) => setTimeout(resolve, 5));
      endTiming({ customKey: 'value' });

      const metrics = profiler.getMetrics('test.operation');
      expect(metrics?.callCount).toBe(1);
      expect(metrics?.totalTimeMs).toBeGreaterThan(0);
    });

    it('should return no-op when disabled', () => {
      const disabledProfiler = new PerformanceProfiler({ enabled: false });
      const endTiming = disabledProfiler.startTiming('test.operation');
      endTiming();
      expect(disabledProfiler.getMetrics('test.operation')).toBeUndefined();
    });
  });

  describe('recordTiming', () => {
    it('should manually record timing', () => {
      profiler.recordTiming('manual.op', 100);
      profiler.recordTiming('manual.op', 200);

      const metrics = profiler.getMetrics('manual.op');
      expect(metrics?.callCount).toBe(2);
      expect(metrics?.totalTimeMs).toBeCloseTo(300, 0);
    });
  });

  describe('metrics and reporting', () => {
    it('should aggregate metrics correctly', () => {
      profiler.recordTiming('agg.op', 10);
      profiler.recordTiming('agg.op', 20);
      profiler.recordTiming('agg.op', 30);

      const metrics = profiler.getMetrics('agg.op');
      expect(metrics?.callCount).toBe(3);
      expect(metrics?.avgTimeMs).toBeCloseTo(20, 0);
    });

    it('should generate report', () => {
      profiler.recordTiming('report.op', 50);
      const report = profiler.generateReport();
      expect(report).toBeDefined();
      expect(report.hotPaths).toBeDefined();
    });

    it('should reset all metrics', () => {
      profiler.recordTiming('reset.op', 100);
      profiler.reset();
      expect(profiler.getMetrics('reset.op')).toBeUndefined();
    });

    it('should export metrics as string', () => {
      profiler.recordTiming('export.op', 100);
      const exported = profiler.exportMetrics();
      expect(exported).toContain('export.op');
    });
  });

  describe('hot paths', () => {
    it('should identify hot paths', () => {
      for (let i = 0; i < 15; i++) {
        profiler.recordTiming('hot.op', 10);
      }
      profiler.recordTiming('cold.op', 10);

      const hotPaths = profiler.getHotPaths(5);
      expect(hotPaths.length).toBeGreaterThan(0);
      expect(hotPaths[0].path).toBe('hot.op');
    });
  });

  describe('global helpers', () => {
    it('should provide singleton profiler', () => {
      expect(getProfiler()).toBeInstanceOf(PerformanceProfiler);
    });

    it('should time operation via helper', async () => {
      const result = await timeOperation('timed.op', () => 'result');
      expect(result).toBe('result');
    });
  });
});
