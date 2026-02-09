/**
 * Tests for performance indexes and pragmas in SQLiteAdapter
 * Verifies that initializeSchema() creates the expected indexes
 * and that connect() sets the correct pragmas.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteAdapter } from '../sqlite-adapter.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Performance Indexes and Pragmas', () => {
  let adapter: SQLiteAdapter;
  let dbPath: string;

  beforeEach(async () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'stackmemory-perf-idx-')
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

  /** Helper: get all index names from the database */
  function getIndexNames(): string[] {
    const db = adapter.getRawDatabase()!;
    const rows = db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type = 'index' AND name LIKE 'idx_%'"
      )
      .all() as Array<{ name: string }>;
    return rows.map((r) => r.name);
  }

  describe('Schema indexes', () => {
    it('should create all base indexes after initializeSchema()', () => {
      const indexes = getIndexNames();

      // Original indexes
      expect(indexes).toContain('idx_frames_run');
      expect(indexes).toContain('idx_frames_project');
      expect(indexes).toContain('idx_frames_parent');
      expect(indexes).toContain('idx_frames_state');
      expect(indexes).toContain('idx_frames_created');
      expect(indexes).toContain('idx_events_frame');
      expect(indexes).toContain('idx_events_seq');
      expect(indexes).toContain('idx_anchors_frame');
      expect(indexes).toContain('idx_retrieval_log_created');
    });

    it('should create composite project+created_at index', () => {
      const indexes = getIndexNames();
      expect(indexes).toContain('idx_frames_project_created');
    });

    it('should create retention_policy+created_at index for GC queries', () => {
      const indexes = getIndexNames();
      expect(indexes).toContain('idx_frames_retention_created');
    });

    it('should create all performance indexes in a single initializeSchema() call', () => {
      const indexes = getIndexNames();

      const expectedIndexes = [
        'idx_frames_run',
        'idx_frames_project',
        'idx_frames_parent',
        'idx_frames_state',
        'idx_frames_created',
        'idx_events_frame',
        'idx_events_seq',
        'idx_anchors_frame',
        'idx_retrieval_log_created',
        'idx_frames_project_created',
        'idx_frames_retention_created',
      ];

      for (const idx of expectedIndexes) {
        expect(indexes).toContain(idx);
      }
    });
  });

  describe('Performance pragmas', () => {
    it('should set mmap_size pragma', () => {
      const db = adapter.getRawDatabase()!;
      const result = db.pragma('mmap_size') as Array<{ mmap_size: number }>;
      expect(result[0].mmap_size).toBe(268435456); // 256MB
    });

    it('should set default cache_size when not overridden', () => {
      const db = adapter.getRawDatabase()!;
      const result = db.pragma('cache_size') as Array<{ cache_size: number }>;
      // Negative value means KB: -64000 = 64MB
      expect(result[0].cache_size).toBe(-64000);
    });

    it('should respect custom cache_size when provided', async () => {
      // Create a new adapter with custom cache_size
      const tmpDir = fs.mkdtempSync(
        path.join(os.tmpdir(), 'stackmemory-perf-cache-')
      );
      const customDbPath = path.join(tmpDir, 'test.db');
      const customAdapter = new SQLiteAdapter('test-project', {
        dbPath: customDbPath,
        cacheSize: -32000,
      });

      await customAdapter.connect();

      const db = customAdapter.getRawDatabase()!;
      const result = db.pragma('cache_size') as Array<{ cache_size: number }>;
      expect(result[0].cache_size).toBe(-32000);

      await customAdapter.disconnect();
      try {
        fs.rmSync(path.dirname(customDbPath), { recursive: true });
      } catch {
        // cleanup best-effort
      }
    });

    it('should enable WAL mode by default', () => {
      const db = adapter.getRawDatabase()!;
      const result = db.pragma('journal_mode') as Array<{
        journal_mode: string;
      }>;
      expect(result[0].journal_mode).toBe('wal');
    });
  });

  describe('EXPLAIN QUERY PLAN', () => {
    it('should use index for project-scoped time queries', () => {
      const db = adapter.getRawDatabase()!;
      const plan = db
        .prepare(
          'EXPLAIN QUERY PLAN SELECT * FROM frames WHERE project_id = ? ORDER BY created_at DESC LIMIT 50'
        )
        .all('test-project') as Array<{ detail: string }>;

      const details = plan.map((r) => r.detail).join(' ');
      // Should use idx_frames_project_created or idx_frames_project, not a full SCAN
      expect(details).toMatch(/USING INDEX|SEARCH/i);
    });

    it('should use index for GC retention queries', () => {
      const db = adapter.getRawDatabase()!;
      const nowSec = Math.floor(Date.now() / 1000);
      const plan = db
        .prepare(
          `EXPLAIN QUERY PLAN SELECT frame_id FROM frames
           WHERE retention_policy IN ('default', 'archive') AND created_at < ?
           LIMIT 100`
        )
        .all(nowSec) as Array<{ detail: string }>;

      const details = plan.map((r) => r.detail).join(' ');
      // Should use idx_frames_retention_created
      expect(details).toMatch(/USING INDEX|SEARCH/i);
    });

    it('should use index for parent frame lookups', () => {
      const db = adapter.getRawDatabase()!;
      const plan = db
        .prepare(
          'EXPLAIN QUERY PLAN SELECT * FROM frames WHERE parent_frame_id = ?'
        )
        .all('some-id') as Array<{ detail: string }>;

      const details = plan.map((r) => r.detail).join(' ');
      expect(details).toMatch(/USING INDEX|SEARCH/i);
    });

    it('should use index for events by frame_id', () => {
      const db = adapter.getRawDatabase()!;
      const plan = db
        .prepare('EXPLAIN QUERY PLAN SELECT * FROM events WHERE frame_id = ?')
        .all('some-id') as Array<{ detail: string }>;

      const details = plan.map((r) => r.detail).join(' ');
      expect(details).toMatch(/USING INDEX|SEARCH/i);
    });

    it('should use index for anchors by frame_id', () => {
      const db = adapter.getRawDatabase()!;
      const plan = db
        .prepare('EXPLAIN QUERY PLAN SELECT * FROM anchors WHERE frame_id = ?')
        .all('some-id') as Array<{ detail: string }>;

      const details = plan.map((r) => r.detail).join(' ');
      expect(details).toMatch(/USING INDEX|SEARCH/i);
    });

    it('FTS search should use virtual table scan (not full table scan on frames)', () => {
      const db = adapter.getRawDatabase()!;
      const plan = db
        .prepare(
          `EXPLAIN QUERY PLAN SELECT f.*, -bm25(frames_fts, 10, 5, 2, 1) as score
           FROM frames_fts fts
           JOIN frames f ON f.rowid = fts.rowid
           WHERE frames_fts MATCH ?
           ORDER BY score DESC
           LIMIT 50`
        )
        .all('"test"') as Array<{ detail: string }>;

      const details = plan.map((r) => r.detail).join(' ');
      // Should reference the virtual table, not a SCAN TABLE frames
      expect(details).toMatch(/VIRTUAL TABLE|frames_fts/i);
    });
  });
});
