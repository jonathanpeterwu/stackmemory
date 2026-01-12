/**
 * Unified Linear Sync System
 * Consolidates all sync functionality with duplicate detection,
 * bidirectional sync, and task planning integration
 */

import { LinearClient, LinearIssue, LinearCreateIssueInput } from './client.js';
import { LinearDuplicateDetector, DuplicateCheckResult } from './sync.js';
import { PebblesTaskStore } from '../../features/tasks/pebbles-task-store.js';
import { LinearAuthManager } from './auth.js';
import { logger } from '../../core/monitoring/logger.js';
import { Task, TaskStatus, TaskPriority } from '../../types/task.js';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { EventEmitter } from 'events';

// Unified sync configuration
export interface UnifiedSyncConfig {
  // Core settings
  enabled: boolean;
  direction: 'bidirectional' | 'to_linear' | 'from_linear';
  defaultTeamId?: string;
  
  // Duplicate detection
  duplicateDetection: boolean;
  duplicateSimilarityThreshold: number; // 0-1, default 0.85
  mergeStrategy: 'merge_content' | 'skip' | 'create_anyway';
  
  // Conflict resolution
  conflictResolution: 'newest_wins' | 'linear_wins' | 'local_wins' | 'manual';
  
  // Task planning
  taskPlanningEnabled: boolean;
  taskPlanFile?: string; // Default: .stackmemory/task-plan.md
  autoCreateTaskPlan: boolean;
  
  // Performance
  maxBatchSize: number;
  rateLimitDelay: number; // ms between requests
  maxRetries: number;
  
  // Auto-sync
  autoSync: boolean;
  autoSyncInterval?: number; // minutes
  quietHours?: {
    start: number; // hour 0-23
    end: number;
  };
}

export const DEFAULT_UNIFIED_CONFIG: UnifiedSyncConfig = {
  enabled: true,
  direction: 'bidirectional',
  duplicateDetection: true,
  duplicateSimilarityThreshold: 0.85,
  mergeStrategy: 'merge_content',
  conflictResolution: 'newest_wins',
  taskPlanningEnabled: true,
  taskPlanFile: '.stackmemory/task-plan.md',
  autoCreateTaskPlan: true,
  maxBatchSize: 50,
  rateLimitDelay: 100,
  maxRetries: 3,
  autoSync: false,
  autoSyncInterval: 15,
};

// Sync statistics
export interface SyncStats {
  toLinear: {
    created: number;
    updated: number;
    skipped: number;
    duplicatesMerged: number;
  };
  fromLinear: {
    created: number;
    updated: number;
    skipped: number;
  };
  conflicts: Array<{
    taskId: string;
    reason: string;
    resolution: string;
  }>;
  errors: string[];
  duration: number;
  timestamp: number;
}

// Task planning integration
interface TaskPlan {
  version: string;
  lastUpdated: Date;
  phases: Array<{
    name: string;
    description: string;
    tasks: Array<{
      id: string;
      title: string;
      priority: TaskPriority;
      status: TaskStatus;
      linearId?: string;
      dependencies?: string[];
    }>;
  }>;
}

export class UnifiedLinearSync extends EventEmitter {
  private config: UnifiedSyncConfig;
  private linearClient: LinearClient;
  private taskStore: PebblesTaskStore;
  private authManager: LinearAuthManager;
  private duplicateDetector: LinearDuplicateDetector;
  private projectRoot: string;
  private mappings: Map<string, string> = new Map(); // task.id -> linear.id
  private lastSyncStats?: SyncStats;
  private syncInProgress = false;

  constructor(
    taskStore: PebblesTaskStore,
    authManager: LinearAuthManager,
    projectRoot: string,
    config?: Partial<UnifiedSyncConfig>
  ) {
    super();
    this.taskStore = taskStore;
    this.authManager = authManager;
    this.projectRoot = projectRoot;
    this.config = { ...DEFAULT_UNIFIED_CONFIG, ...config };
    
    // Initialize Linear client - will be set up in initialize()
    this.linearClient = null as any;
    this.duplicateDetector = null as any;
    
    // Load existing mappings
    this.loadMappings();
  }

