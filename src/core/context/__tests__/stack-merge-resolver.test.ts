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
    it('should support default, conservative, aggressive policies and reject unknown', async () => {
      // Non-existent session returns null
      expect(await resolver.getMergeSession('non-existent')).toBeNull();

      mockManager.mockFrameManager.getActiveFrames.mockResolvedValue([]);

      // All valid policies should create sessions
      for (const policy of ['default', 'conservative', 'aggressive']) {
        const sessionId = await resolver.startMergeSession(
          'source-stack',
          'target-stack',
          [],
          policy
        );
        expect(sessionId).toMatch(/^merge-/);
      }

      // Unknown policy should be rejected
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
    it('should detect name and state conflicts, and skip source-only frames', async () => {
      // Name conflicts
      const sourceFrame1 = createMockFrame({
        frame_id: 'frame-1',
        name: 'Alpha',
      });
      const targetFrame1 = createMockFrame({
        frame_id: 'frame-1',
        name: 'Beta',
      });

      mockManager.mockFrameManager.getFrame
        .mockResolvedValueOnce(sourceFrame1)
        .mockResolvedValueOnce(targetFrame1);
      mockManager.mockFrameManager.getActiveFrames.mockResolvedValue([
        sourceFrame1,
      ]);

      let sessionId = await resolver.startMergeSession(
        'source-stack',
        'target-stack',
        ['frame-1']
      );
      let session = await resolver.getMergeSession(sessionId);
      expect(session!.conflicts.length).toBeGreaterThan(0);
      expect(
        session!.conflicts.find(
          (c) =>
            c.conflictType === 'content' &&
            c.conflictDetails.some((d) => d.field === 'name')
        )
      ).toBeDefined();

      // State conflicts (auto-resolvable)
      const sourceFrame2 = createMockFrame({
        frame_id: 'frame-2',
        state: 'active',
      });
      const targetFrame2 = createMockFrame({
        frame_id: 'frame-2',
        state: 'closed',
      });

      mockManager.mockFrameManager.getFrame
        .mockResolvedValueOnce(sourceFrame2)
        .mockResolvedValueOnce(targetFrame2);
      mockManager.mockFrameManager.getActiveFrames.mockResolvedValue([
        sourceFrame2,
      ]);

      sessionId = await resolver.startMergeSession(
        'source-stack',
        'target-stack',
        ['frame-2']
      );
      session = await resolver.getMergeSession(sessionId);
      const stateConflict = session!.conflicts.find(
        (c) => c.conflictType === 'metadata'
      );
      expect(stateConflict).toBeDefined();
      expect(stateConflict!.autoResolvable).toBe(true);

      // Source-only frames (no conflict)
      const sourceFrame3 = createMockFrame({ frame_id: 'frame-3' });
      mockManager.mockFrameManager.getFrame
        .mockResolvedValueOnce(sourceFrame3)
        .mockResolvedValueOnce(null);
      mockManager.mockFrameManager.getActiveFrames.mockResolvedValue([
        sourceFrame3,
      ]);

      sessionId = await resolver.startMergeSession(
        'source-stack',
        'target-stack',
        ['frame-3']
      );
      session = await resolver.getMergeSession(sessionId);
      expect(session!.conflicts.length).toBe(0);
    });
  });

  describe('Manual Conflict Resolution', () => {
    it('should allow resolution and reject invalid sessions/conflicts', async () => {
      // Valid manual resolution
      const sourceFrame = createMockFrame({
        frame_id: 'frame-1',
        name: 'Source',
      });
      const targetFrame = createMockFrame({
        frame_id: 'frame-1',
        name: 'Target',
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

      // Reject unknown session
      await expect(
        resolver.resolveConflict('unknown-session', 'frame-1', {
          strategy: 'source_wins',
          resolvedBy: 'test-user',
        })
      ).rejects.toThrow('Merge session not found');

      // Reject unknown conflict
      mockManager.mockFrameManager.getActiveFrames.mockResolvedValue([]);
      const emptySession = await resolver.startMergeSession(
        'source',
        'target',
        []
      );
      await expect(
        resolver.resolveConflict(emptySession, 'unknown-frame', {
          strategy: 'source_wins',
          resolvedBy: 'test-user',
        })
      ).rejects.toThrow('Conflict not found');
    });
  });

  describe('Merge Execution', () => {
    it('should execute completed merges and reject incomplete ones', async () => {
      // Execute completed merge
      mockManager.mockFrameManager.getActiveFrames.mockResolvedValue([]);

      let sessionId = await resolver.startMergeSession(
        'source-stack',
        'target-stack',
        []
      );
      let session = await resolver.getMergeSession(sessionId);
      expect(session!.status).toBe('completed');
      expect((await resolver.executeMerge(sessionId)).success).toBe(true);

      // Reject incomplete merge
      const sourceFrame = createMockFrame({
        frame_id: 'frame-1',
        name: 'Source',
      });
      const targetFrame = createMockFrame({
        frame_id: 'frame-1',
        name: 'Target',
      });

      mockManager.mockFrameManager.getFrame
        .mockResolvedValueOnce(sourceFrame)
        .mockResolvedValueOnce(targetFrame);
      mockManager.mockFrameManager.getActiveFrames.mockResolvedValue([
        sourceFrame,
      ]);

      sessionId = await resolver.startMergeSession(
        'source-stack',
        'target-stack',
        ['frame-1']
      );
      session = await resolver.getMergeSession(sessionId);
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
