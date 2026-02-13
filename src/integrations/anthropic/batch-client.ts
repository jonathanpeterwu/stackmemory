/**
 * Anthropic Batch API Client
 *
 * Submit, poll, and retrieve batch jobs at 50% discount.
 * Job state persisted to ~/.stackmemory/batch-jobs.json for cross-session tracking.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { logger } from '../../core/monitoring/logger.js';

export interface BatchRequest {
  custom_id: string;
  params: {
    model: string;
    max_tokens: number;
    messages: Array<{ role: string; content: string }>;
    system?: string;
  };
}

export type BatchJobStatus = 'in_progress' | 'canceling' | 'ended';

export interface BatchJob {
  id: string;
  type: 'message_batch';
  processing_status: BatchJobStatus;
  request_counts: {
    processing: number;
    succeeded: number;
    errored: number;
    canceled: number;
    expired: number;
  };
  created_at: string;
  ended_at?: string;
  expires_at?: string;
  results_url?: string;
}

export interface BatchResultItem {
  custom_id: string;
  result: {
    type: 'succeeded' | 'errored' | 'canceled' | 'expired';
    message?: {
      id: string;
      content: Array<{ type: string; text?: string }>;
      model: string;
      stop_reason: string;
      usage: { input_tokens: number; output_tokens: number };
    };
    error?: { type: string; message: string };
  };
}

interface StoredBatchJob {
  batchId: string;
  status: BatchJobStatus;
  createdAt: string;
  endedAt?: string;
  requestCount: number;
  description?: string;
}

const BATCH_JOBS_PATH = join(homedir(), '.stackmemory', 'batch-jobs.json');
const DEFAULT_POLL_INTERVAL_MS = 30_000;
const DEFAULT_TIMEOUT_MS = 2 * 60 * 60 * 1000; // 2 hours

export class AnthropicBatchClient {
  private apiKey: string;
  private baseUrl: string;
  private mockMode: boolean;

  constructor(config?: {
    apiKey?: string;
    baseUrl?: string;
    mockMode?: boolean;
  }) {
    this.apiKey =
      config?.apiKey !== undefined
        ? config.apiKey
        : process.env['ANTHROPIC_API_KEY'] || '';
    this.baseUrl = config?.baseUrl || 'https://api.anthropic.com';
    this.mockMode = config?.mockMode ?? !this.apiKey;

    if (this.mockMode) {
      logger.warn('AnthropicBatchClient: no API key, using mock mode');
    }
  }

  /**
   * Submit a batch of requests
   */
  async submit(
    requests: BatchRequest[],
    description?: string
  ): Promise<string> {
    if (this.mockMode) {
      const batchId = `batch_mock_${Date.now()}`;
      this.persistJob({
        batchId,
        status: 'ended',
        createdAt: new Date().toISOString(),
        endedAt: new Date().toISOString(),
        requestCount: requests.length,
        description,
      });
      return batchId;
    }

    const response = await fetch(`${this.baseUrl}/v1/messages/batches`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({ requests }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Batch submit failed: ${response.status} ${errText}`);
    }

    const job = (await response.json()) as BatchJob;

    this.persistJob({
      batchId: job.id,
      status: job.processing_status,
      createdAt: job.created_at,
      requestCount: requests.length,
      description,
    });

    logger.info('Batch submitted', { batchId: job.id, count: requests.length });
    return job.id;
  }

  /**
   * Poll batch job status
   */
  async poll(batchId: string): Promise<BatchJob> {
    if (this.mockMode) {
      return this.mockBatchJob(batchId);
    }

    const response = await fetch(
      `${this.baseUrl}/v1/messages/batches/${batchId}`,
      {
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
      }
    );

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Batch poll failed: ${response.status} ${errText}`);
    }

    const job = (await response.json()) as BatchJob;

    this.updateJobStatus(batchId, job.processing_status, job.ended_at);
    return job;
  }

  /**
   * Retrieve batch results
   */
  async retrieve(batchId: string): Promise<BatchResultItem[]> {
    if (this.mockMode) {
      return this.mockBatchResults(batchId);
    }

    const job = await this.poll(batchId);
    if (job.processing_status !== 'ended') {
      throw new Error(
        `Batch ${batchId} not finished: ${job.processing_status}`
      );
    }

    if (!job.results_url) {
      throw new Error(`Batch ${batchId} has no results URL`);
    }

    const response = await fetch(job.results_url, {
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
      },
    });

    if (!response.ok) {
      throw new Error(`Batch retrieve failed: ${response.status}`);
    }

    // Results come as JSONL
    const text = await response.text();
    return text
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line) as BatchResultItem);
  }

  /**
   * Poll until batch completes or times out
   */
  async waitForCompletion(
    batchId: string,
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    pollIntervalMs: number = DEFAULT_POLL_INTERVAL_MS
  ): Promise<BatchJob> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const job = await this.poll(batchId);

      if (job.processing_status === 'ended') {
        return job;
      }

      const remaining = deadline - Date.now();
      const waitTime = Math.min(pollIntervalMs, remaining);
      if (waitTime <= 0) break;

      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => resolve(), waitTime);
        // Prevent timer from keeping the process alive
        if (typeof timer === 'object' && 'unref' in timer) {
          timer.unref();
        }
      });
    }

    throw new Error(`Batch ${batchId} timed out after ${timeoutMs}ms`);
  }

  /**
   * Submit and wait for results (convenience)
   */
  async submitAndWait(
    requests: BatchRequest[],
    timeoutMs: number = DEFAULT_TIMEOUT_MS,
    description?: string
  ): Promise<BatchResultItem[]> {
    const batchId = await this.submit(requests, description);
    await this.waitForCompletion(batchId, timeoutMs);
    return this.retrieve(batchId);
  }

  /**
   * Cancel a batch job
   */
  async cancel(batchId: string): Promise<BatchJob> {
    if (this.mockMode) {
      return this.mockBatchJob(batchId, 'canceling');
    }

    const response = await fetch(
      `${this.baseUrl}/v1/messages/batches/${batchId}/cancel`,
      {
        method: 'POST',
        headers: {
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Batch cancel failed: ${response.status}`);
    }

    const job = (await response.json()) as BatchJob;
    this.updateJobStatus(batchId, job.processing_status);
    return job;
  }

  /**
   * List stored batch jobs
   */
  listJobs(): StoredBatchJob[] {
    return this.loadStoredJobs();
  }

  // ── Persistence ───────────────────────────────────────────────────────

  private persistJob(job: StoredBatchJob): void {
    const jobs = this.loadStoredJobs();
    const existing = jobs.findIndex((j) => j.batchId === job.batchId);
    if (existing >= 0) {
      jobs[existing] = job;
    } else {
      jobs.push(job);
    }
    // Keep last 50 jobs
    const trimmed = jobs.slice(-50);
    this.saveStoredJobs(trimmed);
  }

  private updateJobStatus(
    batchId: string,
    status: BatchJobStatus,
    endedAt?: string
  ): void {
    const jobs = this.loadStoredJobs();
    const job = jobs.find((j) => j.batchId === batchId);
    if (job) {
      job.status = status;
      if (endedAt) job.endedAt = endedAt;
      this.saveStoredJobs(jobs);
    }
  }

  private loadStoredJobs(): StoredBatchJob[] {
    try {
      if (existsSync(BATCH_JOBS_PATH)) {
        return JSON.parse(readFileSync(BATCH_JOBS_PATH, 'utf8'));
      }
    } catch {
      // Corrupt file, start fresh
    }
    return [];
  }

  private saveStoredJobs(jobs: StoredBatchJob[]): void {
    try {
      const dir = join(homedir(), '.stackmemory');
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true });
      }
      writeFileSync(BATCH_JOBS_PATH, JSON.stringify(jobs, null, 2));
    } catch {
      // Best-effort persistence
    }
  }

  // ── Mock mode ─────────────────────────────────────────────────────────

  private mockBatchJob(
    batchId: string,
    status: BatchJobStatus = 'ended'
  ): BatchJob {
    return {
      id: batchId,
      type: 'message_batch',
      processing_status: status,
      request_counts: {
        processing: 0,
        succeeded: 1,
        errored: 0,
        canceled: 0,
        expired: 0,
      },
      created_at: new Date().toISOString(),
      ended_at: status === 'ended' ? new Date().toISOString() : undefined,
    };
  }

  private mockBatchResults(batchId: string): BatchResultItem[] {
    const jobs = this.loadStoredJobs();
    const job = jobs.find((j) => j.batchId === batchId);
    const count = job?.requestCount || 1;

    return Array.from({ length: count }, (_, i) => ({
      custom_id: `req_${i}`,
      result: {
        type: 'succeeded' as const,
        message: {
          id: `msg_mock_${i}`,
          content: [
            { type: 'text', text: `Mock batch response for request ${i}` },
          ],
          model: 'claude-sonnet-4-5-20250929',
          stop_reason: 'end_turn',
          usage: { input_tokens: 100, output_tokens: 50 },
        },
      },
    }));
  }
}
