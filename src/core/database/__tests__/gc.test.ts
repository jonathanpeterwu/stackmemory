/**
 * Tests for incremental garbage collection in SQLiteAdapter
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteAdapter } from '../sqlite-adapter.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Garbage Collection', () => {
  let adapter: SQLiteAdapter;
  let dbPath: string;

  beforeEach(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackmemory-gc-'));
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

  /**
   * Helper: insert a frame with a specific created_at timestamp and retention_policy
   */
  function insertFrame(opts: {
    frameId: string;
    createdAt: number;
    retentionPolicy?: string;
  }): void {
    const db = adapter.getRawDatabase()!;
    db.prepare(
      `INSERT INTO frames (frame_id, run_id, project_id, type, name, state, depth, inputs, outputs, digest_json, created_at, retention_policy)
       VALUES (?, 'run-1', 'test-project', 'task', ?, 'active', 0, '{}', '{}', '{}', ?, ?)`
    ).run(
      opts.frameId,
      `frame-${opts.frameId}`,
      opts.createdAt,
      opts.retentionPolicy ?? 'default'
    );
  }

  function insertEvent(frameId: string, eventId: string): void {
    const db = adapter.getRawDatabase()!;
    db.prepare(
      `INSERT INTO events (event_id, run_id, frame_id, seq, event_type, payload)
       VALUES (?, 'run-1', ?, 0, 'test', '{}')`
    ).run(eventId, frameId);
  }

  function insertAnchor(frameId: string, anchorId: string): void {
    const db = adapter.getRawDatabase()!;
    db.prepare(
      `INSERT INTO anchors (anchor_id, frame_id, project_id, type, text, priority)
       VALUES (?, ?, 'test-project', 'pin', 'test anchor', 0)`
    ).run(anchorId, frameId);
  }

  function countRows(table: string): number {
    const db = adapter.getRawDatabase()!;
    return (
      db.prepare(`SELECT COUNT(*) as count FROM ${table}`).get() as {
        count: number;
      }
    ).count;
  }

  const nowSec = Math.floor(Date.now() / 1000);
  const daysAgo = (d: number) => nowSec - d * 86400;

  it('should delete frames older than retention period', async () => {
    insertFrame({ frameId: 'old-1', createdAt: daysAgo(100) });
    insertFrame({ frameId: 'old-2', createdAt: daysAgo(95) });
    insertFrame({ frameId: 'recent-1', createdAt: daysAgo(10) });

    const result = await adapter.runGC({ retentionDays: 90 });

    expect(result.framesDeleted).toBe(2);
    expect(countRows('frames')).toBe(1);

    // The recent frame should still exist
    const remaining = await adapter.getFrame('recent-1');
    expect(remaining).not.toBeNull();
  });

  it('should respect keep_forever policy', async () => {
    insertFrame({
      frameId: 'forever-1',
      createdAt: daysAgo(365),
      retentionPolicy: 'keep_forever',
    });
    insertFrame({ frameId: 'old-1', createdAt: daysAgo(100) });

    const result = await adapter.runGC({ retentionDays: 90 });

    expect(result.framesDeleted).toBe(1);
    expect(countRows('frames')).toBe(1);

    const kept = await adapter.getFrame('forever-1');
    expect(kept).not.toBeNull();
  });

  it('should cascade deletes to events, anchors', async () => {
    insertFrame({ frameId: 'old-1', createdAt: daysAgo(100) });
    insertEvent('old-1', 'evt-1');
    insertEvent('old-1', 'evt-2');
    insertAnchor('old-1', 'anc-1');

    insertFrame({ frameId: 'recent-1', createdAt: daysAgo(10) });
    insertEvent('recent-1', 'evt-3');

    const result = await adapter.runGC({ retentionDays: 90 });

    expect(result.framesDeleted).toBe(1);
    expect(result.eventsDeleted).toBe(2);
    expect(result.anchorsDeleted).toBe(1);
    expect(countRows('events')).toBe(1);
    expect(countRows('anchors')).toBe(0);
  });

  it('should return counts without deleting on dry run', async () => {
    insertFrame({ frameId: 'old-1', createdAt: daysAgo(100) });
    insertEvent('old-1', 'evt-1');
    insertAnchor('old-1', 'anc-1');

    const result = await adapter.runGC({ retentionDays: 90, dryRun: true });

    expect(result.framesDeleted).toBe(1);
    expect(result.eventsDeleted).toBe(1);
    expect(result.anchorsDeleted).toBe(1);

    // Nothing actually deleted
    expect(countRows('frames')).toBe(1);
    expect(countRows('events')).toBe(1);
    expect(countRows('anchors')).toBe(1);
  });

  it('should limit frames processed per run via batchSize', async () => {
    for (let i = 0; i < 10; i++) {
      insertFrame({ frameId: `old-${i}`, createdAt: daysAgo(100 + i) });
    }

    const result = await adapter.runGC({ retentionDays: 90, batchSize: 3 });

    expect(result.framesDeleted).toBe(3);
    expect(countRows('frames')).toBe(7);
  });

  it('should handle ttl_7d policy correctly', async () => {
    insertFrame({
      frameId: 'ttl7-old',
      createdAt: daysAgo(10),
      retentionPolicy: 'ttl_7d',
    });
    insertFrame({
      frameId: 'ttl7-new',
      createdAt: daysAgo(3),
      retentionPolicy: 'ttl_7d',
    });

    const result = await adapter.runGC({ retentionDays: 90 });

    expect(result.framesDeleted).toBe(1);
    const deleted = await adapter.getFrame('ttl7-old');
    expect(deleted).toBeNull();
    const kept = await adapter.getFrame('ttl7-new');
    expect(kept).not.toBeNull();
  });

  it('should handle ttl_30d policy correctly', async () => {
    insertFrame({
      frameId: 'ttl30-old',
      createdAt: daysAgo(35),
      retentionPolicy: 'ttl_30d',
    });
    insertFrame({
      frameId: 'ttl30-new',
      createdAt: daysAgo(15),
      retentionPolicy: 'ttl_30d',
    });

    const result = await adapter.runGC({ retentionDays: 90 });

    expect(result.framesDeleted).toBe(1);
    const deleted = await adapter.getFrame('ttl30-old');
    expect(deleted).toBeNull();
    const kept = await adapter.getFrame('ttl30-new');
    expect(kept).not.toBeNull();
  });

  it('should handle archive policy same as default', async () => {
    insertFrame({
      frameId: 'archive-old',
      createdAt: daysAgo(100),
      retentionPolicy: 'archive',
    });
    insertFrame({
      frameId: 'archive-new',
      createdAt: daysAgo(10),
      retentionPolicy: 'archive',
    });

    const result = await adapter.runGC({ retentionDays: 90 });

    expect(result.framesDeleted).toBe(1);
    const deleted = await adapter.getFrame('archive-old');
    expect(deleted).toBeNull();
    const kept = await adapter.getFrame('archive-new');
    expect(kept).not.toBeNull();
  });

  it('should return zeros when no frames match', async () => {
    insertFrame({ frameId: 'recent-1', createdAt: daysAgo(5) });

    const result = await adapter.runGC({ retentionDays: 90 });

    expect(result.framesDeleted).toBe(0);
    expect(result.eventsDeleted).toBe(0);
    expect(result.anchorsDeleted).toBe(0);
    expect(result.embeddingsDeleted).toBe(0);
    expect(result.ftsEntriesDeleted).toBe(0);
  });

  it('should remove FTS entries when frames are deleted (via trigger)', async () => {
    // Insert through the adapter so FTS trigger fires
    const frameId = await adapter.createFrame({
      run_id: 'run-1',
      project_id: 'test-project',
      type: 'task',
      name: 'searchable gc target',
      digest_text: 'this frame will be garbage collected',
    });

    // Backdate it so it qualifies for GC
    const db = adapter.getRawDatabase()!;
    db.prepare('UPDATE frames SET created_at = ? WHERE frame_id = ?').run(
      daysAgo(100),
      frameId
    );

    // Verify it is searchable before GC
    let results = await adapter.search({ query: 'searchable' });
    expect(results.length).toBe(1);

    await adapter.runGC({ retentionDays: 90 });

    // After GC, FTS should no longer return it
    results = await adapter.search({ query: 'searchable' });
    expect(results.length).toBe(0);
  });
});
