/**
 * Tests for Linear sync concurrent operations
 * Verifies that the sync manager properly handles concurrent sync requests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'events';

// Mock the sync engine before importing the manager
const mockSyncFn = vi.fn().mockImplementation(async () => {
  // Simulate sync taking 100ms
  await new Promise((resolve) => setTimeout(resolve, 100));
  return {
    success: true,
    synced: { toLinear: 1, fromLinear: 2, updated: 1 },
    conflicts: [],
    errors: [],
  };
});

vi.mock('../sync.js', () => {
  return {
    LinearSyncEngine: class MockLinearSyncEngine {
      sync = mockSyncFn;
      updateConfig = vi.fn();
    },
    DEFAULT_SYNC_CONFIG: {
      enabled: true,
      direction: 'bidirectional',
      autoSync: false,
      conflictResolution: 'newest_wins',
    },
  };
});

vi.mock('../../core/monitoring/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Create a mock task manager
class MockTaskManager extends EventEmitter {
  loadTasks = vi.fn();
  saveTasks = vi.fn();
}

// Create a mock auth manager
const mockAuthManager = {
  loadTokens: vi.fn().mockReturnValue({ accessToken: 'test-token' }),
  saveTokens: vi.fn(),
  clearTokens: vi.fn(),
  isAuthenticated: vi.fn().mockReturnValue(true),
};

describe('LinearSyncManager - Concurrent Operations', () => {
  let syncManager: any;
  let mockTaskStore: MockTaskManager;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockTaskStore = new MockTaskManager();

    // Import after mocks are set up
    const { LinearSyncManager } = await import('../sync-manager.js');

    syncManager = new LinearSyncManager(
      mockTaskStore as any,
      mockAuthManager as any,
      {
        enabled: true,
        direction: 'bidirectional',
        autoSync: false,
        autoSyncInterval: 15,
        syncOnTaskChange: false,
        syncOnSessionStart: false,
        syncOnSessionEnd: false,
        conflictResolution: 'newest_wins',
      }
    );
  });

  afterEach(() => {
    syncManager?.stop();
  });

  describe('Concurrent sync prevention', () => {
    it('should prevent concurrent sync operations', async () => {
      // Start two syncs nearly simultaneously
      const sync1Promise = syncManager.performSync('manual');
      const sync2Promise = syncManager.performSync('manual');

      const [result1, result2] = await Promise.all([
        sync1Promise,
        sync2Promise,
      ]);

      // One should succeed, one should be skipped
      const successes = [result1, result2].filter((r) => r.success);
      const skipped = [result1, result2].filter(
        (r) => !r.success && r.errors.includes('Sync already in progress')
      );

      expect(successes).toHaveLength(1);
      expect(skipped).toHaveLength(1);
    });

    it('should allow sync after previous completes', async () => {
      // First sync
      const result1 = await syncManager.performSync('manual');
      expect(result1.success).toBe(true);

      // Second sync after first completes
      const result2 = await syncManager.performSync('manual');
      expect(result2.success).toBe(true);
    });

    it('should report sync in progress status', async () => {
      // Start sync but don't await
      const syncPromise = syncManager.performSync('manual');

      // Check status during sync
      const statusDuring = syncManager.getStatus();
      expect(statusDuring.syncInProgress).toBe(true);

      // Wait for sync to complete
      await syncPromise;

      // Check status after sync
      const statusAfter = syncManager.getStatus();
      expect(statusAfter.syncInProgress).toBe(false);
    });

    it('should release lock even on sync failure', async () => {
      // Make sync fail once
      mockSyncFn.mockRejectedValueOnce(new Error('Network error'));

      // Sync should fail
      const result1 = await syncManager.performSync('manual');
      expect(result1.success).toBe(false);
      expect(result1.errors[0]).toContain('Network error');

      // But lock should be released
      const status = syncManager.getStatus();
      expect(status.syncInProgress).toBe(false);
    });
  });

  describe('Minimum sync interval', () => {
    it('should enforce minimum interval between non-manual syncs', async () => {
      // First sync
      const result1 = await syncManager.performSync('periodic');
      expect(result1.success).toBe(true);

      // Immediate second sync should be throttled
      const result2 = await syncManager.performSync('periodic');
      expect(result2.success).toBe(false);
      expect(result2.errors[0]).toContain('Too soon since last sync');
    });

    it('should allow manual sync to bypass minimum interval', async () => {
      // First sync
      const result1 = await syncManager.performSync('periodic');
      expect(result1.success).toBe(true);

      // Manual sync should still work
      const result2 = await syncManager.performSync('manual');
      expect(result2.success).toBe(true);
    });
  });

  describe('Event emission', () => {
    it('should emit sync:started and sync:completed events', async () => {
      const startedHandler = vi.fn();
      const completedHandler = vi.fn();

      syncManager.on('sync:started', startedHandler);
      syncManager.on('sync:completed', completedHandler);

      await syncManager.performSync('manual');

      expect(startedHandler).toHaveBeenCalledWith({ trigger: 'manual' });
      expect(completedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: 'manual',
          result: expect.objectContaining({ success: true }),
        })
      );
    });

    it('should emit sync:failed on error', async () => {
      const failedHandler = vi.fn();
      syncManager.on('sync:failed', failedHandler);

      // Make sync fail
      mockSyncFn.mockRejectedValueOnce(new Error('API error'));

      await syncManager.performSync('manual');

      expect(failedHandler).toHaveBeenCalledWith(
        expect.objectContaining({
          trigger: 'manual',
          error: expect.any(Error),
        })
      );
    });
  });

  describe('Disabled sync', () => {
    it('should skip sync when disabled', async () => {
      syncManager.updateConfig({ enabled: false });

      const result = await syncManager.performSync('manual');

      expect(result.success).toBe(false);
      expect(result.errors).toContain('Sync is disabled');
    });
  });
});
