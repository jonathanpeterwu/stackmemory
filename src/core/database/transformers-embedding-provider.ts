/**
 * Embedding provider using @xenova/transformers for local inference.
 * Lazy-loads the model on first embed() call (~30MB download).
 */

import type { EmbeddingProvider } from './embedding-provider.js';

export class TransformersEmbeddingProvider implements EmbeddingProvider {
  readonly dimension: number;
  private pipeline: any = null;
  private modelName: string;
  private initPromise: Promise<void> | null = null;

  constructor(modelName = 'Xenova/all-MiniLM-L6-v2', dimension = 384) {
    this.modelName = modelName;
    this.dimension = dimension;
  }

  private async ensureLoaded(): Promise<void> {
    if (this.pipeline) return;
    if (this.initPromise) {
      await this.initPromise;
      return;
    }
    this.initPromise = (async () => {
      const { pipeline } = await import('@xenova/transformers');
      this.pipeline = await pipeline('feature-extraction', this.modelName);
    })();
    await this.initPromise;
  }

  async embed(text: string): Promise<number[]> {
    await this.ensureLoaded();
    const output = await this.pipeline(text, {
      pooling: 'mean',
      normalize: true,
    });
    return Array.from(output.data);
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}

/**
 * Factory: returns a provider or null if @xenova/transformers is not installed.
 */
export async function createTransformersProvider(
  modelName?: string,
  dimension?: number
): Promise<EmbeddingProvider | null> {
  try {
    await import('@xenova/transformers');
    return new TransformersEmbeddingProvider(modelName, dimension);
  } catch {
    return null;
  }
}