  /**
   * Initialize the sync system
   */
  async initialize(): Promise<void> {
    try {
      // Get Linear authentication
      const token = await this.authManager.getValidToken();
      if (!token) {
        throw new Error('Linear authentication required. Run "stackmemory linear auth" first.');
      }

      // Initialize Linear client with proper auth
      const isOAuth = this.authManager.isOAuth();
      this.linearClient = new LinearClient({
        apiKey: token,
        useBearer: isOAuth,
        teamId: this.config.defaultTeamId,
        onUnauthorized: isOAuth
          ? async () => {
              const refreshed = await this.authManager.refreshAccessToken();
              return refreshed.accessToken;
            }
          : undefined,
      });

      // Initialize duplicate detector
      if (this.config.duplicateDetection) {
        this.duplicateDetector = new LinearDuplicateDetector(this.linearClient);
      }

      // Initialize task planning if enabled
      if (this.config.taskPlanningEnabled) {
        await this.initializeTaskPlanning();
      }

      logger.info('Unified Linear sync initialized', {
        direction: this.config.direction,
        duplicateDetection: this.config.duplicateDetection,
        taskPlanning: this.config.taskPlanningEnabled,
      });
    } catch (error: unknown) {
      logger.error('Failed to initialize Linear sync:', error as Error);
      throw error;
    }
  }

  /**
   * Main sync method - orchestrates bidirectional sync
   */
  async sync(): Promise<SyncStats> {
    if (this.syncInProgress) {
      throw new Error('Sync already in progress');
    }

    this.syncInProgress = true;
    const startTime = Date.now();
    
    const stats: SyncStats = {
      toLinear: { created: 0, updated: 0, skipped: 0, duplicatesMerged: 0 },
      fromLinear: { created: 0, updated: 0, skipped: 0 },
      conflicts: [],
      errors: [],
      duration: 0,
      timestamp: Date.now(),
    };

    try {
      this.emit('sync:started', { config: this.config });

      // Determine sync direction and execute
      switch (this.config.direction) {
        case 'bidirectional':
          await this.syncFromLinear(stats);
          await this.syncToLinear(stats);
          break;
        case 'from_linear':
          await this.syncFromLinear(stats);
          break;
        case 'to_linear':
          await this.syncToLinear(stats);
          break;
      }

      // Update task plan if enabled
      if (this.config.taskPlanningEnabled) {
        await this.updateTaskPlan(stats);
      }

      // Save mappings
      this.saveMappings();

      stats.duration = Date.now() - startTime;
      this.lastSyncStats = stats;

      this.emit('sync:completed', { stats });
      logger.info('Unified sync completed', {
        duration: `${stats.duration}ms`,
        toLinear: stats.toLinear,
        fromLinear: stats.fromLinear,
        conflicts: stats.conflicts.length,
      });

      return stats;
    } catch (error: unknown) {
      stats.errors.push((error as Error).message);
      stats.duration = Date.now() - startTime;
      
      this.emit('sync:failed', { stats, error });
      logger.error('Unified sync failed:', error as Error);
      
      throw error;
    } finally {
      this.syncInProgress = false;
    }
  }

  /**
   * Sync from Linear to local tasks
   */
  private async syncFromLinear(stats: SyncStats): Promise<void> {
    try {
      logger.debug('Syncing from Linear...');

      // Get team ID
      const teamId = this.config.defaultTeamId || (await this.getDefaultTeamId());
      
      // Fetch Linear issues
      const issues = await this.linearClient.getIssues({
        teamId,
        limit: this.config.maxBatchSize,
      });

      for (const issue of issues) {
        try {
          await this.delay(this.config.rateLimitDelay);
          
          // Check if we have this issue mapped
          const localTaskId = this.findLocalTaskByLinearId(issue.id);
          
          if (localTaskId) {
            // Update existing task
            const localTask = await this.taskStore.getTask(localTaskId);
            if (localTask && this.hasChanges(localTask, issue)) {
              await this.updateLocalTask(localTask, issue);
              stats.fromLinear.updated++;
            } else {
              stats.fromLinear.skipped++;
            }
          } else {
            // Create new local task
            await this.createLocalTask(issue);
            stats.fromLinear.created++;
          }
        } catch (error: unknown) {
          stats.errors.push(`Failed to sync issue ${issue.identifier}: ${(error as Error).message}`);
        }
      }
    } catch (error: unknown) {
      logger.error('Failed to sync from Linear:', error as Error);
      throw error;
    }
  }

