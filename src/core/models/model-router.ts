/**
 * Model Router - Switch between Claude and alternative models
 * Supports routing plan/thinking tasks to specialized models like Qwen3-Max-Thinking
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { writeFileSecure, ensureSecureDir } from '../../hooks/secure-fs.js';
import {
  ModelRouterConfigSchema,
  parseConfigSafe,
} from '../../hooks/schemas.js';

export type ModelProvider =
  | 'anthropic'
  | 'qwen'
  | 'openai'
  | 'ollama'
  | 'custom';
export type TaskType = 'default' | 'plan' | 'think' | 'code' | 'review';

export interface ModelConfig {
  provider: ModelProvider;
  model: string;
  baseUrl?: string;
  apiKeyEnv: string; // Environment variable name for API key
  headers?: Record<string, string>;
  params?: Record<string, unknown>; // Provider-specific params
}

export interface ModelRouterConfig {
  enabled: boolean;
  defaultProvider: ModelProvider;

  // Route specific task types to different models
  taskRouting: {
    plan?: ModelProvider; // Planning/architecture tasks
    think?: ModelProvider; // Deep thinking/reasoning
    code?: ModelProvider; // Code generation
    review?: ModelProvider; // Code review
  };

  // Fallback configuration
  fallback: {
    enabled: boolean;
    provider: ModelProvider; // Fallback provider (default: qwen)
    onRateLimit: boolean; // Fallback on 429 errors
    onError: boolean; // Fallback on 5xx errors
    onTimeout: boolean; // Fallback on timeout
    maxRetries: number; // Retries before fallback
    retryDelayMs: number; // Delay between retries
  };

  // Provider configurations
  providers: {
    anthropic?: ModelConfig;
    qwen?: ModelConfig;
    openai?: ModelConfig;
    ollama?: ModelConfig;
    custom?: ModelConfig;
  };

  // Thinking mode settings
  thinkingMode: {
    enabled: boolean;
    budget?: number; // Max thinking tokens
    temperature?: number; // Recommended: 0.6 for thinking
    topP?: number; // Recommended: 0.95 for thinking
  };
}

const CONFIG_PATH = join(homedir(), '.stackmemory', 'model-router.json');

const DEFAULT_CONFIG: ModelRouterConfig = {
  enabled: false,
  defaultProvider: 'anthropic',
  taskRouting: {},
  fallback: {
    enabled: true, // Fallback enabled by default
    provider: 'qwen',
    onRateLimit: true,
    onError: true,
    onTimeout: true,
    maxRetries: 2,
    retryDelayMs: 1000,
  },
  providers: {
    anthropic: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-20250514',
      apiKeyEnv: 'ANTHROPIC_API_KEY',
    },
    qwen: {
      provider: 'qwen',
      model: 'qwen3-max-2025-01-23',
      baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
      apiKeyEnv: 'DASHSCOPE_API_KEY',
      params: {
        enable_thinking: true,
        thinking_budget: 10000,
      },
    },
  },
  thinkingMode: {
    enabled: true,
    budget: 10000,
    temperature: 0.6,
    topP: 0.95,
  },
};

/**
 * Load model router configuration with Zod validation
 */
export function loadModelRouterConfig(): ModelRouterConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const data = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
      return parseConfigSafe(
        ModelRouterConfigSchema,
        { ...DEFAULT_CONFIG, ...data },
        DEFAULT_CONFIG,
        'model-router'
      );
    }
  } catch {
    // Use defaults
  }
  return { ...DEFAULT_CONFIG };
}

/**
 * Save model router configuration
 */
