/**
 * Tests for retrieval_log table and retrieval logging in SQLiteAdapter
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteAdapter } from '../sqlite-adapter.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Retrieval Log', () => {
  let adapter: SQLiteAdapter;
  let dbPath: string;

  beforeEach(async () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'stackmemory-retrieval-log-')
    );
    dbPath = path.join(tmpDir, 'test.db');
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

  it('should insert a row via logRetrieval', async () => {
    await adapter.logRetrieval({
      queryText: 'find authentication flow',
      strategy: 'Keyword Search',
      resultsCount: 3,
      topScore: 0.95,
      latencyMs: 42,
      resultFrameIds: ['frame-1', 'frame-2', 'frame-3'],
    });

    const db = adapter.getRawDatabase()!;
    const rows = db.prepare('SELECT * FROM retrieval_log').all() as any[];

    expect(rows).toHaveLength(1);
    expect(rows[0].query_text).toBe('find authentication flow');
    expect(rows[0].strategy).toBe('Keyword Search');
    expect(rows[0].results_count).toBe(3);
    expect(rows[0].top_score).toBe(0.95);
    expect(rows[0].latency_ms).toBe(42);
    expect(JSON.parse(rows[0].result_frame_ids)).toEqual([
      'frame-1',
      'frame-2',
      'frame-3',
    ]);
    expect(rows[0].created_at).toBeGreaterThan(0);
  });

  it('should handle null topScore', async () => {
    await adapter.logRetrieval({
      queryText: 'no results query',
      strategy: 'Semantic Search',
      resultsCount: 0,
      topScore: null,
      latencyMs: 10,
      resultFrameIds: [],
    });

    const db = adapter.getRawDatabase()!;
    const row = db.prepare('SELECT * FROM retrieval_log').get() as any;

    expect(row.top_score).toBeNull();
    expect(row.results_count).toBe(0);
    expect(JSON.parse(row.result_frame_ids)).toEqual([]);
  });

  it('should return correct aggregate stats from getRetrievalStats', async () => {
    // Insert several log entries with different strategies and latencies
    await adapter.logRetrieval({
      queryText: 'query 1',
      strategy: 'Keyword Search',
      resultsCount: 5,
      topScore: 0.9,
      latencyMs: 10,
      resultFrameIds: ['f1', 'f2', 'f3', 'f4', 'f5'],
    });
    await adapter.logRetrieval({
      queryText: 'query 2',
      strategy: 'Keyword Search',
      resultsCount: 3,
      topScore: 0.7,
      latencyMs: 20,
      resultFrameIds: ['f1', 'f2', 'f3'],
    });
    await adapter.logRetrieval({
      queryText: 'query 3',
      strategy: 'Semantic Search',
      resultsCount: 0,
      topScore: null,
      latencyMs: 50,
      resultFrameIds: [],
    });
    await adapter.logRetrieval({
      queryText: 'query 4',
      strategy: 'Hybrid Search',
      resultsCount: 2,
      topScore: 0.85,
      latencyMs: 30,
      resultFrameIds: ['f1', 'f2'],
    });

    const stats = await adapter.getRetrievalStats();

    expect(stats.totalQueries).toBe(4);
    // avg latency = (10+20+50+30)/4 = 27.5
    expect(stats.avgLatencyMs).toBe(27.5);
    // avg results = (5+3+0+2)/4 = 2.5
    expect(stats.avgResultsCount).toBe(2.5);
    expect(stats.queriesWithNoResults).toBe(1);

    // Strategy distribution
    expect(stats.strategyDistribution['Keyword Search']).toBe(2);
    expect(stats.strategyDistribution['Semantic Search']).toBe(1);
    expect(stats.strategyDistribution['Hybrid Search']).toBe(1);

    // P95 latency: with 4 items sorted [10,20,30,50], p95 index = round(4*0.95)-1 = round(3.8)-1 = 4-1 = 3
    // offset 3 → 50
    expect(stats.p95LatencyMs).toBe(50);
  });

  it('should filter stats by sinceDays', async () => {
    const db = adapter.getRawDatabase()!;

    // Insert an old entry (8 days ago) directly
    const oldTs = Date.now() - 8 * 24 * 60 * 60 * 1000;
    db.prepare(
      `INSERT INTO retrieval_log (query_text, strategy, results_count, top_score, latency_ms, result_frame_ids, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run('old query', 'Keyword Search', 2, 0.5, 100, '["f1","f2"]', oldTs);

    // Insert a recent entry
    await adapter.logRetrieval({
      queryText: 'recent query',
      strategy: 'Hybrid Search',
      resultsCount: 4,
      topScore: 0.8,
      latencyMs: 25,
      resultFrameIds: ['f1', 'f2', 'f3', 'f4'],
    });

    // Without filter: both entries
    const allStats = await adapter.getRetrievalStats();
    expect(allStats.totalQueries).toBe(2);

    // With sinceDays=7: only the recent entry
    const recentStats = await adapter.getRetrievalStats(7);
    expect(recentStats.totalQueries).toBe(1);
    expect(recentStats.avgLatencyMs).toBe(25);
    expect(recentStats.strategyDistribution['Hybrid Search']).toBe(1);
    expect(recentStats.strategyDistribution['Keyword Search']).toBeUndefined();
  });

  it('should return zero stats when no entries exist', async () => {
    const stats = await adapter.getRetrievalStats();
    expect(stats.totalQueries).toBe(0);
    expect(stats.avgLatencyMs).toBe(0);
    expect(stats.p95LatencyMs).toBe(0);
    expect(stats.avgResultsCount).toBe(0);
    expect(stats.queriesWithNoResults).toBe(0);
    expect(stats.strategyDistribution).toEqual({});
  });

  it('should not throw when logRetrieval is called on disconnected adapter', async () => {
    await adapter.disconnect();
    // Should silently return without error
    await expect(
      adapter.logRetrieval({
        queryText: 'test',
        strategy: 'test',
        resultsCount: 0,
        topScore: null,
        latencyMs: 0,
        resultFrameIds: [],
      })
    ).resolves.not.toThrow();
  });
});
