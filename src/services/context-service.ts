import { Task } from '../types/task.js';
// TaskStatus and TaskPriority will be used in future implementations
// import { TaskStatus, TaskPriority } from '../types/task.js';
import { Logger } from '../utils/logger.js';
import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync } from 'fs';

export class ContextService {
  private logger: Logger;
  private db: Database.Database | null = null;
  private tasks: Map<string, Task> = new Map();

  constructor() {
    this.logger = new Logger('ContextService');
    this.initializeDatabase();
  }

  private initializeDatabase(): void {
    try {
      const dbPath = join(process.cwd(), '.stackmemory', 'context.db');
      if (existsSync(dbPath)) {
        this.db = new Database(dbPath);
        this.loadTasksFromDatabase();
      }
    } catch (error) {
      this.logger.warn(
        'Could not connect to database, using in-memory storage',
        error
      );
    }
  }

  private loadTasksFromDatabase(): void {
    // TODO: Load tasks from SQLite database
  }

  public async getTask(id: string): Promise<Task | null> {
    return this.tasks.get(id) || null;
  }

  public async getTaskByExternalId(externalId: string): Promise<Task | null> {
    for (const task of this.tasks.values()) {
      if (task.externalId === externalId) {
        return task;
      }
    }
    return null;
  }

  public async getAllTasks(): Promise<Task[]> {
    return Array.from(this.tasks.values());
  }

  public async createTask(taskData: Partial<Task>): Promise<Task> {
    const task: Task = {
      id: this.generateId(),
      title: taskData.title || 'Untitled Task',
      description: taskData.description || '',
      status: taskData.status || 'todo',
      priority: taskData.priority,
      tags: taskData.tags || [],
      externalId: taskData.externalId,
      externalIdentifier: taskData.externalIdentifier,
      externalUrl: taskData.externalUrl,
      metadata: taskData.metadata,
      createdAt: taskData.createdAt || new Date(),
      updatedAt: taskData.updatedAt || new Date(),
    };

    this.tasks.set(task.id, task);
    this.logger.debug(`Created task: ${task.id} - ${task.title}`);
    return task;
  }

  public async updateTask(
    id: string,
    updates: Partial<Task>
  ): Promise<Task | null> {
    const task = this.tasks.get(id);
    if (!task) {
      return null;
    }

    const updatedTask = {
      ...task,
      ...updates,
      updatedAt: new Date(),
    };

    this.tasks.set(id, updatedTask);
    this.logger.debug(`Updated task: ${id} - ${updatedTask.title}`);
    return updatedTask;
  }

  public async deleteTask(id: string): Promise<boolean> {
    const deleted = this.tasks.delete(id);
    if (deleted) {
      this.logger.debug(`Deleted task: ${id}`);
    }
    return deleted;
  }

  private generateId(): string {
    return 'task_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
  }
}