export function saveModelRouterConfig(config: ModelRouterConfig): void {
  try {
    ensureSecureDir(join(homedir(), '.stackmemory'));
    writeFileSecure(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch {
    // Silently fail
  }
}

/**
 * Get model config for a specific task type
 */
export function getModelForTask(taskType: TaskType): ModelConfig | null {
  const config = loadModelRouterConfig();

  if (!config.enabled) {
    return null; // Use default Claude
  }

  // Check task-specific routing
  const routedProvider =
    config.taskRouting[taskType as keyof typeof config.taskRouting];
  const provider = routedProvider || config.defaultProvider;

  return config.providers[provider] || null;
}

/**
 * Build environment variables for alternative model
 */
export function buildModelEnv(
  modelConfig: ModelConfig
): Record<string, string> {
  const env: Record<string, string> = {};

  // Get API key from environment
  const apiKey = process.env[modelConfig.apiKeyEnv];
  if (!apiKey) {
    console.warn(`[model-router] API key not found: ${modelConfig.apiKeyEnv}`);
    return env;
  }

  // Set Anthropic-compatible env vars (Claude Code reads these)
  env['ANTHROPIC_MODEL'] = modelConfig.model;
  env['ANTHROPIC_SMALL_FAST_MODEL'] = modelConfig.model;
  env['ANTHROPIC_AUTH_TOKEN'] = apiKey;

  if (modelConfig.baseUrl) {
    env['ANTHROPIC_BASE_URL'] = modelConfig.baseUrl;
  }

  return env;
}

/**
 * Detect if current context is a planning task
 */
export function isPlanningContext(input: string): boolean {
  const planPatterns = [
    /\bplan\b/i,
    /\barchitect/i,
    /\bdesign\b/i,
    /\bstrateg/i,
    /\bimplement.*approach/i,
    /\bhow.*should.*we/i,
    /\bthink.*through/i,
    /\breason.*about/i,
    /\banalyze.*options/i,
    /\btrade-?offs?/i,
  ];

  return planPatterns.some((pattern) => pattern.test(input));
}

/**
 * Detect if task requires deep thinking
 */
export function requiresDeepThinking(input: string): boolean {
  const thinkPatterns = [
    /\bcomplex/i,
    /\bdifficult/i,
    /\btricky/i,
    /\bcareful/i,
    /\bstep.*by.*step/i,
    /\bthink.*hard/i,
    /\bultrathink/i,
    /\b--think/i,
    /\b--think-hard/i,
  ];

  return thinkPatterns.some((pattern) => pattern.test(input));
}

/**
 * Error types that trigger fallback
 */
export type FallbackTrigger = 'rate_limit' | 'error' | 'timeout' | 'manual';

/**
 * Model Router class for managing model switching
 */
export class ModelRouter {
  private config: ModelRouterConfig;
  private currentProvider: ModelProvider;
  private inFallbackMode: boolean = false;
  private fallbackReason?: FallbackTrigger;

  constructor() {
    this.config = loadModelRouterConfig();
    this.currentProvider = this.config.defaultProvider;
  }

  /**
   * Route a task to the appropriate model
   */
  route(
    taskType: TaskType,
    input?: string
  ): {
    provider: ModelProvider;
    env: Record<string, string>;
    switched: boolean;
  } {
    if (!this.config.enabled) {
      return { provider: 'anthropic', env: {}, switched: false };
    }

    // Auto-detect task type if input provided
    let detectedType = taskType;
    if (input && taskType === 'default') {
      if (isPlanningContext(input)) {
        detectedType = 'plan';
      } else if (requiresDeepThinking(input)) {
        detectedType = 'think';
      }
    }

    const modelConfig = getModelForTask(detectedType);
    if (!modelConfig) {
      return { provider: 'anthropic', env: {}, switched: false };
    }

    const switched = modelConfig.provider !== this.currentProvider;
    this.currentProvider = modelConfig.provider;

    return {
      provider: modelConfig.provider,
      env: buildModelEnv(modelConfig),
      switched,
    };
  }

  /**
   * Get current provider
   */
  getCurrentProvider(): ModelProvider {
    return this.currentProvider;
  }

  /**
   * Force switch to a specific provider
   */
  switchTo(provider: ModelProvider): Record<string, string> {
    const modelConfig = this.config.providers[provider];
    if (!modelConfig) {
      console.warn(`[model-router] Provider not configured: ${provider}`);
      return {};
    }

    this.currentProvider = provider;
    return buildModelEnv(modelConfig);
  }

  /**
   * Reset to default provider
   */
  reset(): void {
    this.currentProvider = this.config.defaultProvider;
    this.inFallbackMode = false;
    this.fallbackReason = undefined;
  }

  /**
   * Check if fallback is enabled and configured
   */
  isFallbackEnabled(): boolean {
    if (!this.config.fallback?.enabled) return false;

    const fallbackProvider =
      this.config.providers[this.config.fallback.provider];
    if (!fallbackProvider) return false;

    // Check if fallback provider has API key
    const apiKey = process.env[fallbackProvider.apiKeyEnv];
    return !!apiKey;
  }

  /**
   * Check if error should trigger fallback
   */
  shouldFallback(error: {
    status?: number;
    code?: string;
    message?: string;
  }): boolean {
    if (!this.isFallbackEnabled()) return false;
    if (this.inFallbackMode) return false; // Already in fallback

    const fallback = this.config.fallback;

    // Rate limit (429)
    if (fallback.onRateLimit && error.status === 429) {
      return true;
    }

    // Server errors (5xx)
    if (fallback.onError && error.status && error.status >= 500) {
      return true;
    }

    // Timeout
    if (fallback.onTimeout) {
      const isTimeout =
        error.code === 'ETIMEDOUT' ||
        error.code === 'ESOCKETTIMEDOUT' ||
        error.message?.toLowerCase().includes('timeout');
      if (isTimeout) return true;
    }

    // Overloaded
    if (error.message?.toLowerCase().includes('overloaded')) {
      return true;
    }

    return false;
  }

  /**
   * Activate fallback mode
   */
  activateFallback(reason: FallbackTrigger): Record<string, string> {
    if (!this.isFallbackEnabled()) {
      console.warn('[model-router] Fallback not available');
      return {};
    }

    const fallbackProvider = this.config.fallback.provider;
    const modelConfig = this.config.providers[fallbackProvider];

    if (!modelConfig) {
      console.warn(
        `[model-router] Fallback provider not configured: ${fallbackProvider}`
      );
      return {};
    }

    this.inFallbackMode = true;
    this.fallbackReason = reason;
    this.currentProvider = fallbackProvider;

    console.log(
      `[model-router] Fallback activated: ${reason} -> ${fallbackProvider}`
    );

    return buildModelEnv(modelConfig);
  }

  /**
   * Get fallback configuration
   */
  getFallbackConfig(): ModelRouterConfig['fallback'] {
    return this.config.fallback;
  }

  /**
   * Check if currently in fallback mode
   */
  isInFallbackMode(): boolean {
    return this.inFallbackMode;
  }

  /**
   * Get reason for fallback
   */
  getFallbackReason(): FallbackTrigger | undefined {
    return this.fallbackReason;
  }

  /**
   * Get fallback environment variables (for pre-configuring)
   */
  getFallbackEnv(): Record<string, string> {
    if (!this.isFallbackEnabled()) return {};

    const fallbackProvider = this.config.fallback.provider;
    const modelConfig = this.config.providers[fallbackProvider];

    if (!modelConfig) return {};

    return buildModelEnv(modelConfig);
  }
}

// Singleton instance
let routerInstance: ModelRouter | null = null;

export function getModelRouter(): ModelRouter {
  if (!routerInstance) {
    routerInstance = new ModelRouter();
  }
  return routerInstance;
}

/**
 * Quick helper to get env vars for plan mode
 */
export function getPlanModeEnv(): Record<string, string> {
  const router = getModelRouter();
  const result = router.route('plan');
  return result.env;
}

/**
 * Quick helper to get env vars for thinking mode
 */
export function getThinkingModeEnv(): Record<string, string> {
  const router = getModelRouter();
  const result = router.route('think');
  return result.env;
}

/**
 * Check if fallback is available
 */
export function isFallbackAvailable(): boolean {
  const router = getModelRouter();
  return router.isFallbackEnabled();
}

/**
 * Get fallback status for display
 */
export function getFallbackStatus(): {
  enabled: boolean;
  provider: ModelProvider | null;
  hasApiKey: boolean;
  inFallback: boolean;
  reason?: FallbackTrigger;
} {
  const router = getModelRouter();
  const config = loadModelRouterConfig();

  if (!config.fallback?.enabled) {
    return {
      enabled: false,
      provider: null,
      hasApiKey: false,
      inFallback: false,
    };
  }

  const fallbackProvider = config.providers[config.fallback.provider];
  const hasApiKey = fallbackProvider
    ? !!process.env[fallbackProvider.apiKeyEnv]
    : false;

  return {
    enabled: true,
    provider: config.fallback.provider,
    hasApiKey,
    inFallback: router.isInFallbackMode(),
    reason: router.getFallbackReason(),
  };
}

/**
 * Trigger fallback manually (for testing or forced switch)
 */
export function triggerFallback(
  reason: FallbackTrigger = 'manual'
): Record<string, string> {
  const router = getModelRouter();
  return router.activateFallback(reason);
}

/**
 * Reset fallback state
 */
export function resetFallback(): void {
  const router = getModelRouter();
  router.reset();
}