  /**
   * Sync local tasks to Linear
   */
  private async syncToLinear(stats: SyncStats): Promise<void> {
    try {
      logger.debug('Syncing to Linear...');

      // Get all local tasks
      const tasks = await this.taskStore.getAllTasks();
      const teamId = this.config.defaultTeamId || (await this.getDefaultTeamId());

      for (const task of tasks) {
        try {
          await this.delay(this.config.rateLimitDelay);
          
          // Skip if already mapped to Linear
          const linearId = this.mappings.get(task.id);
          
          if (linearId) {
            // Update existing Linear issue
            const linearIssue = await this.linearClient.getIssue(linearId);
            if (linearIssue && this.taskNeedsUpdate(task, linearIssue)) {
              await this.updateLinearIssue(linearIssue, task);
              stats.toLinear.updated++;
            } else {
              stats.toLinear.skipped++;
            }
          } else {
            // Check for duplicates before creating
            if (this.config.duplicateDetection) {
              const duplicateCheck = await this.duplicateDetector.checkForDuplicate(
                task.title,
                teamId
              );
              
              if (duplicateCheck.isDuplicate && duplicateCheck.existingIssue) {
                if (this.config.mergeStrategy === 'merge_content') {
                  // Merge into existing
                  await this.mergeTaskIntoLinear(task, duplicateCheck.existingIssue);
                  this.mappings.set(task.id, duplicateCheck.existingIssue.id);
                  stats.toLinear.duplicatesMerged++;
                } else if (this.config.mergeStrategy === 'skip') {
                  stats.toLinear.skipped++;
                  continue;
                }
              } else {
                // Create new Linear issue
                await this.createLinearIssue(task, teamId);
                stats.toLinear.created++;
              }
            } else {
              // Create without duplicate check
              await this.createLinearIssue(task, teamId);
              stats.toLinear.created++;
            }
          }
        } catch (error: unknown) {
          stats.errors.push(`Failed to sync task ${task.id}: ${(error as Error).message}`);
        }
      }
    } catch (error: unknown) {
      logger.error('Failed to sync to Linear:', error as Error);
      throw error;
    }
  }

  /**
   * Initialize task planning system
   */
  private async initializeTaskPlanning(): Promise<void> {
    const planFile = join(this.projectRoot, this.config.taskPlanFile!);
    const planDir = dirname(planFile);

    // Ensure directory exists
    if (!existsSync(planDir)) {
      mkdirSync(planDir, { recursive: true });
    }

    // Create default task plan if it doesn't exist
    if (!existsSync(planFile) && this.config.autoCreateTaskPlan) {
      const defaultPlan: TaskPlan = {
        version: '1.0.0',
        lastUpdated: new Date(),
        phases: [
          {
            name: 'Backlog',
            description: 'Tasks to be prioritized',
            tasks: [],
          },
          {
            name: 'Current Sprint',
            description: 'Active work items',
            tasks: [],
          },
          {
            name: 'Completed',
            description: 'Finished tasks',
            tasks: [],
          },
        ],
      };

      this.saveTaskPlan(defaultPlan);
      logger.info('Created default task plan', { path: planFile });
    }
  }

  /**
   * Update task plan with sync results
   */
  private async updateTaskPlan(stats: SyncStats): Promise<void> {
    if (!this.config.taskPlanningEnabled) return;

    try {
      const plan = this.loadTaskPlan();
      const tasks = await this.taskStore.getAllTasks();

      // Reorganize tasks by status
      plan.phases = [
        {
          name: 'Backlog',
          description: 'Tasks to be prioritized',
          tasks: tasks
            .filter((t) => t.status === 'todo')
            .map((t) => ({
              id: t.id,
              title: t.title,
              priority: t.priority || 'medium',
              status: t.status,
              linearId: this.mappings.get(t.id),
            })),
        },
        {
          name: 'In Progress',
          description: 'Active work items',
          tasks: tasks
            .filter((t) => t.status === 'in_progress')
            .map((t) => ({
              id: t.id,
              title: t.title,
              priority: t.priority || 'medium',
              status: t.status,
              linearId: this.mappings.get(t.id),
            })),
        },
        {
          name: 'Completed',
          description: 'Finished tasks',
          tasks: tasks
            .filter((t) => t.status === 'done')
            .slice(-20) // Keep last 20 completed
            .map((t) => ({
              id: t.id,
              title: t.title,
              priority: t.priority || 'medium',
              status: t.status,
              linearId: this.mappings.get(t.id),
            })),
        },
      ];

      plan.lastUpdated = new Date();
      this.saveTaskPlan(plan);

      // Also generate markdown report
      this.generateTaskReport(plan, stats);
    } catch (error: unknown) {
      logger.error('Failed to update task plan:', error as Error);
    }
  }

