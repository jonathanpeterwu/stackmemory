/**
 * Sweep Prediction Client
 *
 * HTTP client for llama-server's OpenAI-compatible completions API.
 */

import {
  SweepServerConfig,
  SweepPredictInput,
  SweepPredictResult,
  CompletionRequest,
  CompletionResponse,
  SWEEP_STOP_TOKENS,
  DEFAULT_SERVER_CONFIG,
} from './types.js';
import { buildSweepPrompt } from './prompt-builder.js';

export class SweepPredictionClient {
  private config: SweepServerConfig;
  private baseUrl: string;

  constructor(config: Partial<SweepServerConfig> = {}) {
    this.config = { ...DEFAULT_SERVER_CONFIG, ...config };
    this.baseUrl = `http://${this.config.host}:${this.config.port}`;
  }

  /**
   * Check if the server is healthy
   */
  async checkHealth(): Promise<boolean> {
    try {
      const response = await fetch(`${this.baseUrl}/health`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Run a prediction using the Sweep model
   */
  async predict(input: SweepPredictInput): Promise<SweepPredictResult> {
    const startTime = Date.now();

    try {
      // Build the prompt
      const prompt = buildSweepPrompt({
        filePath: input.file_path,
        originalContent: input.original_content || input.current_content,
        currentContent: input.current_content,
        recentDiffs: input.recent_diffs || [],
        contextFiles: input.context_files,
      });

      // Create completion request
      const request: CompletionRequest = {
        model: 'sweep',
        prompt,
        max_tokens: input.max_tokens || 2048,
        temperature: input.temperature || 0.1,
        top_k: input.top_k || 40,
        stop: SWEEP_STOP_TOKENS,
        stream: false,
      };

      // Call the server
      const response = await fetch(`${this.baseUrl}/v1/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(30000),
      });

      if (!response.ok) {
        const errorText = await response.text();
        return {
          success: false,
          error: 'server_error',
          message: `Server returned ${response.status}: ${errorText}`,
        };
      }

      const data = (await response.json()) as CompletionResponse;
      const latencyMs = Date.now() - startTime;

      if (!data.choices || data.choices.length === 0) {
        return {
          success: false,
          error: 'no_choices',
          message: 'Server returned no completion choices',
        };
      }

      const completionText = data.choices[0].text;

      // Check for empty or whitespace-only completion
      if (!completionText || completionText.trim().length === 0) {
        return {
          success: true,
          predicted_content: '',
          file_path: input.file_path,
          latency_ms: latencyMs,
          tokens_generated: 0,
          message: 'No changes predicted',
        };
      }

      return {
        success: true,
        predicted_content: completionText,
        file_path: input.file_path,
        latency_ms: latencyMs,
        tokens_generated: data.usage?.completion_tokens || 0,
      };
    } catch (error) {
      const latencyMs = Date.now() - startTime;

      if (error instanceof Error) {
        if (error.name === 'AbortError' || error.name === 'TimeoutError') {
          return {
            success: false,
            error: 'timeout',
            message: 'Request timed out',
            latency_ms: latencyMs,
          };
        }

        if (error.message.includes('ECONNREFUSED')) {
          return {
            success: false,
            error: 'connection_refused',
            message: 'Server not running. Start with: stackmemory sweep start',
            latency_ms: latencyMs,
          };
        }

        return {
          success: false,
          error: 'request_error',
          message: error.message,
          latency_ms: latencyMs,
        };
      }

      return {
        success: false,
        error: 'unknown_error',
        message: String(error),
        latency_ms: latencyMs,
      };
    }
  }

  /**
   * Get server info
   */
  async getServerInfo(): Promise<Record<string, unknown> | null> {
    try {
      const response = await fetch(`${this.baseUrl}/v1/models`, {
        method: 'GET',
        signal: AbortSignal.timeout(2000),
      });

      if (response.ok) {
        return (await response.json()) as Record<string, unknown>;
      }
      return null;
    } catch {
      return null;
    }
  }
}

/**
 * Create a prediction client with default config
 */
export function createPredictionClient(
  config?: Partial<SweepServerConfig>
): SweepPredictionClient {
  return new SweepPredictionClient(config);
}
