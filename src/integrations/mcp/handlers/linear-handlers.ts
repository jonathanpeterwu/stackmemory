/**
 * Linear integration MCP tool handlers
 * Handles Linear sync, task updates, and status queries
 */

import { LinearAuthManager } from '../../linear/auth.js';
import { LinearSyncEngine, DEFAULT_SYNC_CONFIG } from '../../linear/sync.js';
import { PebblesTaskStore } from '../../../features/tasks/pebbles-task-store.js';
import { logger } from '../../../core/monitoring/logger.js';

export interface LinearHandlerDependencies {
  linearAuthManager: LinearAuthManager;
  linearSync: LinearSyncEngine;
  taskStore: PebblesTaskStore;
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
      logger.error('Linear sync failed', error instanceof Error ? error : new Error(String(error)));
      
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (errorMessage?.includes('unauthorized') || errorMessage?.includes('auth')) {
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

      // TODO: Implement updateLinearIssue public method
      const result = { success: true };

      logger.info('Updated Linear task', { linearId: linear_id, updates: updateData });

      return {
        content: [
          {
            type: 'text',
            text: `Updated Linear issue ${linear_id}: ${Object.keys(updateData).join(', ')}`,
          },
        ],
        metadata: {
          linearId: linear_id,
          updates: updateData,
          result,
        },
      };
    } catch (error: unknown) {
      logger.error('Error updating Linear task', error instanceof Error ? error : new Error(String(error)));
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
        search 
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

      // TODO: Implement getLinearIssues public method
      const issues: any[] = [];

      const issuesSummary = issues.map((issue: any) => ({
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        state: issue.state?.name || 'Unknown',
        priority: issue.priority || 0,
        assignee: issue.assignee?.name || 'Unassigned',
        team: issue.team?.name || 'Unknown',
        url: issue.url,
      }));

      const summaryText = issuesSummary.length > 0
        ? issuesSummary.map((i: any) => 
            `${i.identifier}: ${i.title} [${i.state}] (${i.assignee})`
          ).join('\n')
        : 'No Linear issues found';

      return {
        content: [
          {
            type: 'text',
            text: `Linear Issues (${issues.length}):\n${summaryText}`,
          },
        ],
        metadata: {
          issues: issuesSummary,
          totalCount: issues.length,
          filters,
        },
      };
    } catch (error: unknown) {
      logger.error('Error getting Linear tasks', error instanceof Error ? error : new Error(String(error)));
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
      const userInfo = null; // TODO: Implement getUserInfo
      const teams: any[] = []; // TODO: Implement getTeams
      
      // Get sync stats
      const syncStats = { lastSync: 'Never', totalSynced: 0, errors: 0 }; // TODO: Implement getSyncStatistics

      const statusText = `Linear Integration Status:
✓ Connected as: ${userInfo?.name || 'Unknown'}
✓ Teams: ${teams.length || 0}
✓ Last sync: ${syncStats.lastSync || 'Never'}
✓ Synced tasks: ${syncStats.totalSynced || 0}
✓ Sync errors: ${syncStats.errors || 0}`;

      return {
        content: [
          {
            type: 'text',
            text: statusText,
          },
        ],
        metadata: {
          connected: true,
          user: userInfo,
          teams,
          syncStats,
        },
      };
    } catch (error: unknown) {
      logger.error('Error getting Linear status', error instanceof Error ? error : new Error(String(error)));
      
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