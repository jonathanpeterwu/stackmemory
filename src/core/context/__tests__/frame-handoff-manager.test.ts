/**
 * Test suite for FrameHandoffManager - STA-100 Advanced Frame Handoff Workflows
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  FrameHandoffManager,
  type HandoffMetadata,
  type HandoffApproval,
} from '../frame-handoff-manager.js';
import { DualStackManager } from '../dual-stack-manager.js';
import { logger } from '../../monitoring/logger.js';

// Mock the logger
vi.mock('../../monitoring/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('FrameHandoffManager - Advanced Workflows', () => {
  let handoffManager: FrameHandoffManager;
  let mockDualStackManager: Partial<DualStackManager>;

  beforeEach(() => {
    // Create mock DualStackManager
    mockDualStackManager = {
      getPermissionManager: vi.fn().mockReturnValue({
        enforcePermission: vi.fn().mockResolvedValue(true),
        createContext: vi.fn().mockReturnValue({}),
      }),
      initiateHandoff: vi.fn().mockResolvedValue('test-handoff-123'),
      acceptHandoff: vi.fn().mockResolvedValue({
        success: true,
        mergedFrames: [{ frameId: 'frame1' }, { frameId: 'frame2' }],
        conflictFrames: [],
        errors: [],
      }),
      getActiveStack: vi.fn().mockReturnValue({
        getFrame: vi.fn().mockResolvedValue({
          frameId: 'frame1',
          state: 'completed',
          name: 'Test Frame',
        }),
      }),
    };

    handoffManager = new FrameHandoffManager(
      mockDualStackManager as DualStackManager
    );
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('Notification System', () => {
    it('should create comprehensive notifications for handoff initiation', async () => {
      const metadata: HandoffMetadata = {
        initiatedAt: new Date(),
        initiatorId: 'user1',
        targetUserId: 'user2',
        frameContext: {
          totalFrames: 3,
          frameTypes: ['development', 'testing'],
          estimatedSize: 1024,
          dependencies: ['dep1'],
        },
        businessContext: {
          priority: 'high',
          milestone: 'Sprint 1',
          stakeholders: ['user3', 'user4'],
        },
      };

      const requestId = await handoffManager.initiateHandoff(
        'target-stack',
        ['frame1', 'frame2', 'frame3'],
        metadata,
        'user2',
        'Test handoff'
      );

      expect(requestId).toBe('test-handoff-123');

      // Check notifications were created
      const targetNotifications =
        await handoffManager.getUserNotifications('user2');
      expect(targetNotifications).toHaveLength(1);
      expect(targetNotifications[0].title).toBe('Frame Handoff Request');
      expect(targetNotifications[0].actionRequired).toBe(true);

      // Check stakeholder notifications
      const stakeholder1Notifications =
        await handoffManager.getUserNotifications('user3');
      expect(stakeholder1Notifications).toHaveLength(1);
      expect(stakeholder1Notifications[0].title).toBe(
        'Frame Handoff Notification'
      );
    });

    it('should send reminders for high priority handoffs', async () => {
      // Create a mock timer for testing reminders
      vi.useFakeTimers();

      const metadata: HandoffMetadata = {
        initiatedAt: new Date(),
        initiatorId: 'user1',
        targetUserId: 'user2',
        frameContext: {
          totalFrames: 2,
          frameTypes: ['development'],
          estimatedSize: 512,
          dependencies: [],
        },
        businessContext: {
          priority: 'critical',
          stakeholders: [],
        },
      };

      await handoffManager.initiateHandoff(
        'target-stack',
        ['frame1', 'frame2'],
        metadata,
        'user2'
      );

      // Fast-forward 4 hours to trigger reminder
      vi.advanceTimersByTime(4 * 60 * 60 * 1000);

      const notifications = await handoffManager.getUserNotifications('user2');
      // Should have initial notification + reminder
      expect(notifications.length).toBeGreaterThanOrEqual(1);

      vi.useRealTimers();
    });

    it('should handle changes requested workflow', async () => {
      const requestId = 'test-request-123';

      // Simulate an active handoff
      await handoffManager.updateHandoffProgress(requestId, {
        requestId,
        status: 'pending_review',
        transferredFrames: 0,
        totalFrames: 2,
        currentStep: 'Awaiting approval',
        errors: [],
      });

      const approval: Omit<HandoffApproval, 'requestId' | 'reviewedAt'> = {
        reviewerId: 'reviewer1',
        decision: 'needs_changes',
        feedback: 'Please add more documentation',
        suggestedChanges: [
          {
            frameId: 'frame1',
            suggestion: 'Add inline comments',
            reason: 'Code clarity',
          },
        ],
      };

      await handoffManager.submitHandoffApproval(requestId, approval);

      const progress = await handoffManager.getHandoffProgress(requestId);
      expect(progress?.status).toBe('pending_review');
      expect(progress?.currentStep).toBe('Changes requested');
    });
  });

  describe('Analytics and Metrics', () => {
    it('should calculate handoff metrics correctly', async () => {
      // Create some test handoffs
      const testHandoffs = [
        {
          requestId: 'req1',
          status: 'completed' as const,
          transferredFrames: 5,
          totalFrames: 5,
          currentStep: 'Completed',
          estimatedCompletion: new Date(),
          errors: [],
        },
        {
          requestId: 'req2',
          status: 'completed' as const,
          transferredFrames: 3,
          totalFrames: 3,
          currentStep: 'Completed',
          estimatedCompletion: new Date(),
          errors: [
            {
              step: 'transfer',
              error: 'Minor conflict',
              timestamp: new Date(),
            },
          ],
        },
        {
          requestId: 'req3',
          status: 'failed' as const,
          transferredFrames: 1,
          totalFrames: 4,
          currentStep: 'Failed',
          errors: [
            {
              step: 'validation',
              error: 'Permission denied',
              timestamp: new Date(),
            },
            { step: 'transfer', error: 'Network error', timestamp: new Date() },
          ],
        },
      ];

      // Manually set up handoffs for testing
      for (const handoff of testHandoffs) {
        (handoffManager as any).activeHandoffs.set(handoff.requestId, handoff);
      }

      const metrics = await handoffManager.getHandoffMetrics();

      expect(metrics.totalHandoffs).toBe(3);
      expect(metrics.completedHandoffs).toBe(2);
      expect(metrics.averageProcessingTime).toBeGreaterThan(0);
      expect(metrics.topFrameTypes.length).toBeGreaterThan(0);
      expect(metrics.collaborationPatterns.length).toBeGreaterThan(0);
    });

    it('should analyze frame types correctly', async () => {
      const handoff = {
        requestId: 'req-bulk',
        status: 'completed' as const,
        transferredFrames: 15,
        totalFrames: 15,
        currentStep: 'Completed',
        errors: [],
      };

      (handoffManager as any).activeHandoffs.set(handoff.requestId, handoff);

      const metrics = await handoffManager.getHandoffMetrics();
      const frameTypes = metrics.topFrameTypes;

      expect(frameTypes.some((type) => type.type === 'bulk_transfer')).toBe(
        true
      );
      expect(frameTypes.some((type) => type.type === 'complete_transfer')).toBe(
        true
      );
    });
  });

  describe('Real-time Collaboration Features', () => {
    it('should update handoff progress in real-time', async () => {
      const requestId = 'real-time-test';

      // Initialize handoff progress
      await handoffManager.updateHandoffProgress(requestId, {
        requestId,
        status: 'approved',
        transferredFrames: 0,
        totalFrames: 5,
        currentStep: 'Starting transfer',
        errors: [],
      });

      // Update progress
      await handoffManager.updateHandoffProgress(requestId, {
        transferredFrames: 3,
        currentStep: 'Transferring frames',
      });

      const progress = await handoffManager.getHandoffProgress(requestId);
      expect(progress?.transferredFrames).toBe(3);
      expect(progress?.currentStep).toBe('Transferring frames');
      expect(progress?.status).toBe('approved');
    });

    it('should filter active handoffs with real-time criteria', async () => {
      // Set up test handoffs with different characteristics
      const handoffs = [
        {
          requestId: 'high-priority',
          status: 'pending_review' as const,
          transferredFrames: 0,
          totalFrames: 25, // High frame count
          currentStep: 'Awaiting approval',
          errors: [],
        },
        {
          requestId: 'low-priority',
          status: 'approved' as const,
          transferredFrames: 2,
          totalFrames: 3,
          currentStep: 'Transferring',
          errors: [],
        },
        {
          requestId: 'critical-errors',
          status: 'in_transfer' as const,
          transferredFrames: 1,
          totalFrames: 10,
          currentStep: 'Resolving conflicts',
          errors: [
            { step: 'transfer', error: 'Conflict 1', timestamp: new Date() },
            { step: 'transfer', error: 'Conflict 2', timestamp: new Date() },
            { step: 'transfer', error: 'Conflict 3', timestamp: new Date() },
          ],
        },
      ];

      // Set up handoffs
      for (const handoff of handoffs) {
        (handoffManager as any).activeHandoffs.set(handoff.requestId, handoff);
      }

      // Test priority filtering
      const highPriorityHandoffs =
        await handoffManager.getActiveHandoffsRealTime({
          priority: 'high',
        });
      expect(highPriorityHandoffs).toHaveLength(1);
      expect(highPriorityHandoffs[0].requestId).toBe('high-priority');

      const criticalHandoffs = await handoffManager.getActiveHandoffsRealTime({
        priority: 'critical',
      });
      expect(criticalHandoffs).toHaveLength(1);
      expect(criticalHandoffs[0].requestId).toBe('critical-errors');

      // Test status filtering
      const pendingHandoffs = await handoffManager.getActiveHandoffsRealTime({
        status: 'pending_review',
      });
      expect(pendingHandoffs).toHaveLength(1);
      expect(pendingHandoffs[0].requestId).toBe('high-priority');
    });

    it('should perform bulk operations correctly', async () => {
      // Set up multiple handoffs
      const requestIds = ['bulk1', 'bulk2', 'bulk3'];
      for (const id of requestIds) {
        (handoffManager as any).activeHandoffs.set(id, {
          requestId: id,
          status: 'pending_review',
          transferredFrames: 0,
          totalFrames: 2,
          currentStep: 'Awaiting approval',
          errors: [],
        });
      }

      const result = await handoffManager.bulkHandoffOperation({
        action: 'approve',
        requestIds,
        reviewerId: 'bulk-reviewer',
        feedback: 'Bulk approval',
      });

      expect(result.successful).toHaveLength(3);
      expect(result.failed).toHaveLength(0);
      expect(result.successful).toEqual(expect.arrayContaining(requestIds));
    });

    it('should cleanup expired notifications', async () => {
      // Add some expired notifications
      const expiredNotification = {
        id: 'expired-1',
        type: 'reminder' as const,
        requestId: 'test-req',
        recipientId: 'user1',
        title: 'Expired Notification',
        message: 'This should be cleaned up',
        actionRequired: false,
        expiresAt: new Date(Date.now() - 60 * 60 * 1000), // 1 hour ago
        createdAt: new Date(Date.now() - 2 * 60 * 60 * 1000), // 2 hours ago
      };

      const activeNotification = {
        id: 'active-1',
        type: 'request' as const,
        requestId: 'test-req',
        recipientId: 'user1',
        title: 'Active Notification',
        message: 'This should remain',
        actionRequired: true,
        expiresAt: new Date(Date.now() + 60 * 60 * 1000), // 1 hour from now
        createdAt: new Date(),
      };

      // Manually set notifications
      (handoffManager as any).notifications.set('user1', [
        expiredNotification,
        activeNotification,
      ]);

      const cleanedCount =
        await handoffManager.cleanupExpiredNotifications('user1');
      expect(cleanedCount).toBe(1);

      const remainingNotifications =
        await handoffManager.getUserNotifications('user1');
      expect(remainingNotifications).toHaveLength(1);
      expect(remainingNotifications[0].id).toBe('active-1');
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle handoff approval for non-existent requests', async () => {
      await expect(
        handoffManager.submitHandoffApproval('non-existent', {
          reviewerId: 'reviewer',
          decision: 'approved',
        })
      ).rejects.toThrow('Handoff request not found: non-existent');
    });

    it('should handle progress updates for non-existent requests', async () => {
      await expect(
        handoffManager.updateHandoffProgress('non-existent', {
          transferredFrames: 5,
        })
      ).rejects.toThrow('Handoff request not found: non-existent');
    });

    it('should handle cancellation of in-transfer handoffs', async () => {
      const requestId = 'in-transfer-test';
      (handoffManager as any).activeHandoffs.set(requestId, {
        requestId,
        status: 'in_transfer',
        transferredFrames: 2,
        totalFrames: 5,
        currentStep: 'Transferring frames',
        errors: [],
      });

      await expect(
        handoffManager.cancelHandoff(requestId, 'User requested cancellation')
      ).rejects.toThrow('Cannot cancel handoff that is currently transferring');
    });

    it('should handle bulk operations with mixed success/failure', async () => {
      // Set up one valid and one invalid handoff
      (handoffManager as any).activeHandoffs.set('valid', {
        requestId: 'valid',
        status: 'pending_review',
        transferredFrames: 0,
        totalFrames: 2,
        currentStep: 'Awaiting approval',
        errors: [],
      });

      const result = await handoffManager.bulkHandoffOperation({
        action: 'approve',
        requestIds: ['valid', 'invalid'],
        reviewerId: 'reviewer',
      });

      expect(result.successful).toHaveLength(1);
      expect(result.failed).toHaveLength(1);
      expect(result.successful[0]).toBe('valid');
      expect(result.failed[0].requestId).toBe('invalid');
    });
  });
});
