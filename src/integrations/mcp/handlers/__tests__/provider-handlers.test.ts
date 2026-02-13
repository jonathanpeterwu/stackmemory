import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ProviderHandlers } from '../provider-handlers.js';

// Mock feature flags
vi.mock('../../../../core/config/feature-flags.js', () => ({
  isFeatureEnabled: vi.fn((flag: string) => {
    if (flag === 'multiProvider') return true;
    return false;
  }),
}));

// Mock getOptimalProvider
vi.mock('../../../../core/models/model-router.js', async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    getOptimalProvider: vi.fn(() => ({
      provider: 'deepinfra',
      model: 'THUDM/glm-4-9b-chat',
      apiKeyEnv: 'DEEPINFRA_API_KEY',
      baseUrl: 'https://api.deepinfra.com/v1/openai',
    })),
  };
});

// Mock AnthropicBatchClient to force mock mode
vi.mock('../../../anthropic/batch-client.js', async (importOriginal) => {
  const original = (await importOriginal()) as any;
  return {
    ...original,
    AnthropicBatchClient: class MockBatchClient
      extends original.AnthropicBatchClient
    {
      constructor(config?: any) {
        super({ ...config, mockMode: true });
      }
    },
  };
});

describe('ProviderHandlers', () => {
  let handlers: ProviderHandlers;
  const originalEnv = process.env;

  beforeEach(() => {
    handlers = new ProviderHandlers();
    process.env = { ...originalEnv, DEEPINFRA_API_KEY: 'test-key' };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  describe('handleDelegateToModel', () => {
    it('should route to optimal provider and return result', async () => {
      const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            choices: [
              { message: { content: 'test response' }, finish_reason: 'stop' },
            ],
            usage: { prompt_tokens: 10, completion_tokens: 5 },
          }),
          { status: 200 }
        )
      );

      const result = await handlers.handleDelegateToModel({
        prompt: 'Hello',
        taskType: 'linting',
      });

      expect(result.content[0].type).toBe('text');
      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.provider).toBe('deepinfra');
      expect(parsed.response).toBe('test response');

      fetchSpy.mockRestore();
    });

    it('should return structured error when API key is missing', async () => {
      delete process.env['DEEPINFRA_API_KEY'];

      const result = await handlers.handleDelegateToModel({
        prompt: 'Hello',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.errorType).toBe('missing_api_key');
      expect(parsed.recommendation).toBeDefined();
      expect(parsed.provider).toBe('deepinfra');
    });

    it('should return structured error on API failure', async () => {
      const fetchSpy = vi
        .spyOn(globalThis, 'fetch')
        .mockRejectedValueOnce(new Error('Network error'));

      const result = await handlers.handleDelegateToModel({
        prompt: 'Hello',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.errorType).toBe('api_error');
      expect(parsed.message).toContain('Network error');
      expect(parsed.recommendation).toBeDefined();

      fetchSpy.mockRestore();
    });
  });

  describe('handleBatchSubmit', () => {
    it('should submit batch and return batchId', async () => {
      // Mock mode (no ANTHROPIC_API_KEY)
      const result = await handlers.handleBatchSubmit({
        prompts: [
          { id: 'req_0', prompt: 'Hello' },
          { id: 'req_1', prompt: 'World' },
        ],
        description: 'test batch',
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.batchId).toMatch(/^batch_mock_/);
      expect(parsed.requestCount).toBe(2);
    });
  });

  describe('handleBatchCheck', () => {
    it('should check batch status', async () => {
      // Submit first
      const submitResult = await handlers.handleBatchSubmit({
        prompts: [{ id: 'req_0', prompt: 'Hello' }],
      });
      const { batchId } = JSON.parse(submitResult.content[0].text);

      const result = await handlers.handleBatchCheck({
        batchId,
        retrieve: false,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.status).toBe('ended');
    });

    it('should retrieve results when requested', async () => {
      const submitResult = await handlers.handleBatchSubmit({
        prompts: [{ id: 'req_0', prompt: 'Hello' }],
      });
      const { batchId } = JSON.parse(submitResult.content[0].text);

      const result = await handlers.handleBatchCheck({
        batchId,
        retrieve: true,
      });

      const parsed = JSON.parse(result.content[0].text);
      expect(parsed.results).toBeDefined();
      expect(parsed.results.length).toBeGreaterThan(0);
    });
  });
});

describe('ProviderHandlers (multiProvider disabled)', () => {
  it('should return disabled message when flag is off', async () => {
    const { isFeatureEnabled } =
      await import('../../../../core/config/feature-flags.js');
    (isFeatureEnabled as any).mockReturnValue(false);

    const handlers = new ProviderHandlers();

    const result = await handlers.handleDelegateToModel({
      prompt: 'Hello',
    });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.errorType).toBe('feature_disabled');
    expect(parsed.recommendation).toContain('STACKMEMORY_MULTI_PROVIDER');
    (isFeatureEnabled as any).mockReturnValue(true);
  });
});
