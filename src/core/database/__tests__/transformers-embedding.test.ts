/**
 * Tests for TransformersEmbeddingProvider
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock @xenova/transformers before imports
const mockPipelineFn = vi.fn();
vi.mock('@xenova/transformers', () => ({
  pipeline: vi.fn(async () => mockPipelineFn),
}));

import {
  TransformersEmbeddingProvider,
  createTransformersProvider,
} from '../transformers-embedding-provider.js';

describe('TransformersEmbeddingProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockPipelineFn.mockResolvedValue({
      data: new Float32Array(384).fill(0.1),
    });
  });

  it('should embed text and return array of correct dimension', async () => {
    const provider = new TransformersEmbeddingProvider();
    expect(provider.dimension).toBe(384);

    const result = await provider.embed('hello world');

    expect(Array.isArray(result)).toBe(true);
    expect(result.length).toBe(384);
    expect(result[0]).toBeCloseTo(0.1);
    expect(mockPipelineFn).toHaveBeenCalledWith('hello world', {
      pooling: 'mean',
      normalize: true,
    });
  });

  it('should handle embedBatch with multiple texts', async () => {
    const provider = new TransformersEmbeddingProvider();
    const results = await provider.embedBatch(['text1', 'text2', 'text3']);

    expect(results.length).toBe(3);
    results.forEach((r) => expect(r.length).toBe(384));
    expect(mockPipelineFn).toHaveBeenCalledTimes(3);
  });

  it('should init pipeline only once with concurrent calls', async () => {
    const { pipeline } = await import('@xenova/transformers');
    const provider = new TransformersEmbeddingProvider();

    // Fire multiple concurrent embeds
    await Promise.all([
      provider.embed('a'),
      provider.embed('b'),
      provider.embed('c'),
    ]);

    // pipeline() factory should only be called once (singleton)
    expect(pipeline).toHaveBeenCalledTimes(1);
    expect(pipeline).toHaveBeenCalledWith(
      'feature-extraction',
      'Xenova/all-MiniLM-L6-v2'
    );
  });

  it('should accept custom model name and dimension', async () => {
    const { pipeline } = await import('@xenova/transformers');
    const provider = new TransformersEmbeddingProvider(
      'Xenova/custom-model',
      768
    );

    expect(provider.dimension).toBe(768);
    await provider.embed('test');

    expect(pipeline).toHaveBeenCalledWith(
      'feature-extraction',
      'Xenova/custom-model'
    );
  });
});

describe('createTransformersProvider', () => {
  it('should return a provider when @xenova/transformers is available', async () => {
    const provider = await createTransformersProvider();
    expect(provider).not.toBeNull();
    expect(provider!.dimension).toBe(384);
  });
});
