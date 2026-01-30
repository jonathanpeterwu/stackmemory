/**
 * Tests for ContextCache
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ContextCache } from '../context-cache.js';

describe('ContextCache', () => {
  let cache: ContextCache<string>;

  beforeEach(() => {
    cache = new ContextCache<string>({
      maxSize: 1024 * 1024, // 1MB
      maxItems: 100,
      defaultTTL: 60000, // 1 minute
    });
  });

  afterEach(() => {
    cache.clear();
  });

  describe('constructor', () => {
    it('should create cache with default options', () => {
      const defaultCache = new ContextCache();
      expect(defaultCache).toBeInstanceOf(ContextCache);
    });

    it('should create cache with custom options', () => {
      const customCache = new ContextCache({
        maxSize: 1000,
        maxItems: 10,
        defaultTTL: 5000,
      });
      expect(customCache).toBeInstanceOf(ContextCache);
    });
  });

  describe('set and get', () => {
    it('should store and retrieve value', () => {
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
    });

    it('should return undefined for non-existent key', () => {
      expect(cache.get('nonexistent')).toBeUndefined();
    });

    it('should update value on re-set', () => {
      cache.set('key', 'value1');
      cache.set('key', 'value2');
      expect(cache.get('key')).toBe('value2');
    });

    it('should respect TTL', async () => {
      cache.set('short-lived', 'value', { ttl: 10 });

      expect(cache.get('short-lived')).toBe('value');

      // Wait for TTL to expire
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(cache.get('short-lived')).toBeUndefined();
    });

    it('should track hits', () => {
      cache.set('popular', 'value');

      cache.get('popular');
      cache.get('popular');
      cache.get('popular');

      const stats = cache.getStats();
      expect(stats.hits).toBe(3);
    });

    it('should track misses', () => {
      cache.get('miss1');
      cache.get('miss2');

      const stats = cache.getStats();
      expect(stats.misses).toBe(2);
    });
  });

  describe('has', () => {
    it('should return true for existing key', () => {
      cache.set('exists', 'value');
      expect(cache.has('exists')).toBe(true);
    });

    it('should return false for non-existent key', () => {
      expect(cache.has('nonexistent')).toBe(false);
    });

    it('should return false for expired key', async () => {
      cache.set('expired', 'value', { ttl: 10 });

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(cache.has('expired')).toBe(false);
    });
  });

  describe('delete', () => {
    it('should remove key from cache', () => {
      cache.set('toDelete', 'value');
      expect(cache.delete('toDelete')).toBe(true);
      expect(cache.get('toDelete')).toBeUndefined();
    });

    it('should return false for non-existent key', () => {
      expect(cache.delete('nonexistent')).toBe(false);
    });
  });

  describe('clear', () => {
    it('should remove all entries', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.set('key3', 'value3');

      cache.clear();

      expect(cache.get('key1')).toBeUndefined();
      expect(cache.get('key2')).toBeUndefined();
      expect(cache.get('key3')).toBeUndefined();
    });

    it('should update stats', () => {
      cache.set('key', 'value');
      cache.clear();

      const stats = cache.getStats();
      expect(stats.itemCount).toBe(0);
      expect(stats.size).toBe(0);
    });
  });

  describe('getStats', () => {
    it('should return correct statistics', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');
      cache.get('key1');
      cache.get('nonexistent');

      const stats = cache.getStats();

      expect(stats.hits).toBe(1);
      expect(stats.misses).toBe(1);
      expect(stats.itemCount).toBe(2);
      expect(stats.hitRate).toBe(0.5);
    });

    it('should calculate hit rate correctly', () => {
      cache.set('key', 'value');

      // 3 hits
      cache.get('key');
      cache.get('key');
      cache.get('key');

      // 1 miss
      cache.get('nonexistent');

      const stats = cache.getStats();
      expect(stats.hitRate).toBe(0.75);
    });
  });

  describe('getSize', () => {
    it('should return size info', () => {
      cache.set('key', 'value');

      const size = cache.getSize();

      expect(size.items).toBe(1);
      expect(size.bytes).toBeGreaterThan(0);
      expect(size.utilization).toBeGreaterThan(0);
    });
  });

  describe('preload', () => {
    it('should preload multiple entries', () => {
      cache.preload([
        { key: 'key1', value: 'value1' },
        { key: 'key2', value: 'value2' },
        { key: 'key3', value: 'value3' },
      ]);

      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('key2')).toBe('value2');
      expect(cache.get('key3')).toBe('value3');
    });

    it('should respect custom TTL in preload', () => {
      cache.preload([{ key: 'short', value: 'value', ttl: 5000 }]);

      expect(cache.get('short')).toBe('value');
    });
  });

  describe('getMany', () => {
    it('should return multiple values', () => {
      cache.set('k1', 'v1');
      cache.set('k2', 'v2');
      cache.set('k3', 'v3');

      const results = cache.getMany(['k1', 'k2', 'missing']);

      expect(results.get('k1')).toBe('v1');
      expect(results.get('k2')).toBe('v2');
      expect(results.has('missing')).toBe(false);
    });
  });

  describe('warmUp', () => {
    it('should warm up cache with computed values', async () => {
      const compute = vi.fn(async (key: string) => `computed-${key}`);

      await cache.warmUp(['a', 'b', 'c'], compute);

      expect(cache.get('a')).toBe('computed-a');
      expect(cache.get('b')).toBe('computed-b');
      expect(cache.get('c')).toBe('computed-c');
      expect(compute).toHaveBeenCalledTimes(3);
    });

    it('should not recompute existing keys', async () => {
      cache.set('existing', 'preset');
      const compute = vi.fn(async (key: string) => `computed-${key}`);

      await cache.warmUp(['existing', 'new'], compute);

      expect(cache.get('existing')).toBe('preset');
      expect(cache.get('new')).toBe('computed-new');
      expect(compute).toHaveBeenCalledTimes(1);
    });

    it('should support sequential warmup', async () => {
      const compute = vi.fn(async (key: string) => `value-${key}`);

      await cache.warmUp(['a', 'b'], compute, { parallel: false });

      expect(cache.get('a')).toBe('value-a');
      expect(cache.get('b')).toBe('value-b');
    });
  });

  describe('getOrCompute', () => {
    it('should return cached value if exists', async () => {
      cache.set('cached', 'cached-value');
      const compute = vi.fn(async () => 'computed-value');

      const result = await cache.getOrCompute('cached', compute);

      expect(result).toBe('cached-value');
      expect(compute).not.toHaveBeenCalled();
    });

    it('should compute and cache value if not exists', async () => {
      const compute = vi.fn(async () => 'computed-value');

      const result = await cache.getOrCompute('new', compute);

      expect(result).toBe('computed-value');
      expect(compute).toHaveBeenCalled();
      expect(cache.get('new')).toBe('computed-value');
    });
  });

  describe('eviction', () => {
    it('should evict entries when max items exceeded', () => {
      const smallCache = new ContextCache<string>({
        maxItems: 3,
        maxSize: 1024 * 1024,
      });

      smallCache.set('k1', 'v1');
      smallCache.set('k2', 'v2');
      smallCache.set('k3', 'v3');
      smallCache.set('k4', 'v4');

      // k1 should have been evicted (LRU)
      expect(smallCache.get('k1')).toBeUndefined();
      expect(smallCache.get('k4')).toBe('v4');
    });

    it('should evict LRU entries', () => {
      const smallCache = new ContextCache<string>({
        maxItems: 3,
        maxSize: 1024 * 1024,
      });

      smallCache.set('k1', 'v1');
      smallCache.set('k2', 'v2');
      smallCache.set('k3', 'v3');

      // Access k1 to make it recently used
      smallCache.get('k1');

      // Add new entry, k2 should be evicted (least recently used)
      smallCache.set('k4', 'v4');

      expect(smallCache.get('k1')).toBe('v1');
      expect(smallCache.get('k2')).toBeUndefined();
    });

    it('should emit evict events', () => {
      const smallCache = new ContextCache<string>({
        maxItems: 2,
        maxSize: 1024 * 1024,
      });

      const handler = vi.fn();
      smallCache.on('evict', handler);

      smallCache.set('k1', 'v1');
      smallCache.set('k2', 'v2');
      smallCache.set('k3', 'v3');

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('events', () => {
    it('should emit set event', () => {
      const handler = vi.fn();
      cache.on('set', handler);

      cache.set('key', 'value');

      expect(handler).toHaveBeenCalledWith('key', 'value');
    });

    it('should emit delete event', () => {
      const handler = vi.fn();
      cache.set('key', 'value');
      cache.on('delete', handler);

      cache.delete('key');

      expect(handler).toHaveBeenCalledWith('key');
    });

    it('should emit clear event', () => {
      const handler = vi.fn();
      cache.set('key', 'value');
      cache.on('clear', handler);

      cache.clear();

      expect(handler).toHaveBeenCalled();
    });
  });

  describe('startCleanup', () => {
    it('should return interval handle', () => {
      const interval = cache.startCleanup(100);

      expect(interval).toBeDefined();

      clearInterval(interval);
    });

    it('should clean expired entries', async () => {
      const cleanupCache = new ContextCache<string>({
        defaultTTL: 10,
      });

      cleanupCache.set('expires', 'value');

      const interval = cleanupCache.startCleanup(50);

      // Wait for TTL and cleanup
      await new Promise((resolve) => setTimeout(resolve, 100));

      expect(cleanupCache.get('expires')).toBeUndefined();

      clearInterval(interval);
    });
  });
});
