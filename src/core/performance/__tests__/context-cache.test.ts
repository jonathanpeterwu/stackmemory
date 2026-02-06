/**
 * Tests for ContextCache - Consolidated
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ContextCache } from '../context-cache.js';

describe('ContextCache', () => {
  let cache: ContextCache<string>;

  beforeEach(() => {
    cache = new ContextCache<string>({
      maxSize: 1024 * 1024,
      maxItems: 100,
      defaultTTL: 60000,
    });
  });

  afterEach(() => {
    cache.clear();
  });

  describe('basic operations', () => {
    it('should handle CRUD, TTL, and stats tracking', async () => {
      // Store, retrieve, update
      cache.set('key1', 'value1');
      expect(cache.get('key1')).toBe('value1');
      expect(cache.get('nonexistent')).toBeUndefined();
      cache.set('key1', 'value2');
      expect(cache.get('key1')).toBe('value2');

      // TTL expiration
      cache.set('short-lived', 'value', { ttl: 10 });
      expect(cache.get('short-lived')).toBe('value');
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(cache.get('short-lived')).toBeUndefined();

      // Track hits and misses
      cache.set('key', 'value');
      cache.get('key');
      cache.get('key');
      cache.get('miss');
      const stats = cache.getStats();
      expect(stats.hits).toBeGreaterThanOrEqual(2);
      expect(stats.misses).toBeGreaterThanOrEqual(1);
    });
  });

  describe('has and delete', () => {
    it('should check existence and delete entries', () => {
      cache.set('exists', 'value');
      expect(cache.has('exists')).toBe(true);
      expect(cache.has('nonexistent')).toBe(false);

      cache.delete('exists');
      expect(cache.has('exists')).toBe(false);
    });
  });

  describe('LRU eviction', () => {
    it('should evict least recently used when at capacity', () => {
      const smallCache = new ContextCache<string>({ maxItems: 3 });

      smallCache.set('a', 'value-a');
      smallCache.set('b', 'value-b');
      smallCache.set('c', 'value-c');

      smallCache.get('a'); // Access 'a' to make it recently used
      smallCache.set('d', 'value-d'); // Should evict 'b'

      expect(smallCache.has('a')).toBe(true);
      expect(smallCache.has('b')).toBe(false);
      expect(smallCache.has('d')).toBe(true);
    });
  });

  describe('clear and stats', () => {
    it('should clear all entries and reset stats', () => {
      cache.set('key1', 'value1');
      cache.set('key2', 'value2');

      cache.clear();

      expect(cache.get('key1')).toBeUndefined();
      expect(cache.getStats().itemCount).toBe(0);
    });
  });
});
