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

  it('should record timing via startTiming, recordTiming, and return no-op when disabled', async () => {
    // startTiming
    const endTiming = profiler.startTiming('test.operation');
    await new Promise((resolve) => setTimeout(resolve, 5));
    endTiming({ customKey: 'value' });
    const metrics = profiler.getMetrics('test.operation');
    expect(metrics?.callCount).toBe(1);
    expect(metrics?.totalTimeMs).toBeGreaterThan(0);

    // recordTiming
    profiler.recordTiming('manual.op', 100);
    profiler.recordTiming('manual.op', 200);
    expect(profiler.getMetrics('manual.op')?.callCount).toBe(2);
    expect(profiler.getMetrics('manual.op')?.totalTimeMs).toBeCloseTo(300, 0);

    // Disabled profiler
    const disabled = new PerformanceProfiler({ enabled: false });
    disabled.startTiming('test.operation')();
    expect(disabled.getMetrics('test.operation')).toBeUndefined();
  });

  it('should aggregate, report, export, and reset metrics', () => {
    profiler.recordTiming('agg.op', 10);
    profiler.recordTiming('agg.op', 20);
    profiler.recordTiming('agg.op', 30);
    expect(profiler.getMetrics('agg.op')?.avgTimeMs).toBeCloseTo(20, 0);

    const report = profiler.generateReport();
    expect(report.hotPaths).toBeDefined();

    profiler.recordTiming('export.op', 100);
    expect(profiler.exportMetrics()).toContain('export.op');

    profiler.reset();
    expect(profiler.getMetrics('agg.op')).toBeUndefined();
  });

  it('should identify hot paths', () => {
    for (let i = 0; i < 15; i++) {
      profiler.recordTiming('hot.op', 10);
    }
    profiler.recordTiming('cold.op', 10);

    const hotPaths = profiler.getHotPaths(5);
    expect(hotPaths.length).toBeGreaterThan(0);
    expect(hotPaths[0].path).toBe('hot.op');
  });

  it('should provide singleton and timeOperation helper', async () => {
    expect(getProfiler()).toBeInstanceOf(PerformanceProfiler);
    expect(await timeOperation('timed.op', () => 'result')).toBe('result');
  });
});
