/**
 * Provider Pricing Table
 *
 * Cost per 1M tokens (USD) for each provider+model pair.
 * Used by provider benchmarks and cost-aware routing.
 *
 * Prices sourced 2026-02-13. Update periodically.
 */

export interface ModelPricing {
  inputPer1M: number; // $/1M input tokens
  outputPer1M: number; // $/1M output tokens
  source: string; // Where price was sourced
}

/**
 * Pricing table keyed by "provider/model"
 */
export const MODEL_PRICING: Record<string, ModelPricing> = {
  // Anthropic (direct API)
  'anthropic/claude-sonnet-4-5-20250929': {
    inputPer1M: 3.0,
    outputPer1M: 15.0,
    source: 'anthropic.com',
  },
  'anthropic/claude-sonnet-4-20250514': {
    inputPer1M: 3.0,
    outputPer1M: 15.0,
    source: 'anthropic.com',
  },
  'anthropic/claude-haiku-4-5-20251001': {
    inputPer1M: 0.8,
    outputPer1M: 4.0,
    source: 'anthropic.com',
  },

  // OpenAI (direct API)
  'openai/gpt-4o': {
    inputPer1M: 2.5,
    outputPer1M: 10.0,
    source: 'openai.com',
  },

  // OpenRouter (aggregated)
  'openrouter/meta-llama/llama-4-scout': {
    inputPer1M: 0.08,
    outputPer1M: 0.3,
    source: 'openrouter.ai/api/v1/models',
  },

  // Cerebras (free tier / inference)
  'cerebras/llama-4-scout-17b-16e-instruct': {
    inputPer1M: 0.1,
    outputPer1M: 0.1,
    source: 'cerebras.ai',
  },

  // DeepInfra
  'deepinfra/THUDM/glm-4-9b-chat': {
    inputPer1M: 0.065,
    outputPer1M: 0.065,
    source: 'deepinfra.com',
  },
};

/**
 * Calculate cost in USD for a single request.
 */
export function calculateCost(
  provider: string,
  model: string,
  inputTokens: number,
  outputTokens: number
): { inputCost: number; outputCost: number; totalCost: number } | null {
  const key = `${provider}/${model}`;
  const pricing = MODEL_PRICING[key];
  if (!pricing) return null;

  const inputCost = (inputTokens / 1_000_000) * pricing.inputPer1M;
  const outputCost = (outputTokens / 1_000_000) * pricing.outputPer1M;

  return { inputCost, outputCost, totalCost: inputCost + outputCost };
}

/**
 * Format cost for display: "$0.001234"
 */
export function formatCost(usd: number): string {
  if (usd < 0.01) return `$${usd.toFixed(6)}`;
  return `$${usd.toFixed(4)}`;
}
