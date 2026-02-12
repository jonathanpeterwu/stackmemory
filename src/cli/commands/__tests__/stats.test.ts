import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Command } from 'commander';
import { createStatsCommand } from '../stats.js';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync, mkdirSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';

describe('stats command', () => {
  let consoleSpy: { log: ReturnType<typeof vi.spyOn> };
  let tempDir: string;
  let origCwd: () => string;

  beforeEach(() => {
    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
    };
    tempDir = mkdtempSync(join(tmpdir(), 'sm-stats-'));
    mkdirSync(join(tempDir, '.stackmemory'), { recursive: true });
    origCwd = process.cwd;
    process.cwd = () => tempDir;
  });

  afterEach(() => {
    process.cwd = origCwd;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('shows no-data message and stats with seeded data', async () => {
    // No table → no data message
    const db1 = new Database(join(tempDir, '.stackmemory', 'context.db'));
    db1.close();

    const p1 = new Command();
    p1.addCommand(createStatsCommand());
    await p1.parseAsync(['node', 'stackmemory', 'stats', 'edits']);
    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringContaining('No edit telemetry data')
    );

    // Seed data → shows stats
    consoleSpy.log.mockClear();
    const db2 = new Database(join(tempDir, '.stackmemory', 'context.db'));
    db2.exec(`
      CREATE TABLE IF NOT EXISTS edit_telemetry (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
        session_id TEXT, tool_name TEXT NOT NULL, file_path TEXT,
        success INTEGER NOT NULL DEFAULT 1, error_type TEXT, error_message TEXT
      );
    `);
    const now = Math.floor(Date.now() / 1000);
    const ins = db2.prepare(
      'INSERT INTO edit_telemetry (timestamp, tool_name, file_path, success, error_type, error_message) VALUES (?, ?, ?, ?, ?, ?)'
    );
    ins.run(now, 'Edit', '/src/foo.ts', 1, null, null);
    ins.run(now, 'Edit', '/src/foo.ts', 0, 'string_not_found', 'not found');
    db2.close();

    const p2 = new Command();
    p2.addCommand(createStatsCommand());
    await p2.parseAsync(['node', 'stackmemory', 'stats', 'edits']);
    expect(consoleSpy.log).toHaveBeenCalledWith(
      expect.stringContaining('Success Rate')
    );
  });
});
