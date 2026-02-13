/**
 * Cerebras Provider Adapter
 *
 * Extends GPTAdapter for Cerebras API (OpenAI-compatible).
 * Supports Llama models at ultra-low latency (1000+ tok/s).
 */

import {
  GPTAdapter,
  type ProviderExtensions,
  type ProviderConfig,
} from './provider-adapter.js';

export class CerebrasAdapter extends GPTAdapter {
  override readonly id = 'cerebras';
  override readonly name = 'Cerebras';
  override readonly version = '1.0.0';
  override readonly extensions: Partial<ProviderExtensions> = {};

  constructor(config: ProviderConfig) {
    super({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || 'https://api.cerebras.ai/v1',
    });
  }

  override supportsExtension(): boolean {
    return false;
  }

  override async listModels(): Promise<string[]> {
    return ['llama-4-scout-17b-16e-instruct', 'llama3.1-8b', 'llama3.1-70b'];
  }
}
