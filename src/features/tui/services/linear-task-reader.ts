/**
 * Linear Task Reader for TUI
 * Reads Linear-synced tasks from tasks.jsonl
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import type { LinearTask } from '../types.js';

export class LinearTaskReader {
  private tasksFile: string;
  private mappingsFile: string;

  constructor(projectRoot?: string) {
    const root = projectRoot || process.cwd();
    this.tasksFile = join(root, '.stackmemory', 'tasks.jsonl');
    this.mappingsFile = join(root, '.stackmemory', 'linear-mappings.json');
  }

  /**
   * Read tasks from the Linear-synced JSONL file
   */
  getTasks(): LinearTask[] {
    if (!existsSync(this.tasksFile)) {
      console.log('No tasks file found. Run "npm run linear:sync" to sync tasks.');
      return [];
    }

    try {
      const content = readFileSync(this.tasksFile, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      
      const tasks: LinearTask[] = lines.map(line => {
        const task = JSON.parse(line);
        
        // Convert from synced format to TUI LinearTask format
        return {
          id: task.id || task.linearId,
          identifier: task.taskId || task.linearId || task.id,
          title: task.title,
          description: task.description || '',
          state: task.linearState || this.mapStatusToState(task.status),
          priority: task.priority || 4,
          estimate: task.estimate,
          assignee: task.assignee,
          createdAt: task.createdAt,
          updatedAt: task.updatedAt,
          lastSyncedAt: task.updatedAt,
          syncStatus: 'synced',
        };
      });

      return tasks;
    } catch (error) {
      console.error('Error reading tasks:', error);
      return [];
    }
  }

  /**
   * Get task mappings between Linear and local IDs
   */
  getMappings(): Map<string, any> {
    if (!existsSync(this.mappingsFile)) {
      return new Map();
    }

    try {
      const content = readFileSync(this.mappingsFile, 'utf8');
      const mappings = JSON.parse(content);
      return new Map(Object.entries(mappings));
    } catch (error) {
      console.error('Error reading mappings:', error);
      return new Map();
    }
  }

  /**
   * Get active tasks (not completed or canceled)
   */
  getActiveTasks(): LinearTask[] {
    const allTasks = this.getTasks();
    return allTasks.filter(task => 
      task.state !== 'Done' && 
      task.state !== 'Canceled' &&
      task.state !== 'Duplicate'
    );
  }

  /**
   * Get tasks by state
   */
  getTasksByState(state: string): LinearTask[] {
    const allTasks = this.getTasks();
    return allTasks.filter(task => task.state === state);
  }

  /**
   * Map local status to Linear state name
   */
  private mapStatusToState(status: string): string {
    switch (status) {
      case 'completed': return 'Done';
      case 'in_progress': return 'In Progress';
      case 'cancelled': return 'Canceled';
      case 'backlog': return 'Backlog';
      case 'todo': return 'Todo';
      default: return 'Backlog';
    }
  }
}