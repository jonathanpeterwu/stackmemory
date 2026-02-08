/**
 * Embedding Provider Interface
 * Abstraction for generating vector embeddings from text
 */

export interface EmbeddingProvider {
  /** Generate embedding for a single text */
  embed(text: string): Promise<number[]>;
  /** Generate embeddings for multiple texts */
  embedBatch(texts: string[]): Promise<number[][]>;
  /** Dimensionality of the embedding vectors */
  dimension: number;
}

/**
 * No-op provider that disables vector search.
 * Used as default when no real provider is configured.
 */
export class NoOpEmbeddingProvider implements EmbeddingProvider {
  readonly dimension = 0;

  async embed(_text: string): Promise<number[]> {
    return [];
  }

  async embedBatch(_texts: string[]): Promise<number[][]> {
    return [];
  }
}
