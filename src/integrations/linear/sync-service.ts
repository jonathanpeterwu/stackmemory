import { LinearClient } from './client.js';
import { ContextService } from '../../services/context-service.js';
import { ConfigService } from '../../services/config-service.js';
import { Logger } from '../../utils/logger.js';
import { Task, TaskStatus, TaskPriority } from '../../types/task.js';
import chalk from 'chalk';

export interface SyncResult {
  created: number;
  updated: number;
  deleted: number;
  conflicts: number;
  errors: string[];
}

export class LinearSyncService {
  private linearClient: LinearClient;
  private contextService: ContextService;
  private configService: ConfigService;
  private logger: Logger;

  constructor() {
    this.logger = new Logger('LinearSync');
    this.configService = new ConfigService();
    this.contextService = new ContextService();
    
    const apiKey = process.env.LINEAR_API_KEY;
    if (!apiKey) {
      throw new Error('LINEAR_API_KEY environment variable not set');
    }
    
    this.linearClient = new LinearClient({ apiKey });
  }

  public async syncAllIssues(): Promise<SyncResult> {
    const result: SyncResult = {
      created: 0,
      updated: 0,
      deleted: 0,
      conflicts: 0,
      errors: [],
    };

    try {
      const config = await this.configService.getConfig();
      const teamId = config.integrations?.linear?.teamId;
      
      if (!teamId) {
        throw new Error('Linear team ID not configured');
      }

      const issues = await this.linearClient.getIssues({ teamId });
      
      for (const issue of issues) {
        try {
          const synced = await this.syncIssueToLocal(issue);
          if (synced === 'created') result.created++;
          else if (synced === 'updated') result.updated++;
        } catch (error: any) {
          result.errors.push(`Failed to sync ${issue.identifier}: ${error.message}`);
        }
      }

      this.logger.info(`Sync complete: ${result.created} created, ${result.updated} updated`);
    } catch (error: any) {
      this.logger.error('Sync failed:', error);
      result.errors.push(error.message);
    }

    return result;
  }

  public async syncIssueToLocal(issue: any): Promise<'created' | 'updated' | 'skipped'> {
    try {
      const task = this.convertIssueToTask(issue);
      const existingTask = await this.contextService.getTaskByExternalId(issue.id);
      
      if (existingTask) {
        if (this.hasChanges(existingTask, task)) {
          await this.contextService.updateTask(existingTask.id, task);
          this.logger.debug(`Updated task: ${issue.identifier}`);
          return 'updated';
        }
        return 'skipped';
      } else {
        await this.contextService.createTask(task);
        this.logger.debug(`Created task: ${issue.identifier}`);
        return 'created';
      }
    } catch (error) {
      this.logger.error(`Failed to sync issue ${issue.identifier}:`, error);
      throw error;
    }
  }

  public async syncLocalToLinear(taskId: string): Promise<any> {
    try {
      const task = await this.contextService.getTask(taskId);
      if (!task) {
        throw new Error(`Task ${taskId} not found`);
      }

      const issueData = this.convertTaskToIssueData(task);
      
      if (task.externalId) {
        const updated = await this.linearClient.updateIssue(task.externalId, issueData);
        this.logger.debug(`Updated Linear issue: ${updated.identifier}`);
        return updated;
      } else {
        const created = await this.linearClient.createIssue(issueData);
        await this.contextService.updateTask(taskId, { externalId: created.id });
        this.logger.debug(`Created Linear issue: ${created.identifier}`);
        return created;
      }
    } catch (error) {
      this.logger.error(`Failed to sync task ${taskId} to Linear:`, error);
      throw error;
    }
  }

  public async removeLocalIssue(identifier: string): Promise<void> {
    try {
      const tasks = await this.contextService.getAllTasks();
      const task = tasks.find(t => t.externalIdentifier === identifier);
      
      if (task) {
        await this.contextService.deleteTask(task.id);
        this.logger.debug(`Removed local task: ${identifier}`);
      }
    } catch (error) {
      this.logger.error(`Failed to remove task ${identifier}:`, error);
      throw error;
    }
  }

  private convertIssueToTask(issue: any): Partial<Task> {
    return {
      title: issue.title,
      description: issue.description || '',
      status: this.mapLinearStateToTaskStatus(issue.state.type),
      priority: this.mapLinearPriorityToTaskPriority(issue.priority),
      externalId: issue.id,
      externalIdentifier: issue.identifier,
      externalUrl: issue.url,
      tags: issue.labels?.map((l: any) => l.name) || [],
      metadata: {
        linear: {
          teamId: issue.team.id,
          teamKey: issue.team.key,
          stateId: issue.state.id,
          stateName: issue.state.name,
          projectId: issue.project?.id,
          projectName: issue.project?.name,
          assigneeId: issue.assignee?.id,
          assigneeName: issue.assignee?.name,
        }
      },
      updatedAt: new Date(issue.updatedAt),
    };
  }

  private convertTaskToIssueData(task: Task): any {
    return {
      title: task.title,
      description: task.description,
      priority: this.mapTaskPriorityToLinearPriority(task.priority),
      stateId: task.metadata?.linear?.stateId,
      projectId: task.metadata?.linear?.projectId,
      assigneeId: task.metadata?.linear?.assigneeId,
    };
  }

  private mapLinearStateToTaskStatus(state: string): TaskStatus {
    switch (state.toLowerCase()) {
      case 'backlog':
      case 'triage':
        return 'todo';
      case 'unstarted':
      case 'todo':
        return 'todo';
      case 'started':
      case 'in_progress':
        return 'in_progress';
      case 'completed':
      case 'done':
        return 'done';
      case 'canceled':
      case 'cancelled':
        return 'cancelled';
      default:
        return 'todo';
    }
  }

  private mapTaskPriorityToLinearPriority(priority?: TaskPriority): number {
    switch (priority) {
      case 'urgent': return 1;
      case 'high': return 2;
      case 'medium': return 3;
      case 'low': return 4;
      default: return 0;
    }
  }

  private mapLinearPriorityToTaskPriority(priority?: number): TaskPriority | undefined {
    switch (priority) {
      case 1: return 'urgent';
      case 2: return 'high';
      case 3: return 'medium';
      case 4: return 'low';
      default: return undefined;
    }
  }

  private hasChanges(existing: Task, updated: Partial<Task>): boolean {
    return (
      existing.title !== updated.title ||
      existing.description !== updated.description ||
      existing.status !== updated.status ||
      existing.priority !== updated.priority ||
      JSON.stringify(existing.tags) !== JSON.stringify(updated.tags)
    );
  }
}