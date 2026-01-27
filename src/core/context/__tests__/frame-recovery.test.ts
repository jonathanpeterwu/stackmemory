/**
 * Tests for Frame Recovery System
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { FrameRecovery } from '../frame-recovery.js';
import { FrameDatabase } from '../frame-database.js';
import { v4 as uuidv4 } from 'uuid';

describe('FrameRecovery', () => {
  let db: Database.Database;
  let recovery: FrameRecovery;
  let frameDb: FrameDatabase;

  beforeEach(() => {
    db = new Database(':memory:');
    frameDb = new FrameDatabase(db);
    frameDb.initSchema();
    recovery = new FrameRecovery(db);
  });

  afterEach(() => {
    db.close();
  });

  it('should complete recovery and handle orphaned frames correctly', async () => {
    // Test 1: Clean database recovery
    let report = await recovery.recoverOnStartup();
    expect(report.recovered).toBe(true);
    expect(report.integrityCheck.passed).toBe(true);
    expect(report.orphanedFrames.detected).toBe(0);

    // Test 2: Detect and close orphaned frames
    const projectId = 'test-project';
    const oldRunId = 'old-run-' + uuidv4();
    const currentRunId = 'current-run-' + uuidv4();

    const oldTimestamp = Math.floor(Date.now() / 1000) - 48 * 3600;
    db.prepare(
      `
      INSERT INTO frames (frame_id, run_id, project_id, name, type, state, depth, created_at, inputs, outputs, digest_json)
      VALUES (?, ?, ?, ?, ?, 'active', 0, ?, '{}', '{}', '{}')
    `
    ).run(
      uuidv4(),
      oldRunId,
      projectId,
      'orphaned-frame',
      'task',
      oldTimestamp
    );

    recovery.setCurrentRunId(currentRunId);
    report = await recovery.recoverOnStartup();
    expect(report.orphanedFrames.detected).toBe(1);
    expect(report.orphanedFrames.closed).toBe(1);
  });

  it('should exclude current session frames from orphan detection', async () => {
    const projectId = 'test-project';
    const currentRunId = 'current-run-' + uuidv4();

    const recentTimestamp = Math.floor(Date.now() / 1000) - 3600;
    db.prepare(
      `
      INSERT INTO frames (frame_id, run_id, project_id, name, type, state, depth, created_at, inputs, outputs, digest_json)
      VALUES (?, ?, ?, ?, ?, 'active', 0, ?, '{}', '{}', '{}')
    `
    ).run(
      uuidv4(),
      currentRunId,
      projectId,
      'current-frame',
      'task',
      recentTimestamp
    );

    recovery.setCurrentRunId(currentRunId);
    const report = await recovery.recoverOnStartup();
    expect(report.orphanedFrames.detected).toBe(0);
  });

  it('should validate integrity and detect depth inconsistencies', () => {
    // Test integrity check with valid data
    const integrityResult = recovery.runIntegrityCheck();
    expect(integrityResult.passed).toBe(true);
    expect(integrityResult.foreignKeyViolations).toBe(0);

    // Test clean project validation
    const projectId = 'test-project';
    let projectResult = recovery.validateProjectIntegrity(projectId);
    expect(projectResult.valid).toBe(true);

    // Test depth inconsistency detection
    const parentId = uuidv4();
    const childId = uuidv4();

    db.prepare(
      `
      INSERT INTO frames (frame_id, run_id, project_id, name, type, state, depth, created_at, inputs, outputs, digest_json)
      VALUES (?, ?, ?, ?, ?, 'active', 0, unixepoch(), '{}', '{}', '{}')
    `
    ).run(parentId, 'run-1', projectId, 'parent', 'task');

    db.prepare(
      `
      INSERT INTO frames (frame_id, run_id, project_id, parent_frame_id, name, type, state, depth, created_at, inputs, outputs, digest_json)
      VALUES (?, ?, ?, ?, ?, ?, 'active', 5, unixepoch(), '{}', '{}', '{}')
    `
    ).run(childId, 'run-1', projectId, parentId, 'child', 'task');

    projectResult = recovery.validateProjectIntegrity(projectId);
    expect(projectResult.valid).toBe(false);
    expect(projectResult.issues[0]).toContain('incorrect depth');
  });

  it('should return recovery stats and WAL status', () => {
    const stats = recovery.getRecoveryStats();
    expect(stats).toHaveProperty('totalFrames');
    expect(stats).toHaveProperty('activeFrames');
    expect(stats).toHaveProperty('closedFrames');
    expect(stats).toHaveProperty('recoveredFrames');

    const walStatus = recovery.checkWalStatus();
    expect(walStatus).toHaveProperty('enabled');
    expect(walStatus).toHaveProperty('checkpointNeeded');
    expect(walStatus).toHaveProperty('walSize');
  });
});
