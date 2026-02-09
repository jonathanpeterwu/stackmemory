/**
 * Ollama Embedding Provider
 * Generates embeddings via a local Ollama server.
 */

import type { EmbeddingProvider } from './embedding-provider.js';

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly dimension: number;
  private baseUrl: string;
  private model: string;

  constructor(baseUrl: string, model: string, dimension: number) {
    this.baseUrl = baseUrl;
    this.model = model;
    this.dimension = dimension;
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch(`${this.baseUrl}/api/embeddings`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: this.model, prompt: text }),
    });
    if (!res.ok) throw new Error(`Ollama embed failed: ${res.status}`);
    const data = (await res.json()) as { embedding: number[] };
    return data.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((t) => this.embed(t)));
  }
}
