/**
 * Integration test: embedding provider → ContextRetriever → hybrid search
 * Verifies the full query-side wiring without requiring sqlite-vec.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SQLiteAdapter } from '../sqlite-adapter.js';
import { ContextRetriever } from '../../retrieval/context-retriever.js';
import type { EmbeddingProvider } from '../embedding-provider.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

function createMockProvider(dimension = 384): EmbeddingProvider {
  return {
    dimension,
    embed: vi.fn(async (_text: string) =>
      Array.from({ length: dimension }, (_, i) => (i % 10) / 10)
    ),
    embedBatch: vi.fn(async (texts: string[]) =>
      texts.map(() =>
        Array.from({ length: dimension }, (_, i) => (i % 10) / 10)
      )
    ),
  };
}

describe('Embedding Integration', () => {
  let adapter: SQLiteAdapter;
  let dbPath: string;
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackmemory-embed-'));
    dbPath = path.join(tmpDir, 'test.db');
  });

  afterEach(async () => {
    await adapter?.disconnect();
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  it('should expose embedding provider via getEmbeddingProvider()', async () => {
    const provider = createMockProvider();
    adapter = new SQLiteAdapter('test', {
      dbPath,
      embeddingProvider: provider,
    });
    await adapter.connect();

    expect(adapter.getEmbeddingProvider()).toBe(provider);
  });

  it('should return undefined when no provider configured', async () => {
    adapter = new SQLiteAdapter('test', { dbPath });
    await adapter.connect();

    expect(adapter.getEmbeddingProvider()).toBeUndefined();
  });

  it('should auto-detect provider from adapter in ContextRetriever', async () => {
    const provider = createMockProvider();
    adapter = new SQLiteAdapter('test', {
      dbPath,
      embeddingProvider: provider,
    });
    await adapter.connect();
    await adapter.initializeSchema();

    // Create a frame to search for
    await adapter.createFrame({
      run_id: 'run-1',
      project_id: 'test',
      type: 'task',
      name: 'authentication login flow',
      digest_text: 'handles user authentication and session management',
      inputs: { action: 'login' },
    });

    const retriever = new ContextRetriever(adapter);
    const result = await retriever.retrieveContext({
      text: 'authentication',
      type: 'hybrid',
      maxResults: 5,
    });

    // With hybrid strategy, if no vec results, falls back to text search
    // The important thing: embed() was called for the query
    expect(provider.embed).toHaveBeenCalledWith('authentication');
    expect(result.contexts.length).toBeGreaterThan(0);
    expect(result.contexts[0].frame.name).toBe('authentication login flow');
  });

  it('should fall back to text search when provider returns empty embedding', async () => {
    const emptyProvider: EmbeddingProvider = {
      dimension: 0,
      embed: vi.fn(async () => []),
      embedBatch: vi.fn(async () => []),
    };

    adapter = new SQLiteAdapter('test', {
      dbPath,
      embeddingProvider: emptyProvider,
    });
    await adapter.connect();
    await adapter.initializeSchema();

    await adapter.createFrame({
      run_id: 'run-1',
      project_id: 'test',
      type: 'task',
      name: 'database migration script',
      digest_text: 'runs database schema migrations',
      inputs: {},
    });

    const retriever = new ContextRetriever(adapter);
    const result = await retriever.retrieveContext({
      text: 'migration',
      type: 'hybrid',
      maxResults: 5,
    });

    // Should still return text results even with empty embeddings
    expect(result.contexts.length).toBeGreaterThan(0);
    expect(result.contexts[0].frame.name).toBe('database migration script');
  });

  it('should pass explicit provider to ContextRetriever over adapter provider', async () => {
    const adapterProvider = createMockProvider();
    const explicitProvider = createMockProvider();

    adapter = new SQLiteAdapter('test', {
      dbPath,
      embeddingProvider: adapterProvider,
    });
    await adapter.connect();
    await adapter.initializeSchema();

    await adapter.createFrame({
      run_id: 'run-1',
      project_id: 'test',
      type: 'task',
      name: 'test frame',
      digest_text: 'test content',
      inputs: {},
    });

    const retriever = new ContextRetriever(adapter, explicitProvider);
    await retriever.retrieveContext({
      text: 'test',
      type: 'hybrid',
      maxResults: 5,
    });

    expect(explicitProvider.embed).toHaveBeenCalled();
    expect(adapterProvider.embed).not.toHaveBeenCalled();
  });
});
