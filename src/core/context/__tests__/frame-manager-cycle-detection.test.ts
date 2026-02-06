/**
 * Unit tests for circular reference detection in frame management
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { FrameManager } from '../index.js';
import { ErrorCode } from '../../errors/index.js';

describe('Frame Manager - Circular Reference Detection', () => {
  let db: Database.Database;
  let frameManager: FrameManager;

  beforeEach(() => {
    db = new Database(':memory:');
    frameManager = new FrameManager(db, 'test-project', {
      maxStackDepth: 100, // Stack limit for testing
    });
  });

  afterEach(() => {
    db.close();
  });

  describe('Cycle Detection', () => {
    it('should detect direct and indirect circular references', () => {
      // Create hierarchy: A -> B -> C
      const frameA = frameManager.createFrame({
        type: 'task',
        name: 'Frame A',
      });
      const frameB = frameManager.createFrame({
        type: 'subtask',
        name: 'Frame B',
        parentFrameId: frameA,
      });
      const frameC = frameManager.createFrame({
        type: 'tool_scope',
        name: 'Frame C',
        parentFrameId: frameB,
      });

      // Direct cycle: A -> B -> A should fail
      expect(() => frameManager.updateParentFrame(frameA, frameB)).toThrow();
      try {
        frameManager.updateParentFrame(frameA, frameB);
      } catch (error: any) {
        expect(error.code).toBe(ErrorCode.FRAME_CYCLE_DETECTED);
      }

      // Indirect cycle: A -> B -> C -> A should fail
      expect(() => frameManager.updateParentFrame(frameA, frameC)).toThrow();
      try {
        frameManager.updateParentFrame(frameA, frameC);
      } catch (error: any) {
        expect(error.code).toBe(ErrorCode.FRAME_CYCLE_DETECTED);
        expect(error.context.cycle).toBeDefined();
      }

      // Normal hierarchy should work
      expect(frameManager.getFrame(frameB)?.parent_frame_id).toBe(frameA);
    });

    it('should detect cycle in long chains', () => {
      let parentId: string | undefined;
      const frameIds: string[] = [];

      for (let i = 0; i < 8; i++) {
        parentId = frameManager.createFrame({
          type: 'task',
          name: `Frame ${i}`,
          parentFrameId: parentId,
        });
        frameIds.push(parentId);
      }

      // Creating cycle from first to last should fail
      expect(() => {
        frameManager.updateParentFrame(
          frameIds[0],
          frameIds[frameIds.length - 1]
        );
      }).toThrow();
    });
  });

  describe('Depth Limits', () => {
    it('should enforce maximum depth limit', () => {
      let parentId: string | undefined;
      let errorThrown = false;

      // Create frames until we hit the depth limit
      try {
        for (let i = 0; i <= 100; i++) {
          parentId = frameManager.createFrame({
            type: 'task',
            name: `Frame ${i}`,
            parentFrameId: parentId,
          });
        }
      } catch (error: any) {
        errorThrown = true;
        expect(error.code).toBe(ErrorCode.FRAME_STACK_OVERFLOW);
      }

      // Should have thrown an error at some point
      expect(errorThrown).toBe(true);
    });
  });

  describe('Parent Updates', () => {
    it('should allow valid parent updates and null parent (root) updates', () => {
      const frameA = frameManager.createFrame({
        type: 'task',
        name: 'Frame A',
      });
      const frameB = frameManager.createFrame({
        type: 'task',
        name: 'Frame B',
      });
      const frameC = frameManager.createFrame({
        type: 'subtask',
        name: 'Frame C',
        parentFrameId: frameB,
      });

      // Valid parent update (moving C to be a child of A)
      expect(() =>
        frameManager.updateParentFrame(frameC, frameA)
      ).not.toThrow();
      expect(frameManager.getFrame(frameC)?.parent_frame_id).toBe(frameA);

      // Null parent update (making a frame a root)
      expect(() => frameManager.updateParentFrame(frameC, null)).not.toThrow();
      expect(frameManager.getFrame(frameC)?.parent_frame_id).toBeUndefined();
    });
  });

  describe('Hierarchy Validation', () => {
    it('should validate simple and complex hierarchies', () => {
      // Simple hierarchy: A -> B -> C
      const frameA = frameManager.createFrame({
        type: 'task',
        name: 'Frame A',
      });
      frameManager.createFrame({
        type: 'subtask',
        name: 'Frame B',
        parentFrameId: frameA,
      });

      let validation = frameManager.validateFrameHierarchy();
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);

      // Add more complexity: multiple roots with children
      const root2 = frameManager.createFrame({ type: 'task', name: 'Root 2' });
      frameManager.createFrame({
        type: 'subtask',
        name: 'Child 1.1',
        parentFrameId: frameA,
      });
      frameManager.createFrame({
        type: 'subtask',
        name: 'Child 2.1',
        parentFrameId: root2,
      });

      validation = frameManager.validateFrameHierarchy();
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle self-reference, non-existent frames, and concurrent operations', () => {
      const frameA = frameManager.createFrame({
        type: 'task',
        name: 'Frame A',
      });

      // Self-reference should throw cycle error
      expect(() => frameManager.updateParentFrame(frameA, frameA)).toThrow();
      try {
        frameManager.updateParentFrame(frameA, frameA);
      } catch (error: any) {
        expect(error.code).toBe(ErrorCode.FRAME_CYCLE_DETECTED);
      }

      // Non-existent frame references should throw
      const fakeId = 'non-existent-frame-id';
      expect(() => frameManager.updateParentFrame(frameA, fakeId)).toThrow();
      expect(() => frameManager.updateParentFrame(fakeId, frameA)).toThrow();

      // Concurrent operations creating cycles should fail
      const frameIds: string[] = [];
      for (let i = 0; i < 5; i++) {
        frameIds.push(
          frameManager.createFrame({ type: 'task', name: `Frame ${i}` })
        );
      }
      expect(() => {
        frameManager.updateParentFrame(frameIds[0], frameIds[4]);
        frameManager.updateParentFrame(frameIds[4], frameIds[0]);
      }).toThrow();
    });
  });
});
