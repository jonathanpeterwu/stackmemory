/**
 * DualStackManager Integration Tests
 * Real database integration testing without complex mocks
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { DualStackManager } from '../dual-stack-manager.js';
import { FrameManager } from '../frame-manager.js';
import { SQLiteAdapter } from '../../database/sqlite-adapter.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('DualStackManager Integration', () => {
  let dualStackManager: DualStackManager;
  let sqliteAdapter: SQLiteAdapter;
  let testDir: string;
  let dbPath: string;
  const projectId = 'test-project';
  const userId = 'test-user';
  const teamId = 'test-team';

  beforeEach(async () => {
    // Create temporary directory for test database
    testDir = path.join(os.tmpdir(), `stackmemory-dual-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    dbPath = path.join(testDir, 'test.db');

    // Create real SQLite adapter
    sqliteAdapter = new SQLiteAdapter(projectId, { dbPath });
    await sqliteAdapter.connect();
    await sqliteAdapter.initializeSchema();

    // Create DualStackManager with SQLite adapter
    dualStackManager = new DualStackManager(sqliteAdapter, projectId, userId);
  });

  afterEach(async () => {
    // Clean up
    if (sqliteAdapter) {
      await sqliteAdapter.disconnect();
    }
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Initialization', () => {
    it('should initialize with individual stack as default', () => {
      const context = dualStackManager.getCurrentContext();

      expect(context.type).toBe('individual');
      expect(context.stackId).toBe(`individual-${userId}`);
      expect(context.projectId).toBe(projectId);
      expect(context.ownerId).toBe(userId);
      expect(context.permissions.canRead).toBe(true);
      expect(context.permissions.canWrite).toBe(true);
      expect(context.permissions.canHandoff).toBe(true);
    });

    it('should provide access to individual stack', () => {
      const activeStack = dualStackManager.getActiveStack();
      expect(activeStack).toBeDefined();
    });
  });

  describe('Shared Stack Management', () => {
    it('should create a new shared stack', async () => {
      const stackName = 'Team Collaboration Stack';
      const ownerId = userId; // Use current user as owner to avoid permission issues

      const sharedStackId = await dualStackManager.createSharedStack(
        teamId,
        stackName,
        ownerId
      );

      expect(sharedStackId).toMatch(/^shared-test-team-\d+$/);
    });

    it('should switch to shared stack', async () => {
      // Create a shared stack first
      const sharedStackId = await dualStackManager.createSharedStack(
        teamId,
        'Test Stack',
        userId
      );

      // Switch to the shared stack
      await dualStackManager.switchToStack(sharedStackId);

      const context = dualStackManager.getCurrentContext();
      expect(context.type).toBe('shared');
      expect(context.stackId).toBe(sharedStackId);
      expect(context.teamId).toBe(teamId);
    });

    it('should get list of available stacks', async () => {
      // Create a shared stack
      await dualStackManager.createSharedStack(teamId, 'Test Stack', userId);

      const stacks = await dualStackManager.getAvailableStacks();

      // Should have at least individual + shared stack
      expect(stacks.length).toBeGreaterThanOrEqual(2);
      expect(stacks.some((s) => s.type === 'individual')).toBe(true);
      expect(stacks.some((s) => s.type === 'shared')).toBe(true);
    });
  });

  describe('Frame Operations', () => {
    it('should delegate frame operations to active stack', async () => {
      const frameManager = dualStackManager.getActiveStack();

      // Create a frame
      const frameId = await frameManager.createFrame({
        name: 'Test Frame',
        type: 'task',
        inputs: { test: 'data' },
      });

      expect(frameId).toBeDefined();
      expect(typeof frameId).toBe('string');

      // Retrieve the frame
      const frame = await frameManager.getFrame(frameId);
      expect(frame).toBeDefined();
      expect(frame?.name).toBe('Test Frame');
      expect(frame?.type).toBe('task');
    });

    it('should maintain stack-specific frame isolation', async () => {
      // Create a frame in individual stack
      const individualFrame = await dualStackManager
        .getActiveStack()
        .createFrame({
          name: 'Individual Frame',
          type: 'task',
          inputs: {},
        });

      // Create and switch to shared stack
      const sharedStackId = await dualStackManager.createSharedStack(
        teamId,
        'Shared Stack',
        userId
      );
      await dualStackManager.switchToStack(sharedStackId);

      // Create a frame in shared stack
      const sharedFrame = await dualStackManager.getActiveStack().createFrame({
        name: 'Shared Frame',
        type: 'task',
        inputs: {},
      });

      // Frames should be different
      expect(individualFrame).not.toBe(sharedFrame);

      // Switch back to individual stack
      await dualStackManager.switchToStack(`individual-${userId}`);

      // Individual frame should still exist
      const retrievedFrame = await dualStackManager
        .getActiveStack()
        .getFrame(individualFrame);
      expect(retrievedFrame).toBeDefined();
      expect(retrievedFrame?.name).toBe('Individual Frame');
    });
  });

  describe('Basic Error Handling', () => {
    it('should handle invalid stack switching', async () => {
      await expect(
        dualStackManager.switchToStack('invalid-stack-id')
      ).rejects.toThrow();
    });

    it('should validate shared stack creation parameters', async () => {
      // Test empty team ID
      await expect(
        dualStackManager.createSharedStack('', 'Test Stack', userId)
      ).rejects.toThrow();

      // Test empty stack name
      await expect(
        dualStackManager.createSharedStack(teamId, '', userId)
      ).rejects.toThrow();

      // Test empty owner ID
      await expect(
        dualStackManager.createSharedStack(teamId, 'Test Stack', '')
      ).rejects.toThrow();
    });
  });

  describe('Stack Context Management', () => {
    it('should track stack activity', async () => {
      const context = dualStackManager.getCurrentContext();

      expect(context.createdAt).toBeDefined();
      expect(context.lastActive).toBeDefined();
      expect(context.metadata).toBeDefined();
    });

    it('should manage stack metadata', async () => {
      // Create shared stack with metadata
      const stackId = await dualStackManager.createSharedStack(
        teamId,
        'Test Stack',
        userId
      );

      await dualStackManager.switchToStack(stackId);
      const context = dualStackManager.getCurrentContext();

      expect(context.metadata).toBeDefined();
      expect(context.teamId).toBe(teamId);
    });
  });
});
