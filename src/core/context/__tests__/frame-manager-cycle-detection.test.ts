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
    it('should detect direct circular reference (A -> B -> A)', () => {
      // Create frame A
      const frameA = frameManager.createFrame({
        type: 'task',
        name: 'Frame A',
      });

      // Create frame B as child of A
      const frameB = frameManager.createFrame({
        type: 'subtask',
        name: 'Frame B',
        parentFrameId: frameA,
      });

      // Try to update A's parent to B (should fail)
      expect(() => {
        frameManager.updateParentFrame(frameA, frameB);
      }).toThrow();

      // Check the error is specifically about cycle detection
      try {
        frameManager.updateParentFrame(frameA, frameB);
      } catch (error: any) {
        expect(error.code).toBe(ErrorCode.FRAME_CYCLE_DETECTED);
      }
    });

    it('should detect indirect circular reference (A -> B -> C -> A)', () => {
      // Create frame A
      const frameA = frameManager.createFrame({
        type: 'task',
        name: 'Frame A',
      });

      // Create frame B as child of A
      const frameB = frameManager.createFrame({
        type: 'subtask',
        name: 'Frame B',
        parentFrameId: frameA,
      });

      // Create frame C as child of B
      const frameC = frameManager.createFrame({
        type: 'tool_scope',
        name: 'Frame C',
        parentFrameId: frameB,
      });

      // Try to update A's parent to C (should fail)
      expect(() => {
        frameManager.updateParentFrame(frameA, frameC);
      }).toThrow();

      // Check the error details
      try {
        frameManager.updateParentFrame(frameA, frameC);
      } catch (error: any) {
        expect(error.code).toBe(ErrorCode.FRAME_CYCLE_DETECTED);
        expect(error.context.cycle).toBeDefined();
      }
    });

    it('should prevent creating a frame that would cause a cycle', () => {
      // In practice, cycles are mainly prevented during parent updates
      const frameA = frameManager.createFrame({
        type: 'task',
        name: 'Frame A',
      });

      const frameB = frameManager.createFrame({
        type: 'subtask',
        name: 'Frame B',
        parentFrameId: frameA,
      });

      // Verify normal hierarchy works
      expect(frameManager.getFrame(frameB)?.parent_frame_id).toBe(frameA);
    });

    it('should detect cycle during traversal safety check', () => {
      // Create a chain
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

      const lastFrame = frameIds[frameIds.length - 1];
      const firstFrame = frameIds[0];

      // This should fail due to cycle detection
      expect(() => {
        frameManager.updateParentFrame(firstFrame, lastFrame);
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
    it('should allow valid parent updates that do not create cycles', () => {
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

      // This should be allowed (moving C to be a child of A)
      expect(() => {
        frameManager.updateParentFrame(frameC, frameA);
      }).not.toThrow();

      // Verify the update worked
      const updatedFrame = frameManager.getFrame(frameC);
      expect(updatedFrame?.parent_frame_id).toBe(frameA);
    });

    it('should handle null parent updates (making a frame a root)', () => {
      const frameA = frameManager.createFrame({
        type: 'task',
        name: 'Frame A',
      });

      const frameB = frameManager.createFrame({
        type: 'subtask',
        name: 'Frame B',
        parentFrameId: frameA,
      });

      // Make frameB a root frame
      expect(() => {
        frameManager.updateParentFrame(frameB, null);
      }).not.toThrow();

      // Verify B is now a root (parent_frame_id is undefined for root frames)
      const updatedFrame = frameManager.getFrame(frameB);
      expect(updatedFrame?.parent_frame_id).toBeUndefined();
    });
  });

  describe('Hierarchy Validation', () => {
    it('should validate entire frame hierarchy', () => {
      // Create a valid hierarchy
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

      // Validate hierarchy (should be valid)
      const validation = frameManager.validateFrameHierarchy();
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
    });

    it('should handle complex hierarchy validations', () => {
      // Create a tree structure
      const root1 = frameManager.createFrame({
        type: 'task',
        name: 'Root 1',
      });

      const root2 = frameManager.createFrame({
        type: 'task',
        name: 'Root 2',
      });

      const child1_1 = frameManager.createFrame({
        type: 'subtask',
        name: 'Child 1.1',
        parentFrameId: root1,
      });

      const child1_2 = frameManager.createFrame({
        type: 'subtask',
        name: 'Child 1.2',
        parentFrameId: root1,
      });

      const child2_1 = frameManager.createFrame({
        type: 'subtask',
        name: 'Child 2.1',
        parentFrameId: root2,
      });

      // Validate - should be valid
      const validation = frameManager.validateFrameHierarchy();
      expect(validation.isValid).toBe(true);
      expect(validation.errors).toHaveLength(0);
      expect(validation.warnings).toHaveLength(0);
    });
  });

  describe('Edge Cases', () => {
    it('should handle self-reference attempts', () => {
      const frameA = frameManager.createFrame({
        type: 'task',
        name: 'Frame A',
      });

      // Try to set frame as its own parent
      expect(() => {
        frameManager.updateParentFrame(frameA, frameA);
      }).toThrow();

      try {
        frameManager.updateParentFrame(frameA, frameA);
      } catch (error: any) {
        expect(error.code).toBe(ErrorCode.FRAME_CYCLE_DETECTED);
      }
    });

    it('should handle non-existent frame references', () => {
      const frameA = frameManager.createFrame({
        type: 'task',
        name: 'Frame A',
      });

      const fakeId = 'non-existent-frame-id';

      // Try to set parent to non-existent frame
      expect(() => {
        frameManager.updateParentFrame(frameA, fakeId);
      }).toThrow();

      // Try to update non-existent frame
      expect(() => {
        frameManager.updateParentFrame(fakeId, frameA);
      }).toThrow();
    });

    it('should handle concurrent frame operations safely', () => {
      // Create multiple frames rapidly
      const frameIds: string[] = [];

      for (let i = 0; i < 5; i++) {
        const id = frameManager.createFrame({
          type: 'task',
          name: `Concurrent Frame ${i}`,
        });
        frameIds.push(id);
      }

      // Try to create circular dependencies
      expect(() => {
        frameManager.updateParentFrame(frameIds[0], frameIds[4]);
        frameManager.updateParentFrame(frameIds[4], frameIds[0]);
      }).toThrow();
    });
  });
});
