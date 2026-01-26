/**
 * Linear Webhook Handler
 * Processes incoming webhooks from Linear to update local task store
 */

import { createHmac } from 'crypto';
import { LinearTaskManager } from '../../features/tasks/linear-task-manager.js';
import { LinearSyncEngine } from './sync.js';
import { LinearAuthManager } from './auth.js';
import { LinearClient } from './client.js';
import { IntegrationError, ErrorCode } from '../../core/errors/index.js';
import { logger } from '../../core/monitoring/logger.js';
import type { Request, Response } from 'express';
// Type-safe environment variable access
function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    throw new IntegrationError(
      `Environment variable ${key} is required`,
      ErrorCode.LINEAR_WEBHOOK_FAILED
    );
  }
  return value;
}

function getOptionalEnv(key: string): string | undefined {
  return process.env[key];
}

export interface LinearWebhookPayload {
  action: 'create' | 'update' | 'remove';
  createdAt: string;
  data: {
    id: string;
    identifier: string;
    title: string;
    description?: string;
    state: {
      id: string;
      name: string;
      type: 'backlog' | 'unstarted' | 'started' | 'completed' | 'cancelled';
    };
    priority?: number;
    estimate?: number;
    assignee?: {
      id: string;
      name: string;
      email: string;
    };
    labels?: Array<{ id: string; name: string }>;
    updatedAt: string;
    url: string;
  };
  type: 'Issue';
  organizationId: string;
  webhookId: string;
}

export class LinearWebhookHandler {
  private taskStore: LinearTaskManager;
  private syncEngine: LinearSyncEngine | null = null;
  private webhookSecret: string;

  constructor(taskStore: LinearTaskManager, webhookSecret: string) {
    this.taskStore = taskStore;
    this.webhookSecret = webhookSecret;

    // Initialize sync engine if API key is available
    if (process.env['LINEAR_API_KEY']) {
      const authManager = new LinearAuthManager();
      this.syncEngine = new LinearSyncEngine(taskStore, authManager, {
        enabled: true,
        direction: 'from_linear',
        autoSync: false,
        conflictResolution: 'linear_wins',
      });
    }
  }

  /**
   * Verify webhook signature
   */
  private verifySignature(payload: string, signature: string): boolean {
    const hmac = createHmac('sha256', this.webhookSecret);
    hmac.update(payload);
    const expectedSignature = hmac.digest('hex');
    return signature === expectedSignature;
  }

  /**
   * Handle incoming webhook from Linear
   */
  async handleWebhook(req: Request, res: Response): Promise<void> {
    try {
      // Get raw body for signature verification
      const rawBody = JSON.stringify(req.body);
      const signature = req.headers['linear-signature'] as string;

      // Verify signature
      if (!this.verifySignature(rawBody, signature)) {
        logger.error('Invalid webhook signature');
        res.status(401).json({ error: 'Invalid signature' });
        return;
      }

      const payload = req.body as LinearWebhookPayload;

      // Only process Issue webhooks
      if (payload.type !== 'Issue') {
        res.status(200).json({ message: 'Ignored non-issue webhook' });
        return;
      }

      // Process based on action
      switch (payload.action) {
        case 'create':
          await this.handleIssueCreate(payload);
          break;
        case 'update':
          await this.handleIssueUpdate(payload);
          break;
        case 'remove':
          await this.handleIssueRemove(payload);
          break;
        default:
          logger.warn(`Unknown webhook action: ${payload.action}`);
      }

      res.status(200).json({ message: 'Webhook processed successfully' });
    } catch (error: unknown) {
      logger.error('Failed to process webhook:', error as Error);
      res.status(500).json({ error: 'Failed to process webhook' });
    }
  }

