/**
 * Linear REST Client for StackMemory
 * Provides memory-based task storage using REST API instead of GraphQL
 */

import { logger } from '../../core/monitoring/logger.js';
import { IntegrationError, ErrorCode } from '../../core/errors/index.js';

export interface LinearTask {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  state: {
    name: string;
    type: string;
  };
  priority: number;
  assignee?: {
    id: string;
    name: string;
  };
  estimate?: number;
  createdAt: string;
  updatedAt: string;
  url: string;
}

export interface LinearTasksResponse {
  data: {
    issues: {
      nodes: LinearTask[];
      pageInfo: {
        hasNextPage: boolean;
        endCursor?: string;
      };
    };
  };
}

export class LinearRestClient {
  private apiKey: string;
  private baseUrl = 'https://api.linear.app/graphql';
  private taskCache = new Map<string, LinearTask>();
  private lastSync = 0;
  private cacheTTL = 5 * 60 * 1000; // 5 minutes

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Get all tasks and store in memory
   */
  async getAllTasks(forceRefresh = false): Promise<LinearTask[]> {
    const now = Date.now();

    // Return cached data if fresh
    if (
      !forceRefresh &&
      now - this.lastSync < this.cacheTTL &&
      this.taskCache.size > 0
    ) {
      return Array.from(this.taskCache.values());
    }

    try {
      const allTasks: LinearTask[] = [];
      let hasNextPage = true;
      let cursor: string | undefined;

      while (hasNextPage) {
        const query = `
          query($after: String) {
            issues(
              filter: { team: { key: { eq: "ENG" } } }
              first: 100
              after: $after
            ) {
              nodes {
                id
                identifier
                title
                description
                state {
                  name
                  type
                }
                priority
                assignee {
                  id
                  name
                }
                estimate
                createdAt
                updatedAt
                url
              }
              pageInfo {
                hasNextPage
                endCursor
              }
            }
          }
        `;

        const variables = cursor ? { after: cursor } : {};
        const response = await this.makeRequest<LinearTasksResponse>(
          query,
          variables
        );

        const tasks = response.data.issues.nodes;
        allTasks.push(...tasks);

        // Update cache
        tasks.forEach((task) => {
          this.taskCache.set(task.id, task);
        });

        hasNextPage = response.data.issues.pageInfo.hasNextPage;
        cursor = response.data.issues.pageInfo.endCursor;

        logger.info(`Fetched ${tasks.length} tasks, total: ${allTasks.length}`);
      }

      this.lastSync = now;
      logger.info(`Cached ${allTasks.length} Linear tasks in memory`);

      return allTasks;
    } catch (error: unknown) {
      logger.error('Failed to fetch Linear tasks:', error as Error);
      return Array.from(this.taskCache.values()); // Return cached data on error
    }
  }

  /**
   * Get tasks by status
   */
  async getTasksByStatus(status: string): Promise<LinearTask[]> {
    const tasks = await this.getAllTasks();
    return tasks.filter((task: any) => task.state.type === status);
  }

  /**
   * Get tasks assigned to current user
   */
  async getMyTasks(): Promise<LinearTask[]> {
    try {
      const viewer = await this.getViewer();
      const tasks = await this.getAllTasks();
      return tasks.filter((task: any) => task.assignee?.id === viewer.id);
    } catch (error: unknown) {
      logger.error('Failed to get assigned tasks:', error as Error);
      return [];
    }
  }

  /**
   * Get task count by status
   */
  async getTaskCounts(): Promise<Record<string, number>> {
    const tasks = await this.getAllTasks();
    const counts: Record<string, number> = {};

    tasks.forEach((task) => {
      const status = task.state.type;
      counts[status] = (counts[status] || 0) + 1;
    });

    return counts;
  }

  /**
   * Search tasks by title or description
   */
  async searchTasks(query: string): Promise<LinearTask[]> {
    const tasks = await this.getAllTasks();
    const searchTerm = query.toLowerCase();

    return tasks.filter(
      (task: any) =>
        task.title.toLowerCase().includes(searchTerm) ||
        task.description?.toLowerCase().includes(searchTerm) ||
        task.identifier.toLowerCase().includes(searchTerm)
    );
  }

  /**
   * Get current viewer info
   */
  async getViewer(): Promise<{ id: string; name: string; email: string }> {
    const query = `
      query {
        viewer {
          id
          name
          email
        }
      }
    `;

    const response = await this.makeRequest<{
      data: {
        viewer: { id: string; name: string; email: string };
      };
    }>(query);

    return response.data.viewer;
  }

  /**
   * Get team info
   */
  async getTeam(): Promise<{ id: string; name: string; key: string }> {
    const query = `
      query {
        teams(filter: { key: { eq: "ENG" } }, first: 1) {
          nodes {
            id
            name
            key
          }
        }
      }
    `;

    const response = await this.makeRequest<{
      data: {
        teams: {
          nodes: Array<{ id: string; name: string; key: string }>;
        };
      };
    }>(query);

    if (response.data.teams.nodes.length === 0) {
      throw new IntegrationError(
        'ENG team not found',
        ErrorCode.LINEAR_API_ERROR
      );
    }

    return response.data.teams.nodes[0]!;
  }

  /**
   * Get cache stats
   */
  getCacheStats(): {
    size: number;
    lastSync: number;
    age: number;
    fresh: boolean;
  } {
    const now = Date.now();
    return {
      size: this.taskCache.size,
      lastSync: this.lastSync,
      age: now - this.lastSync,
      fresh: now - this.lastSync < this.cacheTTL,
    };
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.taskCache.clear();
    this.lastSync = 0;
    logger.info('Linear task cache cleared');
  }

  /**
   * Make GraphQL request
   */
  async makeRequest<T>(
    query: string,
    variables: Record<string, unknown> = {}
  ): Promise<T> {
    const response = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        Authorization: this.apiKey,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query, variables }),
    });

    const result = (await response.json()) as {
      data?: unknown;
      errors?: Array<{ message: string }>;
    };

    if (!response.ok || result.errors) {
      const errorMsg =
        result.errors?.[0]?.message ||
        `${response.status} ${response.statusText}`;
      throw new IntegrationError(
        `Linear API error: ${errorMsg}`,
        ErrorCode.LINEAR_API_ERROR
      );
    }

    return result as T;
  }
}
