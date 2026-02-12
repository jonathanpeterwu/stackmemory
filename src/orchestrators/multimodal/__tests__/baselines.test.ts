import { describe, it, expect } from 'vitest';
import {
  SWE_BENCH_BASELINES,
  HARNESS_TARGETS,
  summarizeRuns,
} from '../baselines.js';
import type { HarnessRunMetrics } from '../baselines.js';

describe('baselines', () => {
  it('SWE-bench baselines are valid and sorted by resolve rate', () => {
    expect(SWE_BENCH_BASELINES.length).toBeGreaterThanOrEqual(3);
    for (const b of SWE_BENCH_BASELINES) {
      expect(b.resolveRate).toBeGreaterThan(0);
      expect(b.resolveRate).toBeLessThanOrEqual(1);
      expect(b.source).toMatch(/^https?:\/\//);
    }
    // Sorted descending
    for (let i = 1; i < SWE_BENCH_BASELINES.length; i++) {
      expect(SWE_BENCH_BASELINES[i - 1].resolveRate).toBeGreaterThanOrEqual(
        SWE_BENCH_BASELINES[i].resolveRate
      );
    }
  });

  it('harness targets are sensible', () => {
    expect(HARNESS_TARGETS.planLatencyP95Ms).toBeLessThan(30_000);
    expect(HARNESS_TARGETS.editSuccessRate).toBeGreaterThan(0.5);
    expect(HARNESS_TARGETS.contextTokenBudget).toBeGreaterThan(1000);
  });
});

describe('summarizeRuns', () => {
  it('returns zeros for empty input', () => {
    const s = summarizeRuns([]);
    expect(s.totalRuns).toBe(0);
    expect(s.approvalRate).toBe(0);
  });

  it('computes correct stats from synthetic runs', () => {
    const now = Date.now();
    const runs: HarnessRunMetrics[] = [
      {
        timestamp: now,
        task: 'test-1',
        plannerModel: 'sonnet',
        reviewerModel: 'sonnet',
        implementer: 'codex',
        planLatencyMs: 2000,
        totalLatencyMs: 10000,
        iterations: 1,
        approved: true,
        editAttempts: 5,
        editSuccesses: 5,
        editFuzzyFallbacks: 0,
        contextTokens: 4000,
      },
      {
        timestamp: now,
        task: 'test-2',
        plannerModel: 'sonnet',
        reviewerModel: 'sonnet',
        implementer: 'codex',
        planLatencyMs: 3000,
        totalLatencyMs: 20000,
        iterations: 2,
        approved: true,
        editAttempts: 10,
        editSuccesses: 8,
        editFuzzyFallbacks: 2,
        contextTokens: 5000,
      },
      {
        timestamp: now,
        task: 'test-3',
        plannerModel: 'sonnet',
        reviewerModel: 'sonnet',
        implementer: 'claude',
        planLatencyMs: 5000,
        totalLatencyMs: 30000,
        iterations: 2,
        approved: false,
        editAttempts: 3,
        editSuccesses: 1,
        editFuzzyFallbacks: 1,
        contextTokens: 6000,
      },
    ];

    const s = summarizeRuns(runs);
    expect(s.totalRuns).toBe(3);
    expect(s.approvalRate).toBeCloseTo(2 / 3, 2);
    expect(s.firstPassRate).toBeCloseTo(1 / 3, 2);
    expect(s.avgIterations).toBeCloseTo(5 / 3, 2);
    expect(s.editSuccessRate).toBeCloseTo(14 / 18, 2);
    expect(s.editFuzzyRate).toBeCloseTo(3 / 14, 2);
    expect(s.avgContextTokens).toBe(5000);

    // Target checks
    expect(s.passesTargets).toHaveProperty('planLatency');
    expect(s.passesTargets).toHaveProperty('editSuccess');
    expect(s.passesTargets).toHaveProperty('contextBudget');
  });
});
