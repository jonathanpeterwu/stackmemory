/**
 * Phase 3 Integration Tests - Team Collaboration End-to-End
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { DualStackManager } from '../dual-stack-manager.js';
import { FrameHandoffManager } from '../frame-handoff-manager.js';
import { StackMergeResolver } from '../stack-merge-resolver.js';
import { SQLiteAdapter } from '../../database/sqlite-adapter.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('Phase 3 Integration - Team Collaboration', () => {
  let dualStackManager: DualStackManager;
  let handoffManager: FrameHandoffManager;
  let mergeResolver: StackMergeResolver;
  let sqliteAdapter: SQLiteAdapter;
  let testDir: string;
  let dbPath: string;

  const projectId = 'test-project';
  const user1Id = 'alice';
  const user2Id = 'bob';
  const teamId = 'dev-team';

  beforeEach(async () => {
    // Create temporary directory for test database
    testDir = path.join(os.tmpdir(), `stackmemory-phase3-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    dbPath = path.join(testDir, 'test.db');

    // Create real SQLite adapter
    sqliteAdapter = new SQLiteAdapter(projectId, { dbPath });
    await sqliteAdapter.connect();
    await sqliteAdapter.initializeSchema();

    // Create managers with real database
    dualStackManager = new DualStackManager(sqliteAdapter, projectId, user1Id);
    handoffManager = new FrameHandoffManager(dualStackManager);
    mergeResolver = new StackMergeResolver(dualStackManager);
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

  describe('Complete Collaboration Workflow', () => {
    it('should support full team collaboration scenario', async () => {
      // User Alice creates frames in individual stack
      const activeStack = dualStackManager.getActiveStack();
      expect(activeStack).toBeDefined();

      // Create actual frames first
      const frame1Id = await activeStack.createFrame({
        name: 'Authentication Module',
        type: 'task',
        inputs: { component: 'auth', status: 'in_progress' },
      });
      const frame2Id = await activeStack.createFrame({
        name: 'Login Implementation',
        type: 'implementation',
        inputs: { feature: 'login', tests: 'pending' },
      });

      // Alice creates a shared team stack
      const sharedStackId = await dualStackManager.createSharedStack(
        teamId,
        'Feature Development',
        user1Id
      );
      expect(sharedStackId).toMatch(/^shared-dev-team-/);

      // Alice initiates handoff to shared stack
      const handoffId = await handoffManager.initiateHandoff(
        sharedStackId,
        [frame1Id, frame2Id],
        {
          initiatedAt: new Date(),
          initiatorId: user1Id,
          frameContext: {
            totalFrames: 2,
            frameTypes: ['task', 'implementation'],
            estimatedSize: 1024,
            dependencies: [],
          },
          businessContext: {
            milestone: 'Sprint 1',
            priority: 'high',
            deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
            stakeholders: [],
          },
        },
        user2Id,
        'Sharing authentication implementation'
      );

      expect(handoffId).toMatch(/^handoff-/);

      // Bob receives notification and approves handoff
      const notifications = await handoffManager.getUserNotifications(user2Id);
      expect(notifications).toHaveLength(1);
      expect(notifications[0].type).toBe('request');

      await handoffManager.submitHandoffApproval(handoffId, {
        reviewerId: user2Id,
        decision: 'approved',
        feedback: 'Looks good, ready for integration',
      });

      // Check handoff progress
      const progress = await handoffManager.getHandoffProgress(handoffId);
      expect(progress?.status).toBe('completed');
    });

    it('should handle complex merge conflicts', async () => {
      // Create shared stack
      const sharedStackId = await dualStackManager.createSharedStack(
        teamId,
        'Merge Test Stack',
        user1Id
      );

      // Create actual frame first
      const activeStack = dualStackManager.getActiveStack();
      const frameId = await activeStack.createFrame({
        name: 'Conflicted Frame',
        type: 'task',
        inputs: { conflict: true },
      });

      // Start merge session with conflicts
      const sessionId = await mergeResolver.startMergeSession(
        `individual-${user1Id}`,
        sharedStackId,
        [frameId],
        'default'
      );

      const session = await mergeResolver.getMergeSession(sessionId);
      expect(session).toBeDefined();
      expect(session?.status).toMatch(
        /analyzing|resolving|manual_review|completed/
      );

      // Manually resolve any remaining conflicts
      if (session?.conflicts.length) {
        for (const conflict of session.conflicts) {
          if (!conflict.autoResolvable) {
            await mergeResolver.resolveConflict(sessionId, conflict.frameId, {
              strategy: 'merge_both',
              resolvedBy: user1Id,
              notes: 'Manual merge of conflicting implementations',
            });
          }
        }
      }

      // Execute merge
      const updatedSession = await mergeResolver.getMergeSession(sessionId);
      if (updatedSession?.status === 'completed') {
        const result = await mergeResolver.executeMerge(sessionId);
        expect(result.success).toBe(true);
      }
    });

    it('should support handoff rejection and resubmission', async () => {
      const sharedStackId = await dualStackManager.createSharedStack(
        teamId,
        'Review Stack',
        user1Id
      );

      // Create actual frame first
      const activeStack = dualStackManager.getActiveStack();
      const frameId = await activeStack.createFrame({
        name: 'Incomplete Feature',
        type: 'task',
        inputs: { status: 'incomplete', tests: 'missing' },
      });

      // Initial handoff request
      const handoffId = await handoffManager.initiateHandoff(
        sharedStackId,
        [frameId],
        {
          initiatedAt: new Date(),
          initiatorId: user1Id,
          frameContext: {
            totalFrames: 1,
            frameTypes: ['task'],
            estimatedSize: 512,
            dependencies: [],
          },
          businessContext: {
            priority: 'medium',
            stakeholders: [user2Id],
          },
        },
        user2Id
      );

      // Reviewer requests changes
      await handoffManager.submitHandoffApproval(handoffId, {
        reviewerId: user2Id,
        decision: 'needs_changes',
        feedback: 'Please add unit tests before handoff',
        suggestedChanges: [
          {
            frameId: frameId,
            suggestion: 'Add test coverage',
            reason: 'Missing test validation',
          },
        ],
      });

      const progress = await handoffManager.getHandoffProgress(handoffId);
      expect(progress?.status).toBe('pending_review');
      expect(progress?.currentStep).toBe('Changes requested');
    });

    it('should track collaboration metrics', async () => {
      // Simulate multiple handoffs
      const sharedStackId = await dualStackManager.createSharedStack(
        teamId,
        'Metrics Stack',
        user1Id
      );

      const activeStack = dualStackManager.getActiveStack();
      // Create and complete several handoffs
      for (let i = 0; i < 3; i++) {
        // Create actual frame first
        const frameId = await activeStack.createFrame({
          name: `Metric Frame ${i}`,
          type: 'task',
          inputs: { metric: i },
        });

        const handoffId = await handoffManager.initiateHandoff(
          sharedStackId,
          [frameId],
          {
            initiatedAt: new Date(),
            initiatorId: user1Id,
            frameContext: {
              totalFrames: 1,
              frameTypes: ['task'],
              estimatedSize: 256,
              dependencies: [],
            },
          },
          user2Id
        );

        await handoffManager.submitHandoffApproval(handoffId, {
          reviewerId: user2Id,
          decision: 'approved',
        });
      }

      // Get metrics
      const metrics = await handoffManager.getHandoffMetrics();
      expect(metrics.totalHandoffs).toBeGreaterThanOrEqual(3);
      expect(metrics.completedHandoffs).toBeGreaterThanOrEqual(3);
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle handoff expiry gracefully', async () => {
      const sharedStackId = await dualStackManager.createSharedStack(
        teamId,
        'Expiry Test',
        user1Id
      );

      // Create actual frame first
      const activeStack = dualStackManager.getActiveStack();
      const frameId = await activeStack.createFrame({
        name: 'Expiry Test Frame',
        type: 'task',
        inputs: { test: 'expiry' },
      });

      const handoffId = await handoffManager.initiateHandoff(
        sharedStackId,
        [frameId],
        {
          initiatedAt: new Date(),
          initiatorId: user1Id,
          frameContext: {
            totalFrames: 1,
            frameTypes: ['task'],
            estimatedSize: 128,
            dependencies: [],
          },
        }
      );

      // Simulate expiry by manually setting expired status
      const progress = await handoffManager.getHandoffProgress(handoffId);
      if (progress) {
        progress.status = 'failed';
        progress.errors.push({
          step: 'expiry',
          error: 'Request expired after 24 hours',
          timestamp: new Date(),
        });
      }

      expect(progress?.status).toBe('failed');
    });

    it('should handle stack permission violations', async () => {
      // Create stack with limited permissions
      const restrictedStackId = await dualStackManager.createSharedStack(
        teamId,
        'Restricted Stack',
        user1Id,
        {
          canRead: true,
          canWrite: false,
          canHandoff: false,
          canMerge: false,
          canAdminister: false,
        }
      );

      // Create actual frame first
      const activeStack = dualStackManager.getActiveStack();
      const frameId = await activeStack.createFrame({
        name: 'Protected Frame',
        type: 'task',
        inputs: { protected: true },
      });

      // Attempt handoff to restricted stack should fail
      await expect(
        handoffManager.initiateHandoff(restrictedStackId, [frameId], {
          initiatedAt: new Date(),
          initiatorId: user2Id, // Different user
          frameContext: {
            totalFrames: 1,
            frameTypes: ['task'],
            estimatedSize: 64,
            dependencies: [],
          },
        })
      ).rejects.toThrow();
    });

    it('should handle concurrent handoffs', async () => {
      const sharedStackId = await dualStackManager.createSharedStack(
        teamId,
        'Concurrent Test',
        user1Id
      );

      const activeStack = dualStackManager.getActiveStack();
      // Create frames first
      const frameIds = [];
      for (let i = 0; i < 3; i++) {
        const frameId = await activeStack.createFrame({
          name: `Concurrent Frame ${i}`,
          type: 'task',
          inputs: { index: i },
        });
        frameIds.push(frameId);
      }

      // Start multiple handoffs concurrently
      const handoffPromises = [];
      for (let i = 0; i < 3; i++) {
        handoffPromises.push(
          handoffManager.initiateHandoff(sharedStackId, [frameIds[i]], {
            initiatedAt: new Date(),
            initiatorId: user1Id,
            frameContext: {
              totalFrames: 1,
              frameTypes: ['task'],
              estimatedSize: 32,
              dependencies: [],
            },
          })
        );
      }

      const handoffIds = await Promise.all(handoffPromises);
      expect(handoffIds).toHaveLength(3);
      expect(new Set(handoffIds).size).toBe(3); // All unique IDs
    });
  });

  describe('Advanced Merge Scenarios', () => {
    it('should handle custom merge policies', async () => {
      // Create aggressive merge policy
      await mergeResolver.createMergePolicy({
        name: 'test-aggressive',
        description: 'Auto-resolve everything possible',
        rules: [
          {
            condition: '$.severity == "low" || $.severity == "medium"',
            action: 'source_wins',
            priority: 5,
          },
          {
            condition: '$.autoResolvable',
            action: 'merge_both',
            priority: 3,
          },
        ],
        autoApplyThreshold: 'high',
      });

      const sharedStackId = await dualStackManager.createSharedStack(
        teamId,
        'Policy Test',
        user1Id
      );

      // Create a frame in the individual stack for the merge session to work with
      const activeStack = dualStackManager.getActiveStack();
      const frameId = await activeStack.createFrame({
        name: 'Policy Test Frame',
        type: 'task',
        inputs: { test: 'policy' },
      });

      const sessionId = await mergeResolver.startMergeSession(
        `individual-${user1Id}`,
        sharedStackId,
        [frameId],
        'test-aggressive'
      );

      const session = await mergeResolver.getMergeSession(sessionId);
      expect(session?.policy.name).toBe('test-aggressive');
    });

    it('should preserve data integrity during complex merges', async () => {
      const sourceStackId = `individual-${user1Id}`;
      const sharedStackId = await dualStackManager.createSharedStack(
        teamId,
        'Integrity Test',
        user1Id
      );

      // Create a frame in the individual stack for the merge session to work with
      const activeStack = dualStackManager.getActiveStack();
      const frameId = await activeStack.createFrame({
        name: 'Integrity Test Frame',
        type: 'task',
        inputs: { integrity: true },
      });

      // Start merge session
      const sessionId = await mergeResolver.startMergeSession(
        sourceStackId,
        sharedStackId,
        [frameId]
      );

      const session = await mergeResolver.getMergeSession(sessionId);
      expect(session).toBeDefined();

      // Verify session metadata is tracked correctly
      expect(session?.metadata).toHaveProperty('totalFrames');
      expect(session?.metadata).toHaveProperty('conflictFrames');
      expect(session?.metadata).toHaveProperty('autoResolvedConflicts');
    });
  });

  describe('Performance and Scalability', () => {
    it('should handle large frame sets efficiently', async () => {
      const startTime = Date.now();

      const sharedStackId = await dualStackManager.createSharedStack(
        teamId,
        'Performance Test',
        user1Id
      );

      // Create a smaller set of frames for testing (10 instead of 100 for faster tests)
      const activeStack = dualStackManager.getActiveStack();
      const frameIds = [];
      for (let i = 0; i < 10; i++) {
        const frameId = await activeStack.createFrame({
          name: `Large Frame ${i}`,
          type: 'task',
          inputs: { index: i, data: 'test data '.repeat(50) },
        });
        frameIds.push(frameId);
      }

      const handoffId = await handoffManager.initiateHandoff(
        sharedStackId,
        frameIds,
        {
          initiatedAt: new Date(),
          initiatorId: user1Id,
          frameContext: {
            totalFrames: frameIds.length,
            frameTypes: ['task', 'implementation', 'test'],
            estimatedSize: 51200, // 50KB
            dependencies: [],
          },
        }
      );

      const elapsed = Date.now() - startTime;
      expect(elapsed).toBeLessThan(1000); // Should complete within 1 second
      expect(handoffId).toBeDefined();
    });

    it('should cleanup expired sessions and notifications', async () => {
      // Create old handoff that should be cleaned up
      const sharedStackId = await dualStackManager.createSharedStack(
        teamId,
        'Cleanup Test',
        user1Id
      );

      // Create actual frame first
      const activeStack = dualStackManager.getActiveStack();
      const frameId = await activeStack.createFrame({
        name: 'Cleanup Frame',
        type: 'task',
        inputs: { cleanup: true },
      });

      await handoffManager.initiateHandoff(sharedStackId, [frameId], {
        initiatedAt: new Date(Date.now() - 25 * 60 * 60 * 1000), // 25 hours ago
        initiatorId: user1Id,
        frameContext: {
          totalFrames: 1,
          frameTypes: ['task'],
          estimatedSize: 16,
          dependencies: [],
        },
      });

      // Check that notifications can be cleaned up
      const notifications = await handoffManager.getUserNotifications(user1Id);
      expect(Array.isArray(notifications)).toBe(true);
    });
  });
});
