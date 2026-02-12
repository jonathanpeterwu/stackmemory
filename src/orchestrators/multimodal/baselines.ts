/**
 * Harness Benchmark Baselines
 *
 * Online benchmark reference scores (SWE-bench, ACE-bench, etc.)
 * used as calibration targets for our internal harness metrics.
 *
 * Sources:
 *   SWE-bench Verified: https://www.swebench.com/
 *   ACE-bench: https://openreview.net/forum?id=41xrZ3uGuI
 */

/** A single benchmark datapoint for an agent/model */
export interface BaselineEntry {
  agent: string;
  model: string;
  benchmark: string;
  resolveRate: number; // 0-1
  date: string; // YYYY-MM-DD
  source: string; // URL or citation
}

/** Our internal harness metrics for one run */
export interface HarnessRunMetrics {
  timestamp: number;
  task: string;
  plannerModel: string;
  reviewerModel: string;
  implementer: string;
  planLatencyMs: number;
  totalLatencyMs: number;
  iterations: number;
  approved: boolean;
  editAttempts: number;
  editSuccesses: number;
  editFuzzyFallbacks: number;
  contextTokens: number;
}

/**
 * SWE-bench Verified leaderboard baselines (Feb 2026).
 * Represents resolve rate on the Verified subset (500 instances).
 */
export const SWE_BENCH_BASELINES: BaselineEntry[] = [
  {
    agent: 'Claude Code',
    model: 'claude-sonnet-4',
    benchmark: 'swe-bench-verified',
    resolveRate: 0.704,
    date: '2025-12-01',
    source: 'https://www.swebench.com/',
  },
  {
    agent: 'Devin',
    model: 'mixed',
    benchmark: 'swe-bench-verified',
    resolveRate: 0.551,
    date: '2025-10-01',
    source: 'https://www.swebench.com/',
  },
  {
    agent: 'OpenHands',
    model: 'claude-sonnet-4',
    benchmark: 'swe-bench-verified',
    resolveRate: 0.535,
    date: '2025-09-01',
    source: 'https://www.swebench.com/',
  },
  {
    agent: 'Aider',
    model: 'claude-sonnet-4',
    benchmark: 'swe-bench-verified',
    resolveRate: 0.489,
    date: '2025-10-01',
    source: 'https://www.swebench.com/',
  },
];

/**
 * Internal harness targets — what we aim for in our own loop.
 * These are not SWE-bench scores; they measure our harness efficiency.
 */
export const HARNESS_TARGETS = {
  /** Plan generation should complete within 10s */
  planLatencyP95Ms: 10_000,
  /**
   * Full cycle (plan + implement + critique) within 5 minutes.
   * Codex execution benchmarks show 89-231s for real runs (1-2 iterations).
   * 300s allows for 2-iteration runs with margin.
   */
  totalLatencyP95Ms: 300_000,
  /**
   * Single-iteration (first-pass) latency ceiling: 2.5 minutes.
   * Based on observed single-pass runs of 89-115s with headroom.
   */
  singleIterLatencyP95Ms: 150_000,
  /** First-pass approval rate (no retries needed) */
  firstPassApprovalRate: 0.7,
  /** Edit success rate (exact + fuzzy combined) */
  editSuccessRate: 0.9,
  /** Edit fuzzy fallback rate (lower = better, means exact match works) */
  editFuzzyFallbackRate: 0.15,
  /** Context overhead should be < 6000 tokens */
  contextTokenBudget: 6000,
};

/**
 * Compute summary statistics from a set of harness runs.
 */
