/**
 * Tests for hybrid search score normalization and merge strategies
 * in SQLiteAdapter.searchHybrid()
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SQLiteAdapter } from '../sqlite-adapter.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Hybrid Search', () => {
  let adapter: SQLiteAdapter;
  let dbPath: string;

  beforeEach(async () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'stackmemory-hybrid-')
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

  describe('text-only fallback (no vector)', () => {
    it('should return text results when vector search is unavailable', async () => {
      await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'test-project',
        type: 'task',
        name: 'authentication module',
        digest_text: 'handles user login',
      });
      await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'test-project',
        type: 'task',
        name: 'database setup',
        digest_text: 'schema migrations',
      });

      const results = await adapter.searchHybrid(
        'authentication',
        [0.1, 0.2, 0.3]
      );

      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].name).toBe('authentication module');
    });

    it('should respect default weighted strategy', async () => {
      await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'test-project',
        type: 'task',
        name: 'search test frame',
        digest_text: 'test content for hybrid',
      });

      // Default mergeStrategy should be 'weighted' (not rrf)
      const results = await adapter.searchHybrid('search', [0.1, 0.2]);
      expect(results.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('weighted merge normalization', () => {
    it('should produce normalized scores in [0, 1]', async () => {
      // Insert frames with varying relevance
      await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'test-project',
        type: 'task',
        name: 'exact match search term',
        digest_text: 'search term repeated search term',
      });
      await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'test-project',
        type: 'task',
        name: 'partial match',
        digest_text: 'contains search keyword',
      });
      await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'test-project',
        type: 'task',
        name: 'unrelated frame',
        digest_text: 'nothing relevant here',
      });

      // Without vector, we get text-only results (no merge), but scores should still be valid
      const results = await adapter.searchHybrid('search', [0.1, 0.2, 0.3]);
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0);
      }
      // Results should be sorted descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(results[i].score);
      }
    });
  });

  describe('merge logic (unit-level via spy)', () => {
    it('weighted merge: min-max normalizes text and vector scores to [0, 1]', async () => {
      // Insert frames that will appear in text search
      const id1 = await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'test-project',
        type: 'task',
        name: 'alpha query target',
        digest_text: 'alpha query content',
      });
      const id2 = await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'test-project',
        type: 'task',
        name: 'beta query content',
        digest_text: 'some other text with query',
      });
      const id3 = await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'test-project',
        type: 'task',
        name: 'gamma unrelated',
        digest_text: 'no match at all',
      });

      // Mock searchByVector to simulate vector results
      // Distance: lower = more similar
      const mockVecResults = [
        {
          frame_id: id1,
          run_id: 'run-1',
          project_id: 'test-project',
          type: 'task',
          name: 'alpha query target',
          state: 'active',
          depth: 0,
          inputs: {},
          outputs: {},
          digest_text: 'alpha query content',
          digest_json: {},
          created_at: Date.now(),
          similarity: 0.1, // closest
        },
        {
          frame_id: id3,
          run_id: 'run-1',
          project_id: 'test-project',
          type: 'task',
          name: 'gamma unrelated',
          state: 'active',
          depth: 0,
          inputs: {},
          outputs: {},
          digest_text: 'no match at all',
          digest_json: {},
          created_at: Date.now(),
          similarity: 0.5, // farthest
        },
      ];

      vi.spyOn(adapter, 'searchByVector').mockResolvedValue(
        mockVecResults as any
      );
      // Force vecEnabled so searchHybrid enters the merge path
      (adapter as any).vecEnabled = true;

      const results = await adapter.searchHybrid(
        'query',
        [0.1, 0.2],
        { text: 0.5, vector: 0.5 },
        'weighted'
      );

      // All scores should be in [0, 1]
      for (const r of results) {
        expect(r.score).toBeGreaterThanOrEqual(0);
        expect(r.score).toBeLessThanOrEqual(1.0 + 1e-9);
      }

      // Should contain union of text + vector results
      const frameIds = results.map((r) => r.frame_id);
      expect(frameIds).toContain(id1); // in both text and vector
      expect(frameIds).toContain(id3); // vector-only

      // Results sorted descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(
          results[i].score - 1e-9
        );
      }

      // id1 should rank highest: it appears in both text and vector results
      expect(results[0].frame_id).toBe(id1);
    });

    it('RRF merge: scores are rank-based and independent of raw score magnitude', async () => {
      const id1 = await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'test-project',
        type: 'task',
        name: 'rrf alpha target',
        digest_text: 'rrf alpha content',
      });
      const id2 = await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'test-project',
        type: 'task',
        name: 'rrf beta target',
        digest_text: 'rrf beta text with target',
      });
      const id3 = await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'test-project',
        type: 'task',
        name: 'rrf gamma veconly',
        digest_text: 'no match for text search',
      });

      // Mock vector results with very different distance scales
      const mockVecResults = [
        {
          frame_id: id2,
          run_id: 'run-1',
          project_id: 'test-project',
          type: 'task',
          name: 'rrf beta target',
          state: 'active',
          depth: 0,
          inputs: {},
          outputs: {},
          digest_text: 'rrf beta text with target',
          digest_json: {},
          created_at: Date.now(),
          similarity: 100, // very large distance scale
        },
        {
          frame_id: id3,
          run_id: 'run-1',
          project_id: 'test-project',
          type: 'task',
          name: 'rrf gamma veconly',
          state: 'active',
          depth: 0,
          inputs: {},
          outputs: {},
          digest_text: 'no match for text search',
          digest_json: {},
          created_at: Date.now(),
          similarity: 500, // extreme distance
        },
      ];

      vi.spyOn(adapter, 'searchByVector').mockResolvedValue(
        mockVecResults as any
      );
      (adapter as any).vecEnabled = true;

      const results = await adapter.searchHybrid(
        'rrf target',
        [0.1, 0.2],
        undefined,
        'rrf'
      );

      // RRF scores: rank-based, not affected by raw magnitude
      expect(results.length).toBeGreaterThanOrEqual(2);

      // id2 appears in both text (rank) and vector (rank 0) => highest RRF score
      const id2Result = results.find((r) => r.frame_id === id2);
      const id1Result = results.find((r) => r.frame_id === id1);
      const id3Result = results.find((r) => r.frame_id === id3);

      expect(id2Result).toBeDefined();

      // id2 in both sets should have higher score than items in only one set
      if (id1Result && id2Result) {
        expect(id2Result.score).toBeGreaterThan(id1Result.score);
      }
      if (id3Result && id2Result) {
        expect(id2Result.score).toBeGreaterThan(id3Result.score);
      }

      // RRF scores should be positive but much smaller than 1
      for (const r of results) {
        expect(r.score).toBeGreaterThan(0);
        // With k=60, max single-list score is 1/61 ~= 0.0164
        // Max combined is 2/61 ~= 0.0328
        expect(r.score).toBeLessThan(0.05);
      }

      // Results sorted descending
      for (let i = 1; i < results.length; i++) {
        expect(results[i - 1].score).toBeGreaterThanOrEqual(
          results[i].score - 1e-9
        );
      }
    });

    it('both strategies return union of text and vector results', async () => {
      const textOnlyId = await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'test-project',
        type: 'task',
        name: 'union keyword match',
        digest_text: 'union keyword content',
      });
      const vecOnlyId = await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'test-project',
        type: 'task',
        name: 'completely different name',
        digest_text: 'no keyword overlap',
      });

      const mockVecResults = [
        {
          frame_id: vecOnlyId,
          run_id: 'run-1',
          project_id: 'test-project',
          type: 'task',
          name: 'completely different name',
          state: 'active',
          depth: 0,
          inputs: {},
          outputs: {},
          digest_text: 'no keyword overlap',
          digest_json: {},
          created_at: Date.now(),
          similarity: 0.2,
        },
      ];

      vi.spyOn(adapter, 'searchByVector').mockResolvedValue(
        mockVecResults as any
      );
      (adapter as any).vecEnabled = true;

      // Test weighted
      const weightedResults = await adapter.searchHybrid(
        'union keyword',
        [0.1],
        undefined,
        'weighted'
      );
      const weightedIds = weightedResults.map((r) => r.frame_id);
      expect(weightedIds).toContain(textOnlyId);
      expect(weightedIds).toContain(vecOnlyId);

      // Test RRF
      const rrfResults = await adapter.searchHybrid(
        'union keyword',
        [0.1],
        undefined,
        'rrf'
      );
      const rrfIds = rrfResults.map((r) => r.frame_id);
      expect(rrfIds).toContain(textOnlyId);
      expect(rrfIds).toContain(vecOnlyId);
    });

    it('handles empty vector results (pure text fallback)', async () => {
      await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'test-project',
        type: 'task',
        name: 'fallback text frame',
        digest_text: 'fallback content',
      });

      vi.spyOn(adapter, 'searchByVector').mockResolvedValue([]);
      (adapter as any).vecEnabled = true;

      const results = await adapter.searchHybrid(
        'fallback',
        [0.1],
        undefined,
        'weighted'
      );
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].name).toBe('fallback text frame');

      const rrfResults = await adapter.searchHybrid(
        'fallback',
        [0.1],
        undefined,
        'rrf'
      );
      expect(rrfResults.length).toBeGreaterThanOrEqual(1);
    });

    it('handles empty text results (pure vector fallback)', async () => {
      const vecId = await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'test-project',
        type: 'task',
        name: 'vec only result',
        digest_text: 'nothing matching text query',
      });

      const mockVecResults = [
        {
          frame_id: vecId,
          run_id: 'run-1',
          project_id: 'test-project',
          type: 'task',
          name: 'vec only result',
          state: 'active',
          depth: 0,
          inputs: {},
          outputs: {},
          digest_text: 'nothing matching text query',
          digest_json: {},
          created_at: Date.now(),
          similarity: 0.3,
        },
      ];

      vi.spyOn(adapter, 'searchByVector').mockResolvedValue(
        mockVecResults as any
      );
      // Mock search to return empty (simulating no text match)
      vi.spyOn(adapter, 'search').mockResolvedValue([]);
      (adapter as any).vecEnabled = true;

      const results = await adapter.searchHybrid('xyznonexistent', [0.1, 0.2]);

      expect(results.length).toBe(1);
      expect(results[0].frame_id).toBe(vecId);
      // Single result should get score 1.0 (min=max, normalized to 1)
      expect(results[0].score).toBeCloseTo(1.0, 5);
    });

    it('single text result normalizes to score 1.0 for text weight', async () => {
      const id = await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'test-project',
        type: 'task',
        name: 'singleton uniqueterm',
        digest_text: 'only one match',
      });

      const mockVecResults = [
        {
          frame_id: id,
          run_id: 'run-1',
          project_id: 'test-project',
          type: 'task',
          name: 'singleton uniqueterm',
          state: 'active',
          depth: 0,
          inputs: {},
          outputs: {},
          digest_text: 'only one match',
          digest_json: {},
          created_at: Date.now(),
          similarity: 0.1,
        },
      ];

      vi.spyOn(adapter, 'searchByVector').mockResolvedValue(
        mockVecResults as any
      );
      (adapter as any).vecEnabled = true;

      const results = await adapter.searchHybrid(
        'singleton uniqueterm',
        [0.1],
        { text: 0.5, vector: 0.5 },
        'weighted'
      );

      expect(results.length).toBe(1);
      // Single item in both lists: text normalized=1.0, vec normalized=1.0
      // score = 1.0*0.5 + 1.0*0.5 = 1.0
      expect(results[0].score).toBeCloseTo(1.0, 5);
    });
  });
});
