/**
 * Tests for embedding backfill resumability in maintenance service
 * Covers: maintenance_state table, checkpoint tracking, progress reporting
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SQLiteAdapter } from '../../../core/database/sqlite-adapter.js';
import type { EmbeddingProvider } from '../../../core/database/embedding-provider.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

/**
 * Creates a mock embedding provider that returns deterministic vectors
 */
function createMockEmbeddingProvider(dimension = 384): EmbeddingProvider {
  return {
    dimension,
    embed: vi.fn(async (_text: string) => Array(dimension).fill(0.1)),
    embedBatch: vi.fn(async (texts: string[]) =>
      texts.map(() => Array(dimension).fill(0.1))
    ),
  };
}

/**
 * Create a regular frame_embeddings table as a stand-in for
 * the sqlite-vec virtual table (which requires the native extension).
 * getFramesMissingEmbeddings only does a LEFT JOIN on frame_id.
 */
function createFakeEmbeddingsTable(adapter: SQLiteAdapter): void {
  const db = adapter.getRawDatabase()!;
  db.exec(`
    CREATE TABLE IF NOT EXISTS frame_embeddings (
      frame_id TEXT PRIMARY KEY
    );
  `);
}

/**
 * Insert a frame_id into the fake embeddings table (simulates storeEmbedding).
 */
function fakeStoreEmbedding(adapter: SQLiteAdapter, frameId: string): void {
  const db = adapter.getRawDatabase()!;
  db.prepare(
    'INSERT OR REPLACE INTO frame_embeddings (frame_id) VALUES (?)'
  ).run(frameId);
}

describe('Maintenance State', () => {
  let adapter: SQLiteAdapter;
  let dbPath: string;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackmemory-maint-state-'));
    dbPath = path.join(tmpDir, 'test.db');
    adapter = new SQLiteAdapter('test-project', { dbPath });
    await adapter.connect();
    await adapter.initializeSchema();
  });

  afterEach(async () => {
    await adapter.disconnect();
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  it('should round-trip getMaintenanceState/setMaintenanceState', async () => {
    // Initially null
    const val = await adapter.getMaintenanceState('test_key');
    expect(val).toBeNull();

    // Set and retrieve
    await adapter.setMaintenanceState('test_key', 'hello');
    const result = await adapter.getMaintenanceState('test_key');
    expect(result).toBe('hello');

    // Overwrite
    await adapter.setMaintenanceState('test_key', 'world');
    const updated = await adapter.getMaintenanceState('test_key');
    expect(updated).toBe('world');
  });

  it('should handle multiple keys independently', async () => {
    await adapter.setMaintenanceState('key_a', '100');
    await adapter.setMaintenanceState('key_b', '200');

    expect(await adapter.getMaintenanceState('key_a')).toBe('100');
    expect(await adapter.getMaintenanceState('key_b')).toBe('200');
    expect(await adapter.getMaintenanceState('key_c')).toBeNull();
  });

  it('should store updated_at timestamp', async () => {
    await adapter.setMaintenanceState('ts_key', 'val');

    const db = adapter.getRawDatabase()!;
    const row = db
      .prepare('SELECT updated_at FROM maintenance_state WHERE key = ?')
      .get('ts_key') as { updated_at: number };

    expect(row.updated_at).toBeGreaterThan(0);
    expect(row.updated_at).toBeLessThanOrEqual(Date.now());
  });
});

