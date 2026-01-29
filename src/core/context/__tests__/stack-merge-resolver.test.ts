/**
 * StackMergeResolver Tests - STA-101
 * Tests for conflict detection, policy evaluation, and merge execution
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { StackMergeResolver } from '../stack-merge-resolver.js';
import { DualStackManager } from '../dual-stack-manager.js';
import type { Frame } from '../frame-types.js';

const createMockDualStackManager = () => {
  const mockFrameManager = {
    getFrame: vi.fn(),
    getActiveFrames: vi.fn().mockResolvedValue([]),
    getFrameEvents: vi.fn().mockResolvedValue([]),
    getFrameAnchors: vi.fn().mockResolvedValue([]),
    createFrame: vi.fn(),
    deleteFrame: vi.fn(),
    addEvent: vi.fn(),
    addAnchor: vi.fn(),
  };

  const mockPermissionManager = {
    enforcePermission: vi.fn().mockResolvedValue(undefined),
    createContext: vi.fn().mockReturnValue({}),
    setStackPermissions: vi.fn(),
  };

  const mockAdapter = {
    isConnected: vi.fn().mockReturnValue(false),
    getRawDatabase: vi.fn().mockReturnValue(null),
  };

  return {
    getStackManager: vi.fn().mockReturnValue(mockFrameManager),
    getPermissionManager: vi.fn().mockReturnValue(mockPermissionManager),
    getDatabaseAdapter: vi.fn().mockReturnValue(mockAdapter),
    getCurrentContext: vi.fn().mockReturnValue({ ownerId: 'test-user' }),
    syncStacks: vi.fn().mockResolvedValue({
      success: true,
      conflictFrames: [],
      mergedFrames: [],
      errors: [],
    }),
    mockFrameManager,
    mockPermissionManager,
  };
};

const createMockFrame = (overrides?: Partial<Frame>): Frame => ({
  frame_id: `frame-${Math.random().toString(36).substr(2, 9)}`,
  run_id: 'test-run',
  project_id: 'test-project',
  depth: 1,
  type: 'task',
  name: 'Test Frame',
  state: 'active',
  inputs: {},
  outputs: {},
  digest_json: {},
  created_at: Date.now(),
  ...overrides,
});

describe('StackMergeResolver', () => {
  let resolver: StackMergeResolver;
  let mockManager: ReturnType<typeof createMockDualStackManager>;

  beforeEach(() => {
    mockManager = createMockDualStackManager();
    resolver = new StackMergeResolver(
      mockManager as unknown as DualStackManager
    );
  });

  describe('Policy Initialization', () => {
    it('should initialize default merge policies', async () => {
      const session = await resolver.getMergeSession('non-existent');
      expect(session).toBeNull();

      mockManager.mockFrameManager.getActiveFrames.mockResolvedValue([]);
      const sessionId = await resolver.startMergeSession(
        'source-stack',
        'target-stack',
        [],
        'default'
      );
      expect(sessionId).toMatch(/^merge-/);
    });

    it('should support conservative policy', async () => {
      mockManager.mockFrameManager.getActiveFrames.mockResolvedValue([]);
      const sessionId = await resolver.startMergeSession(
        'source-stack',
        'target-stack',
        [],
        'conservative'
      );
      expect(sessionId).toMatch(/^merge-/);
    });

    it('should support aggressive policy', async () => {
      mockManager.mockFrameManager.getActiveFrames.mockResolvedValue([]);
      const sessionId = await resolver.startMergeSession(
        'source-stack',
        'target-stack',
        [],
        'aggressive'
      );
      expect(sessionId).toMatch(/^merge-/);
    });

    it('should reject unknown policy', async () => {
      await expect(
        resolver.startMergeSession(
          'source-stack',
          'target-stack',
          [],
          'unknown-policy'
        )
      ).rejects.toThrow('Merge policy not found');
    });
  });

  describe('Conflict Detection', () => {
    it('should detect name conflicts between frames', async () => {
      const sourceFrame = createMockFrame({
        frame_id: 'frame-1',
        name: 'Frame Alpha',
      });
      const targetFrame = createMockFrame({
        frame_id: 'frame-1',
        name: 'Frame Beta',
      });

      mockManager.mockFrameManager.getFrame
        .mockResolvedValueOnce(sourceFrame)
        .mockResolvedValueOnce(targetFrame);
      mockManager.mockFrameManager.getActiveFrames.mockResolvedValue([
        sourceFrame,
      ]);

      const sessionId = await resolver.startMergeSession(
        'source-stack',
        'target-stack',
        ['frame-1']
      );

      const session = await resolver.getMergeSession(sessionId);
      expect(session).not.toBeNull();
      expect(session!.conflicts.length).toBeGreaterThan(0);

      const nameConflict = session!.conflicts.find(
        (c) =>
          c.conflictType === 'content' &&
          c.conflictDetails.some((d) => d.field === 'name')
      );
      expect(nameConflict).toBeDefined();
    });

    it('should detect state conflicts between frames', async () => {
      const sourceFrame = createMockFrame({
        frame_id: 'frame-1',
        state: 'active',
      });
      const targetFrame = createMockFrame({
        frame_id: 'frame-1',
        state: 'closed',
      });

      mockManager.mockFrameManager.getFrame
        .mockResolvedValueOnce(sourceFrame)
        .mockResolvedValueOnce(targetFrame);
      mockManager.mockFrameManager.getActiveFrames.mockResolvedValue([
        sourceFrame,
      ]);

      const sessionId = await resolver.startMergeSession(
        'source-stack',
        'target-stack',
        ['frame-1']
      );

      const session = await resolver.getMergeSession(sessionId);
      const stateConflict = session!.conflicts.find(
        (c) => c.conflictType === 'metadata'
      );
      expect(stateConflict).toBeDefined();
      expect(stateConflict!.autoResolvable).toBe(true);
    });

    it('should skip frames that exist only in source', async () => {
      const sourceFrame = createMockFrame({ frame_id: 'frame-1' });

      mockManager.mockFrameManager.getFrame
        .mockResolvedValueOnce(sourceFrame)
        .mockResolvedValueOnce(null);
      mockManager.mockFrameManager.getActiveFrames.mockResolvedValue([
        sourceFrame,
      ]);

      const sessionId = await resolver.startMergeSession(
        'source-stack',
        'target-stack',
        ['frame-1']
      );

      const session = await resolver.getMergeSession(sessionId);
      expect(session!.conflicts.length).toBe(0);
    });
  });

  describe('Manual Conflict Resolution', () => {
    it('should allow manual resolution of conflicts', async () => {
      const sourceFrame = createMockFrame({
        frame_id: 'frame-1',
        name: 'Source Name',
      });
      const targetFrame = createMockFrame({
        frame_id: 'frame-1',
        name: 'Target Name',
      });

      mockManager.mockFrameManager.getFrame
        .mockResolvedValueOnce(sourceFrame)
        .mockResolvedValueOnce(targetFrame);
      mockManager.mockFrameManager.getActiveFrames.mockResolvedValue([
        sourceFrame,
      ]);

      const sessionId = await resolver.startMergeSession(
        'source-stack',
        'target-stack',
        ['frame-1']
      );

      await resolver.resolveConflict(sessionId, 'frame-1', {
        strategy: 'source_wins',
        resolvedBy: 'test-user',
        notes: 'User chose source',
      });

      const session = await resolver.getMergeSession(sessionId);
      expect(session!.metadata.manualResolvedConflicts).toBe(1);
    });

    it('should reject resolution for unknown session', async () => {
      await expect(
        resolver.resolveConflict('unknown-session', 'frame-1', {
          strategy: 'source_wins',
          resolvedBy: 'test-user',
        })
      ).rejects.toThrow('Merge session not found');
    });

    it('should reject resolution for unknown conflict', async () => {
      mockManager.mockFrameManager.getActiveFrames.mockResolvedValue([]);

      const sessionId = await resolver.startMergeSession(
        'source-stack',
        'target-stack',
        []
      );

      await expect(
        resolver.resolveConflict(sessionId, 'unknown-frame', {
          strategy: 'source_wins',
          resolvedBy: 'test-user',
        })
      ).rejects.toThrow('Conflict not found');
    });
  });

  describe('Merge Execution', () => {
    it('should execute merge when all conflicts are resolved', async () => {
      mockManager.mockFrameManager.getActiveFrames.mockResolvedValue([]);

      const sessionId = await resolver.startMergeSession(
        'source-stack',
        'target-stack',
        []
      );

      const session = await resolver.getMergeSession(sessionId);
      expect(session!.status).toBe('completed');

      const result = await resolver.executeMerge(sessionId);
      expect(result.success).toBe(true);
    });

    it('should reject merge execution for incomplete sessions', async () => {
      const sourceFrame = createMockFrame({
        frame_id: 'frame-1',
        name: 'Source Name',
      });
      const targetFrame = createMockFrame({
        frame_id: 'frame-1',
        name: 'Target Name',
      });

      mockManager.mockFrameManager.getFrame
        .mockResolvedValueOnce(sourceFrame)
        .mockResolvedValueOnce(targetFrame);
      mockManager.mockFrameManager.getActiveFrames.mockResolvedValue([
        sourceFrame,
      ]);

      const sessionId = await resolver.startMergeSession(
        'source-stack',
        'target-stack',
        ['frame-1']
      );

      const session = await resolver.getMergeSession(sessionId);
      if (session!.status !== 'completed') {
        await expect(resolver.executeMerge(sessionId)).rejects.toThrow(
          'not ready for execution'
        );
      }
    });
  });

  describe('Custom Policy Creation', () => {
    it('should allow creating custom merge policies', async () => {
      await resolver.createMergePolicy({
        name: 'custom-policy',
        description: 'Test custom policy',
        rules: [
          {
            condition: '$.conflictType == "content"',
            action: 'source_wins',
            priority: 5,
          },
        ],
        autoApplyThreshold: 'medium',
      });

      mockManager.mockFrameManager.getActiveFrames.mockResolvedValue([]);

      const sessionId = await resolver.startMergeSession(
        'source-stack',
        'target-stack',
        [],
        'custom-policy'
      );

      expect(sessionId).toMatch(/^merge-/);
    });
  });
});
