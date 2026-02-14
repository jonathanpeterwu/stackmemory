import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { GraphitiHooks } from '../graphiti-hooks.js';
import { HookEventEmitter } from '../events.js';
import type { HookEvent, FileChangeEvent } from '../events.js';

// Mock logger to suppress output
vi.mock('../../core/monitoring/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('GraphitiHooks', () => {
  let emitter: HookEventEmitter;

  beforeEach(() => {
    emitter = new HookEventEmitter();
  });

  afterEach(() => {
    emitter.removeAllListeners();
    vi.restoreAllMocks();
  });

  function makeHooks(overrides = {}) {
    return new GraphitiHooks({
      enabled: true,
      endpoint: 'http://localhost:9999',
      maxRetries: 0,
      timeoutMs: 1000,
      projectNamespace: 'test-ns',
      ...overrides,
    });
  }

  function mockClient(hooks: GraphitiHooks) {
    const client = {
      getStatus: vi.fn(),
      upsertEpisode: vi.fn(),
      upsertEntities: vi.fn(),
      upsertRelations: vi.fn(),
      queryTemporal: vi.fn(),
    };
    (hooks as any).client = client;
    return client;
  }

  // ── register ──

  describe('register', () => {
    it('registers handlers for session_start, file_change, session_end', () => {
      const hooks = makeHooks();
      hooks.register(emitter);

      const events = emitter.getRegisteredEvents();
      expect(events).toContain('session_start');
      expect(events).toContain('file_change');
      expect(events).toContain('session_end');
    });

    it('skips registration when enabled=false', () => {
      const hooks = makeHooks({ enabled: false });
      hooks.register(emitter);

      const events = emitter.getRegisteredEvents();
      expect(events).toHaveLength(0);
    });
  });

  // ── onSessionStart ──

  describe('onSessionStart', () => {
    it('checks status and upserts episode when connected', async () => {
      const hooks = makeHooks();
      const client = mockClient(hooks);
      client.getStatus.mockResolvedValue({ connected: true });
      client.upsertEpisode.mockResolvedValue({ id: 'ep-1' });
      hooks.register(emitter);

      const event: HookEvent = {
        type: 'session_start',
        timestamp: Date.now(),
        data: { sessionId: 'sess-1' },
      };
      await emitter.emitHook(event);

      expect(client.getStatus).toHaveBeenCalledOnce();
      expect(client.upsertEpisode).toHaveBeenCalledOnce();
      const episode = client.upsertEpisode.mock.calls[0][0];
      expect(episode.type).toBe('session_start');
      expect(episode.source).toBe('stackmemory');
    });

    it('skips upsert when Graphiti is disconnected', async () => {
      const hooks = makeHooks();
      const client = mockClient(hooks);
      client.getStatus.mockResolvedValue({ connected: false });
      hooks.register(emitter);

      await emitter.emitHook({
        type: 'session_start',
        timestamp: Date.now(),
        data: {},
      });

      expect(client.getStatus).toHaveBeenCalledOnce();
      expect(client.upsertEpisode).not.toHaveBeenCalled();
    });
  });

  // ── onFileChange ──

  describe('onFileChange', () => {
    it('maps FileChangeEvent to Episode correctly', async () => {
      const hooks = makeHooks();
      const client = mockClient(hooks);
      client.upsertEpisode.mockResolvedValue({ id: 'ep-2' });
      hooks.register(emitter);

      const event: FileChangeEvent = {
        type: 'file_change',
        timestamp: Date.now(),
        data: {
          path: '/src/index.ts',
          changeType: 'modify',
          content: 'hello world',
        },
      };
      await emitter.emitHook(event);

      expect(client.upsertEpisode).toHaveBeenCalledOnce();
      const episode = client.upsertEpisode.mock.calls[0][0];
      expect(episode.type).toBe('file_change');
      expect(episode.content).toEqual({
        path: '/src/index.ts',
        changeType: 'modify',
        size: 11,
      });
    });

    it('handles missing content gracefully', async () => {
      const hooks = makeHooks();
      const client = mockClient(hooks);
      client.upsertEpisode.mockResolvedValue({ id: 'ep-3' });
      hooks.register(emitter);

      const event: FileChangeEvent = {
        type: 'file_change',
        timestamp: Date.now(),
        data: {
          path: '/src/deleted.ts',
          changeType: 'delete',
        },
      };
      await emitter.emitHook(event);

      const episode = client.upsertEpisode.mock.calls[0][0];
      expect(episode.content.size).toBeUndefined();
    });
  });

  // ── onSessionEnd ──

  describe('onSessionEnd', () => {
    it('upserts session_end episode', async () => {
      const hooks = makeHooks();
      const client = mockClient(hooks);
      client.upsertEpisode.mockResolvedValue({ id: 'ep-4' });
      hooks.register(emitter);

      await emitter.emitHook({
        type: 'session_end',
        timestamp: Date.now(),
        data: { reason: 'user_quit' },
      });

      expect(client.upsertEpisode).toHaveBeenCalledOnce();
      const episode = client.upsertEpisode.mock.calls[0][0];
      expect(episode.type).toBe('session_end');
      expect(episode.source).toBe('stackmemory');
    });
  });

  // ── Error resilience ──

  describe('error resilience', () => {
    it('catches handler errors without propagating', async () => {
      const hooks = makeHooks();
      const client = mockClient(hooks);
      client.getStatus.mockRejectedValue(new Error('boom'));
      hooks.register(emitter);

      // Should not throw
      await emitter.emitHook({
        type: 'session_start',
        timestamp: Date.now(),
        data: {},
      });

      expect(client.getStatus).toHaveBeenCalledOnce();
    });

    it('catches file_change errors without propagating', async () => {
      const hooks = makeHooks();
      const client = mockClient(hooks);
      client.upsertEpisode.mockRejectedValue(new Error('write fail'));
      hooks.register(emitter);

      await emitter.emitHook({
        type: 'file_change',
        timestamp: Date.now(),
        data: { path: '/x.ts', changeType: 'create' },
      } as FileChangeEvent);

      expect(client.upsertEpisode).toHaveBeenCalledOnce();
    });
  });

  // ── buildTemporalContext ──

  describe('buildTemporalContext', () => {
    it('passes query with defaults to queryTemporal', async () => {
      const hooks = makeHooks();
      const client = mockClient(hooks);
      const ctx = { chunks: [{ text: 'result' }], totalTokens: 10 };
      client.queryTemporal.mockResolvedValue(ctx);

      const result = await hooks.buildTemporalContext({ query: 'find X' });

      expect(result).toEqual(ctx);
      expect(client.queryTemporal).toHaveBeenCalledOnce();
      const q = client.queryTemporal.mock.calls[0][0];
      expect(q.query).toBe('find X');
      expect(q.k).toBe(20);
      expect(q.rerank).toBe(true);
      expect(q.maxHops).toBe(2);
      expect(q.validFrom).toBeDefined();
      expect(q.validTo).toBeDefined();
    });

    it('uses defaults when no query provided', async () => {
      const hooks = makeHooks();
      const client = mockClient(hooks);
      client.queryTemporal.mockResolvedValue({ chunks: [], totalTokens: 0 });

      await hooks.buildTemporalContext();

      const q = client.queryTemporal.mock.calls[0][0];
      expect(q.query).toBeUndefined();
      expect(q.entityTypes).toBeUndefined();
      expect(q.k).toBe(20);
    });

    it('respects overridden maxHops from config', async () => {
      const hooks = makeHooks({ maxHops: 5 });
      const client = mockClient(hooks);
      client.queryTemporal.mockResolvedValue({ chunks: [], totalTokens: 0 });

      await hooks.buildTemporalContext();

      const q = client.queryTemporal.mock.calls[0][0];
      expect(q.maxHops).toBe(5);
    });
  });
});
