/**
 * SMS Action Runner - Executes actions based on SMS responses
 * Bridges SMS responses to Claude Code actions
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

export interface PendingAction {
  id: string;
  promptId: string;
  response: string;
  action: string;
  timestamp: string;
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: string;
  error?: string;
}

export interface ActionQueue {
  actions: PendingAction[];
  lastChecked: string;
}

const QUEUE_PATH = join(homedir(), '.stackmemory', 'sms-action-queue.json');

export function loadActionQueue(): ActionQueue {
  try {
    if (existsSync(QUEUE_PATH)) {
      return JSON.parse(readFileSync(QUEUE_PATH, 'utf8'));
    }
  } catch {
    // Use defaults
  }
  return { actions: [], lastChecked: new Date().toISOString() };
}

export function saveActionQueue(queue: ActionQueue): void {
  try {
    const dir = join(homedir(), '.stackmemory');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));
  } catch {
    // Silently fail
  }
}

export function queueAction(
  promptId: string,
  response: string,
  action: string
): string {
  const queue = loadActionQueue();
  const id = Math.random().toString(36).substring(2, 10);

  queue.actions.push({
    id,
    promptId,
    response,
    action,
    timestamp: new Date().toISOString(),
    status: 'pending',
  });

  saveActionQueue(queue);
  return id;
}

export function getPendingActions(): PendingAction[] {
  const queue = loadActionQueue();
  return queue.actions.filter((a) => a.status === 'pending');
}

export function markActionRunning(id: string): void {
  const queue = loadActionQueue();
  const action = queue.actions.find((a) => a.id === id);
  if (action) {
    action.status = 'running';
    saveActionQueue(queue);
  }
}

export function markActionCompleted(
  id: string,
  result?: string,
  error?: string
): void {
  const queue = loadActionQueue();
  const action = queue.actions.find((a) => a.id === id);
  if (action) {
    action.status = error ? 'failed' : 'completed';
    action.result = result;
    action.error = error;
    saveActionQueue(queue);
  }
}

export function executeAction(action: PendingAction): {
  success: boolean;
  output?: string;
  error?: string;
} {
  markActionRunning(action.id);

  try {
    console.log(`[sms-action] Executing: ${action.action}`);

    // Execute the action
    const output = execSync(action.action, {
      encoding: 'utf8',
      timeout: 60000, // 1 minute timeout
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    markActionCompleted(action.id, output);
    return { success: true, output };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    markActionCompleted(action.id, undefined, error);
    return { success: false, error };
  }
}

export function processAllPendingActions(): {
  processed: number;
  succeeded: number;
  failed: number;
} {
  const pending = getPendingActions();
  let succeeded = 0;
  let failed = 0;

  for (const action of pending) {
    const result = executeAction(action);
    if (result.success) {
      succeeded++;
    } else {
      failed++;
    }
  }

  return { processed: pending.length, succeeded, failed };
}

// Clean up old completed actions (keep last 50)
export function cleanupOldActions(): number {
  const queue = loadActionQueue();
  const completed = queue.actions.filter(
    (a) => a.status === 'completed' || a.status === 'failed'
  );

  if (completed.length > 50) {
    const toRemove = completed.slice(0, completed.length - 50);
    queue.actions = queue.actions.filter(
      (a) => !toRemove.find((r) => r.id === a.id)
    );
    saveActionQueue(queue);
    return toRemove.length;
  }

  return 0;
}

/**
 * Action Templates - Common actions for SMS responses
 */
export const ACTION_TEMPLATES = {
  // Git/PR actions
  approvePR: (prNumber: string) =>
    `gh pr review ${prNumber} --approve && gh pr merge ${prNumber} --auto`,
  requestChanges: (prNumber: string) =>
    `gh pr review ${prNumber} --request-changes -b "Changes requested via SMS"`,
  mergePR: (prNumber: string) => `gh pr merge ${prNumber} --squash`,
  closePR: (prNumber: string) => `gh pr close ${prNumber}`,

  // Deployment actions
  deploy: (env: string = 'production') => `npm run deploy:${env}`,
  rollback: (env: string = 'production') => `npm run rollback:${env}`,
  verifyDeployment: (url: string) => `curl -sf ${url}/health || exit 1`,

  // Build actions
  rebuild: () => `npm run build`,
  retest: () => `npm test`,
  lint: () => `npm run lint:fix`,

  // Notification actions
  notifySlack: (message: string) =>
    `curl -X POST $SLACK_WEBHOOK -d '{"text":"${message}"}'`,
  notifyTeam: (message: string) =>
    `stackmemory notify send "${message}" --title "Team Alert"`,
};

/**
 * Create action string from template
 */
export function createAction(
  template: keyof typeof ACTION_TEMPLATES,
  ...args: string[]
): string {
  const fn = ACTION_TEMPLATES[template];
  if (typeof fn === 'function') {
    return (fn as (...args: string[]) => string)(...args);
  }
  return fn;
}

/**
 * Watch for new actions and execute them
 */
export function startActionWatcher(intervalMs: number = 5000): NodeJS.Timeout {
  console.log(
    `[sms-action] Starting action watcher (interval: ${intervalMs}ms)`
  );

  return setInterval(() => {
    const pending = getPendingActions();
    if (pending.length > 0) {
      console.log(`[sms-action] Found ${pending.length} pending action(s)`);
      processAllPendingActions();
    }
  }, intervalMs);
}

/**
 * Integration with SMS webhook - queue action when response received
 */
export function handleSMSResponse(
  promptId: string,
  response: string,
  action?: string
): void {
  if (action) {
    const actionId = queueAction(promptId, response, action);
    console.log(`[sms-action] Queued action ${actionId}: ${action}`);
  }
}