  /**
   * Handle issue creation
   */
  private async handleIssueCreate(
    payload: LinearWebhookPayload
  ): Promise<void> {
    const issue = payload.data;

    // Check if task already exists locally
    const existingTasks = this.taskStore.getActiveTasks();
    const exists = existingTasks.some(
      (t) =>
        t.title.includes(issue.identifier) ||
        t.external_refs?.linear === issue.id
    );

    if (exists) {
      logger.info(`Task ${issue.identifier} already exists locally`);
      return;
    }

    // Create local task
    const taskId = this.taskStore.createTask({
      title: `[${issue.identifier}] ${issue.title}`,
      description: issue.description || '',
      priority: this.mapLinearPriorityToLocal(issue.priority),
      frameId: 'linear-webhook',
      tags: issue.labels?.map((l) => l.name) || ['linear'],
      estimatedEffort: issue.estimate ? issue.estimate * 60 : undefined,
      assignee: issue.assignee?.name,
    });

    // Update task status if not pending
    const status = this.mapLinearStateToLocalStatus(issue.state.type);
    if (status !== 'pending') {
      this.taskStore.updateTaskStatus(
        taskId,
        status,
        `Synced from Linear (${issue.state.name})`
      );
    }

    // Store Linear mapping
    await this.storeLinearMapping(taskId, issue.id, issue.identifier);

    logger.info(`Created task ${taskId} from Linear issue ${issue.identifier}`);
  }

  /**
   * Handle issue update
   */
  private async handleIssueUpdate(
    payload: LinearWebhookPayload
  ): Promise<void> {
    const issue = payload.data;

    // Find local task by Linear ID or identifier
    const tasks = this.taskStore.getActiveTasks();
    const localTask = tasks.find(
      (t) =>
        t.title.includes(issue.identifier) ||
        t.external_refs?.linear === issue.id
    );

    if (!localTask) {
      // Task doesn't exist locally, create it
      await this.handleIssueCreate(payload);
      return;
    }

    // Update task status
    const newStatus = this.mapLinearStateToLocalStatus(issue.state.type);
    if (newStatus !== localTask.status) {
      this.taskStore.updateTaskStatus(
        localTask.id,
        newStatus,
        `Updated from Linear (${issue.state.name})`
      );
    }

    // Update priority if changed
    const newPriority = this.mapLinearPriorityToLocal(issue.priority);
    if (newPriority !== localTask.priority) {
      // Note: Would need to add updateTaskPriority method to taskStore
      logger.info(
        `Priority changed for ${issue.identifier}: ${localTask.priority} -> ${newPriority}`
      );
    }

    logger.info(
      `Updated task ${localTask.id} from Linear issue ${issue.identifier}`
    );
  }

  /**
   * Handle issue removal
   */
  private async handleIssueRemove(
    payload: LinearWebhookPayload
  ): Promise<void> {
    const issue = payload.data;

    // Find and cancel local task
    const tasks = this.taskStore.getActiveTasks();
    const localTask = tasks.find(
      (t) =>
        t.title.includes(issue.identifier) ||
        t.external_refs?.linear === issue.id
    );

    if (localTask) {
      this.taskStore.updateTaskStatus(
        localTask.id,
        'cancelled',
        `Removed in Linear`
      );
      logger.info(
        `Cancelled task ${localTask.id} (Linear issue ${issue.identifier} was removed)`
      );
    }
  }

  /**
   * Store Linear mapping for a task
   */
  private async storeLinearMapping(
    taskId: string,
    linearId: string,
    linearIdentifier: string
  ): Promise<void> {
    // This would update the linear-mappings.json file
    // For now, just log it
    logger.info(
      `Mapped task ${taskId} to Linear ${linearIdentifier} (${linearId})`
    );
  }

  /**
   * Map Linear priority to local priority
   */
  private mapLinearPriorityToLocal(
    priority?: number
  ): 'urgent' | 'high' | 'medium' | 'low' {
    if (!priority) return 'medium';
    switch (priority) {
      case 0:
        return 'urgent';
      case 1:
        return 'high';
      case 2:
        return 'medium';
      case 3:
      case 4:
        return 'low';
      default:
        return 'medium';
    }
  }

  /**
   * Map Linear state to local status
   */
  private mapLinearStateToLocalStatus(
    state: string
  ): 'pending' | 'in_progress' | 'completed' | 'cancelled' | 'blocked' {
    switch (state) {
      case 'backlog':
      case 'unstarted':
        return 'pending';
      case 'started':
        return 'in_progress';
      case 'completed':
        return 'completed';
      case 'cancelled':
        return 'cancelled';
      default:
        return 'pending';
    }
  }
}
