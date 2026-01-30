/**
 * Unified Merge Resolver Tests - STA-101
 * Tests for the unified merge resolution interface
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import {
  UnifiedMergeResolver,
  UnifiedMergeSession,
  MergeOptions,
} from '../unified-merge-resolver.js';
import { FrameStack, MergeConflict } from '../types.js';
import { ResolutionContext } from '../resolution-engine.js';
import { Frame, Event } from '../../context/index.js';

// Test data factories
function createMockFrame(overrides?: Partial<Frame>): Frame {
  return {
    frame_id: uuidv4(),
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
  };
}

function createMockEvent(overrides?: Partial<Event>): Event {
  return {
    event_id: uuidv4(),
    frame_id: uuidv4(),
    run_id: 'test-run',
    seq: 1,
    event_type: 'tool_call',
    payload: {},
    ts: Date.now(),
    ...overrides,
  };
}

function createMockStack(frames: Frame[], events: Event[] = []): FrameStack {
  return {
    id: uuidv4(),
    frames,
    events,
    createdAt: Date.now(),
    lastModified: Date.now(),
  };
}

describe('UnifiedMergeResolver', () => {
  let resolver: UnifiedMergeResolver;

  beforeEach(() => {
    resolver = new UnifiedMergeResolver();
  });

  describe('Session Management', () => {
    it('should start a new merge session', async () => {
      const stack1 = createMockStack([
        createMockFrame({ frame_id: 'frame-1' }),
      ]);
      const stack2 = createMockStack([
        createMockFrame({ frame_id: 'frame-2' }),
      ]);

      const sessionId = await resolver.startMergeSession(stack1, stack2);

      expect(sessionId).toMatch(/^unified-merge-/);

      const session = resolver.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session!.status).toBe('analyzing');
      expect(session!.stack1).toBe(stack1);
      expect(session!.stack2).toBe(stack2);
    });

    it('should detect conflicts during session creation', async () => {
      const frame1 = createMockFrame({
        frame_id: 'same-problem',
        name: 'Fix Bug',
        outputs: { solution: 'Solution A' },
      });
      const frame2 = createMockFrame({
        frame_id: 'same-problem-2',
        name: 'Fix Bug',
        outputs: { solution: 'Solution B' },
      });

      const stack1 = createMockStack([frame1]);
      const stack2 = createMockStack([frame2]);

      const sessionId = await resolver.startMergeSession(stack1, stack2);
      const session = resolver.getSession(sessionId);

      expect(session!.conflicts.length).toBeGreaterThan(0);
      expect(session!.metadata.conflictCount).toBeGreaterThan(0);
    });

    it('should create rollback snapshot by default', async () => {
      const stack1 = createMockStack([createMockFrame()]);
      const stack2 = createMockStack([createMockFrame()]);

      const sessionId = await resolver.startMergeSession(stack1, stack2);
      const session = resolver.getSession(sessionId);

      expect(session!.rollbackPoint).toBeDefined();
      expect(session!.rollbackPoint).toMatch(/^rollback-/);
    });

    it('should skip rollback snapshot when disabled', async () => {
      const stack1 = createMockStack([createMockFrame()]);
      const stack2 = createMockStack([createMockFrame()]);

      const sessionId = await resolver.startMergeSession(stack1, stack2, {
        preserveRollback: false,
      });
      const session = resolver.getSession(sessionId);

      expect(session!.rollbackPoint).toBeUndefined();
    });

    it('should close session and clean up resources', async () => {
      const stack1 = createMockStack([createMockFrame()]);
      const stack2 = createMockStack([createMockFrame()]);

      const sessionId = await resolver.startMergeSession(stack1, stack2);
      expect(resolver.getSession(sessionId)).toBeDefined();

      resolver.closeSession(sessionId);
      expect(resolver.getSession(sessionId)).toBeUndefined();
    });

    it('should list active sessions', async () => {
      const stack1 = createMockStack([createMockFrame()]);
      const stack2 = createMockStack([createMockFrame()]);

      await resolver.startMergeSession(stack1, stack2);
      await resolver.startMergeSession(stack1, stack2);

      const activeSessions = resolver.listActiveSessions();
      expect(activeSessions.length).toBe(2);
    });
  });

  describe('Preview Generation', () => {
    it('should generate merge preview with keep_both strategy', async () => {
      const stack1 = createMockStack([
        createMockFrame({ frame_id: 'frame-1' }),
      ]);
      const stack2 = createMockStack([
        createMockFrame({ frame_id: 'frame-2' }),
      ]);

      const sessionId = await resolver.startMergeSession(stack1, stack2);
      const preview = await resolver.generatePreview(sessionId, 'keep_both');

      expect(preview).toBeDefined();
      expect(preview.mergedFrames.length).toBe(2);
      expect(preview.keptFromStack1).toContain('frame-1');
      expect(preview.keptFromStack2).toContain('frame-2');
      expect(preview.estimatedSuccess).toBeGreaterThan(0);

      const session = resolver.getSession(sessionId);
      expect(session!.status).toBe('preview');
      expect(session!.preview).toBe(preview);
    });

    it('should generate preview with different strategies', async () => {
      const stack1 = createMockStack([
        createMockFrame({ frame_id: 'frame-1' }),
      ]);
      const stack2 = createMockStack([
        createMockFrame({ frame_id: 'frame-2' }),
      ]);

      const sessionId = await resolver.startMergeSession(stack1, stack2);

      const strategies = [
        'keep_both',
        'team_vote',
        'senior_override',
        'ai_suggest',
        'hybrid',
      ] as const;

      for (const strategy of strategies) {
        const preview = await resolver.generatePreview(sessionId, strategy);
        expect(preview).toBeDefined();
        expect(preview.estimatedSuccess).toBeGreaterThanOrEqual(0);
        expect(preview.estimatedSuccess).toBeLessThanOrEqual(1);
      }
    });

    it('should throw error for invalid session', async () => {
      await expect(
        resolver.generatePreview('invalid-session', 'keep_both')
      ).rejects.toThrow('Session not found');
    });
  });

  describe('Conflict Resolution', () => {
    it('should resolve conflicts with keep_both strategy', async () => {
      const stack1 = createMockStack([
        createMockFrame({ frame_id: 'frame-1' }),
      ]);
      const stack2 = createMockStack([
        createMockFrame({ frame_id: 'frame-2' }),
      ]);

      const context: ResolutionContext = {
        userId: 'user-1',
        userRole: 'senior',
      };

      const sessionId = await resolver.startMergeSession(stack1, stack2);
      const result = await resolver.resolveConflicts(
        sessionId,
        'keep_both',
        context
      );

      expect(result.success).toBe(true);
      expect(result.resolution).toBeDefined();
      expect(result.resolution!.strategy.type).toBe('keep_both');

      const session = resolver.getSession(sessionId);
      expect(session!.status).toBe('completed');
    });

    it('should resolve with ai_suggest strategy', async () => {
      const stack1 = createMockStack([
        createMockFrame({
          frame_id: 'frame-1',
          state: 'closed',
          outputs: { result: 'optimized' },
        }),
      ]);
      const stack2 = createMockStack([
        createMockFrame({ frame_id: 'frame-2' }),
      ]);

      const context: ResolutionContext = {
        userId: 'user-1',
        userRole: 'mid',
        aiConfidence: 0.9,
      };

      const sessionId = await resolver.startMergeSession(stack1, stack2);
      const result = await resolver.resolveConflicts(
        sessionId,
        'ai_suggest',
        context
      );

      expect(result.success).toBe(true);
      expect(result.resolution!.strategy.type).toBe('ai_suggest');
    });

    it('should auto-resolve when option enabled', async () => {
      const stack1 = createMockStack([createMockFrame()]);
      const stack2 = createMockStack([createMockFrame()]);

      const options: MergeOptions = {
        autoResolve: true,
        strategy: 'keep_both',
        context: {
          userId: 'user-1',
          userRole: 'senior',
        },
      };

      const sessionId = await resolver.startMergeSession(
        stack1,
        stack2,
        options
      );
      const session = resolver.getSession(sessionId);

      // Session should have resolution after auto-resolve
      expect(session!.resolution).toBeDefined();
    });

    it('should update session status on resolution failure', async () => {
      const stack1 = createMockStack([createMockFrame()]);
      const stack2 = createMockStack([createMockFrame()]);

      const context: ResolutionContext = {
        userId: 'junior-dev',
        userRole: 'junior',
      };

      const sessionId = await resolver.startMergeSession(stack1, stack2);

      // senior_override should fail for junior role
      await expect(
        resolver.resolveConflicts(sessionId, 'senior_override', context)
      ).rejects.toThrow();

      const session = resolver.getSession(sessionId);
      expect(session!.status).toBe('failed');
    });
  });

  describe('Rollback', () => {
    it('should rollback to original state', async () => {
      const originalFrame1 = createMockFrame({
        frame_id: 'frame-1',
        name: 'Original',
      });
      const originalFrame2 = createMockFrame({
        frame_id: 'frame-2',
        name: 'Original',
      });

      const stack1 = createMockStack([originalFrame1]);
      const stack2 = createMockStack([originalFrame2]);

      const context: ResolutionContext = {
        userId: 'user-1',
        userRole: 'senior',
      };

      const sessionId = await resolver.startMergeSession(stack1, stack2);

      // Resolve conflicts
      await resolver.resolveConflicts(sessionId, 'keep_both', context);

      const sessionAfterResolve = resolver.getSession(sessionId);
      expect(sessionAfterResolve!.status).toBe('completed');

      // Rollback
      const rollbackSuccess = await resolver.rollback(sessionId);
      expect(rollbackSuccess).toBe(true);

      const sessionAfterRollback = resolver.getSession(sessionId);
      expect(sessionAfterRollback!.status).toBe('rolled_back');
      expect(sessionAfterRollback!.resolution).toBeUndefined();
    });

    it('should return false for session without rollback point', async () => {
      const stack1 = createMockStack([createMockFrame()]);
      const stack2 = createMockStack([createMockFrame()]);

      const sessionId = await resolver.startMergeSession(stack1, stack2, {
        preserveRollback: false,
      });

      const rollbackSuccess = await resolver.rollback(sessionId);
      expect(rollbackSuccess).toBe(false);
    });

    it('should return false for invalid session', async () => {
      const rollbackSuccess = await resolver.rollback('invalid-session');
      expect(rollbackSuccess).toBe(false);
    });
  });

  describe('Statistics', () => {
    it('should track merge statistics', async () => {
      const stack1 = createMockStack([
        createMockFrame({ frame_id: 'frame-1', name: 'Test' }),
      ]);
      const stack2 = createMockStack([
        createMockFrame({ frame_id: 'frame-2', name: 'Test' }),
      ]);

      const context: ResolutionContext = {
        userId: 'user-1',
        userRole: 'senior',
      };

      const sessionId = await resolver.startMergeSession(stack1, stack2);
      await resolver.resolveConflicts(sessionId, 'keep_both', context);

      const stats = resolver.getStatistics();

      expect(stats.totalConflicts).toBeGreaterThanOrEqual(0);
      expect(stats.successRate).toBeGreaterThanOrEqual(0);
      expect(stats.successRate).toBeLessThanOrEqual(1);
    });

    it('should track rollback count', async () => {
      const stack1 = createMockStack([createMockFrame()]);
      const stack2 = createMockStack([createMockFrame()]);

      const context: ResolutionContext = {
        userId: 'user-1',
        userRole: 'senior',
      };

      const sessionId = await resolver.startMergeSession(stack1, stack2);
      await resolver.resolveConflicts(sessionId, 'keep_both', context);
      await resolver.rollback(sessionId);

      const stats = resolver.getStatistics();
      expect(stats.rollbackCount).toBe(1);
    });
  });

  describe('Parallel Solution Analysis', () => {
    it('should analyze parallel solutions', () => {
      const frames = [
        createMockFrame({
          frame_id: 'solution-1',
          name: 'Optimize Query',
          outputs: { approach: 'Added indexes' },
          state: 'closed',
        }),
        createMockFrame({
          frame_id: 'solution-2',
          name: 'Optimize Query',
          outputs: { approach: 'Rewrote logic' },
          state: 'closed',
        }),
      ];

      const analysis = resolver.analyzeParallelSolutions(frames);

      expect(analysis.solutions.length).toBe(2);
      expect(analysis.solutions[0].frameId).toBe('solution-1');
      expect(analysis.solutions[1].frameId).toBe('solution-2');
    });

    it('should provide recommendations for parallel solutions', () => {
      const frames = [
        createMockFrame({
          frame_id: 'solution-1',
          name: 'Fix Bug',
          outputs: { approach: 'quick fix' },
          state: 'closed',
          closed_at: Date.now(),
        }),
        createMockFrame({
          frame_id: 'solution-2',
          name: 'Fix Bug',
          outputs: { approach: 'refactored' },
          state: 'closed',
          digest_text: 'Comprehensive fix',
          closed_at: Date.now(),
        }),
      ];

      const analysis = resolver.analyzeParallelSolutions(frames);

      expect(analysis.recommendations.length).toBeGreaterThan(0);
    });
  });

  describe('Visual Diff', () => {
    it('should create visual diff between stacks', () => {
      const baseFrame = createMockFrame({ frame_id: 'base', depth: 0 });
      const child1 = createMockFrame({
        frame_id: 'child-1',
        parent_frame_id: 'base',
        depth: 1,
      });
      const child2 = createMockFrame({
        frame_id: 'child-2',
        parent_frame_id: 'base',
        depth: 1,
      });

      const stack1 = createMockStack([baseFrame, child1]);
      const stack2 = createMockStack([baseFrame, child2]);

      const diff = resolver.createVisualDiff(baseFrame, stack1, stack2);

      expect(diff.nodes.length).toBeGreaterThan(0);
      expect(diff.edges.length).toBeGreaterThanOrEqual(0);
    });

    it('should include conflict information in visual diff', () => {
      const baseFrame = createMockFrame({ frame_id: 'base' });
      const frame1 = createMockFrame({
        frame_id: 'conflict-1',
        name: 'Same Problem',
        parent_frame_id: 'base',
      });
      const frame2 = createMockFrame({
        frame_id: 'conflict-2',
        name: 'Same Problem',
        parent_frame_id: 'base',
      });

      const stack1 = createMockStack([baseFrame, frame1]);
      const stack2 = createMockStack([baseFrame, frame2]);

      const diff = resolver.createVisualDiff(baseFrame, stack1, stack2);

      // Should detect conflicts in the visual diff
      expect(diff.conflicts).toBeDefined();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty stacks', async () => {
      const stack1 = createMockStack([]);
      const stack2 = createMockStack([]);

      const sessionId = await resolver.startMergeSession(stack1, stack2);
      const session = resolver.getSession(sessionId);

      expect(session).toBeDefined();
      expect(session!.conflicts.length).toBe(0);
      expect(session!.metadata.totalFrames).toBe(0);
    });

    it('should handle stacks with identical frames', async () => {
      const frame = createMockFrame({ frame_id: 'shared' });
      const stack1 = createMockStack([frame]);
      const stack2 = createMockStack([frame]);

      const sessionId = await resolver.startMergeSession(stack1, stack2);
      const session = resolver.getSession(sessionId);

      expect(session!.conflicts.length).toBe(0);
    });

    it('should handle stacks with many frames', async () => {
      const frames1 = Array.from({ length: 50 }, (_, i) =>
        createMockFrame({ frame_id: `frame-1-${i}` })
      );
      const frames2 = Array.from({ length: 50 }, (_, i) =>
        createMockFrame({ frame_id: `frame-2-${i}` })
      );

      const stack1 = createMockStack(frames1);
      const stack2 = createMockStack(frames2);

      const startTime = Date.now();
      const sessionId = await resolver.startMergeSession(stack1, stack2);
      const duration = Date.now() - startTime;

      // Should complete within reasonable time
      expect(duration).toBeLessThan(1000);

      const session = resolver.getSession(sessionId);
      expect(session).toBeDefined();
      expect(session!.metadata.totalFrames).toBe(100);
    });
  });
});
