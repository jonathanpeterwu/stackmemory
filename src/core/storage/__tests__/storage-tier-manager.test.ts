/**
 * Tests for StorageTierManager
 * Cold-tier frame archival to S3/GCS with rehydration cache
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  StorageTierManager,
  InMemoryColdStorageProvider,
  type StorageTierConfig,
} from '../storage-tier-manager.js';
import type { Frame } from '../../context/index.js';

function createTestFrame(overrides: Partial<Frame> = {}): Frame {
  return {
    frame_id: `frame-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    run_id: 'test-run',
    project_id: 'test-project',
    depth: 0,
    type: 'task',
    name: 'Test Frame',
    state: 'active',
    inputs: { test: true },
    outputs: {},
    digest_json: {},
    created_at: Date.now(),
    ...overrides,
  };
}

describe('StorageTierManager', () => {
  let manager: StorageTierManager;
  let provider: InMemoryColdStorageProvider;
  let config: StorageTierConfig;

  beforeEach(() => {
    config = {
      coldTierProvider: 's3',
      coldTierBucket: 'test-bucket',
      coldTierPrefix: 'stackmemory/frames/',
      migrationAgeDays: 60,
      rehydrateCacheMinutes: 30,
    };
    provider = new InMemoryColdStorageProvider();
    manager = new StorageTierManager(config);
    manager.initializeWithProvider(provider);
  });

  describe('isEnabled', () => {
    it('should return true when provider is set', () => {
      expect(manager.isEnabled).toBe(true);
    });

    it('should return false when provider is none', () => {
      const disabledManager = new StorageTierManager({
        coldTierProvider: 'none',
      });
      expect(disabledManager.isEnabled).toBe(false);
    });

    it('should return false when provider is undefined', async () => {
      const noProviderManager = new StorageTierManager({});
      await noProviderManager.initialize();
      expect(noProviderManager.isEnabled).toBe(false);
    });
  });

  describe('archiveFrame', () => {
    it('should archive a frame and store it in the provider', async () => {
      const frame = createTestFrame();
      const result = await manager.archiveFrame(frame);

      expect(result).toBe(true);
      expect(provider.size).toBe(1);

      const key = `stackmemory/frames/${frame.frame_id}.json`;
      const exists = await provider.exists(key);
      expect(exists).toBe(true);
    });

    it('should return false when provider is not set', async () => {
      const disabledManager = new StorageTierManager({
        coldTierProvider: 'none',
      });
      const frame = createTestFrame();
      const result = await disabledManager.archiveFrame(frame);
      expect(result).toBe(false);
    });

    it('should store frame data as JSON', async () => {
      const frame = createTestFrame({ name: 'Archive Test' });
      await manager.archiveFrame(frame);

      const key = `stackmemory/frames/${frame.frame_id}.json`;
      const data = await provider.download(key);
      expect(data).not.toBeNull();

      const parsed = JSON.parse(data!.toString()) as Frame;
      expect(parsed.name).toBe('Archive Test');
      expect(parsed.frame_id).toBe(frame.frame_id);
    });
  });

  describe('archiveFrames (batch)', () => {
    it('should archive multiple frames and return count', async () => {
      const frames = [
        createTestFrame({ name: 'Frame 1' }),
        createTestFrame({ name: 'Frame 2' }),
        createTestFrame({ name: 'Frame 3' }),
      ];

      const count = await manager.archiveFrames(frames);
      expect(count).toBe(3);
      expect(provider.size).toBe(3);
    });

    it('should return 0 when provider is disabled', async () => {
      const disabledManager = new StorageTierManager({
        coldTierProvider: 'none',
      });
      const frames = [createTestFrame(), createTestFrame()];
      const count = await disabledManager.archiveFrames(frames);
      expect(count).toBe(0);
    });

    it('should handle empty array', async () => {
      const count = await manager.archiveFrames([]);
      expect(count).toBe(0);
    });
  });

  describe('rehydrateFrame', () => {
    it('should rehydrate an archived frame', async () => {
      const frame = createTestFrame({ name: 'Rehydrate Me' });
      await manager.archiveFrame(frame);

      const rehydrated = await manager.rehydrateFrame(frame.frame_id);
      expect(rehydrated).not.toBeNull();
      expect(rehydrated!.frame_id).toBe(frame.frame_id);
      expect(rehydrated!.name).toBe('Rehydrate Me');
    });

    it('should return null for non-existent frame', async () => {
      const result = await manager.rehydrateFrame('non-existent-id');
      expect(result).toBeNull();
    });

    it('should return null when provider is disabled', async () => {
      const disabledManager = new StorageTierManager({
        coldTierProvider: 'none',
      });
      const result = await disabledManager.rehydrateFrame('any-id');
      expect(result).toBeNull();
    });
  });

  describe('rehydration cache', () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it('should return cached frame within cache window', async () => {
      const frame = createTestFrame({ name: 'Cached Frame' });
      await manager.archiveFrame(frame);

      // First rehydration fetches from provider
      const first = await manager.rehydrateFrame(frame.frame_id);
      expect(first).not.toBeNull();

      // Remove from provider to prove cache is used
      const key = `stackmemory/frames/${frame.frame_id}.json`;
      await provider.delete(key);

      // Advance time by 10 minutes (within 30 min cache window)
      vi.advanceTimersByTime(10 * 60 * 1000);

      // Should still get cached result
      const second = await manager.rehydrateFrame(frame.frame_id);
      expect(second).not.toBeNull();
      expect(second!.name).toBe('Cached Frame');
    });

    it('should expire cache after configured time', async () => {
      const frame = createTestFrame({ name: 'Expiring Cache' });
      await manager.archiveFrame(frame);

      // First rehydration
      await manager.rehydrateFrame(frame.frame_id);

      // Remove from provider
      const key = `stackmemory/frames/${frame.frame_id}.json`;
      await provider.delete(key);

      // Advance time past cache window (31 minutes > 30 minute default)
      vi.advanceTimersByTime(31 * 60 * 1000);

      // Cache expired, provider has no data => null
      const result = await manager.rehydrateFrame(frame.frame_id);
      expect(result).toBeNull();
    });

    it('should respect custom cache duration', async () => {
      const shortCacheManager = new StorageTierManager({
        ...config,
        rehydrateCacheMinutes: 5,
      });
      shortCacheManager.initializeWithProvider(provider);

      const frame = createTestFrame();
      await shortCacheManager.archiveFrame(frame);
      await shortCacheManager.rehydrateFrame(frame.frame_id);

      // Remove from provider
      const key = `stackmemory/frames/${frame.frame_id}.json`;
      await provider.delete(key);

      // 4 minutes: still cached
      vi.advanceTimersByTime(4 * 60 * 1000);
      const cached = await shortCacheManager.rehydrateFrame(frame.frame_id);
      expect(cached).not.toBeNull();

      // 2 more minutes (6 total > 5 min cache): expired
      vi.advanceTimersByTime(2 * 60 * 1000);
      const expired = await shortCacheManager.rehydrateFrame(frame.frame_id);
      expect(expired).toBeNull();
    });

    it('should be clearable via clearCache', async () => {
      const frame = createTestFrame();
      await manager.archiveFrame(frame);
      await manager.rehydrateFrame(frame.frame_id);

      // Remove from provider
      const key = `stackmemory/frames/${frame.frame_id}.json`;
      await provider.delete(key);

      // Clear cache manually
      manager.clearCache();

      // Cache cleared, provider empty => null
      const result = await manager.rehydrateFrame(frame.frame_id);
      expect(result).toBeNull();
    });
  });

  describe('getStats', () => {
    it('should return correct stats with archived frames', async () => {
      await manager.archiveFrame(createTestFrame());
      await manager.archiveFrame(createTestFrame());
      await manager.archiveFrame(createTestFrame());

      const stats = await manager.getStats();
      expect(stats.provider).toBe('s3');
      expect(stats.archivedFrames).toBe(3);
      expect(stats.bucket).toBe('test-bucket');
    });

    it('should return zero stats when no frames archived', async () => {
      const stats = await manager.getStats();
      expect(stats.provider).toBe('s3');
      expect(stats.archivedFrames).toBe(0);
      expect(stats.bucket).toBe('test-bucket');
    });

    it('should return none stats when provider is disabled', async () => {
      const disabledManager = new StorageTierManager({
        coldTierProvider: 'none',
      });
      const stats = await disabledManager.getStats();
      expect(stats.provider).toBe('none');
      expect(stats.archivedFrames).toBe(0);
      expect(stats.bucket).toBe('');
    });
  });

  describe('deleteArchived', () => {
    it('should delete an archived frame', async () => {
      const frame = createTestFrame();
      await manager.archiveFrame(frame);

      const deleted = await manager.deleteArchived(frame.frame_id);
      expect(deleted).toBe(true);
      expect(provider.size).toBe(0);
    });

    it('should return false for non-existent frame', async () => {
      const deleted = await manager.deleteArchived('non-existent');
      expect(deleted).toBe(false);
    });

    it('should clear rehydration cache on delete', async () => {
      vi.useFakeTimers();
      try {
        const frame = createTestFrame();
        await manager.archiveFrame(frame);
        await manager.rehydrateFrame(frame.frame_id);

        // Delete the archived frame (also clears cache entry)
        await manager.deleteArchived(frame.frame_id);

        // Even though cache would still be valid, delete cleared it
        const result = await manager.rehydrateFrame(frame.frame_id);
        expect(result).toBeNull();
      } finally {
        vi.useRealTimers();
      }
    });
  });

  describe('S3 provider creation', () => {
    it('should create S3 provider via initialize without crashing', async () => {
      // S3 provider is created via dynamic import; it won't fail at creation
      // time even without credentials - only on actual operations
      const s3Manager = new StorageTierManager({
        coldTierProvider: 's3',
        coldTierBucket: 'test-bucket',
      });

      // initialize() should succeed (dynamic import of @aws-sdk/client-s3)
      await s3Manager.initialize();
      expect(s3Manager.isEnabled).toBe(true);
    });
  });

  describe('custom prefix', () => {
    it('should use custom prefix for frame keys', async () => {
      const customManager = new StorageTierManager({
        ...config,
        coldTierPrefix: 'custom/prefix/',
      });
      customManager.initializeWithProvider(provider);

      const frame = createTestFrame();
      await customManager.archiveFrame(frame);

      const key = `custom/prefix/${frame.frame_id}.json`;
      const exists = await provider.exists(key);
      expect(exists).toBe(true);
    });

    it('should use default prefix when not configured', async () => {
      const defaultPrefixManager = new StorageTierManager({
        coldTierProvider: 's3',
        coldTierBucket: 'bucket',
      });
      defaultPrefixManager.initializeWithProvider(provider);

      const frame = createTestFrame();
      await defaultPrefixManager.archiveFrame(frame);

      const key = `stackmemory/frames/${frame.frame_id}.json`;
      const exists = await provider.exists(key);
      expect(exists).toBe(true);
    });
  });

  describe('InMemoryColdStorageProvider', () => {
    it('should implement all ColdStorageProvider methods', async () => {
      const mem = new InMemoryColdStorageProvider();

      // upload + download
      await mem.upload('key1', Buffer.from('data1'));
      const downloaded = await mem.download('key1');
      expect(downloaded?.toString()).toBe('data1');

      // exists
      expect(await mem.exists('key1')).toBe(true);
      expect(await mem.exists('key2')).toBe(false);

      // list
      await mem.upload('prefix/a', Buffer.from('a'));
      await mem.upload('prefix/b', Buffer.from('b'));
      await mem.upload('other/c', Buffer.from('c'));
      const listed = await mem.list('prefix/');
      expect(listed).toHaveLength(2);
      expect(listed).toContain('prefix/a');
      expect(listed).toContain('prefix/b');

      // delete
      await mem.delete('key1');
      expect(await mem.exists('key1')).toBe(false);
      expect(await mem.download('key1')).toBeNull();

      // size + clear
      expect(mem.size).toBe(3);
      mem.clear();
      expect(mem.size).toBe(0);
    });
  });
});
