import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { AnthropicBatchClient, type BatchRequest } from '../batch-client.js';
import * as fs from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const BATCH_JOBS_PATH = join(homedir(), '.stackmemory', 'batch-jobs.json');

describe('AnthropicBatchClient', () => {
  let client: AnthropicBatchClient;

  beforeEach(() => {
    // Force mock mode regardless of env
    client = new AnthropicBatchClient({ apiKey: '', mockMode: true });
  });

  afterEach(() => {
    // Clean up persisted test jobs
    try {
      if (fs.existsSync(BATCH_JOBS_PATH)) {
        const jobs = JSON.parse(fs.readFileSync(BATCH_JOBS_PATH, 'utf8'));
        const filtered = jobs.filter(
          (j: any) => !j.batchId.startsWith('batch_mock_')
        );
        fs.writeFileSync(BATCH_JOBS_PATH, JSON.stringify(filtered, null, 2));
      }
    } catch {
      // ignore
    }
  });

  describe('mock mode', () => {
    it('should submit and return a mock batch ID', async () => {
      const requests: BatchRequest[] = [
        {
          custom_id: 'req_1',
          params: {
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 100,
            messages: [{ role: 'user', content: 'hello' }],
          },
        },
      ];

      const batchId = await client.submit(requests, 'test batch');
      expect(batchId).toMatch(/^batch_mock_/);
    });

    it('should poll and return ended status', async () => {
      const requests: BatchRequest[] = [
        {
          custom_id: 'req_1',
          params: {
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 100,
            messages: [{ role: 'user', content: 'hello' }],
          },
        },
      ];

      const batchId = await client.submit(requests);
      const job = await client.poll(batchId);

      expect(job.processing_status).toBe('ended');
      expect(job.id).toBe(batchId);
    });

    it('should retrieve mock results', async () => {
      const requests: BatchRequest[] = [
        {
          custom_id: 'req_0',
          params: {
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 100,
            messages: [{ role: 'user', content: 'hello' }],
          },
        },
        {
          custom_id: 'req_1',
          params: {
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 100,
            messages: [{ role: 'user', content: 'world' }],
          },
        },
      ];

      const batchId = await client.submit(requests);
      const results = await client.retrieve(batchId);

      expect(results).toHaveLength(2);
      expect(results[0].result.type).toBe('succeeded');
      expect(results[0].result.message?.content[0].text).toContain(
        'Mock batch response'
      );
    });

    it('should support submitAndWait convenience method', async () => {
      const requests: BatchRequest[] = [
        {
          custom_id: 'req_0',
          params: {
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 100,
            messages: [{ role: 'user', content: 'test' }],
          },
        },
      ];

      const results = await client.submitAndWait(requests, 5000, 'test');
      expect(results).toHaveLength(1);
      expect(results[0].result.type).toBe('succeeded');
    });

    it('should cancel a batch job', async () => {
      const requests: BatchRequest[] = [
        {
          custom_id: 'req_0',
          params: {
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 100,
            messages: [{ role: 'user', content: 'test' }],
          },
        },
      ];

      const batchId = await client.submit(requests);
      const job = await client.cancel(batchId);
      expect(job.processing_status).toBe('canceling');
    });

    it('should list stored jobs', async () => {
      const requests: BatchRequest[] = [
        {
          custom_id: 'req_0',
          params: {
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 100,
            messages: [{ role: 'user', content: 'test' }],
          },
        },
      ];

      const id1 = await client.submit(requests, 'job 1');
      const id2 = await client.submit(requests, 'job 2');

      const jobs = client.listJobs();
      // Both submitted jobs should be in the list
      expect(jobs.some((j) => j.batchId === id1)).toBe(true);
      expect(jobs.some((j) => j.batchId === id2)).toBe(true);
    });
  });

  describe('real API mode (mocked fetch)', () => {
    let realClient: AnthropicBatchClient;

    beforeEach(() => {
      realClient = new AnthropicBatchClient({ apiKey: 'sk-ant-test123' });
    });

    it('should submit via real API', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'batch_abc123',
            type: 'message_batch',
            processing_status: 'in_progress',
            request_counts: {
              processing: 1,
              succeeded: 0,
              errored: 0,
              canceled: 0,
              expired: 0,
            },
            created_at: '2026-01-01T00:00:00Z',
          }),
          { status: 200 }
        )
      );

      const batchId = await realClient.submit([
        {
          custom_id: 'req_0',
          params: {
            model: 'claude-sonnet-4-5-20250929',
            max_tokens: 100,
            messages: [{ role: 'user', content: 'test' }],
          },
        },
      ]);

      expect(batchId).toBe('batch_abc123');

      const [url, opts] = fetchSpy.mock.calls[0];
      expect(url).toContain('/v1/messages/batches');
      expect((opts as any).headers['x-api-key']).toBe('sk-ant-test123');

      fetchSpy.mockRestore();
    });

    it('should throw on submit failure', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockResolvedValueOnce(new Response('Unauthorized', { status: 401 }));

      await expect(
        realClient.submit([
          {
            custom_id: 'req_0',
            params: {
              model: 'claude-sonnet-4-5-20250929',
              max_tokens: 100,
              messages: [{ role: 'user', content: 'test' }],
            },
          },
        ])
      ).rejects.toThrow('Batch submit failed: 401');

      fetchSpy.mockRestore();
    });

    it('should poll batch status', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 'batch_abc123',
            type: 'message_batch',
            processing_status: 'ended',
            request_counts: {
              processing: 0,
              succeeded: 1,
              errored: 0,
              canceled: 0,
              expired: 0,
            },
            created_at: '2026-01-01T00:00:00Z',
            ended_at: '2026-01-01T00:05:00Z',
            results_url: 'https://api.anthropic.com/v1/results/abc',
          }),
          { status: 200 }
        )
      );

      const job = await realClient.poll('batch_abc123');
      expect(job.processing_status).toBe('ended');
      expect(job.request_counts.succeeded).toBe(1);

      fetchSpy.mockRestore();
    });
  });
});
