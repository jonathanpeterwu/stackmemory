/**
 * Fallback Monitor - Watches Claude output for errors and triggers automatic fallback
 * Restarts session with Qwen when Claude fails
 */

import { spawn, ChildProcess } from 'child_process';
import {
  loadModelRouterConfig,
  buildModelEnv,
  type ModelProvider,
} from './model-router.js';

export interface FallbackMonitorConfig {
  enabled: boolean;
  maxRestarts: number;
  restartDelayMs: number;
  errorPatterns: RegExp[];
  onFallback?: (provider: ModelProvider, reason: string) => void;
  onRestore?: (provider: ModelProvider) => void;
}

const DEFAULT_ERROR_PATTERNS = [
  /rate.?limit/i,
  /429/,
  /too.?many.?requests/i,
  /overloaded/i,
  /capacity/i,
  /temporarily.?unavailable/i,
  /503/,
  /502/,
  /500/,
  /internal.?server.?error/i,
  /timeout/i,
  /ETIMEDOUT/,
  /ESOCKETTIMEDOUT/,
  /ECONNRESET/,
  /ECONNREFUSED/,
];

/**
 * FallbackMonitor watches a Claude process and restarts with fallback on errors
 */
export class FallbackMonitor {
  private config: FallbackMonitorConfig;
  private routerConfig = loadModelRouterConfig();
  private currentProvider: ModelProvider = 'anthropic';
  private restartCount = 0;
  private inFallback = false;
  private errorBuffer = '';
  private lastErrorTime = 0;
  private errorCount = 0;

  constructor(config: Partial<FallbackMonitorConfig> = {}) {
    this.config = {
      enabled: true,
      maxRestarts: 3,
      restartDelayMs: 2000,
      errorPatterns: DEFAULT_ERROR_PATTERNS,
      ...config,
    };
  }

  /**
   * Check if text contains error patterns that should trigger fallback
   */
  detectError(text: string): { shouldFallback: boolean; reason: string } {
    for (const pattern of this.config.errorPatterns) {
      if (pattern.test(text)) {
        return {
          shouldFallback: true,
          reason: pattern.source,
        };
      }
    }
    return { shouldFallback: false, reason: '' };
  }

  /**
   * Get environment variables for fallback provider
   */
  getFallbackEnv(): Record<string, string> {
    const fallbackProvider = this.routerConfig.fallback?.provider || 'qwen';
    const providerConfig = this.routerConfig.providers[fallbackProvider];

    if (!providerConfig) {
      console.error(`[fallback] Provider not configured: ${fallbackProvider}`);
      return {};
    }

    return buildModelEnv(providerConfig);
  }

  /**
   * Check if fallback is available (has API key)
   */
  isFallbackAvailable(): boolean {
    const fallbackProvider = this.routerConfig.fallback?.provider || 'qwen';
    const providerConfig = this.routerConfig.providers[fallbackProvider];

    if (!providerConfig) return false;

    return !!process.env[providerConfig.apiKeyEnv];
  }

  /**
   * Wrap a Claude process with fallback monitoring
   * Returns a function to spawn the process with automatic restart on failure
   */
  wrapProcess(
    command: string,
    args: string[],
    options: { env?: NodeJS.ProcessEnv; cwd?: string } = {}
  ): {
    start: () => ChildProcess;
    stop: () => void;
    isInFallback: () => boolean;
    getCurrentProvider: () => ModelProvider;
  } {
    let currentProcess: ChildProcess | null = null;
    let stopped = false;

    const startProcess = (): ChildProcess => {
      const env = { ...process.env, ...options.env };

      // Apply fallback env if in fallback mode
      if (this.inFallback) {
        const fallbackEnv = this.getFallbackEnv();
        Object.assign(env, fallbackEnv);
        this.currentProvider = this.routerConfig.fallback?.provider || 'qwen';
      }

      currentProcess = spawn(command, args, {
        stdio: ['inherit', 'pipe', 'pipe'],
        env,
        cwd: options.cwd,
      });

      // Monitor stdout
      currentProcess.stdout?.on('data', (data: Buffer) => {
        const text = data.toString();
        process.stdout.write(data);
        this.checkForErrors(text);
      });

      // Monitor stderr
      currentProcess.stderr?.on('data', (data: Buffer) => {
        const text = data.toString();
        process.stderr.write(data);
        this.checkForErrors(text);
      });

      // Handle exit
      currentProcess.on('exit', (code, _signal) => {
        if (stopped) return;

        // Check if we should restart with fallback
        if (code !== 0 && this.shouldRestart()) {
          console.log(
            `\n[fallback] Process exited with code ${code}, restarting with fallback...`
          );
          this.activateFallback('exit_code');
          setTimeout(() => {
            if (!stopped) {
              startProcess();
            }
          }, this.config.restartDelayMs);
        }
      });

      return currentProcess;
    };

    return {
      start: startProcess,
      stop: () => {
        stopped = true;
        currentProcess?.kill();
      },
      isInFallback: () => this.inFallback,
      getCurrentProvider: () => this.currentProvider,
    };
  }

