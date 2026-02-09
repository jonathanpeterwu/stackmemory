/**
 * Search Benchmark Tests
 *
 * Skip in CI, run manually with:
 *   npx vitest run --reporter=verbose src/core/database/__tests__/search-benchmark.test.ts
 *
 * To run, temporarily remove the `.skip` from describe.skip
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteAdapter } from '../sqlite-adapter.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

/** Sample words for generating realistic frame content */
const SAMPLE_WORDS = [
  'authentication',
  'database',
  'migration',
  'deployment',
  'refactoring',
  'optimization',
  'configuration',
  'integration',
  'validation',
  'serialization',
  'middleware',
  'controller',
  'repository',
  'service',
  'handler',
  'pipeline',
  'scheduler',
  'transformer',
  'resolver',
  'adapter',
  'cache',
  'queue',
  'stream',
  'buffer',
  'socket',
  'session',
  'token',
  'permission',
  'schema',
  'index',
  'backup',
  'restore',
  'snapshot',
  'monitor',
  'alert',
  'logging',
  'tracing',
  'profiling',
  'benchmark',
  'coverage',
];

const FRAME_TYPES = ['task', 'session', 'function', 'workflow', 'debug'];

/** Generate a random sentence from sample words */
function randomSentence(wordCount: number): string {
  const words: string[] = [];
  for (let i = 0; i < wordCount; i++) {
    words.push(SAMPLE_WORDS[Math.floor(Math.random() * SAMPLE_WORDS.length)]);
  }
  return words.join(' ');
}

