/**
 * Tests for FTS5 Full-Text Search in SQLiteAdapter
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteAdapter } from '../sqlite-adapter.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('FTS5 Search', () => {
  let adapter: SQLiteAdapter;
  let dbPath: string;

  beforeEach(async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackmemory-fts-'));
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

  it('should enable FTS5 and return BM25-ranked results with custom boost', async () => {
    expect(adapter.getFeatures().supportsFullTextSearch).toBe(true);

    await adapter.createFrame({
      run_id: 'run-1',
      project_id: 'test-project',
      type: 'task',
      name: 'authentication login flow',
      digest_text: 'handles user auth',
    });
    await adapter.createFrame({
      run_id: 'run-1',
      project_id: 'test-project',
      type: 'task',
      name: 'database migration',
      digest_text: 'authentication schema migration for login',
    });
    await adapter.createFrame({
      run_id: 'run-1',
      project_id: 'test-project',
      type: 'task',
      name: 'plain name',
      inputs: JSON.stringify({ query: 'boosted content here' }),
    });
    await adapter.createFrame({
      run_id: 'run-1',
      project_id: 'test-project',
      type: 'task',
      name: 'boosted content here',
      inputs: JSON.stringify({}),
    });

    // BM25 ranking: name match scores higher than digest-only match
    const results = await adapter.search({ query: 'authentication' });
    expect(results.length).toBeGreaterThanOrEqual(2);
    const nameMatch = results.find(
      (r) => r.name === 'authentication login flow'
    );
    const digestMatch = results.find((r) => r.name === 'database migration');
    expect(nameMatch).toBeDefined();
    expect(digestMatch).toBeDefined();
    expect(nameMatch!.score).toBeGreaterThan(digestMatch!.score);

    // Custom boost: inputs weighted 20x, name 1x → inputs match wins
    const customResults = await adapter.search({
      query: 'boosted',
      boost: { name: 1, inputs: 20 },
    });
    expect(customResults[0].name).toBe('plain name');
  });

  it('should fall back to LIKE on bad FTS syntax and respect limit/offset', async () => {
    await adapter.createFrame({
      run_id: 'run-1',
      project_id: 'test-project',
      type: 'task',
      name: 'test frame',
      digest_text: 'hello world',
    });

    // Unbalanced quotes trigger LIKE fallback
    const results = await adapter.search({ query: '"unbalanced' });
    expect(Array.isArray(results)).toBe(true);

    // Limit/offset
    for (let i = 0; i < 5; i++) {
      await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'test-project',
        type: 'task',
        name: `search target item ${i}`,
        digest_text: `description ${i}`,
      });
    }
    const limited = await adapter.search({ query: 'target', limit: 2 });
    expect(limited.length).toBe(2);
    const offset = await adapter.search({
      query: 'target',
      limit: 2,
      offset: 3,
    });
    expect(offset.length).toBeLessThanOrEqual(2);
  });

  it('should keep FTS in sync after insert/update/delete and survive rebuild', async () => {
    const frameId = await adapter.createFrame({
      run_id: 'run-1',
      project_id: 'test-project',
      type: 'task',
      name: 'searchable original name',
      digest_text: 'original digest',
    });

    let results = await adapter.search({ query: 'searchable' });
    expect(results.length).toBe(1);

    await adapter.updateFrame(frameId, {
      digest_text: 'updated digest with searchable content',
    });
    results = await adapter.search({ query: 'updated' });
    expect(results.length).toBe(1);

    await adapter.deleteFrame(frameId);
    results = await adapter.search({ query: 'searchable' });
    expect(results.length).toBe(0);

    // Rebuild after re-inserting
    await adapter.createFrame({
      run_id: 'run-1',
      project_id: 'test-project',
      type: 'task',
      name: 'rebuild test',
      digest_text: 'testing rebuild',
    });
    await expect(adapter.rebuildFtsIndex()).resolves.not.toThrow();
    results = await adapter.search({ query: 'rebuild' });
    expect(results.length).toBe(1);
  });

  it('should populate FTS index for pre-existing data on schema init', async () => {
    const db = adapter.getRawDatabase()!;
    db.prepare(
      `
      INSERT INTO frames (frame_id, run_id, project_id, type, name, state, depth, inputs, outputs, digest_json)
      VALUES ('pre-existing', 'run-1', 'test-project', 'task', 'legacy data frame', 'active', 0, '{}', '{}', '{}')
    `
    ).run();

    const adapter2 = new SQLiteAdapter('test-project', { dbPath });
    await adapter2.connect();
    await adapter2.initializeSchema();

    const results = await adapter2.search({ query: 'legacy' });
    expect(results.length).toBeGreaterThanOrEqual(1);
    await adapter2.disconnect();
  });
});