export function summarizeRuns(runs: HarnessRunMetrics[]): {
  totalRuns: number;
  approvalRate: number;
  firstPassRate: number;
  avgIterations: number;
  avgPlanLatencyMs: number;
  avgTotalLatencyMs: number;
  p95PlanLatencyMs: number;
  p95TotalLatencyMs: number;
  p95SingleIterLatencyMs: number;
  editSuccessRate: number;
  editFuzzyRate: number;
  avgContextTokens: number;
  passesTargets: Record<string, boolean>;
} {
  if (runs.length === 0) {
    return {
      totalRuns: 0,
      approvalRate: 0,
      firstPassRate: 0,
      avgIterations: 0,
      avgPlanLatencyMs: 0,
      avgTotalLatencyMs: 0,
      p95PlanLatencyMs: 0,
      p95TotalLatencyMs: 0,
      p95SingleIterLatencyMs: 0,
      editSuccessRate: 0,
      editFuzzyRate: 0,
      avgContextTokens: 0,
      passesTargets: {},
    };
  }

  const approvedRuns = runs.filter((r) => r.approved);
  const firstPassRuns = runs.filter((r) => r.approved && r.iterations <= 1);
  const totalEdits = runs.reduce((s, r) => s + r.editAttempts, 0);
  const totalEditSuccesses = runs.reduce((s, r) => s + r.editSuccesses, 0);
  const totalFuzzy = runs.reduce((s, r) => s + r.editFuzzyFallbacks, 0);

  const planLatencies = runs.map((r) => r.planLatencyMs).sort((a, b) => a - b);
  const totalLatencies = runs
    .map((r) => r.totalLatencyMs)
    .sort((a, b) => a - b);

  const p95Idx = Math.min(Math.ceil(runs.length * 0.95) - 1, runs.length - 1);

  const approvalRate = approvedRuns.length / runs.length;
  const firstPassRate = firstPassRuns.length / runs.length;
  const editSuccessRate = totalEdits > 0 ? totalEditSuccesses / totalEdits : 1;
  const editFuzzyRate =
    totalEditSuccesses > 0 ? totalFuzzy / totalEditSuccesses : 0;
  const avgContextTokens =
    runs.reduce((s, r) => s + r.contextTokens, 0) / runs.length;
  const p95Plan = planLatencies[p95Idx];
  const p95Total = totalLatencies[p95Idx];

  // P95 latency for single-iteration approved runs
  const singleIterLatencies = runs
    .filter((r) => r.approved && r.iterations <= 1)
    .map((r) => r.totalLatencyMs)
    .sort((a, b) => a - b);
  const p95SingleIter =
    singleIterLatencies.length > 0
      ? singleIterLatencies[
          Math.min(
            Math.ceil(singleIterLatencies.length * 0.95) - 1,
            singleIterLatencies.length - 1
          )
        ]
      : 0;

  return {
    totalRuns: runs.length,
    approvalRate,
    firstPassRate,
    avgIterations: runs.reduce((s, r) => s + r.iterations, 0) / runs.length,
    avgPlanLatencyMs:
      runs.reduce((s, r) => s + r.planLatencyMs, 0) / runs.length,
    avgTotalLatencyMs:
      runs.reduce((s, r) => s + r.totalLatencyMs, 0) / runs.length,
    p95PlanLatencyMs: p95Plan,
    p95TotalLatencyMs: p95Total,
    p95SingleIterLatencyMs: p95SingleIter,
    editSuccessRate,
    editFuzzyRate,
    avgContextTokens,
    passesTargets: {
      planLatency: p95Plan <= HARNESS_TARGETS.planLatencyP95Ms,
      totalLatency: p95Total <= HARNESS_TARGETS.totalLatencyP95Ms,
      singleIterLatency:
        singleIterLatencies.length === 0 ||
        p95SingleIter <= HARNESS_TARGETS.singleIterLatencyP95Ms,
      firstPassApproval: firstPassRate >= HARNESS_TARGETS.firstPassApprovalRate,
      editSuccess: editSuccessRate >= HARNESS_TARGETS.editSuccessRate,
      editFuzzyRate: editFuzzyRate <= HARNESS_TARGETS.editFuzzyFallbackRate,
      contextBudget: avgContextTokens <= HARNESS_TARGETS.contextTokenBudget,
    },
  };
}