/** Insert N frames with realistic data using raw SQL for speed */
function insertBenchmarkFrames(adapter: SQLiteAdapter, count: number): void {
  const db = adapter.getRawDatabase()!;
  const insert = db.prepare(`
    INSERT INTO frames (frame_id, run_id, project_id, parent_frame_id, depth,
      type, name, state, inputs, outputs, digest_text, digest_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const insertMany = db.transaction(() => {
    for (let i = 0; i < count; i++) {
      const frameId = crypto.randomUUID();
      const runId = `run-${Math.floor(i / 10)}`;
      const type = FRAME_TYPES[Math.floor(Math.random() * FRAME_TYPES.length)];
      const name = randomSentence(3);
      const digestText = randomSentence(8);
      const inputs = JSON.stringify({ query: randomSentence(4) });
      const outputs = JSON.stringify({ result: randomSentence(2) });
      const createdAt = Math.floor(Date.now() / 1000) - (count - i);

      insert.run(
        frameId,
        runId,
        'test-project',
        null,
        0,
        type,
        name,
        'closed',
        inputs,
        outputs,
        digestText,
        '{}',
        createdAt
      );
    }
  });

  insertMany();
}

/** Measure latency of a function over N iterations, return percentiles in ms */
function measureLatency(
  fn: () => void,
  iterations: number
): {
  p50: number;
  p95: number;
  p99: number;
  avg: number;
  min: number;
  max: number;
} {
  const times: number[] = [];

  // Warmup: 3 iterations
  for (let i = 0; i < 3; i++) {
    fn();
  }

  for (let i = 0; i < iterations; i++) {
    const start = performance.now();
    fn();
    const end = performance.now();
    times.push(end - start);
  }

  times.sort((a, b) => a - b);

  const sum = times.reduce((a, b) => a + b, 0);

  return {
    p50: times[Math.floor(times.length * 0.5)],
    p95: times[Math.floor(times.length * 0.95)],
    p99: times[Math.floor(times.length * 0.99)],
    avg: sum / times.length,
    min: times[0],
    max: times[times.length - 1],
  };
}

// Skip by default - remove .skip to run manually
describe.skip('Search Benchmark', () => {
  let adapter: SQLiteAdapter;
  let dbPath: string;

  beforeEach(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackmemory-bench-'));
    dbPath = path.join(tmpDir, 'bench.db');
    adapter = new SQLiteAdapter('test-project', { dbPath });
    await adapter.connect();
    await adapter.initializeSchema();
  });

  afterEach(async () => {
    await adapter.disconnect();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  const ITERATIONS = 50;

  describe('100 frames', () => {
    beforeEach(() => {
      insertBenchmarkFrames(adapter, 100);
    });

    it('FTS search latency', async () => {
      const stats = measureLatency(
        () => adapter.search({ query: 'authentication database', limit: 20 }),
        ITERATIONS
      );
      console.log('FTS (100 frames):', stats);
      expect(stats.p50).toBeLessThan(100);
    });

    it('LIKE search latency', () => {
      // Force LIKE by using the adapter's searchLike via a query that would normally use FTS
      const db = adapter.getRawDatabase()!;
      const stats = measureLatency(() => {
        db.prepare(
          `SELECT *, CASE
            WHEN name LIKE ? THEN 1.0
            WHEN digest_text LIKE ? THEN 0.8
            WHEN inputs LIKE ? THEN 0.6
            ELSE 0.5
          END as score
          FROM frames
          WHERE name LIKE ? OR digest_text LIKE ? OR inputs LIKE ?
          ORDER BY score DESC
          LIMIT 20`
        ).all(
          '%authentication%',
          '%authentication%',
          '%authentication%',
          '%authentication%',
          '%authentication%',
          '%authentication%'
        );
      }, ITERATIONS);
      console.log('LIKE (100 frames):', stats);
      expect(stats.p50).toBeLessThan(100);
    });
  });

  describe('1000 frames', () => {
    beforeEach(() => {
      insertBenchmarkFrames(adapter, 1000);
    });

    it('FTS search p50 < 100ms', async () => {
      const stats = measureLatency(
        () =>
          adapter.search({ query: 'authentication optimization', limit: 20 }),
        ITERATIONS
      );
      console.log('FTS (1000 frames):', stats);
      expect(stats.p50).toBeLessThan(100);
    });

    it('LIKE search latency', () => {
      const db = adapter.getRawDatabase()!;
      const stats = measureLatency(() => {
        db.prepare(
          `SELECT *, CASE
            WHEN name LIKE ? THEN 1.0
            WHEN digest_text LIKE ? THEN 0.8
            WHEN inputs LIKE ? THEN 0.6
            ELSE 0.5
          END as score
          FROM frames
          WHERE name LIKE ? OR digest_text LIKE ? OR inputs LIKE ?
          ORDER BY score DESC
          LIMIT 20`
        ).all(
          '%middleware%',
          '%middleware%',
          '%middleware%',
          '%middleware%',
          '%middleware%',
          '%middleware%'
        );
      }, ITERATIONS);
      console.log('LIKE (1000 frames):', stats);
      expect(stats.p50).toBeLessThan(100);
    });

    it('hybrid search (mocked vector) latency', async () => {
      // Since sqlite-vec is optional and likely not installed in test,
      // hybrid search falls back to text-only. This measures the hybrid path overhead.
      const stats = measureLatency(
        () =>
          adapter.searchHybrid(
            'deployment pipeline',
            Array(384).fill(0.1), // dummy embedding
            { text: 0.6, vector: 0.4 }
          ),
        ITERATIONS
      );
      console.log('Hybrid (1000 frames, no vec):', stats);
      expect(stats.p50).toBeLessThan(100);
    });

    it('project-scoped query uses index efficiently', () => {
      const db = adapter.getRawDatabase()!;
      const stats = measureLatency(() => {
        db.prepare(
          `SELECT * FROM frames
           WHERE project_id = ?
           ORDER BY created_at DESC
           LIMIT 50`
        ).all('test-project');
      }, ITERATIONS);
      console.log('Project-scoped (1000 frames):', stats);
      expect(stats.p50).toBeLessThan(50);
    });

    it('GC candidate query uses index efficiently', () => {
      const db = adapter.getRawDatabase()!;
      const nowSec = Math.floor(Date.now() / 1000);
      const cutoff = nowSec - 90 * 86400;

      const stats = measureLatency(() => {
        db.prepare(
          `SELECT frame_id FROM frames
           WHERE (
             (retention_policy IN ('default', 'archive') AND created_at < ?)
             OR (retention_policy = 'ttl_30d' AND created_at < ?)
             OR (retention_policy = 'ttl_7d' AND created_at < ?)
           )
           AND retention_policy != 'keep_forever'
           LIMIT 100`
        ).all(cutoff, cutoff, cutoff);
      }, ITERATIONS);
      console.log('GC candidates (1000 frames):', stats);
      expect(stats.p50).toBeLessThan(50);
    });
  });

  describe('10000 frames', () => {
    beforeEach(() => {
      insertBenchmarkFrames(adapter, 10000);
    });

    it('FTS search at scale', async () => {
      const stats = measureLatency(
        () => adapter.search({ query: 'scheduler tracing', limit: 20 }),
        ITERATIONS
      );
      console.log('FTS (10000 frames):', stats);
      // Relaxed target for larger dataset
      expect(stats.p50).toBeLessThan(200);
    });

    it('LIKE search at scale', () => {
      const db = adapter.getRawDatabase()!;
      const stats = measureLatency(() => {
        db.prepare(
          `SELECT *, CASE
            WHEN name LIKE ? THEN 1.0
            WHEN digest_text LIKE ? THEN 0.8
            WHEN inputs LIKE ? THEN 0.6
            ELSE 0.5
          END as score
          FROM frames
          WHERE name LIKE ? OR digest_text LIKE ? OR inputs LIKE ?
          ORDER BY score DESC
          LIMIT 20`
        ).all(
          '%resolver%',
          '%resolver%',
          '%resolver%',
          '%resolver%',
          '%resolver%',
          '%resolver%'
        );
      }, ITERATIONS);
      console.log('LIKE (10000 frames):', stats);
      // LIKE will be slower at scale
      expect(stats.p50).toBeLessThan(500);
    });
  });
});
