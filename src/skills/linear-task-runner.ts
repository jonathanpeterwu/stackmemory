/**
 * Linear Task Runner
 * Bridges LinearTaskManager → RLM Orchestrator → Linear status updates.
 * Stateless: pull → execute → update. Ralph loop handles retries/learning.
 */

import type { SkillContext, SkillResult } from './claude-skills.js';
import type { RecursiveAgentOrchestrator } from './recursive-agent-orchestrator.js';
import type { SpecGeneratorSkill } from './spec-generator-skill.js';
import type { Task } from '../types/task.js';
import { logger } from '../core/monitoring/logger.js';
import * as fs from 'fs';
import * as path from 'path';

// Dynamic import type for LinearTaskManager (loaded lazily)
type LinearTaskManagerType = {
  getActiveTasks(): Task[];
  getTask(id: string): Task | undefined;
  updateTaskStatus(id: string, status: string, reason?: string): void;
  syncWithLinear(): Promise<{ synced: number; errors: string[] }>;
  getTasksByStatus(status: string): Task[];
};

interface RunOptions {
  priority?: string;
  tag?: string;
  dryRun?: boolean;
  maxConcurrent?: number;
}

interface RunSummary {
  completed: string[];
  failed: Array<{ taskId: string; error: string }>;
  skipped: string[];
  totalTokens: number;
  totalCost: number;
  duration: number;
}

const PROMPT_PLAN_PATH = 'docs/specs/PROMPT_PLAN.md';

export class LinearTaskRunner {
  constructor(
    private taskManager: LinearTaskManagerType,
    private rlmOrchestrator: RecursiveAgentOrchestrator,
    private context: SkillContext,
    private specSkill?: SpecGeneratorSkill
  ) {}

  /** Pull next task from Linear, execute via RLM, update status */
  async runNext(opts?: RunOptions): Promise<SkillResult> {
    const tasks = this.getFilteredTasks(opts);

    if (tasks.length === 0) {
      return {
        success: true,
        message: 'No pending tasks found',
        data: { tasksAvailable: 0 },
      };
    }

    const task = tasks[0];
    return this.runTask(task.id, opts);
  }

  /** Run all active tasks iteratively */
  async runAll(opts?: RunOptions): Promise<SkillResult> {
    const startTime = Date.now();
    const tasks = this.getFilteredTasks(opts);

    if (tasks.length === 0) {
      return {
        success: true,
        message: 'No pending tasks to execute',
        data: { tasksAvailable: 0 },
      };
    }

    if (opts?.dryRun) {
      return this.preview();
    }

    const summary: RunSummary = {
      completed: [],
      failed: [],
      skipped: [],
      totalTokens: 0,
      totalCost: 0,
      duration: 0,
    };

    // Sequential by default
    for (const task of tasks) {
      try {
        const result = await this.executeTask(task);

        if (result.success) {
          summary.completed.push(task.id);
          const data = result.data as Record<string, unknown> | undefined;
          summary.totalTokens += (data?.totalTokens as number) || 0;
          summary.totalCost += (data?.totalCost as number) || 0;

          // Auto-update PROMPT_PLAN checkboxes if spec skill available
          await this.autoUpdatePromptPlan(task);
        } else {
          summary.failed.push({
            taskId: task.id,
            error: result.message,
          });
        }

        // Sync to Linear after each task
        await this.syncSafe();
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        summary.failed.push({ taskId: task.id, error: msg });
        logger.error('Task execution failed', { taskId: task.id, error: msg });
      }
    }

    summary.duration = Date.now() - startTime;

    return {
      success: summary.failed.length === 0,
      message: `Completed ${summary.completed.length}/${tasks.length} tasks`,
      data: summary,
      action: `Executed ${summary.completed.length} tasks, ${summary.failed.length} failures`,
    };
  }

  /** Execute a specific Linear task by ID */
  async runTask(taskId: string, opts?: RunOptions): Promise<SkillResult> {
    const task = this.taskManager.getTask(taskId);

    if (!task) {
      return { success: false, message: `Task not found: ${taskId}` };
    }

    if (opts?.dryRun) {
      return this.previewTask(task);
    }

    const result = await this.executeTask(task);

    // Auto-update PROMPT_PLAN if successful
    if (result.success) {
      await this.autoUpdatePromptPlan(task);
      await this.syncSafe();
    }

    return result;
  }

  /** Show execution plan without running */
  async preview(taskId?: string): Promise<SkillResult> {
    if (taskId) {
      const task = this.taskManager.getTask(taskId);
      if (!task) {
        return { success: false, message: `Task not found: ${taskId}` };
      }
      return this.previewTask(task);
    }

    const tasks = this.getFilteredTasks();
    const plan = tasks.map((t, i) => ({
      order: i + 1,
      id: t.id,
      identifier: t.externalIdentifier || t.id,
      title: t.title,
      priority: t.priority || 'medium',
      status: t.status,
      tags: t.tags,
    }));

    return {
      success: true,
      message: `${plan.length} tasks in execution queue`,
      data: { plan, totalTasks: plan.length },
    };
  }

