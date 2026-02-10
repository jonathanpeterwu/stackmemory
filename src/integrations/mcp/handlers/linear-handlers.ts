/**
 * Linear integration MCP tool handlers
 * Handles Linear sync, task updates, and status queries
 */

import { LinearAuthManager } from '../../linear/auth.js';
import { LinearSyncEngine, DEFAULT_SYNC_CONFIG } from '../../linear/sync.js';
import { LinearTaskManager } from '../../../features/tasks/linear-task-manager.js';
import { logger } from '../../../core/monitoring/logger.js';

export interface LinearHandlerDependencies {
  linearAuthManager: LinearAuthManager;
  linearSync: LinearSyncEngine;
  taskStore: LinearTaskManager;
}

export class LinearHandlers {
  constructor(private deps: LinearHandlerDependencies) {}

  /**
   * Sync tasks with Linear
   */
  async handleLinearSync(args: any): Promise<any> {
    try {
      const { direction = 'both', force = false } = args;

      // Check auth first
      try {
        await this.deps.linearAuthManager.getValidToken();
      } catch {
        return {
          content: [
            {
              type: 'text',
              text: 'Linear auth required. Please run: stackmemory linear setup',
            },
          ],
          metadata: {
            authRequired: true,
          },
        };
      }

      logger.info('Starting Linear sync', { direction, force });

      const result = await this.deps.linearSync.sync();

      const syncText = `Linear Sync Complete:
- To Linear: ${result.synced.toLinear} tasks
- From Linear: ${result.synced.fromLinear} tasks  
- Updated: ${result.synced.updated} tasks
- Errors: ${result.errors.length}`;

      return {
        content: [
          {
            type: 'text',
            text: syncText,
          },
        ],
        metadata: result,
      };
    } catch (error: unknown) {
      logger.error(
        'Linear sync failed',
        error instanceof Error ? error : new Error(String(error))
      );

      const errorMessage =
        error instanceof Error ? error.message : String(error);
      if (
        errorMessage?.includes('unauthorized') ||
        errorMessage?.includes('auth')
      ) {
        return {
          content: [
            {
              type: 'text',
              text: 'Linear authentication failed. Please run: stackmemory linear setup',
            },
          ],
          metadata: {
            authError: true,
          },
        };
      }

      throw error;
    }
  }

  /**
   * Update Linear task status
   */
  async handleLinearUpdateTask(args: any): Promise<any> {
    try {
      const { linear_id, status, assignee_id, priority, labels } = args;

      if (!linear_id) {
        throw new Error('Linear ID is required');
      }

      try {
        await this.deps.linearAuthManager.getValidToken();
      } catch {
        throw new Error('Linear authentication required');
      }

      const updateData: any = {};

      if (status) {
        updateData.status = status;
      }

      if (assignee_id) {
        updateData.assigneeId = assignee_id;
      }

      if (priority) {
        updateData.priority = priority;
      }

      if (labels) {
        updateData.labels = Array.isArray(labels) ? labels : [labels];
      }

      throw new Error(
        'Linear issue updates via MCP are not yet implemented. Use `stackmemory linear sync` instead.'
      );
    } catch (error: unknown) {
      logger.error(
        'Error updating Linear task',
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Get tasks from Linear
   */
  async handleLinearGetTasks(args: any): Promise<any> {
    try {
      const {
        team_id,
        assignee_id,
        state = 'active',
        limit = 20,
        search,
      } = args;

      try {
        await this.deps.linearAuthManager.getValidToken();
      } catch {
        throw new Error('Linear authentication required');
      }

      const filters: any = {
        limit,
      };

      if (team_id) {
        filters.teamId = team_id;
      }

      if (assignee_id) {
        filters.assigneeId = assignee_id;
      }

      if (state) {
        filters.state = state;
      }

      if (search) {
        filters.search = search;
      }

      throw new Error(
        'Linear issue listing via MCP is not yet implemented. Use `stackmemory linear sync` instead.'
      );
    } catch (error: unknown) {
      logger.error(
        'Error getting Linear tasks',
        error instanceof Error ? error : new Error(String(error))
      );
      throw error;
    }
  }

  /**
   * Get Linear integration status
   */
  async handleLinearStatus(args: any): Promise<any> {
    try {
      let authStatus = false;
      try {
        await this.deps.linearAuthManager.getValidToken();
        authStatus = true;
      } catch {
        authStatus = false;
      }

      if (!authStatus) {
        return {
          content: [
            {
              type: 'text',
              text: 'Linear: Not connected\nRun: stackmemory linear setup',
            },
          ],
          metadata: {
            connected: false,
            authRequired: true,
          },
        };
      }

      // Get basic Linear info
      const statusText =
        'Linear Integration Status:\n✓ Connected (authenticated)\n\nUse `stackmemory linear sync` for full sync details.';

      return {
        content: [
          {
            type: 'text',
            text: statusText,
          },
        ],
        metadata: {
          connected: true,
        },
      };
    } catch (error: unknown) {
      logger.error(
        'Error getting Linear status',
        error instanceof Error ? error : new Error(String(error))
      );

      return {
        content: [
          {
            type: 'text',
            text: 'Linear: Connection error - please check auth',
          },
        ],
        metadata: {
          connected: false,
          error: error instanceof Error ? error.message : String(error),
        },
      };
    }
  }
}
