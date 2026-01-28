import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { FrameManager, type Frame } from '../index.js';

// Mock dependencies before importing the module under test
vi.mock('../../session/session-manager.js');
vi.mock('../../monitoring/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks are set up
import {
  ContextBridge,
  SharedContextLayer,
  sharedContextLayer,
} from '../shared-context-layer.js';
import { sessionManager } from '../../session/session-manager.js';

describe('ContextBridge', () => {
  let bridge: ContextBridge;
  let mockFrameManager: Partial<FrameManager>;

  const mockSession = {
    sessionId: 'test-session-123',
    runId: 'test-run-456',
    projectId: 'test-project',
    branch: 'main',
    startedAt: Date.now(),
    lastActiveAt: Date.now(),
    metadata: {},
    state: 'active' as const,
  };

  // Spy on sharedContextLayer methods
  let autoDiscoverSpy: ReturnType<typeof vi.spyOn>;
  let addToSharedContextSpy: ReturnType<typeof vi.spyOn>;
  let querySharedContextSpy: ReturnType<typeof vi.spyOn>;
  let addDecisionSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.mocked(sessionManager.getCurrentSession).mockReturnValue(mockSession);

    // Spy on SharedContextLayer methods
    autoDiscoverSpy = vi
      .spyOn(sharedContextLayer, 'autoDiscoverContext')
      .mockResolvedValue({
        hasSharedContext: true,
        sessionCount: 2,
        recentPatterns: [
          {
            pattern: 'Error pattern',
            type: 'error',
            frequency: 3,
            lastSeen: Date.now(),
          },
        ],
        lastDecisions: [
          {
            id: '1',
            decision: 'Use TypeScript',
            reasoning: 'Type safety',
            timestamp: Date.now(),
            sessionId: 'old-session',
          },
        ],
        suggestedFrames: [
          {
            frameId: 'f1',
            title: 'Important Frame',
            type: 'task',
            score: 0.9,
            tags: ['important'],
            createdAt: Date.now(),
          },
        ],
      });

    addToSharedContextSpy = vi
      .spyOn(sharedContextLayer, 'addToSharedContext')
      .mockResolvedValue(undefined);

    querySharedContextSpy = vi
      .spyOn(sharedContextLayer, 'querySharedContext')
      .mockResolvedValue([]);

    addDecisionSpy = vi
      .spyOn(sharedContextLayer, 'addDecision')
      .mockResolvedValue(undefined);

    mockFrameManager = {
      getActiveFramePath: vi.fn().mockReturnValue([]),
      getRecentFrames: vi.fn().mockResolvedValue([]),
      addContext: vi.fn().mockResolvedValue(undefined),
      getCurrentFrameId: vi.fn().mockReturnValue('current-frame-id'),
      closeFrame: vi.fn().mockResolvedValue(undefined),
      createFrame: vi.fn().mockResolvedValue('new-frame-id'),
      getFrame: vi.fn().mockReturnValue(undefined),
    };

    bridge = ContextBridge.getInstance();
  });

  afterEach(() => {
    bridge.stopAutoSync();
    vi.restoreAllMocks();
    vi.clearAllTimers();
  });

  it('should initialize as singleton and load shared context', async () => {
    // Test singleton
    const instance1 = ContextBridge.getInstance();
    const instance2 = ContextBridge.getInstance();
    expect(instance1).toBe(instance2);

    // Test initialization
    await bridge.initialize(mockFrameManager as FrameManager, {
      autoSync: false, // Disable to avoid timer issues
      syncInterval: 30000,
      minFrameScore: 0.6,
      importantTags: ['custom-tag'],
    });

    expect(autoDiscoverSpy).toHaveBeenCalled();
    expect(mockFrameManager.addContext).toHaveBeenCalledWith(
      'shared-context-suggestions',
      expect.objectContaining({
        suggestedFrames: expect.any(Array),
        loadedAt: expect.any(Number),
      })
    );
  });

  it('should handle initialization errors and empty context gracefully', async () => {
    autoDiscoverSpy.mockRejectedValueOnce(new Error('Load failed'));
    await expect(
      bridge.initialize(mockFrameManager as FrameManager, { autoSync: false })
    ).resolves.not.toThrow();

    // Test empty shared context
    vi.mocked(mockFrameManager.addContext).mockClear();
    autoDiscoverSpy.mockResolvedValueOnce({
      hasSharedContext: false,
      sessionCount: 0,
      recentPatterns: [],
      lastDecisions: [],
      suggestedFrames: [],
    });
    await bridge.loadSharedContext();
    expect(mockFrameManager.addContext).not.toHaveBeenCalled();
  });

  it('should sync important frames and filter by importance', async () => {
    await bridge.initialize(mockFrameManager as FrameManager, {
      autoSync: false,
      minFrameScore: 0.5,
      importantTags: ['test-tag'],
    });

    const frames: Frame[] = [
      {
        frame_id: '1',
        type: 'task',
        name: 'Important Task',
        metadata: { importance: 'high' },
      } as any,
      { frame_id: '2', type: 'debug', name: 'Debug Info' } as any,
      { frame_id: '3', type: 'error', name: 'Error Found' } as any,
      { frame_id: '4', type: 'milestone', name: 'Milestone' } as any,
    ];

    vi.mocked(mockFrameManager.getActiveFramePath).mockReturnValue(frames);
    vi.mocked(mockFrameManager.getRecentFrames).mockResolvedValue([]);

    await bridge.syncToSharedContext();

    expect(addToSharedContextSpy).toHaveBeenCalledWith(
      expect.arrayContaining([
        expect.objectContaining({ frame_id: '1' }),
        expect.objectContaining({ frame_id: '3' }),
        expect.objectContaining({ frame_id: '4' }),
      ]),
      expect.any(Object)
    );
  });

  it('should query shared frames and handle errors', async () => {
    await bridge.initialize(mockFrameManager as FrameManager, {
      autoSync: false,
    });

    const mockResults = [{ frameId: 'f1', title: 'Result 1', score: 0.8 }];
    querySharedContextSpy.mockResolvedValueOnce(mockResults);

    const results = await bridge.querySharedFrames({
      tags: ['important'],
      type: 'task',
      limit: 10,
    });
    expect(results).toEqual(mockResults);

    // Test error handling
    querySharedContextSpy.mockRejectedValueOnce(new Error('Query failed'));
    const errorResults = await bridge.querySharedFrames({ tags: ['test'] });
    expect(errorResults).toEqual([]);
  });

  it('should add decisions and handle errors', async () => {
    await bridge.initialize(mockFrameManager as FrameManager, {
      autoSync: false,
    });

    await bridge.addDecision('Use new architecture', 'Better scalability');
    expect(addDecisionSpy).toHaveBeenCalledWith({
      decision: 'Use new architecture',
      reasoning: 'Better scalability',
      outcome: 'pending',
    });

    // Test error handling
    addDecisionSpy.mockRejectedValueOnce(new Error('Save failed'));
    await expect(
      bridge.addDecision('Test decision', 'Test reasoning')
    ).resolves.not.toThrow();
  });

  it('should handle auto-sync lifecycle and manual sync', async () => {
    vi.useFakeTimers();

    vi.mocked(mockFrameManager.getActiveFramePath).mockReturnValue([
      { frame_id: 'test', type: 'task', name: 'Test' } as any,
    ]);
    vi.mocked(mockFrameManager.getRecentFrames).mockResolvedValue([]);

    await bridge.initialize(mockFrameManager as FrameManager, {
      autoSync: true,
      syncInterval: 5000,
    });

    // Fast-forward time to trigger the interval
    await vi.advanceTimersByTimeAsync(5000);
    expect(addToSharedContextSpy).toHaveBeenCalledTimes(1);

    // Stop auto-sync
    bridge.stopAutoSync();
    await vi.advanceTimersByTimeAsync(10000);
    expect(addToSharedContextSpy).toHaveBeenCalledTimes(1); // No new calls

    // Manual sync
    await bridge.forceSyncNow();
    expect(addToSharedContextSpy).toHaveBeenCalledTimes(2);

    vi.useRealTimers();
  });

  it('should return sync statistics', async () => {
    await bridge.initialize(mockFrameManager as FrameManager, {
      autoSync: true,
      syncInterval: 30000,
    });

    vi.mocked(mockFrameManager.getActiveFramePath).mockReturnValue([
      { frame_id: 'test', type: 'task', name: 'Test' } as any,
    ]);
    await bridge.syncToSharedContext();

    const stats = bridge.getSyncStats();
    expect(stats).toMatchObject({
      lastSyncTime: expect.any(Number),
      autoSyncEnabled: true,
      syncInterval: 30000,
    });
    expect(stats.lastSyncTime).toBeGreaterThan(0);
  });
});
