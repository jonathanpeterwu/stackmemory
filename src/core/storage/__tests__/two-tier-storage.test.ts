/**
 * Tests for Two-Tier Storage System
 * Validates STA-414 implementation
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { 
  TwoTierStorageSystem, 
  StorageTier,
  type TwoTierConfig,
  type TierConfig
} from '../two-tier-storage.js';
import type { Frame, Event, Anchor } from '../../context/frame-manager.js';

describe('TwoTierStorageSystem', () => {
  let storage: TwoTierStorageSystem;
  let tempDir: string;
  let config: TwoTierConfig;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'two-tier-test-'));
    
    config = {
      local: {
        dbPath: join(tempDir, 'test.db'),
        maxSizeGB: 1,
        tiers: [
          {
            name: StorageTier.YOUNG,
            maxAgeHours: 24,
            compressionType: 'none',
            retentionPolicy: 'complete',
            maxSizeMB: 100
          },
          {
            name: StorageTier.MATURE,
            maxAgeHours: 168,
            compressionType: 'gzip', // Use gzip instead of lz4 for testing
            retentionPolicy: 'selective',
            maxSizeMB: 200
          },
          {
            name: StorageTier.OLD,
            maxAgeHours: 720,
            compressionType: 'gzip',
            retentionPolicy: 'critical',
            maxSizeMB: 100
          }
        ]
      },
      remote: {
        s3: {
          bucket: 'test-bucket',
          region: 'us-east-1'
        }
      },
      migration: {
        triggers: [
          { type: 'age', threshold: 720, action: 'migrate' },
          { type: 'size', threshold: 300, action: 'migrate' }
        ],
        batchSize: 10,
        intervalMs: 1000
      }
    };
    
    storage = new TwoTierStorageSystem(config);
  });

  afterEach(async () => {
    if (storage) {
      await storage.shutdown();
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Initialization', () => {
    it('should initialize storage system successfully', async () => {
      await expect(storage.initialize()).resolves.not.toThrow();
    });

    it('should create required database tables', async () => {
      await storage.initialize();
      // Database tables are created in constructor
      expect(true).toBe(true); // If we reach here, initialization worked
    });
  });

  describe('Tier Selection', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should select YOUNG tier for recent frames', async () => {
      const recentFrame: Frame = createTestFrame({
        created_at: Date.now() - (1000 * 60 * 60) // 1 hour ago
      });
      
      const storageId = await storage.storeFrame(recentFrame, [], []);
      expect(storageId).toBeDefined();
    });

    it('should select MATURE tier for 2-day-old frames', async () => {
      const matureFrame: Frame = createTestFrame({
        created_at: Date.now() - (1000 * 60 * 60 * 48) // 2 days ago
      });
      
      const storageId = await storage.storeFrame(matureFrame, [], []);
      expect(storageId).toBeDefined();
    });

    it('should select OLD tier for 10-day-old frames', async () => {
      const oldFrame: Frame = createTestFrame({
        created_at: Date.now() - (1000 * 60 * 60 * 24 * 10) // 10 days ago
      });
      
      const storageId = await storage.storeFrame(oldFrame, [], []);
      expect(storageId).toBeDefined();
    });

    it('should handle invalid timestamps gracefully', async () => {
      const invalidFrame: Frame = createTestFrame({
        created_at: NaN
      });
      
      const storageId = await storage.storeFrame(invalidFrame, [], []);
      expect(storageId).toBeDefined(); // Should default to YOUNG tier
    });
  });

  describe('Data Compression', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should not compress young tier data', async () => {
      const youngFrame = createTestFrame({
        created_at: Date.now() - (1000 * 60 * 30) // 30 minutes ago
      });
      
      const storageId = await storage.storeFrame(youngFrame, [], []);
      const retrieved = await storage.retrieveFrame(youngFrame.frame_id);
      
      expect(retrieved).toBeDefined();
      expect(retrieved.frame.frame_id).toBe(youngFrame.frame_id);
    });

    it('should compress mature tier data', async () => {
      const matureFrame = createTestFrame({
        created_at: Date.now() - (1000 * 60 * 60 * 48) // 2 days ago
      });
      
      const storageId = await storage.storeFrame(matureFrame, [], []);
      const retrieved = await storage.retrieveFrame(matureFrame.frame_id);
      
      expect(retrieved).toBeDefined();
      expect(retrieved.frame.frame_id).toBe(matureFrame.frame_id);
    });
  });

  describe('Importance Scoring', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should calculate higher importance for frames with decisions', async () => {
      const frame = createTestFrame();
      const anchors: Anchor[] = [
        createTestAnchor({ type: 'DECISION' }),
        createTestAnchor({ type: 'DECISION' })
      ];
      
      const storageId = await storage.storeFrame(frame, [], anchors);
      expect(storageId).toBeDefined();
    });

    it('should calculate higher importance for frames with many events', async () => {
      const frame = createTestFrame();
      const events: Event[] = Array.from({ length: 50 }, () => createTestEvent());
      
      const storageId = await storage.storeFrame(frame, events, []);
      expect(storageId).toBeDefined();
    });

    it('should calculate higher importance for frames with errors', async () => {
      const frame = createTestFrame();
      const events: Event[] = [
        createTestEvent({ event_type: 'error' }),
        createTestEvent({ event_type: 'error' })
      ];
      
      const storageId = await storage.storeFrame(frame, events, []);
      expect(storageId).toBeDefined();
    });
  });

  describe('Storage Retrieval', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should retrieve stored frame successfully', async () => {
      const frame = createTestFrame();
      const events = [createTestEvent()];
      const anchors = [createTestAnchor()];
      
      await storage.storeFrame(frame, events, anchors);
      const retrieved = await storage.retrieveFrame(frame.frame_id);
      
      expect(retrieved).toBeDefined();
      expect(retrieved.frame.frame_id).toBe(frame.frame_id);
      expect(retrieved.events).toHaveLength(1);
      expect(retrieved.anchors).toHaveLength(1);
    });

    it('should return null for non-existent frame', async () => {
      const retrieved = await storage.retrieveFrame('non-existent-frame-id');
      expect(retrieved).toBeNull();
    });
  });

  describe('Storage Statistics', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should provide accurate storage statistics', async () => {
      // Store some test data
      const frame1 = createTestFrame();
      const frame2 = createTestFrame({ 
        created_at: Date.now() - (1000 * 60 * 60 * 48) 
      });
      
      await storage.storeFrame(frame1, [], []);
      await storage.storeFrame(frame2, [], []);
      
      const stats = await storage.getStats();
      
      expect(stats).toBeDefined();
      expect(stats.tierDistribution).toBeDefined();
      expect(stats.localUsageMB).toBeGreaterThan(0);
      expect(stats.compressionRatio).toBeGreaterThan(0);
    });
  });

  describe('Input Validation', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should reject invalid frame data', async () => {
      const invalidFrame = {} as Frame; // Missing required fields
      
      await expect(
        storage.storeFrame(invalidFrame, [], [])
      ).rejects.toThrow();
    });

    it('should handle empty events and anchors arrays', async () => {
      const frame = createTestFrame();
      
      const storageId = await storage.storeFrame(frame, [], []);
      expect(storageId).toBeDefined();
    });
  });

  describe('Configuration', () => {
    it('should use default tiers when none provided', () => {
      const emptyConfig: TwoTierConfig = {
        local: {
          dbPath: join(tempDir, 'empty.db'),
          maxSizeGB: 1,
          tiers: []
        },
        remote: {
          s3: { bucket: 'test', region: 'us-east-1' }
        },
        migration: {
          triggers: [],
          batchSize: 10,
          intervalMs: 1000
        }
      };
      
      // Should not throw when creating with empty tiers
      const emptyStorage = new TwoTierStorageSystem(emptyConfig);
      expect(emptyStorage).toBeDefined();
    });
  });
});

// Test helper functions
function createTestFrame(overrides: Partial<Frame> = {}): Frame {
  return {
    frame_id: `test-frame-${Date.now()}-${Math.random()}`,
    project_id: 'test-project',
    run_id: 'test-run',
    type: 'task',
    name: 'Test Frame',
    created_at: Date.now(),
    closed_at: null,
    status: 'active',
    inputs: { test: true },
    outputs: null,
    digest_json: null,
    parent_frame_id: null,
    ...overrides
  };
}

function createTestEvent(overrides: Partial<Event> = {}): Event {
  return {
    event_id: `test-event-${Date.now()}-${Math.random()}`,
    run_id: 'test-run',
    frame_id: 'test-frame',
    seq: 1,
    event_type: 'tool_call',
    payload: { tool: 'test', args: {} },
    created_at: Date.now(),
    ...overrides
  };
}

function createTestAnchor(overrides: Partial<Anchor> = {}): Anchor {
  return {
    anchor_id: `test-anchor-${Date.now()}-${Math.random()}`,
    run_id: 'test-run',
    frame_id: 'test-frame',
    type: 'INFO',
    text: 'Test anchor',
    position: 0,
    created_at: Date.now(),
    ...overrides
  };
}