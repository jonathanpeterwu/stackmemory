/**
 * Linear Task Manager
 * In-memory task storage with Linear synchronization
 * Replaces LinearTaskManager system
 */

import { EventEmitter } from 'events';
import { logger } from '../../core/monitoring/logger.js';
import { Task, TaskStatus, TaskPriority, TaskMetadata } from '../../types/task.js';
import { LinearClient, LinearIssue } from '../../integrations/linear/client.js';

export interface LinearTaskManagerConfig {
  linearApiKey?: string;
  teamId?: string;
  projectFilter?: string; // Filter tasks by project name/org
  autoSync?: boolean;
  syncInterval?: number; // minutes
}

export interface TaskMetrics {
  total_tasks: number;
  by_status: Record<TaskStatus, number>;
  by_priority: Record<TaskPriority, number>;
  completion_rate: number;
  avg_effort_accuracy: number;
  blocked_tasks: number;
  overdue_tasks: number;
}

export class LinearTaskManager extends EventEmitter {
  private tasks: Map<string, Task> = new Map();
  private linearClient?: LinearClient;
  private config: LinearTaskManagerConfig;
  private projectId?: string;
  private syncTimer?: NodeJS.Timeout;

  constructor(config: LinearTaskManagerConfig = {}, projectId?: string) {
    super();
    this.config = config;
    this.projectId = projectId;

    // Initialize Linear client if API key is provided
    if (config.linearApiKey) {
      this.linearClient = new LinearClient({
        apiKey: config.linearApiKey,
        teamId: config.teamId,
      });
    }

    // Setup auto-sync if enabled
    if (config.autoSync && config.syncInterval && this.linearClient) {
      this.setupAutoSync();
    }
  }

  /**
   * Create a new task
   */
  createTask(options: {
    title: string;
    description?: string;
    priority?: TaskPriority;
    tags?: string[];
    metadata?: TaskMetadata;
  }): string {
    const id = this.generateTaskId();
    const now = new Date();
    
    const task: Task = {
      id,
      title: options.title,
      description: options.description || '',
      status: 'todo',
      priority: options.priority || 'medium',
      tags: options.tags || [],
      metadata: options.metadata,
      createdAt: now,
      updatedAt: now,
    };

    this.tasks.set(id, task);
    this.emit('task:created', task);
    this.emit('sync:needed', 'task:created');
    
    return id;
  }

  /**
   * Update task status
   */
  updateTaskStatus(taskId: string, newStatus: TaskStatus, reason?: string): void {
    const task = this.tasks.get(taskId);
    if (!task) {
      throw new Error(`Task not found: ${taskId}`);
    }

    task.status = newStatus;
    task.updatedAt = new Date();
    
    this.tasks.set(taskId, task);
    
    if (newStatus === 'done') {
      this.emit('task:completed', task);
    }
    
    this.emit('task:updated', task);
    this.emit('sync:needed', 'task:updated');
  }

  /**
   * Get task by ID
   */
  getTask(taskId: string): Task | undefined {
    return this.tasks.get(taskId);
  }

  /**
   * Get all active tasks (not done/cancelled)
   */
  getActiveTasks(): Task[] {
    return Array.from(this.tasks.values())
      .filter(task => !['done', 'cancelled'].includes(task.status))
      .sort((a, b) => {
        // Sort by priority then by creation date
        const priorityOrder = { urgent: 4, high: 3, medium: 2, low: 1 };
        const aPriority = priorityOrder[a.priority || 'medium'];
        const bPriority = priorityOrder[b.priority || 'medium'];
        
        if (aPriority !== bPriority) {
          return bPriority - aPriority; // Higher priority first
        }
        
        return a.createdAt.getTime() - b.createdAt.getTime(); // Older first
      });
  }

  /**
   * Get tasks by status
   */
  getTasksByStatus(status: TaskStatus): Task[] {
    return Array.from(this.tasks.values()).filter(task => task.status === status);
  }

  /**
   * Get metrics for tasks
   */
  getMetrics(): TaskMetrics {
    const allTasks = Array.from(this.tasks.values());
    const totalTasks = allTasks.length;
    
    const byStatus: Record<TaskStatus, number> = {
      todo: 0,
      in_progress: 0,
      done: 0,
      cancelled: 0,
    };
    
    const byPriority: Record<TaskPriority, number> = {
      low: 0,
      medium: 0,
      high: 0,
      urgent: 0,
    };

    for (const task of allTasks) {
      byStatus[task.status]++;
      if (task.priority) {
        byPriority[task.priority]++;
      }
    }

    const completedTasks = byStatus.done;
    const completionRate = totalTasks > 0 ? completedTasks / totalTasks : 0;

    return {
      total_tasks: totalTasks,
      by_status: byStatus,
      by_priority: byPriority,
      completion_rate: completionRate,
      avg_effort_accuracy: 0, // Not implemented in this simplified version
      blocked_tasks: 0, // Could be implemented with tags or metadata
      overdue_tasks: 0, // Could be implemented with due dates
    };
  }