  // --- Private helpers ---

  private async executeTask(task: Task): Promise<SkillResult> {
    const taskLabel = task.externalIdentifier || task.id;

    logger.info('Starting task execution', {
      taskId: task.id,
      title: task.title,
    });

    // 1. Mark as in_progress
    try {
      this.taskManager.updateTaskStatus(
        task.id,
        'in_progress',
        'LinearTaskRunner: starting execution'
      );
    } catch {
      // Non-fatal — task may already be in_progress
    }

    // 2. Execute via RLM orchestrator
    try {
      const result = await this.rlmOrchestrator.execute(
        task.description || task.title,
        {
          linearTaskId: task.id,
          linearIdentifier: task.externalIdentifier,
          title: task.title,
          tags: task.tags,
        }
      );

      if (result.success) {
        // 3. Mark as done
        this.taskManager.updateTaskStatus(
          task.id,
          'done',
          `Completed via RLM: ${result.improvements.length} improvements, ${result.testsGenerated} tests`
        );

        return {
          success: true,
          message: `${taskLabel}: completed`,
          data: {
            taskId: task.id,
            duration: result.duration,
            totalTokens: result.totalTokens,
            totalCost: result.totalCost,
            testsGenerated: result.testsGenerated,
            improvements: result.improvements.length,
            issuesFound: result.issuesFound,
            issuesFixed: result.issuesFixed,
          },
          action: `Executed ${taskLabel} via RLM`,
        };
      } else {
        // Leave as in_progress on failure — don't regress to todo
        logger.warn('Task execution failed', {
          taskId: task.id,
          rootNode: result.rootNode,
        });

        return {
          success: false,
          message: `${taskLabel}: execution failed`,
          data: {
            taskId: task.id,
            duration: result.duration,
            totalTokens: result.totalTokens,
          },
        };
      }
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.error('Task execution threw', { taskId: task.id, error: msg });

      return {
        success: false,
        message: `${taskLabel}: ${msg}`,
        data: { taskId: task.id },
      };
    }
  }

  private getFilteredTasks(opts?: RunOptions): Task[] {
    const tasks = this.taskManager.getTasksByStatus('todo');

    let filtered = tasks;

    // Filter by priority
    if (opts?.priority) {
      filtered = filtered.filter((t) => t.priority === opts.priority);
    }

    // Filter by tag
    if (opts?.tag) {
      const tag = opts.tag;
      filtered = filtered.filter((t) => t.tags.includes(tag));
    }

    // Sort: urgent > high > medium > low
    const priorityOrder: Record<string, number> = {
      urgent: 0,
      high: 1,
      medium: 2,
      low: 3,
    };

    return filtered.sort(
      (a, b) =>
        (priorityOrder[a.priority || 'medium'] || 2) -
        (priorityOrder[b.priority || 'medium'] || 2)
    );
  }

  private previewTask(task: Task): SkillResult {
    return {
      success: true,
      message: `Preview: ${task.externalIdentifier || task.id}`,
      data: {
        id: task.id,
        identifier: task.externalIdentifier,
        title: task.title,
        description: task.description?.slice(0, 200),
        priority: task.priority,
        status: task.status,
        tags: task.tags,
        willExecuteVia: 'RLM Orchestrator',
        estimatedSteps: [
          'Planning agent decomposes task',
          'Code/Test/Review subagents execute',
          'Multi-stage review',
          'Update Linear status to done',
        ],
      },
    };
  }

  /** Auto-update PROMPT_PLAN checkboxes when a task completes */
  private async autoUpdatePromptPlan(task: Task): Promise<void> {
    if (!this.specSkill) return;

    const promptPlanPath = path.join(process.cwd(), PROMPT_PLAN_PATH);
    if (!fs.existsSync(promptPlanPath)) return;

    try {
      // Try to match task title to a checkbox in PROMPT_PLAN
      await this.specSkill.update(PROMPT_PLAN_PATH, task.title);
      logger.info('Auto-updated PROMPT_PLAN checkbox', {
        taskId: task.id,
        title: task.title,
      });
    } catch {
      // Non-fatal — task title may not match any checkbox
    }
  }

  /** Safe Linear sync — log errors but don't throw */
  private async syncSafe(): Promise<void> {
    try {
      await this.taskManager.syncWithLinear();
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);
      logger.warn('Linear sync failed (non-fatal)', { error: msg });
    }
  }
}
