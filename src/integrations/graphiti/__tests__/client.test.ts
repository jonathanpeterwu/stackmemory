import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GraphitiClient, GraphitiClientError } from '../client.js';

describe('GraphitiClient', () => {
  const originalFetch = global.fetch;
  let mockFetch: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockFetch = vi.fn();
    global.fetch = mockFetch;
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  function makeClient(overrides = {}) {
    return new GraphitiClient({
      endpoint: 'http://localhost:9999',
      timeoutMs: 5000,
      maxRetries: 2,
      projectNamespace: 'test-ns',
      ...overrides,
    });
  }

  function jsonResponse(data: unknown, status = 200) {
    return new Response(JSON.stringify(data), {
      status,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── upsertEpisode ──

  describe('upsertEpisode', () => {
    it('sends POST to /episodes with namespace', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'ep-1' }));
      const client = makeClient();

      const result = await client.upsertEpisode({
        type: 'session_start',
        content: { foo: 'bar' },
        timestamp: 1000,
      });

      expect(result).toEqual({ id: 'ep-1' });
      expect(mockFetch).toHaveBeenCalledOnce();
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:9999/episodes');
      expect(opts.method).toBe('POST');
      const body = JSON.parse(opts.body);
      expect(body.namespace).toBe('test-ns');
      expect(body.type).toBe('session_start');
    });
  });

  // ── upsertEntities ──

  describe('upsertEntities', () => {
    it('sends POST to /entities:batchUpsert', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ids: ['e1', 'e2'] }));
      const client = makeClient();

      const result = await client.upsertEntities([
        { type: 'File', name: 'index.ts' },
        { type: 'Person', name: 'Alice' },
      ]);

      expect(result).toEqual({ ids: ['e1', 'e2'] });
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:9999/entities:batchUpsert');
      const body = JSON.parse(opts.body);
      expect(body.entities).toHaveLength(2);
      expect(body.namespace).toBe('test-ns');
    });
  });

  // ── upsertRelations ──

  describe('upsertRelations', () => {
    it('sends POST to /relations:batchUpsert', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ ids: ['r1'] }));
      const client = makeClient();

      const result = await client.upsertRelations([
        { fromId: 'a', toId: 'b', type: 'USES', validFrom: 1000 },
      ]);

      expect(result).toEqual({ ids: ['r1'] });
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:9999/relations:batchUpsert');
      const body = JSON.parse(opts.body);
      expect(body.edges).toHaveLength(1);
      expect(body.namespace).toBe('test-ns');
    });
  });

  // ── queryTemporal ──

  describe('queryTemporal', () => {
    it('sends POST to /query/temporal', async () => {
      const ctx = { chunks: [{ text: 'hello' }], totalTokens: 5 };
      mockFetch.mockResolvedValueOnce(jsonResponse(ctx));
      const client = makeClient();

      const result = await client.queryTemporal({
        query: 'test query',
        maxHops: 3,
        k: 10,
      });

      expect(result).toEqual(ctx);
      const [url, opts] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:9999/query/temporal');
      const body = JSON.parse(opts.body);
      expect(body.query).toBe('test query');
      expect(body.namespace).toBe('test-ns');
    });
  });

  // ── getStatus ──

  describe('getStatus', () => {
    it('returns status on success', async () => {
      const status = { connected: true, backend: 'neo4j', nodes: 42 };
      mockFetch.mockResolvedValueOnce(jsonResponse(status));
      const client = makeClient();

      const result = await client.getStatus();

      expect(result).toEqual(status);
      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://localhost:9999/status?namespace=test-ns');
    });

    it('returns { connected: false } on network error', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      const client = makeClient({ maxRetries: 0 });

      const result = await client.getStatus();

      expect(result).toEqual({ connected: false });
    });

    it('returns { connected: false } on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Internal Server Error', { status: 500 })
      );
      const client = makeClient({ maxRetries: 0 });

      const result = await client.getStatus();

      expect(result).toEqual({ connected: false });
    });
  });

  // ── Retry logic ──

  describe('retry logic', () => {
    it('retries on network error and succeeds', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('ECONNREFUSED'))
        .mockResolvedValueOnce(jsonResponse({ id: 'ep-1' }));
      const client = makeClient({ maxRetries: 1 });

      const result = await client.upsertEpisode({
        type: 'test',
        content: 'x',
        timestamp: 1,
      });

      expect(result).toEqual({ id: 'ep-1' });
      expect(mockFetch).toHaveBeenCalledTimes(2);
    });

    it('respects maxRetries limit', async () => {
      mockFetch
        .mockRejectedValueOnce(new Error('fail1'))
        .mockRejectedValueOnce(new Error('fail2'))
        .mockRejectedValueOnce(new Error('fail3'));
      const client = makeClient({ maxRetries: 2 });

      await expect(
        client.upsertEpisode({ type: 'x', content: '', timestamp: 0 })
      ).rejects.toThrow(GraphitiClientError);

      // initial attempt + 2 retries = 3
      expect(mockFetch).toHaveBeenCalledTimes(3);
    });

    it('does not retry on HTTP error (GraphitiClientError)', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Not Found', { status: 404 })
      );
      const client = makeClient({ maxRetries: 2 });

      await expect(
        client.upsertEpisode({ type: 'x', content: '', timestamp: 0 })
      ).rejects.toThrow(GraphitiClientError);

      expect(mockFetch).toHaveBeenCalledOnce();
    });
  });

  // ── Timeout ──

  describe('timeout', () => {
    it('aborts after timeoutMs', async () => {
      const abortError = new DOMException(
        'The operation was aborted',
        'AbortError'
      );
      mockFetch.mockRejectedValueOnce(abortError);
      const client = makeClient({ timeoutMs: 50, maxRetries: 0 });

      await expect(
        client.upsertEpisode({ type: 'x', content: '', timestamp: 0 })
      ).rejects.toThrow('Request timeout');
    });
  });

  // ── Error handling ──

  describe('error handling', () => {
    it('throws GraphitiClientError with code and statusCode on HTTP error', async () => {
      mockFetch.mockResolvedValueOnce(
        new Response('Bad Request', { status: 400 })
      );
      const client = makeClient({ maxRetries: 0 });

      try {
        await client.upsertEpisode({ type: 'x', content: '', timestamp: 0 });
        expect.fail('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(GraphitiClientError);
        const e = err as GraphitiClientError;
        expect(e.code).toBe('HTTP_ERROR');
        expect(e.statusCode).toBe(400);
      }
    });

    it('throws GraphitiClientError with NETWORK_ERROR on exhausted retries', async () => {
      mockFetch.mockRejectedValueOnce(new Error('net fail'));
      const client = makeClient({ maxRetries: 0 });

      try {
        await client.upsertEpisode({ type: 'x', content: '', timestamp: 0 });
        expect.fail('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(GraphitiClientError);
        const e = err as GraphitiClientError;
        expect(e.code).toBe('NETWORK_ERROR');
      }
    });

    it('throws GraphitiClientError with TIMEOUT on abort', async () => {
      const abortError = new DOMException('aborted', 'AbortError');
      mockFetch.mockRejectedValueOnce(abortError);
      const client = makeClient({ maxRetries: 0 });

      try {
        await client.upsertEpisode({ type: 'x', content: '', timestamp: 0 });
        expect.fail('should throw');
      } catch (err) {
        expect(err).toBeInstanceOf(GraphitiClientError);
        const e = err as GraphitiClientError;
        expect(e.code).toBe('TIMEOUT');
      }
    });
  });

  // ── Endpoint normalization ──

  describe('endpoint normalization', () => {
    it('strips trailing slash from endpoint', async () => {
      mockFetch.mockResolvedValueOnce(jsonResponse({ id: 'x' }));
      const client = makeClient({ endpoint: 'http://example.com/' });

      await client.upsertEpisode({ type: 'x', content: '', timestamp: 0 });

      const [url] = mockFetch.mock.calls[0];
      expect(url).toBe('http://example.com/episodes');
    });
  });
});