  /**
   * Generate markdown task report
   */
  private generateTaskReport(plan: TaskPlan, stats: SyncStats): void {
    const reportFile = join(this.projectRoot, '.stackmemory', 'task-report.md');
    
    let content = `# Task Sync Report\n\n`;
    content += `**Last Updated:** ${plan.lastUpdated.toLocaleString()}\n`;
    content += `**Sync Duration:** ${stats.duration}ms\n\n`;

    content += `## Sync Statistics\n\n`;
    content += `### To Linear\n`;
    content += `- Created: ${stats.toLinear.created}\n`;
    content += `- Updated: ${stats.toLinear.updated}\n`;
    content += `- Duplicates Merged: ${stats.toLinear.duplicatesMerged}\n`;
    content += `- Skipped: ${stats.toLinear.skipped}\n\n`;

    content += `### From Linear\n`;
    content += `- Created: ${stats.fromLinear.created}\n`;
    content += `- Updated: ${stats.fromLinear.updated}\n`;
    content += `- Skipped: ${stats.fromLinear.skipped}\n\n`;

    if (stats.conflicts.length > 0) {
      content += `### Conflicts\n`;
      stats.conflicts.forEach((c) => {
        content += `- **${c.taskId}**: ${c.reason} (${c.resolution})\n`;
      });
      content += '\n';
    }

    content += `## Task Overview\n\n`;
    plan.phases.forEach((phase) => {
      content += `### ${phase.name} (${phase.tasks.length})\n`;
      content += `> ${phase.description}\n\n`;
      
      if (phase.tasks.length > 0) {
        phase.tasks.slice(0, 10).forEach((task) => {
          const linearLink = task.linearId ? ` [Linear]` : '';
          content += `- **${task.title}**${linearLink}\n`;
        });
        
        if (phase.tasks.length > 10) {
          content += `- _...and ${phase.tasks.length - 10} more_\n`;
        }
      }
      content += '\n';
    });

    writeFileSync(reportFile, content);
    logger.debug('Task report generated', { path: reportFile });
  }

  /**
   * Helper methods
   */
  
  private async getDefaultTeamId(): Promise<string> {
    const teams = await this.linearClient.getTeams();
    if (teams.length === 0) {
      throw new Error('No Linear teams found');
    }
    return teams[0]!.id;
  }

  private findLocalTaskByLinearId(linearId: string): string | undefined {
    for (const [taskId, linId] of this.mappings) {
      if (linId === linearId) return taskId;
    }
    return undefined;
  }

  private hasChanges(localTask: Task, linearIssue: LinearIssue): boolean {
    return (
      localTask.title !== linearIssue.title ||
      localTask.description !== (linearIssue.description || '') ||
      this.mapLinearStateToStatus(linearIssue.state.type) !== localTask.status
    );
  }

  private taskNeedsUpdate(task: Task, linearIssue: LinearIssue): boolean {
    return (
      task.title !== linearIssue.title ||
      task.description !== (linearIssue.description || '') ||
      task.status !== this.mapLinearStateToStatus(linearIssue.state.type)
    );
  }

  private async createLocalTask(issue: LinearIssue): Promise<void> {
    const task = await this.taskStore.createTask({
      title: issue.title,
      description: issue.description || '',
      status: this.mapLinearStateToStatus(issue.state.type),
      priority: this.mapLinearPriorityToPriority(issue.priority),
      metadata: {
        linear: {
          id: issue.id,
          identifier: issue.identifier,
          url: issue.url,
        },
      },
    });

    this.mappings.set(task.id, issue.id);
  }

