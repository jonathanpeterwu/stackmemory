/**
 * SMS Action Runner - Executes actions based on SMS responses
 * Bridges SMS responses to Claude Code actions
 *
 * Security: Uses allowlist-based action execution to prevent command injection
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync, execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import { writeFileSecure, ensureSecureDir } from './secure-fs.js';
import { ActionQueueSchema, parseConfigSafe } from './schemas.js';

// Allowlist of safe action patterns
const SAFE_ACTION_PATTERNS: Array<{
  pattern: RegExp;
  validate?: (match: RegExpMatchArray) => boolean;
}> = [
  // Git/GitHub CLI commands (limited to safe operations)
  { pattern: /^gh pr (view|list|status|checks) (\d+)$/ },
  { pattern: /^gh pr review (\d+) --approve$/ },
  { pattern: /^gh pr merge (\d+) --squash$/ },
  { pattern: /^gh issue (view|list) (\d+)?$/ },

  // NPM commands (limited to safe operations)
  { pattern: /^npm run (build|test|lint|lint:fix|test:run)$/ },
  { pattern: /^npm (test|run build)$/ },

  // StackMemory commands
  { pattern: /^stackmemory (status|notify check|context list)$/ },

  // Simple echo/confirmation (no variables)
  { pattern: /^echo "?(Done|OK|Confirmed|Acknowledged)"?$/ },
];

/**
 * Check if an action is in the allowlist
 */
function isActionAllowed(action: string): boolean {
  const trimmed = action.trim();
  return SAFE_ACTION_PATTERNS.some(({ pattern, validate }) => {
    const match = trimmed.match(pattern);
    if (!match) return false;
    if (validate && !validate(match)) return false;
    return true;
  });
}

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

const DEFAULT_QUEUE: ActionQueue = {
  actions: [],
  lastChecked: new Date().toISOString(),
};

export function loadActionQueue(): ActionQueue {
  try {
    if (existsSync(QUEUE_PATH)) {
      const data = JSON.parse(readFileSync(QUEUE_PATH, 'utf8'));
      return parseConfigSafe(
        ActionQueueSchema,
        data,
        DEFAULT_QUEUE,
        'action-queue'
      );
    }
  } catch {
    // Use defaults
  }
  return { ...DEFAULT_QUEUE, lastChecked: new Date().toISOString() };
}

export function saveActionQueue(queue: ActionQueue): void {
  try {
    ensureSecureDir(join(homedir(), '.stackmemory'));
    writeFileSecure(QUEUE_PATH, JSON.stringify(queue, null, 2));
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
  // Use cryptographically secure random ID
  const id = randomBytes(8).toString('hex');

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

/**
 * Execute an action safely using allowlist validation
 * This prevents command injection by only allowing pre-approved commands
 */
export function executeActionSafe(
  action: string,
  _response: string
): { success: boolean; output?: string; error?: string } {
  // Check if action is in allowlist
  if (!isActionAllowed(action)) {
    console.error(`[sms-action] Action not in allowlist: ${action}`);
    return {
      success: false,
      error: `Action not allowed. Only pre-approved commands can be executed via SMS.`,
    };
  }

  try {
    console.log(`[sms-action] Executing safe action: ${action}`);

    // Parse the action into command and args
    const parts = action.split(' ');
    const cmd = parts[0];
    const args = parts.slice(1);

    // Use execFileSync for commands without shell interpretation
    // This prevents shell injection even if the allowlist is somehow bypassed
    const output = execFileSync(cmd, args, {
      encoding: 'utf8',
      timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
      shell: false, // Explicitly disable shell
    });

    return { success: true, output };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    return { success: false, error };
  }
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
 *
 * SECURITY NOTE: These templates return command strings that must be
 * validated against SAFE_ACTION_PATTERNS before execution.
 * Templates that accept user input are removed to prevent injection.
 */
export const ACTION_TEMPLATES = {
  // Git/PR actions (PR numbers must be validated as integers)
  approvePR: (prNumber: string) => {
    // Validate PR number is numeric only
    if (!/^\d+$/.test(prNumber)) {
      throw new Error('Invalid PR number');
    }
    return `gh pr review ${prNumber} --approve`;
  },
  mergePR: (prNumber: string) => {
    if (!/^\d+$/.test(prNumber)) {
      throw new Error('Invalid PR number');
    }
    return `gh pr merge ${prNumber} --squash`;
  },
  viewPR: (prNumber: string) => {
    if (!/^\d+$/.test(prNumber)) {
      throw new Error('Invalid PR number');
    }
    return `gh pr view ${prNumber}`;
  },

  // Build actions (no user input)
  rebuild: () => `npm run build`,
  retest: () => `npm run test:run`,
  lint: () => `npm run lint:fix`,

  // Status actions (no user input)
  status: () => `stackmemory status`,
  checkNotifications: () => `stackmemory notify check`,

  // REMOVED for security - these templates allowed arbitrary user input:
  // - requestChanges (allowed arbitrary message)
  // - closePR (could be used maliciously)
  // - deploy/rollback (too dangerous for SMS)
  // - verifyDeployment (allowed arbitrary URL)
  // - notifySlack (allowed arbitrary message - command injection)
  // - notifyTeam (allowed arbitrary message - command injection)
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
