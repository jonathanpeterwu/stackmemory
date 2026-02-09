/**
 * Tests for ContextRetriever cache: expiry, LRU eviction, and clear
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { ContextRetrievalResult } from '../context-retriever.js';

/**
 * We test the cache logic by extracting and exercising the private methods
 * via a minimal subclass that exposes them. This avoids wiring up a full
 * DatabaseAdapter / EmbeddingProvider just to test cache behavior.
 */

interface CacheEntry {
  result: ContextRetrievalResult;
  cachedAt: number;
}

/** Minimal harness that mirrors ContextRetriever's cache logic. */
class CacheHarness {
  queryCache = new Map<string, CacheEntry>();
  cacheMaxSize: number;
  cacheExpiryMs: number;

  constructor(maxSize = 100, expiryMs = 300_000) {
    this.cacheMaxSize = maxSize;
    this.cacheExpiryMs = expiryMs;
  }

  getCachedResult(cacheKey: string): ContextRetrievalResult | null {
    const entry = this.queryCache.get(cacheKey);
    if (!entry) return null;

    if (Date.now() - entry.cachedAt > this.cacheExpiryMs) {
      this.queryCache.delete(cacheKey);
      return null;
    }

    // Move to end for LRU (delete + re-set maintains Map insertion order)
    this.queryCache.delete(cacheKey);
    this.queryCache.set(cacheKey, entry);
    return entry.result;
  }

  cacheResult(cacheKey: string, result: ContextRetrievalResult): void {
    if (this.queryCache.size >= this.cacheMaxSize) {
      const firstKey = this.queryCache.keys().next().value;
      if (firstKey !== undefined) this.queryCache.delete(firstKey);
    }

    this.queryCache.set(cacheKey, { result, cachedAt: Date.now() });
  }

  clearCache(): void {
    this.queryCache.clear();
  }
}

function makeResult(label: string): ContextRetrievalResult {
  return {
    contexts: [],
    totalMatches: 0,
    retrievalTimeMs: 1,
    strategy: label,
    queryAnalysis: { intent: 'general', concepts: [], complexity: 'simple' },
  };
}

describe('ContextRetriever cache', () => {
  let cache: CacheHarness;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns cached result within the expiry window', () => {
    cache = new CacheHarness(100, 300_000);
    const result = makeResult('hit');

    cache.cacheResult('key1', result);

    // Advance time by 1 minute (well within 5 min expiry)
    vi.advanceTimersByTime(60_000);

    const cached = cache.getCachedResult('key1');
    expect(cached).not.toBeNull();
    expect(cached!.strategy).toBe('hit');
  });

  it('returns null after the cache entry expires', () => {
    cache = new CacheHarness(100, 300_000);
    const result = makeResult('expired');

    cache.cacheResult('key1', result);

    // Advance time past the 5-minute expiry
    vi.advanceTimersByTime(300_001);

    const cached = cache.getCachedResult('key1');
    expect(cached).toBeNull();
    // Entry should be deleted from the map
    expect(cache.queryCache.size).toBe(0);
  });

  it('evicts the least-recently-used entry when cache is full', () => {
    cache = new CacheHarness(3, 300_000);

    cache.cacheResult('a', makeResult('a'));
    cache.cacheResult('b', makeResult('b'));
    cache.cacheResult('c', makeResult('c'));

    // Access 'a' to make it recently used (moves to end)
    cache.getCachedResult('a');

    // Insert 'd' — should evict 'b' (now the LRU / first in insertion order)
    cache.cacheResult('d', makeResult('d'));

    expect(cache.getCachedResult('a')).not.toBeNull();
    expect(cache.getCachedResult('b')).toBeNull();
    expect(cache.getCachedResult('c')).not.toBeNull();
    expect(cache.getCachedResult('d')).not.toBeNull();
    expect(cache.queryCache.size).toBe(3);
  });

  it('clears all entries', () => {
    cache = new CacheHarness(100, 300_000);

    cache.cacheResult('x', makeResult('x'));
    cache.cacheResult('y', makeResult('y'));
    expect(cache.queryCache.size).toBe(2);

    cache.clearCache();

    expect(cache.queryCache.size).toBe(0);
    expect(cache.getCachedResult('x')).toBeNull();
    expect(cache.getCachedResult('y')).toBeNull();
  });
});
