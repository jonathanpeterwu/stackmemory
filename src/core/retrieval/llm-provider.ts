/**
 * LLM Provider Implementation for Context Retrieval
 * Provides real Anthropic API integration for intelligent context analysis
 */

import Anthropic from '@anthropic-ai/sdk';
import { logger } from '../monitoring/logger.js';

/**
 * LLM provider interface for context analysis
 */
export interface LLMProvider {
  analyze(prompt: string, maxTokens: number): Promise<string>;
}

/**
 * Configuration for Anthropic LLM provider
 */
export interface AnthropicProviderConfig {
  apiKey: string;
  model?: string;
  temperature?: number;
  maxRetries?: number;
  timeout?: number;
}

/**
 * Real Anthropic LLM provider using the official SDK
 */
export class AnthropicLLMProvider implements LLMProvider {
  private client: Anthropic;
  private model: string;
  private temperature: number;
  private maxRetries: number;
  private timeout: number;

  constructor(config: AnthropicProviderConfig) {
    this.client = new Anthropic({
      apiKey: config.apiKey,
    });
    this.model = config.model || 'claude-3-haiku-20240307';
    this.temperature = config.temperature ?? 0.3;
    this.maxRetries = config.maxRetries ?? 2;
    this.timeout = config.timeout ?? 30000;

    logger.info('AnthropicLLMProvider initialized', {
      model: this.model,
      temperature: this.temperature,
    });
  }

  /**
   * Analyze a prompt using the Anthropic API
   */
  async analyze(prompt: string, maxTokens: number): Promise<string> {
    const startTime = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const response = await this.makeRequest(prompt, maxTokens);

        logger.debug('LLM analysis completed', {
          model: this.model,
          promptLength: prompt.length,
          responseLength: response.length,
          durationMs: Date.now() - startTime,
          attempt,
        });

        return response;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));

        // Check if retryable
        if (this.isRetryableError(error) && attempt < this.maxRetries) {
          const backoffMs = Math.pow(2, attempt) * 1000;
          logger.warn('LLM request failed, retrying', {
            attempt,
            backoffMs,
            error: lastError.message,
          });
          await this.sleep(backoffMs);
          continue;
        }

        break;
      }
    }

    logger.error('LLM analysis failed after retries', lastError!);
    throw lastError;
  }

  /**
   * Make the actual API request
   */
  private async makeRequest(
    prompt: string,
    maxTokens: number
  ): Promise<string> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        temperature: this.temperature,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      // Extract text from response
      const textContent = response.content.find((c) => c.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new Error('No text content in response');
      }

      return textContent.text;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  /**
   * Check if an error is retryable
   */
  private isRetryableError(error: unknown): boolean {
    if (error instanceof Anthropic.RateLimitError) {
      return true;
    }
    if (error instanceof Anthropic.APIConnectionError) {
      return true;
    }
    if (error instanceof Anthropic.InternalServerError) {
      return true;
    }
    // Timeout errors are retryable
    if (error instanceof Error && error.name === 'AbortError') {
      return true;
    }
    return false;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

/**
 * Factory function to create an LLM provider based on environment
 */
export function createLLMProvider(): LLMProvider | undefined {
  const apiKey = process.env['ANTHROPIC_API_KEY'];

  if (!apiKey) {
    logger.info(
      'No ANTHROPIC_API_KEY found, LLM retrieval will use heuristics'
    );
    return undefined;
  }

  return new AnthropicLLMProvider({
    apiKey,
    model: process.env['ANTHROPIC_MODEL'] || 'claude-3-haiku-20240307',
    temperature: parseFloat(process.env['ANTHROPIC_TEMPERATURE'] || '0.3'),
  });
}