describe('getFramesMissingEmbeddings with sinceRowid', () => {
  let adapter: SQLiteAdapter;
  let dbPath: string;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackmemory-missing-emb-'));
    dbPath = path.join(tmpDir, 'test.db');
    adapter = new SQLiteAdapter('test-project', { dbPath });
    await adapter.connect();
    await adapter.initializeSchema();
    // sqlite-vec is not available in test env; create a stand-in table
    createFakeEmbeddingsTable(adapter);
  });

  afterEach(async () => {
    await adapter.disconnect();
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  it('should return all frames when sinceRowid is not provided', async () => {
    for (let i = 0; i < 5; i++) {
      await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'test-project',
        type: 'task',
        name: `frame-${i}`,
      });
    }

    const frames = await adapter.getFramesMissingEmbeddings(10);
    expect(frames.length).toBe(5);
  });

  it('should filter frames by sinceRowid cursor', async () => {
    const frameIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'test-project',
        type: 'task',
        name: `frame-${i}`,
      });
      frameIds.push(id);
    }

    // Get the rowid of the 3rd frame (index 2)
    const db = adapter.getRawDatabase()!;
    const thirdRow = db
      .prepare('SELECT rowid FROM frames WHERE frame_id = ?')
      .get(frameIds[2]) as { rowid: number };

    // Only frames with rowid > thirdRow.rowid should be returned
    const frames = await adapter.getFramesMissingEmbeddings(10, thirdRow.rowid);
    expect(frames.length).toBe(2);
    expect(frames.map((f) => f.frame_id)).toContain(frameIds[3]);
    expect(frames.map((f) => f.frame_id)).toContain(frameIds[4]);
  });

  it('should return frames ordered by rowid ascending', async () => {
    const frameIds: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'test-project',
        type: 'task',
        name: `frame-${i}`,
      });
      frameIds.push(id);
    }

    const frames = await adapter.getFramesMissingEmbeddings(10);
    // Should be in insertion order (rowid ascending)
    expect(frames[0].frame_id).toBe(frameIds[0]);
    expect(frames[1].frame_id).toBe(frameIds[1]);
    expect(frames[2].frame_id).toBe(frameIds[2]);
  });
});

