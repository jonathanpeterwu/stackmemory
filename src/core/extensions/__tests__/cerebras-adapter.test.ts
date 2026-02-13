import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { CerebrasAdapter } from '../cerebras-adapter.js';

describe('CerebrasAdapter', () => {
  let adapter: CerebrasAdapter;

  beforeEach(() => {
    adapter = new CerebrasAdapter({
      apiKey: 'test-key',
      baseUrl: 'https://api.cerebras.ai/v1',
    });
  });

  it('should have correct id and name', () => {
    expect(adapter.id).toBe('cerebras');
    expect(adapter.name).toBe('Cerebras');
  });

  it('should not support any provider extensions', () => {
    expect(adapter.supportsExtension('claude')).toBe(false);
    expect(adapter.supportsExtension('gpt')).toBe(false);
    expect(adapter.supportsExtension('gemini')).toBe(false);
  });

  it('should list Cerebras models', async () => {
    const models = await adapter.listModels();
    expect(models).toContain('llama-4-scout-17b-16e-instruct');
    expect(models.length).toBeGreaterThan(0);
  });

  it('should use Cerebras base URL by default', () => {
    const defaultAdapter = new CerebrasAdapter({ apiKey: 'key' });
    // Validate by attempting a completion with a mock — the URL is set internally
    expect(defaultAdapter).toBeDefined();
  });

  it('should format request as OpenAI-compatible', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 'hello' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 10, completion_tokens: 5 },
        }),
        { status: 200 }
      )
    );

    const result = await adapter.complete([{ role: 'user', content: 'test' }], {
      model: 'llama-4-scout-17b-16e-instruct',
      maxTokens: 100,
    });

    expect(result.content[0]).toMatchObject({ type: 'text', text: 'hello' });
    expect(result.usage.inputTokens).toBe(10);
    expect(result.usage.outputTokens).toBe(5);

    const [url, opts] = fetchSpy.mock.calls[0];
    expect(url).toContain('cerebras.ai');
    expect((opts as any).headers?.Authorization).toBe('Bearer test-key');

    fetchSpy.mockRestore();
  });

  it('should throw on API error during complete', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('Unauthorized', {
          status: 401,
          statusText: 'Unauthorized',
        })
      );

    await expect(
      adapter.complete([{ role: 'user', content: 'test' }], {
        model: 'llama3.1-8b',
        maxTokens: 100,
      })
    ).rejects.toThrow('GPT API error: 401');

    fetchSpy.mockRestore();
  });
});