  private async updateLocalTask(task: Task, issue: LinearIssue): Promise<void> {
    await this.taskStore.updateTask(task.id, {
      title: issue.title,
      description: issue.description || '',
      status: this.mapLinearStateToStatus(issue.state.type),
      priority: this.mapLinearPriorityToPriority(issue.priority),
    });
  }

  private async createLinearIssue(task: Task, teamId: string): Promise<void> {
    const input: LinearCreateIssueInput = {
      title: task.title,
      description: task.description || '',
      teamId,
      priority: this.mapPriorityToLinearPriority(task.priority),
    };

    const issue = await this.linearClient.createIssue(input);
    this.mappings.set(task.id, issue.id);

    // Update task with Linear metadata
    await this.taskStore.updateTask(task.id, {
      metadata: {
        ...task.metadata,
        linear: {
          id: issue.id,
          identifier: issue.identifier,
          url: issue.url,
        },
      },
    });
  }

  private async updateLinearIssue(issue: LinearIssue, task: Task): Promise<void> {
    await this.linearClient.updateIssue(issue.id, {
      title: task.title,
      description: task.description,
      priority: this.mapPriorityToLinearPriority(task.priority),
    });
  }

  private async mergeTaskIntoLinear(task: Task, existingIssue: LinearIssue): Promise<void> {
    await this.duplicateDetector.mergeIntoExisting(
      existingIssue,
      task.title,
      task.description,
      `StackMemory Task: ${task.id}\nMerged: ${new Date().toISOString()}`
    );
  }

  private mapLinearStateToStatus(state: string): TaskStatus {
    switch (state.toLowerCase()) {
      case 'backlog':
      case 'unstarted':
        return 'todo';
      case 'started':
        return 'in_progress';
      case 'completed':
        return 'done';
      case 'cancelled':
        return 'cancelled';
      default:
        return 'todo';
    }
  }

  private mapLinearPriorityToPriority(priority?: number): TaskPriority | undefined {
    switch (priority) {
      case 1:
        return 'urgent';
      case 2:
        return 'high';
      case 3:
        return 'medium';
      case 4:
        return 'low';
      default:
        return undefined;
    }
  }

  private mapPriorityToLinearPriority(priority?: TaskPriority): number {
    switch (priority) {
      case 'urgent':
        return 1;
      case 'high':
        return 2;
      case 'medium':
        return 3;
      case 'low':
        return 4;
      default:
        return 0;
    }
  }

  private loadMappings(): void {
    const mappingFile = join(this.projectRoot, '.stackmemory', 'linear-mappings.json');
    if (existsSync(mappingFile)) {
      try {
        const data = JSON.parse(readFileSync(mappingFile, 'utf8'));
        this.mappings = new Map(Object.entries(data));
      } catch (error: unknown) {
        logger.error('Failed to load mappings:', error as Error);
      }
    }
  }

  private saveMappings(): void {
    const mappingFile = join(this.projectRoot, '.stackmemory', 'linear-mappings.json');
    const data = Object.fromEntries(this.mappings);
    writeFileSync(mappingFile, JSON.stringify(data, null, 2));
  }

  private loadTaskPlan(): TaskPlan {
    const planFile = join(this.projectRoot, this.config.taskPlanFile!);
    if (existsSync(planFile)) {
      try {
        return JSON.parse(readFileSync(planFile, 'utf8'));
      } catch (error: unknown) {
        logger.error('Failed to load task plan:', error as Error);
      }
    }
    
    return {
      version: '1.0.0',
      lastUpdated: new Date(),
      phases: [],
    };
  }

  private saveTaskPlan(plan: TaskPlan): void {
    const planFile = join(this.projectRoot, this.config.taskPlanFile!);
    writeFileSync(planFile, JSON.stringify(plan, null, 2));
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get last sync statistics
   */
  getLastSyncStats(): SyncStats | undefined {
    return this.lastSyncStats;
  }

  /**
   * Clear duplicate detector cache
   */
  clearCache(): void {
    if (this.duplicateDetector) {
      this.duplicateDetector.clearCache();
    }
  }
}