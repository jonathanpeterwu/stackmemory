/**
 * Graphiti API Client (stub)
 * Wraps Graphiti REST endpoints or MCP tools with simple methods
 */

import type {
  Episode,
  EntityNode,
  RelationEdge,
  TemporalQuery,
  GraphContext,
  GraphitiStatus,
} from './types.js';
import type { GraphitiIntegrationConfig } from './config.js';
import { DEFAULT_GRAPHITI_CONFIG } from './config.js';

export class GraphitiClientError extends Error {
  constructor(
    message: string,
    public readonly code?: string,
    public readonly statusCode?: number
  ) {
    super(message);
    this.name = 'GraphitiClientError';
  }
}

export class GraphitiClient {
  private readonly endpoint: string;
  private readonly timeout: number;
  private readonly maxRetries: number;
  private readonly namespace: string;

  constructor(config: Partial<GraphitiIntegrationConfig> = {}) {
    const merged = { ...DEFAULT_GRAPHITI_CONFIG, ...config };
    this.endpoint = merged.endpoint.replace(/\/$/, '');
    this.timeout = merged.timeoutMs;
    this.maxRetries = merged.maxRetries;
    this.namespace = merged.projectNamespace || 'default';
  }

  private async request<T>(
    path: string,
    options: RequestInit = {}
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    let lastError: Error | undefined;
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      try {
        const res = await fetch(`${this.endpoint}${path}`, {
          ...options,
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            ...(options.headers || {}),
          },
        });
        clearTimeout(timeoutId);
        if (!res.ok) {
          const msg = await res.text().catch(() => res.statusText);
          throw new GraphitiClientError(
            `Request failed: ${msg}`,
            'HTTP_ERROR',
            res.status
          );
        }
        return (await res.json()) as T;
      } catch (err) {
        lastError = err as Error;
        if (err instanceof GraphitiClientError) throw err;
        if ((err as Error).name === 'AbortError') {
          throw new GraphitiClientError('Request timeout', 'TIMEOUT');
        }
        if (attempt < this.maxRetries) {
          await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 100));
          continue;
        }
      }
    }
    clearTimeout(timeoutId);
    throw new GraphitiClientError(
      lastError?.message || 'Network error',
      'NETWORK_ERROR'
    );
  }

  // Episodes
  async upsertEpisode(episode: Episode): Promise<{ id: string }> {
    const payload = { ...episode, namespace: this.namespace };
    const res = await this.request<{ id: string }>(`/episodes`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res;
  }

  // Entities
  async upsertEntities(entities: EntityNode[]): Promise<{ ids: string[] }> {
    const payload = { entities, namespace: this.namespace };
    return this.request<{ ids: string[] }>(`/entities:batchUpsert`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Relations
  async upsertRelations(edges: RelationEdge[]): Promise<{ ids: string[] }> {
    const payload = { edges, namespace: this.namespace };
    return this.request<{ ids: string[] }>(`/relations:batchUpsert`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Temporal query + hybrid retrieval
  async queryTemporal(query: TemporalQuery): Promise<GraphContext> {
    const payload = { ...query, namespace: this.namespace };
    return this.request<GraphContext>(`/query/temporal`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  }

  // Health/status
  async getStatus(): Promise<GraphitiStatus> {
    try {
      return await this.request<GraphitiStatus>(
        `/status?namespace=${encodeURIComponent(this.namespace)}`
      );
    } catch {
      return { connected: false };
    }
  }
}
