/**
 * DiffMem MCP Tool Handlers
 * Handles user memory management via DiffMem integration
 */

import {
  UserMemory,
  MemoryQuery,
  LearnedInsight,
  DiffMemStatus,
} from '../../diffmem/types.js';
import {
  DiffMemIntegrationConfig,
  DEFAULT_DIFFMEM_CONFIG,
} from '../../diffmem/config.js';
import { logger } from '../../../core/monitoring/logger.js';
import { MCPToolDefinition } from '../tool-definitions.js';

interface MCPResponse {
  content: Array<{ type: string; text: string }>;
  metadata?: Record<string, unknown>;
}

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

export interface DiffMemHandlerDependencies {
  config?: Partial<DiffMemIntegrationConfig>;
}

export class DiffMemHandlers {
  private config: DiffMemIntegrationConfig;
  private cache: Map<string, CacheEntry<unknown>> = new Map();
  private cacheTTL: number = 5 * 60 * 1000; // 5 minutes

  constructor(deps?: DiffMemHandlerDependencies) {
    this.config = { ...DEFAULT_DIFFMEM_CONFIG, ...deps?.config };
  }

  /**
   * Get tool definitions for DiffMem tools
   */
  getToolDefinitions(): MCPToolDefinition[] {
    return [
      {
        name: 'diffmem_get_user_context',
        description:
          'Fetch user knowledge and preferences from memory. Use to personalize responses based on learned user patterns.',
        inputSchema: {
          type: 'object',
          properties: {
            categories: {
              type: 'array',
              items: {
                type: 'string',
                enum: [
                  'preference',
                  'expertise',
                  'project_knowledge',
                  'pattern',
                  'correction',
                ],
              },
              description: 'Filter by memory categories',
            },
            limit: {
              type: 'number',
              default: 10,
              description: 'Maximum memories to return',
            },
          },
        },
      },
      {
        name: 'diffmem_store_learning',
        description:
          'Store a new insight about the user (preference, expertise, pattern, or correction)',
        inputSchema: {
          type: 'object',
          properties: {
            content: {
              type: 'string',
              description: 'The insight to store',
            },
            category: {
              type: 'string',
              enum: [
                'preference',
                'expertise',
                'project_knowledge',
                'pattern',
                'correction',
              ],
              description: 'Category of the insight',
            },
            confidence: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              default: 0.7,
              description: 'Confidence level (0-1)',
            },
            context: {
              type: 'object',
              description: 'Additional context for the insight',
            },
          },
          required: ['content', 'category'],
        },
      },
      {
        name: 'diffmem_search',
        description:
          'Semantic search across user memories. Find relevant past insights and preferences.',
        inputSchema: {
          type: 'object',
          properties: {
            query: {
              type: 'string',
              description: 'Search query',
            },
            timeRange: {
              type: 'string',
              enum: ['day', 'week', 'month', 'all'],
              default: 'all',
              description: 'Time range filter',
            },
            minConfidence: {
              type: 'number',
              minimum: 0,
              maximum: 1,
              default: 0.5,
              description: 'Minimum confidence threshold',
            },
            limit: {
              type: 'number',
              default: 10,
              description: 'Maximum results',
            },
          },
          required: ['query'],
        },
      },
      {
        name: 'diffmem_status',
        description: 'Check DiffMem connection status and memory statistics',
        inputSchema: {
          type: 'object',
          properties: {},
        },
      },
    ];
  }

  /**
   * Fetch user context/memories with optional category filter
   */
  async handleGetUserContext(args: {
    categories?: string[];
    limit?: number;
  }): Promise<MCPResponse> {
    const { categories, limit = 10 } = args;

    try {
      const cacheKey = `context:${JSON.stringify(categories)}:${limit}`;
      const cached = this.getFromCache<UserMemory[]>(cacheKey);

      if (cached) {
        logger.debug('DiffMem cache hit', { cacheKey });
        return this.formatMemoriesResponse(cached, true);
      }

      const query: MemoryQuery = { limit };
      if (categories?.length) {
        query.categories = categories;
      }

      const memories = await this.fetchMemories(query);
      this.setCache(cacheKey, memories);

      return this.formatMemoriesResponse(memories, false);
    } catch (error) {
      return this.handleError('getUserContext', error);
    }
  }

  /**
   * Store a new learning/insight
   */
  async handleStoreLearning(args: {
    content: string;
    category: UserMemory['category'];
    confidence?: number;
    context?: Record<string, unknown>;
  }): Promise<MCPResponse> {
    const { content, category, confidence = 0.7, context } = args;

    if (!content) {
      return {
        content: [{ type: 'text', text: 'Error: content is required' }],
        metadata: { error: true },
      };
    }

    if (!category) {
      return {
        content: [{ type: 'text', text: 'Error: category is required' }],
        metadata: { error: true },
      };
    }

    try {
      const insight: LearnedInsight = {
        content,
        category,
        confidence,
        source: 'stackmemory',
        timestamp: Date.now(),
        context,
      };

      await this.storeInsight(insight);

      // Invalidate relevant cache entries
      this.invalidateCacheByPrefix('context:');

      logger.info('Stored DiffMem insight', { category, confidence });

      return {
        content: [
          {
            type: 'text',
            text: `Stored ${category} insight: "${content.substring(0, 50)}${content.length > 50 ? '...' : ''}"`,
          },
        ],
        metadata: {
          stored: true,
          category,
          confidence,
        },
      };
    } catch (error) {
      return this.handleError('storeLearning', error);
    }
  }

  /**
   * Semantic search across memories
   */
  async handleSearch(args: {
    query: string;
    timeRange?: MemoryQuery['timeRange'];
    minConfidence?: number;
    limit?: number;
  }): Promise<MCPResponse> {
    const { query, timeRange = 'all', minConfidence = 0.5, limit = 10 } = args;

    if (!query) {
      return {
        content: [{ type: 'text', text: 'Error: query is required' }],
        metadata: { error: true },
      };
    }

    try {
      const searchQuery: MemoryQuery = {
        query,
        timeRange,
        minConfidence,
        limit,
      };

      const results = await this.searchMemories(searchQuery);

      if (results.length === 0) {
        return {
          content: [
            {
              type: 'text',
              text: `No memories found matching "${query}"`,
            },
          ],
          metadata: {
            query,
            resultCount: 0,
          },
        };
      }

      const formattedResults = results
        .map(
          (m, i) =>
            `${i + 1}. [${m.category}] ${m.content} (confidence: ${(m.confidence * 100).toFixed(0)}%)`
        )
        .join('\n');

      return {
        content: [
          {
            type: 'text',
            text: `Search results for "${query}":\n${formattedResults}`,
          },
        ],
        metadata: {
          query,
          resultCount: results.length,
          results: results.map((m) => ({
            id: m.id,
            category: m.category,
            confidence: m.confidence,
          })),
        },
      };
    } catch (error) {
      return this.handleError('search', error);
    }
  }

  /**
   * Get DiffMem connection status
   */
  async handleStatus(): Promise<MCPResponse> {
    try {
      const status = await this.getStatus();

      const statusText = status.connected
        ? `DiffMem Status:
- Connected: Yes
- Memories: ${status.memoryCount}
- Last sync: ${status.lastSync ? new Date(status.lastSync).toISOString() : 'Never'}
- Version: ${status.version || 'Unknown'}`
        : `DiffMem Status:
- Connected: No
- Endpoint: ${this.config.endpoint}
- Enabled: ${this.config.enabled}`;

      return {
        content: [{ type: 'text', text: statusText }],
        metadata: status,
      };
    } catch (error) {
      return this.handleError('status', error);
    }
  }

  // Private helper methods

  private formatMemoriesResponse(
    memories: UserMemory[],
    fromCache: boolean
  ): MCPResponse {
    if (memories.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text: 'No user context memories found.',
          },
        ],
        metadata: { fromCache, count: 0 },
      };
    }

    // Group by category
    const byCategory = memories.reduce(
      (acc, m) => {
        if (!acc[m.category]) {
          acc[m.category] = [];
        }
        acc[m.category].push(m);
        return acc;
      },
      {} as Record<string, UserMemory[]>
    );

    const sections = Object.entries(byCategory)
      .map(([category, mems]) => {
        const items = mems
          .map(
            (m) =>
              `  - ${m.content} (${(m.confidence * 100).toFixed(0)}% confidence)`
          )
          .join('\n');
        return `${category.toUpperCase()}:\n${items}`;
      })
      .join('\n\n');

    return {
      content: [
        {
          type: 'text',
          text: `User Context:\n\n${sections}`,
        },
      ],
      metadata: {
        fromCache,
        count: memories.length,
        categories: Object.keys(byCategory),
      },
    };
  }

  private handleError(operation: string, error: unknown): MCPResponse {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const isConnectionError =
      errorMessage.includes('ECONNREFUSED') ||
      errorMessage.includes('fetch failed') ||
      errorMessage.includes('network');

    logger.warn(`DiffMem ${operation} failed`, { error: errorMessage });

    if (isConnectionError) {
      return {
        content: [
          {
            type: 'text',
            text: `DiffMem unavailable (${operation}). Session continues without user memory.`,
          },
        ],
        metadata: {
          error: true,
          unavailable: true,
          operation,
        },
      };
    }

    return {
      content: [
        {
          type: 'text',
          text: `DiffMem ${operation} error: ${errorMessage}`,
        },
      ],
      metadata: {
        error: true,
        operation,
        message: errorMessage,
      },
    };
  }

  private getFromCache<T>(key: string): T | undefined {
    const entry = this.cache.get(key) as CacheEntry<T> | undefined;
    if (!entry) return undefined;

    if (Date.now() - entry.timestamp > this.cacheTTL) {
      this.cache.delete(key);
      return undefined;
    }

    return entry.data;
  }

  private setCache<T>(key: string, data: T): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  private invalidateCacheByPrefix(prefix: string): void {
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  // API interaction methods (with graceful degradation)

  private async fetchMemories(query: MemoryQuery): Promise<UserMemory[]> {
    if (!this.config.enabled) {
      return [];
    }

    const response = await fetch(`${this.config.endpoint}/memories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      throw new Error(`DiffMem API error: ${response.status}`);
    }

    const data = await response.json();
    return data.memories || [];
  }

  private async searchMemories(query: MemoryQuery): Promise<UserMemory[]> {
    if (!this.config.enabled) {
      return [];
    }

    const response = await fetch(`${this.config.endpoint}/search`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(query),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      throw new Error(`DiffMem API error: ${response.status}`);
    }

    const data = await response.json();
    return data.results || [];
  }

  private async storeInsight(insight: LearnedInsight): Promise<void> {
    if (!this.config.enabled) {
      logger.debug('DiffMem disabled, skipping store');
      return;
    }

    const response = await fetch(`${this.config.endpoint}/insights`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(insight),
      signal: AbortSignal.timeout(this.config.timeout),
    });

    if (!response.ok) {
      throw new Error(`DiffMem API error: ${response.status}`);
    }
  }

  private async getStatus(): Promise<DiffMemStatus> {
    if (!this.config.enabled) {
      return {
        connected: false,
        memoryCount: 0,
        lastSync: null,
      };
    }

    try {
      const response = await fetch(`${this.config.endpoint}/status`, {
        method: 'GET',
        signal: AbortSignal.timeout(this.config.timeout),
      });

      if (!response.ok) {
        return {
          connected: false,
          memoryCount: 0,
          lastSync: null,
        };
      }

      return await response.json();
    } catch {
      return {
        connected: false,
        memoryCount: 0,
        lastSync: null,
      };
    }
  }
}