  /**
   * Check output text for errors and trigger fallback if needed
   */
  private checkForErrors(text: string): void {
    this.errorBuffer += text;

    // Keep buffer manageable
    if (this.errorBuffer.length > 10000) {
      this.errorBuffer = this.errorBuffer.slice(-5000);
    }

    const { shouldFallback, reason } = this.detectError(text);

    if (shouldFallback) {
      const now = Date.now();

      // Debounce rapid errors
      if (now - this.lastErrorTime < 1000) {
        this.errorCount++;
      } else {
        this.errorCount = 1;
      }
      this.lastErrorTime = now;

      // Trigger fallback after multiple rapid errors
      if (
        this.errorCount >= 2 &&
        !this.inFallback &&
        this.isFallbackAvailable()
      ) {
        console.log(`\n[fallback] Detected error pattern: ${reason}`);
        this.activateFallback(reason);
      }
    }
  }

  /**
   * Activate fallback mode
   */
  private activateFallback(reason: string): void {
    if (this.inFallback) return;

    this.inFallback = true;
    this.restartCount++;
    this.currentProvider = this.routerConfig.fallback?.provider || 'qwen';

    console.log(
      `[fallback] Switching to ${this.currentProvider} (reason: ${reason})`
    );

    if (this.config.onFallback) {
      this.config.onFallback(this.currentProvider, reason);
    }
  }

  /**
   * Check if we should restart
   */
  private shouldRestart(): boolean {
    return (
      this.config.enabled &&
      this.restartCount < this.config.maxRestarts &&
      this.isFallbackAvailable()
    );
  }

  /**
   * Reset fallback state
   */
  reset(): void {
    this.inFallback = false;
    this.restartCount = 0;
    this.errorCount = 0;
    this.errorBuffer = '';
    this.currentProvider = 'anthropic';
  }

  /**
   * Get current status
   */
  getStatus(): {
    inFallback: boolean;
    currentProvider: ModelProvider;
    restartCount: number;
    fallbackAvailable: boolean;
  } {
    return {
      inFallback: this.inFallback,
      currentProvider: this.currentProvider,
      restartCount: this.restartCount,
      fallbackAvailable: this.isFallbackAvailable(),
    };
  }
}

/**
 * Create a simple fallback-aware spawn function
 */
export function spawnWithFallback(
  command: string,
  args: string[],
  options: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    onFallback?: (provider: ModelProvider, reason: string) => void;
  } = {}
): ChildProcess {
  const monitor = new FallbackMonitor({
    onFallback: options.onFallback,
  });

  const wrapper = monitor.wrapProcess(command, args, options);
  return wrapper.start();
}

/**
 * Quick helper to get env vars with fallback pre-configured
 */
export function getEnvWithFallback(): Record<string, string> {
  const config = loadModelRouterConfig();
  const env: Record<string, string> = {};

  // Set fallback provider info for error recovery
  if (config.fallback?.enabled) {
    const fallbackProvider = config.providers[config.fallback.provider];
    if (fallbackProvider) {
      env['STACKMEMORY_FALLBACK_PROVIDER'] = config.fallback.provider;
      env['STACKMEMORY_FALLBACK_MODEL'] = fallbackProvider.model;
      env['STACKMEMORY_FALLBACK_URL'] = fallbackProvider.baseUrl || '';
      env['STACKMEMORY_FALLBACK_KEY_ENV'] = fallbackProvider.apiKeyEnv;
    }
  }

  return env;
}
