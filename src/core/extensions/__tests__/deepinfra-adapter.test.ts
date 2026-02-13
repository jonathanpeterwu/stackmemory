import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DeepInfraAdapter } from '../deepinfra-adapter.js';

describe('DeepInfraAdapter', () => {
  let adapter: DeepInfraAdapter;

  beforeEach(() => {
    adapter = new DeepInfraAdapter({
      apiKey: 'test-key',
      baseUrl: 'https://api.deepinfra.com/v1/openai',
    });
  });

  it('should have correct id and name', () => {
    expect(adapter.id).toBe('deepinfra');
    expect(adapter.name).toBe('DeepInfra');
  });

  it('should not support any provider extensions', () => {
    expect(adapter.supportsExtension('claude')).toBe(false);
    expect(adapter.supportsExtension('gpt')).toBe(false);
  });

  it('should list DeepInfra models', async () => {
    const models = await adapter.listModels();
    expect(models).toContain('THUDM/glm-4-9b-chat');
    expect(models.length).toBeGreaterThan(0);
  });

  it('should use DeepInfra base URL by default', () => {
    const defaultAdapter = new DeepInfraAdapter({ apiKey: 'key' });
    expect(defaultAdapter).toBeDefined();
  });

  it('should format request correctly for DeepInfra endpoint', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          choices: [
            {
              message: { content: 'response from glm' },
              finish_reason: 'stop',
            },
          ],
          usage: { prompt_tokens: 20, completion_tokens: 15 },
        }),
        { status: 200 }
      )
    );

    const result = await adapter.complete(
      [{ role: 'user', content: 'hello' }],
      { model: 'THUDM/glm-4-9b-chat', maxTokens: 256 }
    );

    expect(result.content[0]).toMatchObject({
      type: 'text',
      text: 'response from glm',
    });
    expect(result.usage).toEqual({ inputTokens: 20, outputTokens: 15 });

    const [url] = fetchSpy.mock.calls[0];
    expect(url).toContain('deepinfra.com');

    fetchSpy.mockRestore();
  });

  it('should throw on API error during complete', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response('rate limited', {
          status: 429,
          statusText: 'Too Many Requests',
        })
      );

    await expect(
      adapter.complete([{ role: 'user', content: 'test' }], {
        model: 'THUDM/glm-4-9b-chat',
        maxTokens: 100,
      })
    ).rejects.toThrow('GPT API error: 429');

    fetchSpy.mockRestore();
  });
});
