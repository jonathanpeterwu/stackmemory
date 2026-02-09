/**
 * Tests for EmbeddingProviderFactory
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Mock @xenova/transformers so the transformers provider resolves
const mockPipelineFn = vi.fn();
vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn(async () => mockPipelineFn),
}));

import { EmbeddingProviderFactory } from '../embedding-provider-factory.js';
import type { EmbeddingProviderConfig } from '../embedding-provider-factory.js';
import { OllamaEmbeddingProvider } from '../ollama-embedding-provider.js';
import { OpenAIEmbeddingProvider } from '../openai-embedding-provider.js';

describe('EmbeddingProviderFactory', () => {
  let originalEnv: string | undefined;

  beforeEach(() => {
    vi.clearAllMocks();
    mockPipelineFn.mockResolvedValue({
      data: new Float32Array(384).fill(0.1),
    });
    originalEnv = process.env['OPENAI_API_KEY'];
    delete process.env['OPENAI_API_KEY'];
  });

  afterEach(() => {
    if (originalEnv !== undefined) {
      process.env['OPENAI_API_KEY'] = originalEnv;
    } else {
      delete process.env['OPENAI_API_KEY'];
    }
    vi.restoreAllMocks();
  });

  describe('create()', () => {
    it('should create a transformers provider', async () => {
      const provider = await EmbeddingProviderFactory.create({
        provider: 'transformers',
      });

      expect(provider).not.toBeNull();
      expect(provider!.dimension).toBe(384);
    });

    it('should create a transformers provider with custom model and dimension', async () => {
      const provider = await EmbeddingProviderFactory.create({
        provider: 'transformers',
        model: 'Xenova/custom-model',
        dimension: 768,
      });

      expect(provider).not.toBeNull();
      expect(provider!.dimension).toBe(768);
    });

    it('should return null for none provider', async () => {
      const provider = await EmbeddingProviderFactory.create({
        provider: 'none',
      });

      expect(provider).toBeNull();
    });

    it('should return null for unknown provider type', async () => {
      const provider = await EmbeddingProviderFactory.create({
        provider: 'unknown' as any,
      });

      expect(provider).toBeNull();
    });
  });

  describe('fallback chain', () => {
    it('should try fallback when primary fails', async () => {
      // Mock transformers to fail on import
      vi.doMock('../transformers-embedding-provider.js', () => ({
        createTransformersProvider: vi.fn(async () => null),
      }));

      // Re-import to pick up the mock
      const { EmbeddingProviderFactory: FactoryWithMock } =
        await import('../embedding-provider-factory.js');

      // OpenAI as fallback with explicit API key
      const config: EmbeddingProviderConfig = {
        provider: 'transformers',
        apiKey: 'sk-test-key',
        fallbackProviders: ['openai'],
      };

      const provider = await FactoryWithMock.create(config);
      expect(provider).not.toBeNull();
      expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
      expect(provider!.dimension).toBe(1536);

      vi.doUnmock('../transformers-embedding-provider.js');
    });

    it('should return null when all fallbacks fail', async () => {
      // Ollama unreachable (fetch will fail), no OpenAI key, transformers returns null
      vi.doMock('../transformers-embedding-provider.js', () => ({
        createTransformersProvider: vi.fn(async () => null),
      }));

      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('Connection refused'));

      const { EmbeddingProviderFactory: FactoryWithMock } =
        await import('../embedding-provider-factory.js');

      const provider = await FactoryWithMock.create({
        provider: 'transformers',
        fallbackProviders: ['ollama', 'openai'],
      });

      expect(provider).toBeNull();

      fetchSpy.mockRestore();
      vi.doUnmock('../transformers-embedding-provider.js');
    });

    it('should stop at first successful fallback', async () => {
      vi.doMock('../transformers-embedding-provider.js', () => ({
        createTransformersProvider: vi.fn(async () => null),
      }));

      // Ollama reachable
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response(JSON.stringify({ models: [] }), { status: 200 })
        );

      const { EmbeddingProviderFactory: FactoryWithMock } =
        await import('../embedding-provider-factory.js');

      const provider = await FactoryWithMock.create({
        provider: 'transformers',
        fallbackProviders: ['ollama', 'openai'],
      });

      expect(provider).not.toBeNull();
      expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
      expect(provider!.dimension).toBe(768);

      fetchSpy.mockRestore();
      vi.doUnmock('../transformers-embedding-provider.js');
    });
  });

  describe('OpenAI provider', () => {
    it('should return null without API key', async () => {
      const provider = await EmbeddingProviderFactory.create({
        provider: 'openai',
      });

      expect(provider).toBeNull();
    });

    it('should create provider with explicit API key', async () => {
      const provider = await EmbeddingProviderFactory.create({
        provider: 'openai',
        apiKey: 'sk-test-key',
      });

      expect(provider).not.toBeNull();
      expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
      expect(provider!.dimension).toBe(1536);
    });

    it('should create provider with env API key', async () => {
      process.env['OPENAI_API_KEY'] = 'sk-env-key';

      const provider = await EmbeddingProviderFactory.create({
        provider: 'openai',
      });

      expect(provider).not.toBeNull();
      expect(provider).toBeInstanceOf(OpenAIEmbeddingProvider);
    });

    it('should use custom model and dimension', async () => {
      const provider = await EmbeddingProviderFactory.create({
        provider: 'openai',
        apiKey: 'sk-test-key',
        model: 'text-embedding-3-large',
        dimension: 3072,
      });

      expect(provider).not.toBeNull();
      expect(provider!.dimension).toBe(3072);
    });
  });

  describe('Ollama provider', () => {
    it('should return null when server is unreachable', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValue(new Error('Connection refused'));

      const provider = await EmbeddingProviderFactory.create({
        provider: 'ollama',
      });

      expect(provider).toBeNull();
      fetchSpy.mockRestore();
    });

    it('should return null when server returns error', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response('Internal Server Error', { status: 500 })
        );

      const provider = await EmbeddingProviderFactory.create({
        provider: 'ollama',
      });

      expect(provider).toBeNull();
      fetchSpy.mockRestore();
    });

    it('should create provider when server is reachable', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response(JSON.stringify({ models: [] }), { status: 200 })
        );

      const provider = await EmbeddingProviderFactory.create({
        provider: 'ollama',
      });

      expect(provider).not.toBeNull();
      expect(provider).toBeInstanceOf(OllamaEmbeddingProvider);
      expect(provider!.dimension).toBe(768);

      fetchSpy.mockRestore();
    });

    it('should use custom baseUrl, model, and dimension', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response(JSON.stringify({ models: [] }), { status: 200 })
        );

      const provider = await EmbeddingProviderFactory.create({
        provider: 'ollama',
        baseUrl: 'http://myserver:11434',
        model: 'mxbai-embed-large',
        dimension: 1024,
      });

      expect(provider).not.toBeNull();
      expect(provider!.dimension).toBe(1024);
      expect(fetchSpy).toHaveBeenCalledWith(
        'http://myserver:11434/api/tags',
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );

      fetchSpy.mockRestore();
    });
  });

  describe('config defaults', () => {
    it('should default to transformers provider', async () => {
      const provider = await EmbeddingProviderFactory.create({
        provider: 'transformers',
      });

      expect(provider).not.toBeNull();
      expect(provider!.dimension).toBe(384);
    });

    it('should default Ollama model to nomic-embed-text', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(
          new Response(JSON.stringify({ models: [] }), { status: 200 })
        );

      const provider = await EmbeddingProviderFactory.create({
        provider: 'ollama',
      });

      expect(provider).not.toBeNull();
      // Default dimension for ollama is 768
      expect(provider!.dimension).toBe(768);

      fetchSpy.mockRestore();
    });

    it('should default OpenAI model to text-embedding-3-small', async () => {
      const provider = await EmbeddingProviderFactory.create({
        provider: 'openai',
        apiKey: 'sk-test',
      });

      expect(provider).not.toBeNull();
      // Default dimension for openai is 1536
      expect(provider!.dimension).toBe(1536);
    });

    it('should handle empty fallbackProviders array', async () => {
      const provider = await EmbeddingProviderFactory.create({
        provider: 'transformers',
        fallbackProviders: [],
      });

      expect(provider).not.toBeNull();
    });
  });
});

describe('OllamaEmbeddingProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should embed text via Ollama API', async () => {
    const embedding = [0.1, 0.2, 0.3];
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ embedding }), { status: 200 })
      );

    const provider = new OllamaEmbeddingProvider(
      'http://localhost:11434',
      'nomic-embed-text',
      768
    );
    const result = await provider.embed('hello');

    expect(result).toEqual(embedding);
    expect(fetchSpy).toHaveBeenCalledWith(
      'http://localhost:11434/api/embeddings',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ model: 'nomic-embed-text', prompt: 'hello' }),
      })
    );

    fetchSpy.mockRestore();
  });

  it('should throw on API error', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('Not Found', { status: 404 }));

    const provider = new OllamaEmbeddingProvider(
      'http://localhost:11434',
      'nomic-embed-text',
      768
    );

    await expect(provider.embed('hello')).rejects.toThrow(
      'Ollama embed failed: 404'
    );
    fetchSpy.mockRestore();
  });

  it('should embedBatch by calling embed for each text', async () => {
    let callCount = 0;
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => {
        callCount++;
        return new Response(JSON.stringify({ embedding: [0.1 * callCount] }), {
          status: 200,
        });
      });

    const provider = new OllamaEmbeddingProvider(
      'http://localhost:11434',
      'nomic-embed-text',
      768
    );
    const results = await provider.embedBatch(['a', 'b']);

    expect(results.length).toBe(2);
    expect(fetchSpy).toHaveBeenCalledTimes(2);

    fetchSpy.mockRestore();
  });
});

describe('OpenAIEmbeddingProvider', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should embed text via OpenAI API', async () => {
    const embedding = [0.1, 0.2, 0.3];
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        new Response(JSON.stringify({ data: [{ embedding }] }), { status: 200 })
      );

    const provider = new OpenAIEmbeddingProvider(
      'sk-key',
      'text-embedding-3-small',
      1536
    );
    const result = await provider.embed('hello');

    expect(result).toEqual(embedding);
    expect(fetchSpy).toHaveBeenCalledWith(
      'https://api.openai.com/v1/embeddings',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: 'Bearer sk-key',
        }),
      })
    );

    fetchSpy.mockRestore();
  });

  it('should throw on API error', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('Unauthorized', { status: 401 }));

    const provider = new OpenAIEmbeddingProvider(
      'sk-bad',
      'text-embedding-3-small',
      1536
    );

    await expect(provider.embed('hello')).rejects.toThrow(
      'OpenAI embed failed: 401'
    );
    fetchSpy.mockRestore();
  });

  it('should batch embed in a single API call', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          data: [{ embedding: [0.1] }, { embedding: [0.2] }],
        }),
        { status: 200 }
      )
    );

    const provider = new OpenAIEmbeddingProvider(
      'sk-key',
      'text-embedding-3-small',
      1536
    );
    const results = await provider.embedBatch(['a', 'b']);

    expect(results).toEqual([[0.1], [0.2]]);
    // Single API call for batch
    expect(fetchSpy).toHaveBeenCalledTimes(1);

    fetchSpy.mockRestore();
  });

  it('should throw on batch API error', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response('Rate Limited', { status: 429 }));

    const provider = new OpenAIEmbeddingProvider(
      'sk-key',
      'text-embedding-3-small',
      1536
    );

    await expect(provider.embedBatch(['a', 'b'])).rejects.toThrow(
      'OpenAI embed batch failed: 429'
    );
    fetchSpy.mockRestore();
  });
});
