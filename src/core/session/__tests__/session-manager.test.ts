/**
 * Tests for SessionManager
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager, FrameQueryMode, Session } from '../session-manager.js';
import * as fs from 'fs/promises';

// Mock fs operations
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

// Mock child_process
vi.mock('child_process', () => ({
  execSync: vi.fn().mockReturnValue('main\n'),
}));

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(async () => {
    vi.clearAllMocks();
    // Reset singleton by accessing private instance
    // @ts-expect-error accessing private static field for testing
    SessionManager.instance = undefined;
    manager = SessionManager.getInstance();
    await manager.initialize();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = SessionManager.getInstance();
      const instance2 = SessionManager.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('initialize', () => {
    it('should create session directories', async () => {
      expect(fs.mkdir).toHaveBeenCalled();
    });
  });

  describe('FrameQueryMode', () => {
    it('should have correct query mode values', () => {
      expect(FrameQueryMode.CURRENT_SESSION).toBe('current');
      expect(FrameQueryMode.PROJECT_ACTIVE).toBe('project');
      expect(FrameQueryMode.ALL_ACTIVE).toBe('all');
      expect(FrameQueryMode.HISTORICAL).toBe('historical');
    });
  });

  describe('createSession', () => {
    it('should create new session with correct structure', async () => {
      const session = await manager.createSession({
        projectId: 'test-project',
        branch: 'main',
      });

      expect(session).toMatchObject({
        sessionId: expect.any(String),
        runId: expect.any(String),
        projectId: 'test-project',
        branch: 'main',
        state: 'active',
      });
      expect(session.startedAt).toBeDefined();
      expect(session.lastActiveAt).toBeDefined();
    });

    it('should save session to file', async () => {
      await manager.createSession({
        projectId: 'test-project',
      });

      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should include metadata', async () => {
      const session = await manager.createSession({
        projectId: 'test-project',
        metadata: {
          tags: ['test', 'integration'],
        },
      });

      // User is set from process.env.USER, so just check it exists
      expect(session.metadata.user).toBeDefined();
      expect(session.metadata.tags).toContain('test');
      expect(session.metadata.tags).toContain('integration');
    });
  });

  describe('loadSession', () => {
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

      expect(loaded).toMatchObject({
        sessionId: 'test-session-id',
        projectId: 'test-project',
      });
    });

    it('should return null for non-existent session', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      const loaded = await manager.loadSession('nonexistent');

      expect(loaded).toBeNull();
    });

    it('should try history directory as fallback', async () => {
      const historySession: Session = {
        sessionId: 'history-session',
        runId: 'history-run',
        projectId: 'test-project',
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
        metadata: {},
        state: 'closed',
      };

      vi.mocked(fs.readFile)
        .mockRejectedValueOnce(new Error('ENOENT'))
        .mockResolvedValueOnce(JSON.stringify(historySession));

      const loaded = await manager.loadSession('history-session');

      expect(loaded?.state).toBe('closed');
    });
  });

  describe('saveSession', () => {
    it('should save session to correct path', async () => {
      const session: Session = {
        sessionId: 'save-test-id',
        runId: 'save-run-id',
        projectId: 'test-project',
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
        metadata: {},
        state: 'active',
      };

      await manager.saveSession(session);

      expect(fs.writeFile).toHaveBeenCalledWith(
        expect.stringContaining('save-test-id.json'),
        expect.any(String)
      );
    });
  });

  describe('suspendSession', () => {
    it('should update session state to suspended', async () => {
      const session = await manager.createSession({
        projectId: 'test-project',
      });

      vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(session));

      await manager.suspendSession(session.sessionId);

      expect(fs.writeFile).toHaveBeenCalled();
    });

    it('should handle no current session', async () => {
      await manager.suspendSession();

      // Should not throw
      expect(true).toBe(true);
    });
  });

  describe('resumeSession', () => {
    it('should resume suspended session', async () => {
      const suspendedSession: Session = {
        sessionId: 'suspended-id',
        runId: 'suspended-run',
        projectId: 'test-project',
        startedAt: Date.now(),
        lastActiveAt: Date.now() - 10000,
        metadata: {},
        state: 'suspended',
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(suspendedSession)
      );

      const resumed = await manager.resumeSession('suspended-id');

      expect(resumed.state).toBe('active');
    });

    it('should throw for non-existent session', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      await expect(manager.resumeSession('nonexistent')).rejects.toThrow(
        'Session not found'
      );
    });
  });

  describe('closeSession', () => {
    it('should close and move session to history', async () => {
      const session = await manager.createSession({
        projectId: 'test-project',
      });

      vi.mocked(fs.readFile).mockResolvedValueOnce(JSON.stringify(session));

      await manager.closeSession(session.sessionId);

      expect(fs.rename).toHaveBeenCalled();
    });
  });

  describe('listSessions', () => {
    it('should list all active sessions', async () => {
      const mockFiles = ['session1.json', 'session2.json', 'projects'];
      vi.mocked(fs.readdir).mockResolvedValueOnce(mockFiles as any);

      const mockSession: Session = {
        sessionId: 'session1',
        runId: 'run1',
        projectId: 'test-project',
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
        metadata: {},
        state: 'active',
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockSession));

      const sessions = await manager.listSessions();

      expect(Array.isArray(sessions)).toBe(true);
    });

    it('should filter by project', async () => {
      const mockFiles = ['session1.json'];
      vi.mocked(fs.readdir).mockResolvedValueOnce(mockFiles as any);

      const mockSession: Session = {
        sessionId: 'session1',
        runId: 'run1',
        projectId: 'target-project',
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
        metadata: {},
        state: 'active',
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockSession));

      const sessions = await manager.listSessions({
        projectId: 'target-project',
      });

      expect(sessions.every((s) => s.projectId === 'target-project')).toBe(
        true
      );
    });

    it('should filter by state', async () => {
      const mockFiles = ['session1.json'];
      vi.mocked(fs.readdir).mockResolvedValueOnce(mockFiles as any);

      const mockSession: Session = {
        sessionId: 'session1',
        runId: 'run1',
        projectId: 'test-project',
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
        metadata: {},
        state: 'active',
      };

      vi.mocked(fs.readFile).mockResolvedValue(JSON.stringify(mockSession));

      const sessions = await manager.listSessions({ state: 'active' });

      expect(sessions.every((s) => s.state === 'active')).toBe(true);
    });
  });

  describe('mergeSessions', () => {
    it('should merge source into target', async () => {
      const sourceSession: Session = {
        sessionId: 'source-id',
        runId: 'source-run',
        projectId: 'test-project',
        startedAt: Date.now() - 10000,
        lastActiveAt: Date.now() - 5000,
        metadata: { tags: ['source-tag'] },
        state: 'active',
      };

      const targetSession: Session = {
        sessionId: 'target-id',
        runId: 'target-run',
        projectId: 'test-project',
        startedAt: Date.now() - 20000,
        lastActiveAt: Date.now() - 15000,
        metadata: { tags: ['target-tag'] },
        state: 'active',
      };

      vi.mocked(fs.readFile)
        .mockResolvedValueOnce(JSON.stringify(sourceSession))
        .mockResolvedValueOnce(JSON.stringify(targetSession))
        .mockResolvedValueOnce(JSON.stringify(sourceSession)); // For close

      const merged = await manager.mergeSessions('source-id', 'target-id');

      expect(merged.sessionId).toBe('target-id');
      expect(merged.metadata.tags).toContain('source-tag');
      expect(merged.metadata.tags).toContain('target-tag');
    });

    it('should throw if session not found', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));

      await expect(
        manager.mergeSessions('nonexistent1', 'nonexistent2')
      ).rejects.toThrow('Session not found');
    });
  });

  describe('cleanupStaleSessions', () => {
    it('should clean up old sessions', async () => {
      vi.mocked(fs.readdir).mockResolvedValueOnce(['old-session.json'] as any);
      vi.mocked(fs.stat).mockResolvedValueOnce({
        mtimeMs: Date.now() - 40 * 24 * 60 * 60 * 1000, // 40 days ago
      } as any);

      const cleaned = await manager.cleanupStaleSessions();

      expect(cleaned).toBe(1);
      expect(fs.unlink).toHaveBeenCalled();
    });

    it('should respect max age parameter', async () => {
      vi.mocked(fs.readdir).mockResolvedValueOnce([
        'recent-session.json',
      ] as any);
      vi.mocked(fs.stat).mockResolvedValueOnce({
        mtimeMs: Date.now() - 5 * 24 * 60 * 60 * 1000, // 5 days ago
      } as any);

      const cleaned = await manager.cleanupStaleSessions(
        7 * 24 * 60 * 60 * 1000
      );

      expect(cleaned).toBe(0);
      expect(fs.unlink).not.toHaveBeenCalled();
    });
  });

  describe('getCurrentSession', () => {
    it('should return current session after create', async () => {
      const session = await manager.createSession({
        projectId: 'test-project',
      });

      const current = manager.getCurrentSession();

      expect(current?.sessionId).toBe(session.sessionId);
    });

    it('should return null if no current session', () => {
      // Reset to simulate no current session
      // @ts-expect-error accessing private static field
      SessionManager.instance = undefined;
      const freshManager = SessionManager.getInstance();

      const current = freshManager.getCurrentSession();

      expect(current).toBeNull();
    });
  });

  describe('getSessionRunId', () => {
    it('should return run ID from current session', async () => {
      const session = await manager.createSession({
        projectId: 'test-project',
      });

      const runId = manager.getSessionRunId();

      expect(runId).toBe(session.runId);
    });

    it('should generate new UUID if no current session', () => {
      // Reset to ensure no current session
      // @ts-expect-error accessing private static field
      SessionManager.instance = undefined;
      const freshManager = SessionManager.getInstance();

      const runId = freshManager.getSessionRunId();

      expect(runId).toBeDefined();
      expect(runId.length).toBeGreaterThan(0);
    });
  });

  describe('getOrCreateSession', () => {
    it('should load session if sessionId provided', async () => {
      const existingSession: Session = {
        sessionId: 'existing-id',
        runId: 'existing-run',
        projectId: 'test-project',
        startedAt: Date.now(),
        lastActiveAt: Date.now(),
        metadata: {},
        state: 'active',
      };

      vi.mocked(fs.readFile).mockResolvedValueOnce(
        JSON.stringify(existingSession)
      );

      const session = await manager.getOrCreateSession({
        sessionId: 'existing-id',
      });

      expect(session.sessionId).toBe('existing-id');
    });

    it('should create new session if none exists', async () => {
      vi.mocked(fs.readFile).mockRejectedValue(new Error('ENOENT'));
      vi.mocked(fs.readdir).mockResolvedValue([]);

      const session = await manager.getOrCreateSession({
        projectPath: '/test/project',
      });

      expect(session.sessionId).toBeDefined();
      expect(session.state).toBe('active');
    });
  });
});
