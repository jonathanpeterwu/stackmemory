/**
 * DeepInfra Provider Adapter
 *
 * Extends GPTAdapter for DeepInfra API (OpenAI-compatible).
 * Supports GLM, Llama, and other open-source models.
 */

import {
  GPTAdapter,
  type ProviderExtensions,
  type ProviderConfig,
} from './provider-adapter.js';

export class DeepInfraAdapter extends GPTAdapter {
  override readonly id = 'deepinfra';
  override readonly name = 'DeepInfra';
  override readonly version = '1.0.0';
  override readonly extensions: Partial<ProviderExtensions> = {};

  constructor(config: ProviderConfig) {
    super({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl || 'https://api.deepinfra.com/v1/openai',
    });
  }

  override supportsExtension(): boolean {
    return false;
  }

  override async listModels(): Promise<string[]> {
    return [
      'THUDM/glm-4-9b-chat',
      'meta-llama/Meta-Llama-3.1-8B-Instruct',
      'meta-llama/Meta-Llama-3.1-70B-Instruct',
    ];
  }
}
