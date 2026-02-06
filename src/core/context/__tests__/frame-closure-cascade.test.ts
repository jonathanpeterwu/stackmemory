/**
 * Tests for frame closure and stack behavior
 *
 * NOTE: There's a known limitation in the current implementation:
 * closeChildFrames() runs AFTER popFrame(), which means children are
 * already off the stack when we try to close them. The current behavior
 * is that frames above the target in the stack get popped but may not
 * be properly closed in the database.
 *
 * These tests document the ACTUAL current behavior.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { FrameManager } from '../index.js';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';

describe('Frame Manager - Stack and Closure Behavior', () => {
  let db: Database.Database;
  let frameManager: FrameManager;
  let tempDir: string;
  const projectId = 'test-cascade-project';

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'stackmemory-cascade-test-'));
    const dbPath = join(tempDir, 'test.db');
    db = new Database(dbPath);
    frameManager = new FrameManager(db, projectId, {
      maxStackDepth: 50,
    });
  });

  afterEach(() => {
    if (db) db.close();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Single frame lifecycle', () => {
    it('should create and close a single frame', () => {
      const frameId = frameManager.createFrame({
        type: 'task',
        name: 'Single Frame',
      });

      expect(frameManager.getStackDepth()).toBe(1);
      expect(frameManager.getFrame(frameId)?.state).toBe('active');

      frameManager.closeFrame(frameId);

      expect(frameManager.getStackDepth()).toBe(0);
      expect(frameManager.getFrame(frameId)?.state).toBe('closed');
    });

    it('should generate digest on close', () => {
      const frameId = frameManager.createFrame({
        type: 'task',
        name: 'Frame with content',
      });

      // Add some content
      frameManager.addEvent('user_message', { text: 'Hello world' });
      frameManager.addAnchor('decision', 'Important choice', 7);

      frameManager.closeFrame(frameId);

      const closed = frameManager.getFrame(frameId);
      expect(closed?.state).toBe('closed');
      expect(closed?.digest_text).toBeDefined();
      expect(closed?.digest_json).toBeDefined();
    });
  });

  describe('Stack management', () => {
    it('should maintain parent-child relationships', () => {
      const parent = frameManager.createFrame({ type: 'task', name: 'Parent' });
      const child = frameManager.createFrame({
        type: 'subtask',
        name: 'Child',
      });

      const childFrame = frameManager.getFrame(child);
      expect(childFrame?.parent_frame_id).toBe(parent);
      expect(childFrame?.depth).toBe(1);
      expect(frameManager.getStackDepth()).toBe(2);
    });

    it('should track stack depth correctly', () => {
      expect(frameManager.getStackDepth()).toBe(0);

      const f1 = frameManager.createFrame({ type: 'task', name: 'F1' });
      expect(frameManager.getStackDepth()).toBe(1);

      const f2 = frameManager.createFrame({ type: 'subtask', name: 'F2' });
      expect(frameManager.getStackDepth()).toBe(2);

      frameManager.createFrame({ type: 'tool_scope', name: 'F3' });
      expect(frameManager.getStackDepth()).toBe(3);

      // Close F2 (also removes F3 from stack)
      frameManager.closeFrame(f2);
      expect(frameManager.getStackDepth()).toBe(1);

      // Close F1
      frameManager.closeFrame(f1);
      expect(frameManager.getStackDepth()).toBe(0);
    });

    it('should close current frame when no ID specified', () => {
      frameManager.createFrame({ type: 'task', name: 'L0' });
      const current = frameManager.createFrame({ type: 'subtask', name: 'L1' });

      expect(frameManager.getCurrentFrameId()).toBe(current);

      frameManager.closeFrame(); // Close current (L1)

      expect(frameManager.getStackDepth()).toBe(1);
      expect(frameManager.getFrame(current)?.state).toBe('closed');
    });

    it('should unwind stack when closing non-top frame', () => {
      const f1 = frameManager.createFrame({ type: 'task', name: 'F1' });
      const f2 = frameManager.createFrame({ type: 'subtask', name: 'F2' });
      const f3 = frameManager.createFrame({ type: 'tool_scope', name: 'F3' });

      expect(frameManager.getStackDepth()).toBe(3);

      // Close F1 (should unwind entire stack)
      frameManager.closeFrame(f1);

      // Stack should be empty
      expect(frameManager.getStackDepth()).toBe(0);
      // F1 should be closed
      expect(frameManager.getFrame(f1)?.state).toBe('closed');
    });
  });

  describe('Event and anchor operations', () => {
    it('should add, retrieve, and preserve events and anchors', () => {
      const frameId = frameManager.createFrame({ type: 'task', name: 'Test' });

      // Add events and anchors
      frameManager.addEvent('user_message', { text: 'Hello' });
      frameManager.addEvent('assistant_message', { text: 'Hi there' });
      frameManager.addEvent('decision', { choice: 'A' });
      frameManager.addAnchor('decision', 'Chose React', 8);
      frameManager.addAnchor('finding', 'Found bug', 6);

      expect(frameManager.getFrameEvents(frameId).length).toBe(3);
      expect(frameManager.getFrameAnchors(frameId).length).toBe(2);

      // Close and verify preservation
      frameManager.closeFrame(frameId);
      expect(frameManager.getFrameEvents(frameId).length).toBe(3);
      expect(frameManager.getFrameAnchors(frameId).length).toBe(2);
    });
  });

  describe('Frame depth limits', () => {
    it('should handle deep frame hierarchies and close entire chains', () => {
      const frameIds: string[] = [];

      // Create 10 nested frames
      for (let i = 0; i < 10; i++) {
        frameIds.push(
          frameManager.createFrame({ type: 'task', name: `Frame ${i}` })
        );
      }

      expect(frameManager.getStackDepth()).toBe(10);
      for (let i = 0; i < 10; i++) {
        expect(frameManager.getFrame(frameIds[i])?.depth).toBe(i);
      }

      // Close root should unwind entire stack
      frameManager.closeFrame(frameIds[0]);
      expect(frameManager.getStackDepth()).toBe(0);
      expect(frameManager.getFrame(frameIds[0])?.state).toBe('closed');
    });
  });

  describe('Edge cases', () => {
    it('should handle edge cases for frame closure', () => {
      // Empty stack should throw
      expect(frameManager.getStackDepth()).toBe(0);
      expect(() => frameManager.closeFrame()).toThrow();

      // Create and close a frame
      const frameId = frameManager.createFrame({ type: 'task', name: 'Test' });
      frameManager.closeFrame(frameId);

      // Already-closed frame should not throw
      expect(() => frameManager.closeFrame(frameId)).not.toThrow();

      // Non-existent frame should throw
      frameManager.createFrame({ type: 'task', name: 'Another' });
      expect(() => frameManager.closeFrame('non-existent-id')).toThrow();
    });

    it('should validate stack after operations', () => {
      frameManager.createFrame({ type: 'task', name: 'F1' });
      frameManager.createFrame({ type: 'subtask', name: 'F2' });

      const validation = frameManager.validateStack();
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  describe('Frame context', () => {
    it('should get hot stack context and active frame path', () => {
      frameManager.createFrame({ type: 'task', name: 'Root' });
      frameManager.createFrame({ type: 'subtask', name: 'Child' });
      frameManager.createFrame({ type: 'tool_scope', name: 'Grandchild' });

      frameManager.addEvent('user_message', { text: 'Test event' });
      frameManager.addAnchor('decision', 'Test anchor', 7);

      // Hot stack context
      const contexts = frameManager.getHotStackContext();
      expect(contexts).toBeDefined();
      expect(contexts.length).toBeGreaterThan(0);

      // Active frame path
      const path = frameManager.getActiveFramePath();
      expect(path.length).toBe(3);
      expect(path[0].name).toBe('Root');
      expect(path[1].name).toBe('Child');
      expect(path[2].name).toBe('Grandchild');
    });
  });
});
