/**
 * Unified Merge Resolver Tests - STA-101 (Consolidated)
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { UnifiedMergeResolver } from '../unified-merge-resolver.js';
import { FrameStack } from '../types.js';
import { Frame, Event } from '../../context/index.js';

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

  describe('session management', () => {
    it('should start a merge session', async () => {
      const stack1 = createMockStack([
        createMockFrame({ frame_id: 'frame-1' }),
      ]);
      const stack2 = createMockStack([
        createMockFrame({ frame_id: 'frame-2' }),
      ]);

      const sessionId = await resolver.startMergeSession(stack1, stack2);
      expect(sessionId).toMatch(/^unified-merge-/);

      const session = resolver.getSession(sessionId);
      expect(session?.status).toBe('analyzing');
      expect(session?.rollbackPoint).toMatch(/^rollback-/);
    });

    it('should track and list active sessions', async () => {
      const stack1 = createMockStack([createMockFrame()]);
      const stack2 = createMockStack([createMockFrame()]);

      const sessionId = await resolver.startMergeSession(stack1, stack2);
      const sessions = resolver.listActiveSessions();

      expect(sessions.some((s) => s.sessionId === sessionId)).toBe(true);
    });

    it('should close session and clean up', async () => {
      const stack1 = createMockStack([createMockFrame()]);
      const stack2 = createMockStack([createMockFrame()]);

      const sessionId = await resolver.startMergeSession(stack1, stack2);
      resolver.closeSession(sessionId);

      expect(resolver.getSession(sessionId)).toBeUndefined();
    });

    it('should detect conflicts during merge', async () => {
      const frame1 = createMockFrame({
        name: 'Fix Bug',
        outputs: { solution: 'A' },
      });
      const frame2 = createMockFrame({
        name: 'Fix Bug',
        outputs: { solution: 'B' },
      });

      const sessionId = await resolver.startMergeSession(
        createMockStack([frame1]),
        createMockStack([frame2])
      );

      const session = resolver.getSession(sessionId);
      expect(session!.conflicts.length).toBeGreaterThan(0);
    });

    it('should skip rollback when disabled', async () => {
      const stack1 = createMockStack([createMockFrame()]);
      const stack2 = createMockStack([createMockFrame()]);

      const sessionId = await resolver.startMergeSession(stack1, stack2, {
        preserveRollback: false,
      });

      expect(resolver.getSession(sessionId)!.rollbackPoint).toBeUndefined();
    });
  });

  describe('preview generation', () => {
    it('should generate merge preview', async () => {
      const stack1 = createMockStack([
        createMockFrame({ outputs: { data: 'value1' } }),
      ]);
      const stack2 = createMockStack([
        createMockFrame({ outputs: { data: 'value2' } }),
      ]);

      const sessionId = await resolver.startMergeSession(stack1, stack2);
      const preview = await resolver.generatePreview(sessionId, 'auto');

      expect(preview).toBeDefined();
      expect(preview.mergedFrames).toBeDefined();
    });
  });

  describe('rollback', () => {
    it('should return false when no rollback point', async () => {
      const stack1 = createMockStack([createMockFrame()]);
      const stack2 = createMockStack([createMockFrame()]);

      const sessionId = await resolver.startMergeSession(stack1, stack2, {
        preserveRollback: false,
      });

      const result = await resolver.rollback(sessionId);
      expect(result).toBe(false);
    });
  });

  describe('statistics', () => {
    it('should track merge statistics', async () => {
      const frame1 = createMockFrame({
        name: 'Fix Bug',
        outputs: { solution: 'A' },
      });
      const frame2 = createMockFrame({
        name: 'Fix Bug',
        outputs: { solution: 'B' },
      });

      await resolver.startMergeSession(
        createMockStack([frame1]),
        createMockStack([frame2])
      );

      const stats = resolver.getStatistics();
      expect(stats.totalConflicts).toBeGreaterThan(0);
    });
  });
});
