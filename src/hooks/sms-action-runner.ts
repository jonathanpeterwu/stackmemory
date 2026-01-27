/**
 * SMS Action Runner - Executes actions based on SMS responses
 * Bridges SMS responses to Claude Code actions
 *
 * Security: Uses allowlist-based action execution to prevent command injection
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execFileSync } from 'child_process';
import { randomBytes } from 'crypto';
import { writeFileSecure, ensureSecureDir } from './secure-fs.js';
import { ActionQueueSchema, parseConfigSafe } from './schemas.js';
import { LinearClient } from '../integrations/linear/client.js';
import { LinearAuthManager } from '../integrations/linear/auth.js';

/**
 * Parse a command string into an array of arguments, respecting quotes
 * Handles single quotes, double quotes, and escaped characters
 *
 * Examples:
 *   'echo "hello world"' -> ['echo', 'hello world']
 *   "git commit -m 'fix bug'" -> ['git', 'commit', '-m', 'fix bug']
 *   'npm run build' -> ['npm', 'run', 'build']
 */
function parseCommandArgs(command: string): string[] {
  const args: string[] = [];
  let current = '';
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < command.length; i++) {
    const char = command[i];

    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      escaped = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (char === ' ' && !inSingleQuote && !inDoubleQuote) {
      if (current.length > 0) {
        args.push(current);
        current = '';
      }
      continue;
    }

    current += char;
  }

  if (current.length > 0) {
    args.push(current);
  }

  return args;
}

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
  // Task start with optional --assign-me flag (Linear task ID is UUID format)
  {
    pattern: /^stackmemory task start ([a-f0-9-]{36})( --assign-me)?$/,
  },
  // Additional StackMemory commands for mobile/WhatsApp
  { pattern: /^stackmemory context show$/ },
  { pattern: /^stackmemory task list$/ },

  // Git commands
  { pattern: /^git (status|diff|log|branch)( --[a-z-]+)*$/ },
  { pattern: /^git add -A && git commit$/ },
  { pattern: /^gh pr create --fill$/ },
  // Git log with line limit for mobile-friendly output
  { pattern: /^git log --oneline -\d{1,2}$/ },

  // WhatsApp/Mobile quick commands
  { pattern: /^status$/i },
  { pattern: /^tasks$/i },
  { pattern: /^context$/i },
  { pattern: /^help$/i },
  { pattern: /^sync$/i },

  // Claude Code launcher
  { pattern: /^claude-sm$/ },

  // Log viewing (safe read-only)
  { pattern: /^tail -\d+ ~\/\.claude\/logs\/\*\.log$/ },

  // Custom aliases (cwm = claude worktree merge)
  { pattern: /^cwm$/ },

  // Simple echo/confirmation (no variables)
  {
    pattern:
      /^echo "?(Done|OK|Confirmed|Acknowledged|Great work! Time for a coffee break\.)"?$/,
  },
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

export interface ActionResult {
  success: boolean;
  output?: string;
  error?: string;
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
 * Get Linear client if available
 * Returns null if credentials are missing or invalid
 */
function getLinearClient(): LinearClient | null {
  // Try API key first - must be valid format (lin_api_*)
  const apiKey = process.env['LINEAR_API_KEY'];
  if (apiKey && apiKey.startsWith('lin_api_')) {
    return new LinearClient({ apiKey });
  }

  try {
    const authManager = new LinearAuthManager();
    const tokens = authManager.loadTokens();
    if (tokens?.accessToken) {
      return new LinearClient({ accessToken: tokens.accessToken });
    }
  } catch {
    // Auth not available
  }

  return null;
}

/**
 * Handle special actions that require API calls instead of shell commands
 */
async function handleSpecialAction(action: string): Promise<{
  handled: boolean;
  success?: boolean;
  output?: string;
  error?: string;
}> {
  // Handle stackmemory task start command
  const taskStartMatch = action.match(
    /^stackmemory task start ([a-f0-9-]{36})( --assign-me)?$/
  );
  if (taskStartMatch) {
    const issueId = taskStartMatch[1];
    const client = getLinearClient();

    if (!client) {
      return {
        handled: true,
        success: false,
        error:
          'Linear not configured. Set LINEAR_API_KEY or run stackmemory linear setup.',
      };
    }

    try {
      const result = await client.startIssue(issueId);
      if (result.success && result.issue) {
        return {
          handled: true,
          success: true,
          output: `Started: ${result.issue.identifier} - ${result.issue.title}`,
        };
      }
      return {
        handled: true,
        success: false,
        error: result.error || 'Failed to start issue',
      };
    } catch (err) {
      return {
        handled: true,
        success: false,
        error: err instanceof Error ? err.message : 'Unknown error',
      };
    }
  }

  return { handled: false };
}

/**
 * Execute an action safely using allowlist validation
 * This prevents command injection by only allowing pre-approved commands
 */
export async function executeActionSafe(
  action: string,
  _response: string
): Promise<{ success: boolean; output?: string; error?: string }> {
  // Check if action is in allowlist
  if (!isActionAllowed(action)) {
    console.error(`[sms-action] Action not in allowlist: ${action}`);
    return {
      success: false,
      error: `Action not allowed. Only pre-approved commands can be executed via SMS.`,
    };
  }

  // Check for special actions that need API calls
  const specialResult = await handleSpecialAction(action);
  if (specialResult.handled) {
    return {
      success: specialResult.success || false,
      output: specialResult.output,
      error: specialResult.error,
    };
  }

  try {
    console.log(`[sms-action] Executing safe action: ${action}`);

    // Parse the action into command and args, respecting quotes
    const parts = parseCommandArgs(action);
    if (parts.length === 0) {
      return { success: false, error: 'Empty command' };
    }

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

export async function executeAction(action: PendingAction): Promise<{
  success: boolean;
  output?: string;
  error?: string;
}> {
  markActionRunning(action.id);

  // Use the safe execution path to prevent command injection
  const result = await executeActionSafe(action.action, action.response);

  if (result.success) {
    markActionCompleted(action.id, result.output);
  } else {
    markActionCompleted(action.id, undefined, result.error);
  }

  return result;
}

export async function processAllPendingActions(): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
}> {
  const pending = getPendingActions();
  let succeeded = 0;
  let failed = 0;

  for (const action of pending) {
    const result = await executeAction(action);
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
