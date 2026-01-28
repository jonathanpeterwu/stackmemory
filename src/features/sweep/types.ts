/**
 * Sweep Next-Edit Types
 *
 * Types for the Sweep 1.5B model server integration.
 */

export interface SweepServerConfig {
  port: number;
  host: string;
  modelPath: string;
  contextSize: number;
  threads?: number;
  gpuLayers?: number;
}

export interface SweepServerStatus {
  running: boolean;
  pid?: number;
  port?: number;
  host?: string;
  startedAt?: number;
  modelPath?: string;
}

export interface SweepPredictInput {
  file_path: string;
  current_content: string;
  original_content?: string;
  context_files?: Record<string, string>;
  recent_diffs?: DiffEntry[];
  max_tokens?: number;
  temperature?: number;
  top_k?: number;
}

export interface DiffEntry {
  file_path: string;
  original: string;
  updated: string;
  timestamp?: number;
}

export interface SweepPredictResult {
  success: boolean;
  predicted_content?: string;
  file_path?: string;
  latency_ms?: number;
  tokens_generated?: number;
  error?: string;
  message?: string;
}

export interface SweepPromptInput {
  filePath: string;
  originalContent: string;
  currentContent: string;
  recentDiffs: DiffEntry[];
  contextFiles?: Record<string, string>;
}

export interface CompletionRequest {
  model: string;
  prompt: string;
  max_tokens: number;
  temperature: number;
  top_k?: number;
  stop?: string[];
  stream?: boolean;
}

export interface CompletionResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    text: string;
    index: number;
    logprobs: null;
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

export const DEFAULT_SERVER_CONFIG: SweepServerConfig = {
  port: 8766,
  host: '127.0.0.1',
  modelPath: '',
  contextSize: 8192,
  threads: undefined,
  gpuLayers: 0,
};

export const SWEEP_STOP_TOKENS = ['<|file_sep|>', '</s>'];
