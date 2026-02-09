/**
 * OpenAI Embedding Provider
 * Generates embeddings via the OpenAI API.
 */

import type { EmbeddingProvider } from './embedding-provider.js';

interface OpenAIEmbeddingResponse {
  data: Array<{ embedding: number[] }>;
}

export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly dimension: number;
  private apiKey: string;
  private model: string;

  constructor(apiKey: string, model: string, dimension: number) {
    this.apiKey = apiKey;
    this.model = model;
    this.dimension = dimension;
  }

  async embed(text: string): Promise<number[]> {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: text }),
    });
    if (!res.ok) throw new Error(`OpenAI embed failed: ${res.status}`);
    const data = (await res.json()) as OpenAIEmbeddingResponse;
    return data.data[0]!.embedding;
  }

  async embedBatch(texts: string[]): Promise<number[][]> {
    const res = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ model: this.model, input: texts }),
    });
    if (!res.ok) throw new Error(`OpenAI embed batch failed: ${res.status}`);
    const data = (await res.json()) as OpenAIEmbeddingResponse;
    return data.data.map((d) => d.embedding);
  }
}
