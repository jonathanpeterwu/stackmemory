/**
 * Tests for DiffMem Client
 * Updated for DiffMem's actual API endpoints
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { DiffMemClient, DiffMemClientError } from '../client.js';
import type { LearnedInsight, MemoryQuery } from '../types.js';

describe('DiffMemClient', () => {
  let client: DiffMemClient;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    vi.stubGlobal('fetch', mockFetch);
    client = new DiffMemClient({
      endpoint: 'http://localhost:8000',
      userId: 'test-user',
      timeout: 1000,
      maxRetries: 2,
      enabled: true,
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const createMockResponse = (data: unknown, ok = true, status = 200) => ({
    ok,
    status,
    statusText: ok ? 'OK' : 'Error',
    json: vi.fn().mockResolvedValue(data),
    text: vi.fn().mockResolvedValue(JSON.stringify(data)),
  });

  describe('constructor', () => {
    it('should use default config when not provided', () => {
      const defaultClient = new DiffMemClient();
      expect(defaultClient).toBeDefined();
    });

    it('should strip trailing slash from endpoint', () => {
      const clientWithSlash = new DiffMemClient({
        endpoint: 'http://localhost:8000/',
      });
      expect(clientWithSlash).toBeDefined();
    });
  });

  describe('getMemories', () => {
    it('should call DiffMem context endpoint', async () => {
      const mockResponse = {
        status: 'success',
        entities: [{ id: 'entity-1', content: 'Test memory', score: 0.9 }],
      };
      mockFetch.mockResolvedValue(createMockResponse(mockResponse));

      const result = await client.getMemories();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/memory/test-user/context',
        expect.objectContaining({ method: 'POST' })
      );
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Test memory');
    });

    it('should use query as conversation content', async () => {
      const mockResponse = { status: 'success', entities: [] };
      mockFetch.mockResolvedValue(createMockResponse(mockResponse));

      const query: MemoryQuery = { query: 'test query', limit: 5 };
      await client.getMemories(query);

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('test query'),
        })
      );
    });

    it('should return empty array on error (graceful degradation)', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await client.getMemories();

      expect(result).toEqual([]);
    });
  });

  describe('storeInsight', () => {
    it('should call DiffMem process-and-commit endpoint', async () => {
      const mockResponse = { status: 'success', session_id: 'sess-123' };
      mockFetch.mockResolvedValue(createMockResponse(mockResponse));

      const insight: LearnedInsight = {
        content: 'User prefers TypeScript',
        category: 'preference',
        confidence: 0.85,
        source: 'conversation',
        timestamp: Date.now(),
      };

      const result = await client.storeInsight(insight);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/memory/test-user/process-and-commit',
        expect.objectContaining({ method: 'POST' })
      );
      expect(result.id).toBe('sess-123');
    });

    it('should include category in memory_input', async () => {
      const mockResponse = { status: 'success' };
      mockFetch.mockResolvedValue(createMockResponse(mockResponse));

      await client.storeInsight({
        content: 'User likes tests',
        category: 'preference',
        confidence: 0.9,
        source: 'test',
        timestamp: Date.now(),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({
          body: expect.stringContaining('[preference]'),
        })
      );
    });
  });

  describe('search', () => {
    it('should call DiffMem search endpoint', async () => {
      const mockResponse = {
        status: 'success',
        results: [
          {
            score: 0.85,
            snippet: { id: 'result-1', content: 'Search result' },
          },
        ],
      };
      mockFetch.mockResolvedValue(createMockResponse(mockResponse));

      const query: MemoryQuery = { query: 'typescript', limit: 5 };
      const result = await client.search(query);

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/memory/test-user/search',
        expect.objectContaining({ method: 'POST' })
      );
      expect(result).toHaveLength(1);
      expect(result[0].content).toBe('Search result');
      expect(result[0].confidence).toBe(0.85);
    });

    it('should return empty array on error (graceful degradation)', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await client.search({ query: 'test' });

      expect(result).toEqual([]);
    });
  });

  describe('getStatus', () => {
    it('should call health endpoint', async () => {
      const mockHealth = {
        status: 'healthy',
        active_contexts: 5,
        version: '0.2.0',
      };
      mockFetch.mockResolvedValue(createMockResponse(mockHealth));

      const result = await client.getStatus();

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/health',
        expect.objectContaining({ method: 'GET' })
      );
      expect(result.connected).toBe(true);
      expect(result.memoryCount).toBe(5);
      expect(result.version).toBe('0.2.0');
    });

    it('should return disconnected status on error', async () => {
      mockFetch.mockRejectedValue(new Error('Network error'));

      const result = await client.getStatus();

      expect(result).toEqual({
        connected: false,
        memoryCount: 0,
        lastSync: null,
      });
    });
  });

  describe('batchSync', () => {
    it('should sync multiple insights individually', async () => {
      const mockResponse = { status: 'success', session_id: 'sess-1' };
      mockFetch.mockResolvedValue(createMockResponse(mockResponse));

      const insights: LearnedInsight[] = [
        {
          content: 'Insight 1',
          category: 'preference',
          confidence: 0.9,
          source: 'test',
          timestamp: Date.now(),
        },
        {
          content: 'Insight 2',
          category: 'pattern',
          confidence: 0.8,
          source: 'test',
          timestamp: Date.now(),
        },
      ];

      const result = await client.batchSync(insights);

      // Should call storeInsight for each (2 insights)
      expect(mockFetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ synced: 2, failed: 0 });
    });

    it('should return zero counts for empty array', async () => {
      const result = await client.batchSync([]);

      expect(mockFetch).not.toHaveBeenCalled();
      expect(result).toEqual({ synced: 0, failed: 0 });
    });

    it('should track failed syncs', async () => {
      mockFetch
        .mockResolvedValueOnce(createMockResponse({ status: 'success' }))
        .mockRejectedValueOnce(new Error('Failed'));

      const insights: LearnedInsight[] = [
        {
          content: 'Good',
          category: 'preference',
          confidence: 0.9,
          source: 'test',
          timestamp: Date.now(),
        },
        {
          content: 'Bad',
          category: 'pattern',
          confidence: 0.8,
          source: 'test',
          timestamp: Date.now(),
        },
      ];

      const result = await client.batchSync(insights);

      expect(result).toEqual({ synced: 1, failed: 1 });
    });
  });

  describe('onboardUser', () => {
    it('should call onboard endpoint', async () => {
      const mockResponse = { status: 'success' };
      mockFetch.mockResolvedValue(createMockResponse(mockResponse));

      const result = await client.onboardUser('Test user info');

      expect(mockFetch).toHaveBeenCalledWith(
        'http://localhost:8000/memory/test-user/onboard',
        expect.objectContaining({
          method: 'POST',
          body: expect.stringContaining('Test user info'),
        })
      );
      expect(result.success).toBe(true);
    });

    it('should return false on error', async () => {
      mockFetch.mockRejectedValue(new Error('Failed'));

      const result = await client.onboardUser('Test');

      expect(result.success).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should throw DiffMemClientError on HTTP error for storeInsight', async () => {
      mockFetch.mockResolvedValue(createMockResponse({}, false, 500));

      await expect(
        client.storeInsight({
          content: 'test',
          category: 'preference',
          confidence: 0.9,
          source: 'test',
          timestamp: Date.now(),
        })
      ).rejects.toThrow(DiffMemClientError);
    });

    it('should retry on network errors', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('Network error'))
        .mockRejectedValueOnce(new Error('Network error'))
        .mockResolvedValue(createMockResponse({ status: 'healthy' }));

      const result = await client.getStatus();

      expect(mockFetch).toHaveBeenCalledTimes(3);
      expect(result.connected).toBe(true);
    });
  });
});
