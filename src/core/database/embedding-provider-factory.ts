/**
 * Embedding Provider Factory
 * Config-driven creation with fallback chain support.
 * Never throws — returns null when no provider is available.
 */

import type { EmbeddingProvider } from './embedding-provider.js';
import { OllamaEmbeddingProvider } from './ollama-embedding-provider.js';
import { OpenAIEmbeddingProvider } from './openai-embedding-provider.js';

export type EmbeddingProviderType =
  | 'transformers'
  | 'ollama'
  | 'openai'
  | 'none';

export interface EmbeddingProviderConfig {
  provider: EmbeddingProviderType;
  model?: string;
  dimension?: number;
  apiKey?: string;
  baseUrl?: string;
  fallbackProviders?: EmbeddingProviderType[];
}

export class EmbeddingProviderFactory {
  /**
   * Create an embedding provider based on config.
   * Tries the primary provider first, then fallbacks in order.
   * Returns null if no provider is available.
   */
  static async create(
    config: EmbeddingProviderConfig
  ): Promise<EmbeddingProvider | null> {
    const providers: EmbeddingProviderType[] = [
      config.provider,
      ...(config.fallbackProviders ?? []),
    ];

    for (const p of providers) {
      if (p === 'none') return null;
      try {
        const provider = await EmbeddingProviderFactory.tryCreate(p, config);
        if (provider) return provider;
      } catch {
        // Swallow — try next fallback
      }
    }
    return null;
  }

  private static async tryCreate(
    type: EmbeddingProviderType,
    config: EmbeddingProviderConfig
  ): Promise<EmbeddingProvider | null> {
    switch (type) {
      case 'transformers': {
        const { createTransformersProvider } =
          await import('./transformers-embedding-provider.js');
        return createTransformersProvider(config.model, config.dimension);
      }
      case 'ollama':
        return EmbeddingProviderFactory.createOllamaProvider(config);
      case 'openai':
        return EmbeddingProviderFactory.createOpenAIProvider(config);
      case 'none':
        return null;
      default:
        return null;
    }
  }

  private static async createOllamaProvider(
    config: EmbeddingProviderConfig
  ): Promise<EmbeddingProvider | null> {
    try {
      const baseUrl = config.baseUrl ?? 'http://localhost:11434';
      const response = await fetch(`${baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) return null;
      return new OllamaEmbeddingProvider(
        baseUrl,
        config.model ?? 'nomic-embed-text',
        config.dimension ?? 768
      );
    } catch {
      return null;
    }
  }

  private static async createOpenAIProvider(
    config: EmbeddingProviderConfig
  ): Promise<EmbeddingProvider | null> {
    const apiKey = config.apiKey ?? process.env['OPENAI_API_KEY'];
    if (!apiKey) return null;
    return new OpenAIEmbeddingProvider(
      apiKey,
      config.model ?? 'text-embedding-3-small',
      config.dimension ?? 1536
    );
  }
}
