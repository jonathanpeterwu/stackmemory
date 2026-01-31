/**
 * Tests for SessionManager - Consolidated
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager, FrameQueryMode, Session } from '../session-manager.js';
import * as fs from 'fs/promises';

vi.mock('fs/promises', () => ({
  mkdir: vi.fn().mockResolvedValue(undefined),
  readdir: vi.fn().mockResolvedValue([]),
  readFile: vi.fn(),
  writeFile: vi.fn().mockResolvedValue(undefined),
  rename: vi.fn().mockResolvedValue(undefined),
  unlink: vi.fn().mockResolvedValue(undefined),
  stat: vi.fn(),
  access: vi.fn(),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn().mockReturnValue('main\n'),
}));

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    // @ts-expect-error accessing private static field for testing
    SessionManager.instance = undefined;
    manager = SessionManager.getInstance();
    await manager.initialize();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('singleton', () => {
    it('should return singleton instance', () => {
      expect(SessionManager.getInstance()).toBe(SessionManager.getInstance());
    });
  });

  describe('FrameQueryMode', () => {
    it('should have correct query mode values', () => {
      expect(FrameQueryMode.CURRENT_SESSION).toBe('current');
      expect(FrameQueryMode.PROJECT_ACTIVE).toBe('project');
      expect(FrameQueryMode.ALL_ACTIVE).toBe('all');
    });
  });

  describe('session lifecycle', () => {
    it('should create session with correct structure', async () => {
      const session = await manager.createSession({
        projectId: 'test-project',
        branch: 'main',
        metadata: { tags: ['test'] },
      });

      expect(session).toMatchObject({
        sessionId: expect.any(String),
        projectId: 'test-project',
        branch: 'main',
        state: 'active',
      });
      expect(session.metadata.tags).toContain('test');
      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should load existing session', async () => {
      const mockSession: Session = {
        sessionId: 'test-session-id',
        runId: 'test-run-id',
        projectId: 'test-project',
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
        metadata: {},
        state: 'active',
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(mockSession));
      const loaded = await manager.loadSession('test-session-id');
      expect(loaded?.sessionId).toBe('test-session-id');
    });

    it('should return null for non-existent session', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
      expect(await manager.loadSession('nonexistent')).toBeNull();
    });
  });

  describe('session state transitions', () => {
    it('should suspend and resume sessions', async () => {
      const session = await manager.createSession({
        projectId: 'test-project',
      });
      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(session));

      await manager.suspendSession(session.sessionId);
      expect(fs.writeFile).toHaveBeenCalled();

      await manager.resumeSession(session.sessionId);
      expect(fs.writeFile).toHaveBeenCalled();
    });
  });
});
