/**
 * Complexity Scorer Regression Benchmark
 *
 * Pinned corpus of prompts with expected tiers and score ranges.
 * Any weight/threshold change that shifts classifications will fail here.
 *
 * To update after intentional weight changes:
 *   1. Run with COMPLEXITY_UPDATE=1 to print the new golden values
 *   2. Review the diff — every tier shift should be intentional
 *   3. Update the corpus entries below
 */

import { describe, it, expect } from 'vitest';
import { scoreComplexity, type ComplexityTier } from '../complexity-scorer.js';

interface CorpusEntry {
  label: string;
  prompt: string;
  context?: Record<string, unknown>;
  expectedTier: ComplexityTier;
  /** Inclusive lower bound for score */
  minScore: number;
  /** Inclusive upper bound for score */
  maxScore: number;
}

// ---------------------------------------------------------------------------
// Golden corpus — each entry is a pinned regression test
// ---------------------------------------------------------------------------

const CORPUS: CorpusEntry[] = [
  // === LOW COMPLEXITY ===
  {
    label: 'fix typo',
    prompt: 'Fix typo in README',
    expectedTier: 'low',
    minScore: 0,
    maxScore: 0.1,
  },
  {
    label: 'rename variable',
    prompt: 'Rename the variable foo to bar',
    expectedTier: 'low',
    minScore: 0,
    maxScore: 0.1,
  },
  {
    label: 'remove unused imports',
    prompt: 'Remove unused imports from utils.ts',
    expectedTier: 'low',
    minScore: 0,
    maxScore: 0.1,
  },
  {
    label: 'lint fix',
    prompt: 'Fix lint errors in the project',
    expectedTier: 'low',
    minScore: 0,
    maxScore: 0.1,
  },
  {
    label: 'format code',
    prompt: 'Run prettier on all files',
    expectedTier: 'low',
    minScore: 0,
    maxScore: 0.1,
  },
  {
    label: 'add comment',
    prompt: 'Add comment explaining this function',
    expectedTier: 'low',
    minScore: 0,
    maxScore: 0.1,
  },
  {
    label: 'update dependency version',
    prompt: 'Update version of lodash to latest',
    expectedTier: 'low',
    minScore: 0,
    maxScore: 0.1,
  },
  {
    label: 'remove console.log',
    prompt: 'Remove all console.log statements',
    expectedTier: 'low',
    minScore: 0,
    maxScore: 0.1,
  },
  {
    label: 'sort imports',
    prompt: 'Sort import order alphabetically',
    expectedTier: 'low',
    minScore: 0,
    maxScore: 0.1,
  },
  {
    label: 'trivial greeting',
    prompt: 'Say hello',
    expectedTier: 'low',
    minScore: 0,
    maxScore: 0.05,
  },

  // === MEDIUM COMPLEXITY ===
  {
    label: 'write CSV parser',
    prompt:
      'Write a TypeScript function that parses CSV files and returns an array of objects. ' +
      'Handle quoted fields and escaped characters correctly.',
    expectedTier: 'medium',
    minScore: 0.25,
    maxScore: 0.45,
  },
  {
    label: 'implement API endpoint',
    prompt:
      'Implement a REST API endpoint for user registration that validates email format ' +
      'and checks for duplicate accounts.',
    expectedTier: 'medium',
    minScore: 0.25,
    maxScore: 0.5,
  },
  {
    label: 'create React component',
    prompt:
      'Create a React component that implements a sortable data table with pagination and column filtering.',
    expectedTier: 'medium',
    minScore: 0.25,
    maxScore: 0.5,
  },
  {
    label: 'build CLI tool',
    prompt:
      'Build a CLI tool that converts JSON files to YAML format with proper error handling.',
    expectedTier: 'medium',
    minScore: 0.25,
    maxScore: 0.5,
  },
  {
    label: 'debug intermittent timeout',
    prompt:
      'Debug the intermittent timeout in the API handler and find the root cause.',
    expectedTier: 'low',
    minScore: 0.15,
    maxScore: 0.24,
  },
  {
    label: 'write unit tests',
    prompt:
      'Write unit tests for the payment processing module. ' +
      'Handle edge cases like zero amounts and currency conversion.',
    expectedTier: 'medium',
    minScore: 0.25,
    maxScore: 0.5,
  },
  {
    label: 'generate TypeScript types',
    prompt:
      'Generate TypeScript types from the OpenAPI spec and validate them against the schema.',
    expectedTier: 'medium',
    minScore: 0.25,
    maxScore: 0.5,
  },

  // === HIGH COMPLEXITY ===
  {
    label: 'architecture redesign',
    prompt:
      'Refactor the authentication system to use distributed consensus with backward compatibility. ' +
      'Analyze the trade-offs between JWT and session-based auth. Consider security vulnerabilities.',
    expectedTier: 'high',
    minScore: 0.6,
    maxScore: 1.0,
  },
  {
    label: 'security audit',
    prompt:
      'Evaluate the application for OWASP vulnerabilities. Check authentication and authorization ' +
      'flows for security issues. Analyze encryption and crypto usage.',
    expectedTier: 'high',
    minScore: 0.6,
    maxScore: 1.0,
  },
  {
    label: 'database migration',
    prompt:
      'Migrate the database schema from SQL to NoSQL while maintaining backward compatibility. ' +
      'Analyze the performance trade-offs and design a distributed caching layer for scalability.',
    expectedTier: 'high',
    minScore: 0.6,
    maxScore: 1.0,
  },
  {
    label: 'distributed system design',
    prompt:
      'Design a distributed event-sourcing architecture with eventual consistency. ' +
      'Evaluate the trade-offs between CQRS and traditional approaches. ' +
      'Consider scalability, concurrency, and backward compatibility.',
    expectedTier: 'high',
    minScore: 0.6,
    maxScore: 1.0,
  },
  {
    label: 'crypto + auth overhaul',
    prompt:
      'Redesign the encryption layer to support key rotation. Refactor authentication ' +
      'to use OAuth2 with PKCE. Analyze security vulnerabilities in the current crypto implementation.',
    expectedTier: 'high',
    minScore: 0.6,
    maxScore: 1.0,
  },
  {
    label: 'performance + migration',
    prompt:
      'Migrate the monolith to microservices architecture. Analyze performance bottlenecks ' +
      'and design a distributed tracing system. Evaluate scalability trade-offs.',
    expectedTier: 'high',
    minScore: 0.6,
    maxScore: 1.0,
  },

  // === CONTEXT-BOOSTED ===
  {
    label: 'simple prompt + many files',
    prompt: 'Review the code changes',
    context: { files: Array.from({ length: 15 }, (_, i) => `src/file${i}.ts`) },
    expectedTier: 'low',
    minScore: 0.05,
    maxScore: 0.25,
  },
  {
    label: 'simple prompt + large codebase',
    prompt: 'Analyze this code',
    context: { codeSize: 10000 },
    expectedTier: 'low',
    minScore: 0.15,
    maxScore: 0.24,
  },
  {
    label: 'medium prompt + many files + large code',
    prompt: 'Implement a caching layer for the API',
    context: {
      files: Array.from({ length: 12 }, (_, i) => `src/api/${i}.ts`),
      codeSize: 8000,
    },
    expectedTier: 'medium',
    minScore: 0.35,
    maxScore: 0.59,
  },
];

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('complexity scorer regression', () => {
  // Individual pinned tests — one per corpus entry
  for (const entry of CORPUS) {
    it(`[${entry.expectedTier}] ${entry.label}: tier=${entry.expectedTier}, score ∈ [${entry.minScore}, ${entry.maxScore}]`, () => {
      const result = scoreComplexity(entry.prompt, entry.context);

      expect(result.tier).toBe(entry.expectedTier);
      expect(result.score).toBeGreaterThanOrEqual(entry.minScore);
      expect(result.score).toBeLessThanOrEqual(entry.maxScore);
    });
  }

  // Distribution invariants — these catch systemic drift
  it('low prompts should never score above LOW threshold (0.25)', () => {
    const lowEntries = CORPUS.filter((e) => e.expectedTier === 'low');
    for (const entry of lowEntries) {
      const result = scoreComplexity(entry.prompt, entry.context);
      expect(result.score).toBeLessThan(0.25);
    }
  });

  it('high prompts should always score at or above HIGH threshold (0.60)', () => {
    const highEntries = CORPUS.filter((e) => e.expectedTier === 'high');
    for (const entry of highEntries) {
      const result = scoreComplexity(entry.prompt, entry.context);
      expect(result.score).toBeGreaterThanOrEqual(0.6);
    }
  });

  it('tier ordering: avg(low) < avg(medium) < avg(high)', () => {
    const avg = (tier: ComplexityTier) => {
      const entries = CORPUS.filter((e) => e.expectedTier === tier);
      const scores = entries.map(
        (e) => scoreComplexity(e.prompt, e.context).score
      );
      return scores.reduce((a, b) => a + b, 0) / scores.length;
    };

    const avgLow = avg('low');
    const avgMed = avg('medium');
    const avgHigh = avg('high');

    expect(avgLow).toBeLessThan(avgMed);
    expect(avgMed).toBeLessThan(avgHigh);
  });

  it('no tier has zero coverage in corpus', () => {
    const tiers = new Set(CORPUS.map((e) => e.expectedTier));
    expect(tiers.has('low')).toBe(true);
    expect(tiers.has('medium')).toBe(true);
    expect(tiers.has('high')).toBe(true);
  });

  // Summary table — printed on every run for quick visual inspection
  it('print regression summary', () => {
    const rows = CORPUS.map((entry) => {
      const result = scoreComplexity(entry.prompt, entry.context);
      const pass =
        result.tier === entry.expectedTier &&
        result.score >= entry.minScore &&
        result.score <= entry.maxScore;
      return {
        label: entry.label.padEnd(30),
        expected: entry.expectedTier.padEnd(6),
        actual: result.tier.padEnd(6),
        score: result.score.toFixed(2),
        range: `[${entry.minScore.toFixed(2)}, ${entry.maxScore.toFixed(2)}]`,
        status: pass ? 'OK' : 'FAIL',
      };
    });

    const header =
      'Label                          | Expect | Actual | Score | Range          | Status';
    const sep = '-'.repeat(header.length);
    const lines = rows.map(
      (r) =>
        `${r.label} | ${r.expected} | ${r.actual} | ${r.score}  | ${r.range} | ${r.status}`
    );

    console.log('\n' + sep);
    console.log('COMPLEXITY SCORER REGRESSION BENCHMARK');
    console.log(sep);
    console.log(header);
    console.log(sep);
    for (const line of lines) console.log(line);
    console.log(sep);

    const failures = rows.filter((r) => r.status === 'FAIL');
    console.log(`\n${rows.length} prompts, ${failures.length} failures\n`);

    // This assertion is intentionally last — let the table print first
    expect(failures.length).toBe(0);
  });
});
