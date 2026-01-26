/**
 * Essential Tests for FrameManager
 * Reduced test suite focusing on critical functionality only
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { FrameManager } from '../index.js';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

describe('FrameManager', () => {
  let db: Database.Database;
  let frameManager: FrameManager;
  let tempDir: string;
  const projectId = 'test-project';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'stackmemory-test-'));
    const dbPath = join(tempDir, 'test.db');
    db = new Database(dbPath);
    frameManager = new FrameManager(db, projectId);
  });

  afterEach(() => {
    if (db) db.close();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  it('should initialize with correct schema', () => {
    const tables = db.prepare(`
      SELECT name FROM sqlite_master 
      WHERE type='table' AND name IN ('frames', 'events', 'anchors')
    `).all();
    expect(tables).toHaveLength(3);
  });

  it('should handle frame lifecycle', () => {
    // Create frame
    const frameId = frameManager.createFrame({
      type: 'task',
      name: 'Test Task',
      inputs: { test: true },
    });
    expect(frameId).toBeDefined();
    
    // Get frame
    const frame = frameManager.getFrame(frameId);
    expect(frame?.name).toBe('Test Task');
    expect(frame?.state).toBe('active');
    
    // Close frame
    frameManager.closeFrame(frameId, { success: true });
    const closed = frameManager.getFrame(frameId);
    expect(closed?.state).toBe('closed');
  });

  it('should handle nested frames', () => {
    const parentId = frameManager.createFrame({ type: 'task', name: 'Parent' });
    const childId = frameManager.createFrame({ type: 'subtask', name: 'Child' });
    
    const child = frameManager.getFrame(childId);
    expect(child?.parent_frame_id).toBe(parentId);
    expect(child?.depth).toBe(1);
  });

  it('should get frame by id', () => {
    const frameId = frameManager.createFrame({ type: 'task', name: 'Search Test' });
    const frame = frameManager.getFrame(frameId);
    expect(frame?.name).toBe('Search Test');
  });

  it('should track stack depth', () => {
    const depth1 = frameManager.getStackDepth();
    expect(depth1).toBe(0);
    
    frameManager.createFrame({ type: 'task', name: 'Frame 1' });
    const depth2 = frameManager.getStackDepth();
    expect(depth2).toBe(1);
  });
});