describe('Embedding Backfill Resumability', () => {
  let adapter: SQLiteAdapter;
  let dbPath: string;
  let tmpDir: string;
  let mockProvider: EmbeddingProvider;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'stackmemory-backfill-resume-')
    );
    dbPath = path.join(tmpDir, 'test.db');
    mockProvider = createMockEmbeddingProvider();
    adapter = new SQLiteAdapter('test-project', {
      dbPath,
      embeddingProvider: mockProvider,
    });
    await adapter.connect();
    await adapter.initializeSchema();
    // sqlite-vec is not available in test env; create a stand-in table
    createFakeEmbeddingsTable(adapter);
  });

  afterEach(async () => {
    await adapter.disconnect();
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  it('should track backfill checkpoint in maintenance_state', async () => {
    // Insert 5 frames
    const frameIds: string[] = [];
    for (let i = 0; i < 5; i++) {
      const id = await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'test-project',
        type: 'task',
        name: `frame-${i}`,
        digest_text: `description for frame ${i}`,
      });
      frameIds.push(id);
    }

    // Process first batch of 2
    const batch1 = await adapter.getFramesMissingEmbeddings(2);
    expect(batch1.length).toBe(2);

    for (const frame of batch1) {
      fakeStoreEmbedding(adapter, frame.frame_id);
    }

    // Record checkpoint: get rowid of last processed frame
    const db = adapter.getRawDatabase()!;
    const lastRow = db
      .prepare('SELECT rowid FROM frames WHERE frame_id = ?')
      .get(batch1[batch1.length - 1].frame_id) as { rowid: number };

    await adapter.setMaintenanceState(
      'embedding_backfill_last_id',
      String(lastRow.rowid)
    );

    // Now get next batch using checkpoint
    const checkpoint = await adapter.getMaintenanceState(
      'embedding_backfill_last_id'
    );
    expect(checkpoint).toBe(String(lastRow.rowid));

    const batch2 = await adapter.getFramesMissingEmbeddings(
      10,
      parseInt(checkpoint!, 10)
    );
    // Should return the remaining 3 frames
    expect(batch2.length).toBe(3);

    // Verify batch2 does NOT contain frames from batch1
    const batch1Ids = new Set(batch1.map((f) => f.frame_id));
    for (const frame of batch2) {
      expect(batch1Ids.has(frame.frame_id)).toBe(false);
    }
  });

  it('should resume backfill after partial processing', async () => {
    // Insert 6 frames
    for (let i = 0; i < 6; i++) {
      await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'test-project',
        type: 'task',
        name: `frame-${i}`,
        digest_text: `text ${i}`,
      });
    }

    // Simulate first run: process batch of 3
    const batch1 = await adapter.getFramesMissingEmbeddings(3);
    expect(batch1.length).toBe(3);

    const db = adapter.getRawDatabase()!;
    let lastRowid = 0;
    for (const frame of batch1) {
      fakeStoreEmbedding(adapter, frame.frame_id);

      const rowInfo = db
        .prepare('SELECT rowid FROM frames WHERE frame_id = ?')
        .get(frame.frame_id) as { rowid: number };
      lastRowid = rowInfo.rowid;
    }

    // Save checkpoint
    await adapter.setMaintenanceState(
      'embedding_backfill_last_id',
      String(lastRowid)
    );
    await adapter.setMaintenanceState('embedding_backfill_completed', '3');
    await adapter.setMaintenanceState('embedding_backfill_total', '6');

    // Simulate second run: resume from checkpoint
    const savedLastId = await adapter.getMaintenanceState(
      'embedding_backfill_last_id'
    );
    const batch2 = await adapter.getFramesMissingEmbeddings(
      10,
      parseInt(savedLastId!, 10)
    );
    expect(batch2.length).toBe(3);

    // Process remaining frames
    for (const frame of batch2) {
      fakeStoreEmbedding(adapter, frame.frame_id);
    }

    // Verify all frames now have embeddings
    const remaining = await adapter.getFramesMissingEmbeddings(10);
    expect(remaining.length).toBe(0);

    // Update completed count
    const prevCompleted = await adapter.getMaintenanceState(
      'embedding_backfill_completed'
    );
    const totalCompleted = parseInt(prevCompleted!, 10) + batch2.length;
    await adapter.setMaintenanceState(
      'embedding_backfill_completed',
      String(totalCompleted)
    );

    // Verify progress state
    const finalCompleted = await adapter.getMaintenanceState(
      'embedding_backfill_completed'
    );
    expect(parseInt(finalCompleted!, 10)).toBe(6);

    const total = await adapter.getMaintenanceState('embedding_backfill_total');
    const embeddingsRemaining =
      parseInt(total!, 10) - parseInt(finalCompleted!, 10);
    expect(embeddingsRemaining).toBe(0);
  });

  it('should track total and completed counts for progress reporting', async () => {
    // Set up progress tracking state
    await adapter.setMaintenanceState('embedding_backfill_total', '100');
    await adapter.setMaintenanceState('embedding_backfill_completed', '42');

    const total = await adapter.getMaintenanceState('embedding_backfill_total');
    const completed = await adapter.getMaintenanceState(
      'embedding_backfill_completed'
    );

    expect(parseInt(total!, 10)).toBe(100);
    expect(parseInt(completed!, 10)).toBe(42);

    const remaining = parseInt(total!, 10) - parseInt(completed!, 10);
    expect(remaining).toBe(58);
  });

  it('should handle empty database gracefully', async () => {
    // No frames at all
    const frames = await adapter.getFramesMissingEmbeddings(10);
    expect(frames.length).toBe(0);

    const frames2 = await adapter.getFramesMissingEmbeddings(10, 0);
    expect(frames2.length).toBe(0);
  });

  it('should handle sinceRowid beyond all existing rows', async () => {
    await adapter.createFrame({
      run_id: 'run-1',
      project_id: 'test-project',
      type: 'task',
      name: 'single-frame',
    });

    // Use a very large sinceRowid
    const frames = await adapter.getFramesMissingEmbeddings(10, 999999);
    expect(frames.length).toBe(0);
  });
});
