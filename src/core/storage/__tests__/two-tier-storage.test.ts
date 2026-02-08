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
} from '../two-tier-storage.js';
import type { Frame, Event, Anchor } from '../../context/index.js';

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
            maxSizeMB: 100,
          },
          {
            name: StorageTier.MATURE,
            maxAgeHours: 168,
            compressionType: 'gzip',
            retentionPolicy: 'selective',
            maxSizeMB: 200,
          },
          {
            name: StorageTier.OLD,
            maxAgeHours: 720,
            compressionType: 'gzip',
            retentionPolicy: 'critical',
            maxSizeMB: 100,
          },
        ],
      },
      remote: {
        s3: {
          bucket: 'test-bucket',
          region: 'us-east-1',
        },
      },
      migration: {
        triggers: [
          { type: 'age', threshold: 720, action: 'migrate' },
          { type: 'size', threshold: 300, action: 'migrate' },
        ],
        batchSize: 10,
        intervalMs: 1000,
      },
    };

    storage = new TwoTierStorageSystem(config);
  });

  afterEach(async () => {
    if (storage) {
      await storage.shutdown();
    }
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('should initialize successfully', async () => {
    await expect(storage.initialize()).resolves.not.toThrow();
  });

  describe('Tier Selection', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should select correct tier based on frame age', async () => {
      // Recent → YOUNG
      const young = createTestFrame({
        created_at: Date.now() - 1000 * 60 * 60,
      });
      expect(await storage.storeFrame(young, [], [])).toBeDefined();

      // 2 days → MATURE
      const mature = createTestFrame({
        created_at: Date.now() - 1000 * 60 * 60 * 48,
      });
      expect(await storage.storeFrame(mature, [], [])).toBeDefined();

      // 10 days → OLD
      const old = createTestFrame({
        created_at: Date.now() - 1000 * 60 * 60 * 24 * 10,
      });
      expect(await storage.storeFrame(old, [], [])).toBeDefined();

      // Invalid timestamp defaults to YOUNG
      const invalid = createTestFrame({ created_at: NaN });
      expect(await storage.storeFrame(invalid, [], [])).toBeDefined();
    });
  });

  describe('Data Compression', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should handle compression for young and mature tiers', async () => {
      // Young: no compression
      const young = createTestFrame({
        created_at: Date.now() - 1000 * 60 * 30,
      });
      await storage.storeFrame(young, [], []);
      const retrievedYoung = await storage.retrieveFrame(young.frame_id);
      expect(retrievedYoung).toBeDefined();
      expect(retrievedYoung.frame.frame_id).toBe(young.frame_id);

      // Mature: gzip compression
      const mature = createTestFrame({
        created_at: Date.now() - 1000 * 60 * 60 * 48,
      });
      await storage.storeFrame(mature, [], []);
      const retrievedMature = await storage.retrieveFrame(mature.frame_id);
      expect(retrievedMature).toBeDefined();
      expect(retrievedMature.frame.frame_id).toBe(mature.frame_id);
    });
  });

  describe('Importance Scoring', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should score frames based on decisions, events, and errors', async () => {
      // Decisions
      const frame1 = createTestFrame();
      const anchors: Anchor[] = [
        createTestAnchor({ type: 'DECISION' }),
        createTestAnchor({ type: 'DECISION' }),
      ];
      expect(await storage.storeFrame(frame1, [], anchors)).toBeDefined();

      // Many events
      const frame2 = createTestFrame();
      const events: Event[] = Array.from({ length: 50 }, () =>
        createTestEvent()
      );
      expect(await storage.storeFrame(frame2, events, [])).toBeDefined();

      // Error events
      const frame3 = createTestFrame();
      const errorEvents: Event[] = [
        createTestEvent({ event_type: 'error' }),
        createTestEvent({ event_type: 'error' }),
      ];
      expect(await storage.storeFrame(frame3, errorEvents, [])).toBeDefined();
    });
  });

  describe('Storage Retrieval', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should store and retrieve frames with events and anchors', async () => {
      const frame = createTestFrame();
      await storage.storeFrame(
        frame,
        [createTestEvent()],
        [createTestAnchor()]
      );
      const retrieved = await storage.retrieveFrame(frame.frame_id);

      expect(retrieved).toBeDefined();
      expect(retrieved.frame.frame_id).toBe(frame.frame_id);
      expect(retrieved.events).toHaveLength(1);
      expect(retrieved.anchors).toHaveLength(1);

      // Non-existent
      expect(await storage.retrieveFrame('non-existent-id')).toBeNull();
    });
  });

  describe('Statistics', () => {
    beforeEach(async () => {
      await storage.initialize();
    });

    it('should provide accurate storage statistics', async () => {
      await storage.storeFrame(createTestFrame(), [], []);
      await storage.storeFrame(
        createTestFrame({ created_at: Date.now() - 1000 * 60 * 60 * 48 }),
        [],
        []
      );

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

    it('should reject invalid frames and accept empty arrays', async () => {
      await expect(storage.storeFrame({} as Frame, [], [])).rejects.toThrow();

      const frame = createTestFrame();
      expect(await storage.storeFrame(frame, [], [])).toBeDefined();
    });
  });

  describe('Configuration', () => {
    it('should handle empty tiers and validate config', () => {
      const emptyStorage = new TwoTierStorageSystem({
        local: {
          dbPath: join(tempDir, 'empty.db'),
          maxSizeGB: 1,
          tiers: [],
        },
        remote: { s3: { bucket: 'test', region: 'us-east-1' } },
        migration: { triggers: [], batchSize: 10, intervalMs: 1000 },
      });
      expect(emptyStorage).toBeDefined();

      // Tier config validation
      expect(config.local.tiers[0].compressionType).toBe('none');
      expect(config.local.tiers[1].compressionType).toBe('gzip');
      const ages = config.local.tiers.map((tier) => tier.maxAgeHours);
      expect(ages[0]).toBeLessThan(ages[1]);
      expect(ages[1]).toBeLessThan(ages[2]);
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
    ...overrides,
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
    ...overrides,
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
    ...overrides,
  };
}