  /**
   * Sync with Linear workspace
   */
  async syncWithLinear(): Promise<{ synced: number; errors: string[] }> {
    if (!this.linearClient) {
      throw new Error('Linear client not initialized');
    }

    const errors: string[] = [];
    let synced = 0;

    try {
      // Sync local tasks to Linear
      for (const task of this.getActiveTasks()) {
        if (!task.externalId) {
          try {
            // Create in Linear if it doesn't exist
            const linearIssue = await this.createLinearIssue(task);
            task.externalId = linearIssue.id;
            task.externalIdentifier = linearIssue.identifier;
            task.externalUrl = linearIssue.url;
            task.updatedAt = new Date();
            synced++;
          } catch (error) {
            const errorMsg = error instanceof Error ? error.message : String(error);
            errors.push(`Failed to sync task ${task.id}: ${errorMsg}`);
            logger.error('Failed to sync task to Linear', { taskId: task.id, error: errorMsg });
          }
        }
      }

      this.emit('sync:completed', { synced, errors });
      return { synced, errors };
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      errors.push(`Sync failed: ${errorMsg}`);
      throw new Error(`Linear sync failed: ${errorMsg}`);
    }
  }

  /**
   * Load tasks from Linear
   */
  async loadFromLinear(): Promise<number> {
    if (!this.linearClient || !this.config.teamId) {
      throw new Error('Linear client or team ID not configured');
    }

    try {
      const issues = await this.linearClient.getIssues({
        teamId: this.config.teamId,
      });

      let loaded = 0;
      for (const issue of issues) {
        const task = this.convertLinearIssueToTask(issue);
        this.tasks.set(task.id, task);
        loaded++;
      }

      logger.info(`Loaded ${loaded} tasks from Linear`);
      this.emit('tasks:loaded', { count: loaded });
      return loaded;

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error);
      logger.error('Failed to load tasks from Linear', { error: errorMsg });
      throw new Error(`Failed to load from Linear: ${errorMsg}`);
    }
  }

  /**
   * Clear all tasks (for testing or cleanup)
   */
  clear(): void {
    this.tasks.clear();
    this.emit('tasks:cleared');
  }

  /**
   * Get task count
   */
  getTaskCount(): number {
    return this.tasks.size;
  }

  // Private methods

  private generateTaskId(): string {
    return `tsk-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  private async createLinearIssue(task: Task): Promise<LinearIssue> {
    if (!this.linearClient || !this.config.teamId) {
      throw new Error('Linear client or team ID not configured');
    }

    const priorityMap: Record<TaskPriority, number> = {
      urgent: 1,
      high: 2,
      medium: 3,
      low: 4,
    };

    return await this.linearClient.createIssue({
      title: task.title,
      description: task.description,
      teamId: this.config.teamId,
      priority: task.priority ? priorityMap[task.priority] : 3,
    });
  }

  private convertLinearIssueToTask(issue: LinearIssue): Task {
    const priorityMap: Record<number, TaskPriority> = {
      1: 'urgent',
      2: 'high',
      3: 'medium',
      4: 'low',
    };

    const statusMap: Record<string, TaskStatus> = {
      'backlog': 'todo',
      'unstarted': 'todo',
      'started': 'in_progress',
      'completed': 'done',
      'cancelled': 'cancelled',
    };

    return {
      id: `linear-${issue.id}`,
      title: issue.title,
      description: issue.description || '',
      status: statusMap[issue.state.type] || 'todo',
      priority: priorityMap[issue.priority] || 'medium',
      tags: issue.labels?.map(label => label.name) || [],
      externalId: issue.id,
      externalIdentifier: issue.identifier,
      externalUrl: issue.url,
      metadata: {
        linear: {
          stateId: issue.state.id,
          assigneeId: issue.assignee?.id,
        },
      },
      createdAt: new Date(issue.createdAt),
      updatedAt: new Date(issue.updatedAt),
    };
  }

  private setupAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }

    const intervalMs = (this.config.syncInterval || 15) * 60 * 1000;
    this.syncTimer = setInterval(async () => {
      try {
        await this.syncWithLinear();
      } catch (error) {
        logger.error('Auto-sync failed', error instanceof Error ? error : new Error(String(error)));
      }
    }, intervalMs);
  }

  /**
   * Cleanup resources
   */
  destroy(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }
    this.removeAllListeners();
  }
}