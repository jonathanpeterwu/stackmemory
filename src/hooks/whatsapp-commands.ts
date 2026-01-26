/**
 * WhatsApp Inbound Command Processor
 * Process WhatsApp messages as commands
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execFileSync } from 'child_process';
import { writeFileSecure, ensureSecureDir } from './secure-fs.js';
import { WhatsAppCommandsConfigSchema, parseConfigSafe } from './schemas.js';
import { executeActionSafe } from './sms-action-runner.js';
import {
  syncContext,
  getFrameDigestData,
  generateMobileDigest,
  loadSyncOptions,
} from './whatsapp-sync.js';
import { sendNotification } from './sms-notify.js';

// ReDoS protection: max execution time for regex test (ms)
const REGEX_TIMEOUT_MS = 100;
// Max input length for regex matching to prevent catastrophic backtracking
const MAX_REGEX_INPUT_LENGTH = 200;

/**
 * Safely test a regex pattern against input with ReDoS protection
 * Returns false if pattern is invalid, times out, or doesn't match
 */
function safeRegexTest(pattern: string, input: string): boolean {
  // Truncate input to prevent catastrophic backtracking
  const safeInput = input.slice(0, MAX_REGEX_INPUT_LENGTH);

  try {
    const regex = new RegExp(pattern);

    // Use a simple timeout approach - run in try/catch with limited input
    // For true async timeout, we'd need Worker threads which adds complexity
    const startTime = Date.now();
    const result = regex.test(safeInput);
    const elapsed = Date.now() - startTime;

    // Log warning if regex took too long (could indicate ReDoS attempt)
    if (elapsed > REGEX_TIMEOUT_MS) {
      console.warn(
        `[whatsapp-commands] Slow regex detected: ${pattern} took ${elapsed}ms`
      );
      return false;
    }

    return result;
  } catch {
    // Invalid regex pattern
    console.warn(`[whatsapp-commands] Invalid regex pattern: ${pattern}`);
    return false;
  }
}

export interface WhatsAppCommand {
  name: string;
  description: string;
  enabled: boolean;
  action?: string; // Safe action to execute
  requiresArg?: boolean;
  argPattern?: string; // Regex pattern for arg validation
}

export interface CommandsConfig {
  enabled: boolean;
  commands: WhatsAppCommand[];
}

export interface CommandResult {
  handled: boolean;
  response?: string;
  action?: string;
  error?: string;
}

const CONFIG_PATH = join(homedir(), '.stackmemory', 'whatsapp-commands.json');
const REMOTE_SESSIONS_PATH = join(
  homedir(),
  '.stackmemory',
  'remote-sessions.json'
);

/**
 * Remote session tracking
 */
export interface RemoteSession {
  id: string;
  url: string;
  prompt: string;
  createdAt: string;
  status: 'active' | 'completed' | 'failed';
  lastActivity?: string;
}

interface RemoteSessionsStore {
  sessions: RemoteSession[];
}

function loadRemoteSessions(): RemoteSessionsStore {
  try {
    if (existsSync(REMOTE_SESSIONS_PATH)) {
      return JSON.parse(readFileSync(REMOTE_SESSIONS_PATH, 'utf8'));
    }
  } catch {
    // Use defaults
  }
  return { sessions: [] };
}

function saveRemoteSessions(store: RemoteSessionsStore): void {
  try {
    ensureSecureDir(join(homedir(), '.stackmemory'));
    writeFileSecure(REMOTE_SESSIONS_PATH, JSON.stringify(store, null, 2));
  } catch {
    // Silently fail
  }
}

function addRemoteSession(session: RemoteSession): void {
  const store = loadRemoteSessions();
  // Keep last 20 sessions
  store.sessions = [session, ...store.sessions.slice(0, 19)];
  saveRemoteSessions(store);
}

export function getRemoteSessions(): RemoteSession[] {
  return loadRemoteSessions().sessions;
}

export function getActiveRemoteSessions(): RemoteSession[] {
  return loadRemoteSessions().sessions.filter((s) => s.status === 'active');
}

// Default supported commands
const DEFAULT_COMMANDS: WhatsAppCommand[] = [
  {
    name: 'status',
    description: 'Get current task/frame status',
    enabled: true,
    // No action - handled specially in-process
  },
  {
    name: 'tasks',
    description: 'List active tasks',
    enabled: true,
    // No action - handled specially in-process
  },
  {
    name: 'context',
    description: 'Get latest context digest',
    enabled: true,
    // No action - handled specially
  },
  {
    name: 'approve',
    description: 'Approve a PR (requires PR number)',
    enabled: true,
    requiresArg: true,
    argPattern: '^\\d+$', // PR number must be numeric
  },
  {
    name: 'merge',
    description: 'Merge a PR (requires PR number)',
    enabled: true,
    requiresArg: true,
    argPattern: '^\\d+$',
  },
  {
    name: 'help',
    description: 'List available commands',
    enabled: true,
    // No action - handled specially
  },
  {
    name: 'sync',
    description: 'Push current context to WhatsApp',
    enabled: true,
    // No action - handled specially
  },
  {
    name: 'build',
    description: 'Run npm build',
    enabled: true,
    action: 'npm run build',
  },
  {
    name: 'test',
    description: 'Run tests',
    enabled: true,
    action: 'npm run test:run',
  },
  {
    name: 'lint',
    description: 'Run linter',
    enabled: true,
    action: 'npm run lint',
  },
  {
    name: 'log',
    description: 'Show recent git commits',
    enabled: true,
    action: 'git log --oneline -5',
  },
  {
    name: 'diff',
    description: 'Show git diff summary',
    enabled: true,
    action: 'git diff --stat',
  },
  {
    name: 'pr',
    description: 'List open PRs',
    enabled: true,
    action: 'gh pr list',
  },
  {
    name: 'branch',
    description: 'Show current branch',
    enabled: true,
    action: 'git branch --show-current',
  },
  {
    name: 'remote',
    description: 'Launch remote Claude session (requires task prompt)',
    enabled: true,
    requiresArg: true,
    // No action - handled specially to capture session URL
  },
  {
    name: 'sessions',
    description: 'List active remote sessions',
    enabled: true,
    // No action - handled specially
  },
];

const DEFAULT_CONFIG: CommandsConfig = {
  enabled: true,
  commands: DEFAULT_COMMANDS,
};

/**
 * Load commands config
 */
export function loadCommandsConfig(): CommandsConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const data = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
      return parseConfigSafe(
        WhatsAppCommandsConfigSchema,
        { ...DEFAULT_CONFIG, ...data },
        DEFAULT_CONFIG,
        'whatsapp-commands'
      );
    }
  } catch {
    // Use defaults
  }
  return { ...DEFAULT_CONFIG };
}

/**
 * Save commands config
 */
export function saveCommandsConfig(config: CommandsConfig): void {
  try {
    ensureSecureDir(join(homedir(), '.stackmemory'));
    writeFileSecure(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch {
    // Silently fail
  }
}

/**
 * Check if a message is a command
 */
export function isCommand(message: string): boolean {
  const trimmed = message.trim().toLowerCase();

  // Check if it's a single word command
  const config = loadCommandsConfig();
  if (!config.enabled) return false;

  const words = trimmed.split(/\s+/);
  const firstWord = words[0];

  return config.commands.some(
    (cmd) => cmd.enabled && cmd.name.toLowerCase() === firstWord
  );
}

/**
 * Parse command from message
 */
function parseCommand(message: string): { name: string; arg?: string } | null {
  const trimmed = message.trim();
  const words = trimmed.split(/\s+/);

  if (words.length === 0) return null;

  const name = words[0].toLowerCase();
  const arg = words.slice(1).join(' ').trim() || undefined;

  return { name, arg };
}

/**
 * Generate help text for available commands
 */
function generateHelpText(config: CommandsConfig): string {
  const lines: string[] = ['Available commands:'];

  config.commands
    .filter((cmd) => cmd.enabled)
    .forEach((cmd) => {
      const argHint = cmd.requiresArg ? ' <arg>' : '';
      lines.push(`  ${cmd.name}${argHint} - ${cmd.description}`);
    });

  lines.push('');
  lines.push('Reply with command name to execute');

  return lines.join('\n');
}

/**
 * Handle the 'context' command specially
 */
async function handleContextCommand(): Promise<string> {
  const data = await getFrameDigestData();

  if (!data) {
    return 'No context available. Start a task first.';
  }

  const options = loadSyncOptions();
  return generateMobileDigest(data, options);
}

/**
 * Handle the 'sync' command specially
 */
async function handleSyncCommand(): Promise<string> {
  const result = await syncContext();

  if (result.success) {
    return `Context synced (${result.digestLength} chars)`;
  } else {
    return `Sync failed: ${result.error}`;
  }
}

/**
 * Handle the 'status' command - get current frame/task status
 */
async function handleStatusCommand(): Promise<string> {
  try {
    const data = await getFrameDigestData();
    if (!data) {
      return 'No active session. Start with: claude-sm';
    }

    const lines: string[] = [];
    lines.push(`Frame: ${data.name || data.frameId}`);
    lines.push(`Status: ${data.status}`);
    lines.push(`Files: ${data.filesModified?.length || 0} modified`);
    lines.push(`Tools: ${data.toolCallCount || 0} calls`);
    if (data.errors?.length > 0) {
      const unresolved = data.errors.filter((e) => !e.resolved).length;
      if (unresolved > 0) lines.push(`Errors: ${unresolved} unresolved`);
    }
    lines.push(`Duration: ${Math.round(data.durationSeconds / 60)}min`);

    return lines.join('\n');
  } catch {
    return 'Status unavailable';
  }
}

/**
 * Handle the 'tasks' command - list recent decisions/risks
 */
async function handleTasksCommand(): Promise<string> {
  try {
    const data = await getFrameDigestData();
    if (!data) {
      return 'No active tasks';
    }

    const lines: string[] = [];

    if (data.decisions?.length > 0) {
      lines.push('Recent decisions:');
      data.decisions.slice(0, 3).forEach((d, i) => {
        lines.push(
          `${i + 1}. ${d.substring(0, 50)}${d.length > 50 ? '...' : ''}`
        );
      });
    }

    if (data.risks?.length > 0) {
      lines.push('');
      lines.push('Risks:');
      data.risks.slice(0, 2).forEach((r) => {
        lines.push(`- ${r.substring(0, 50)}${r.length > 50 ? '...' : ''}`);
      });
    }

    if (lines.length === 0) {
      return 'No active tasks or decisions';
    }

    return lines.join('\n');
  } catch {
    return 'Tasks unavailable';
  }
}

/**
 * Handle the 'remote' command - launch a remote Claude session
 */
async function handleRemoteCommand(prompt: string): Promise<string> {
  try {
    // Sanitize prompt - remove any shell-dangerous characters
    const sanitizedPrompt = prompt
      .replace(/[`$\\]/g, '')
      .replace(/["']/g, "'")
      .substring(0, 500);

    if (!sanitizedPrompt.trim()) {
      return 'Please provide a task prompt. Usage: remote <your task>';
    }

    console.log(
      `[whatsapp-commands] Launching remote session: ${sanitizedPrompt.substring(0, 50)}...`
    );

    // Execute claude --remote with the prompt
    const output = execFileSync('claude', ['--remote', sanitizedPrompt], {
      encoding: 'utf8',
      timeout: 30000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Parse session URL from output
    // Expected format contains: https://claude.ai/code/session_...
    const urlMatch = output.match(
      /https:\/\/claude\.ai\/code\/session_[a-zA-Z0-9]+/
    );

    if (urlMatch) {
      const sessionUrl = urlMatch[0];
      const sessionId = sessionUrl.split('/').pop() || 'unknown';

      // Store the session
      addRemoteSession({
        id: sessionId,
        url: sessionUrl,
        prompt: sanitizedPrompt,
        createdAt: new Date().toISOString(),
        status: 'active',
      });

      return `Remote session launched!\n\n${sessionUrl}\n\nTask: ${sanitizedPrompt.substring(0, 100)}`;
    }

    // No URL found - return raw output
    return `Session launched:\n${output.substring(0, 300)}`;
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.error(`[whatsapp-commands] Remote launch failed: ${error}`);
    return `Failed to launch remote session: ${error.substring(0, 100)}`;
  }
}

/**
 * Handle the 'sessions' command - list active remote sessions
 */
function handleSessionsCommand(): string {
  const sessions = getActiveRemoteSessions();

  if (sessions.length === 0) {
    return 'No active remote sessions';
  }

  const lines: string[] = ['Active remote sessions:'];

  sessions.slice(0, 5).forEach((s, i) => {
    const age = Math.round(
      (Date.now() - new Date(s.createdAt).getTime()) / 60000
    );
    const ageStr = age < 60 ? `${age}m ago` : `${Math.round(age / 60)}h ago`;
    lines.push(`${i + 1}. ${s.prompt.substring(0, 40)}... (${ageStr})`);
    lines.push(`   ${s.url}`);
  });

  return lines.join('\n');
}

/**
 * Process an incoming WhatsApp command
 */
export async function processCommand(
  from: string,
  message: string
): Promise<CommandResult> {
  const config = loadCommandsConfig();

  if (!config.enabled) {
    return { handled: false };
  }

  const parsed = parseCommand(message);
  if (!parsed) {
    return { handled: false };
  }

  const command = config.commands.find(
    (cmd) => cmd.enabled && cmd.name.toLowerCase() === parsed.name
  );

  if (!command) {
    return { handled: false };
  }

  // Handle special commands
  if (command.name === 'help') {
    const helpText = generateHelpText(config);
    return { handled: true, response: helpText };
  }

  if (command.name === 'context') {
    const contextText = await handleContextCommand();
    return { handled: true, response: contextText };
  }

  if (command.name === 'sync') {
    const syncText = await handleSyncCommand();
    return { handled: true, response: syncText };
  }

  if (command.name === 'status') {
    const statusText = await handleStatusCommand();
    return { handled: true, response: statusText };
  }

  if (command.name === 'tasks') {
    const tasksText = await handleTasksCommand();
    return { handled: true, response: tasksText };
  }

  if (command.name === 'remote') {
    if (!parsed.arg) {
      return {
        handled: true,
        response:
          'Usage: remote <task prompt>\nExample: remote Fix the login bug',
        error: 'Missing prompt',
      };
    }
    const remoteText = await handleRemoteCommand(parsed.arg);
    return { handled: true, response: remoteText };
  }

  if (command.name === 'sessions') {
    const sessionsText = handleSessionsCommand();
    return { handled: true, response: sessionsText };
  }

  // Check if argument is required
  if (command.requiresArg && !parsed.arg) {
    return {
      handled: true,
      response: `${command.name} requires an argument. Usage: ${command.name} <arg>`,
      error: 'Missing argument',
    };
  }

  // Validate argument pattern if specified (with ReDoS protection)
  if (command.argPattern && parsed.arg) {
    if (!safeRegexTest(command.argPattern, parsed.arg)) {
      return {
        handled: true,
        response: `Invalid argument format for ${command.name}`,
        error: 'Invalid argument format',
      };
    }
  }

  // Build the action command
  let action = command.action;

  if (action && parsed.arg) {
    // Special handling for PR commands
    if (command.name === 'approve') {
      action = `gh pr review ${parsed.arg} --approve`;
    } else if (command.name === 'merge') {
      action = `gh pr merge ${parsed.arg} --squash`;
    }
  }

  // Execute the action if defined
  if (action) {
    console.log(`[whatsapp-commands] Executing: ${action}`);

    const result = await executeActionSafe(action, message);

    if (result.success) {
      const output = result.output?.slice(0, 200) || 'Done';
      return {
        handled: true,
        response: `${command.name}: ${output}`,
        action,
      };
    } else {
      return {
        handled: true,
        response: `${command.name} failed: ${result.error?.slice(0, 100)}`,
        error: result.error,
        action,
      };
    }
  }

  return {
    handled: true,
    response: `Command ${command.name} acknowledged`,
  };
}

/**
 * Send command result back via WhatsApp
 */
export async function sendCommandResponse(
  response: string
): Promise<{ success: boolean; error?: string }> {
  const result = await sendNotification({
    type: 'custom',
    title: 'Command Result',
    message: response,
  });

  return { success: result.success, error: result.error };
}

/**
 * Enable command processing
 */
export function enableCommands(): void {
  const config = loadCommandsConfig();
  config.enabled = true;
  saveCommandsConfig(config);
}

/**
 * Disable command processing
 */
export function disableCommands(): void {
  const config = loadCommandsConfig();
  config.enabled = false;
  saveCommandsConfig(config);
}

/**
 * Check if commands are enabled
 */
export function isCommandsEnabled(): boolean {
  const config = loadCommandsConfig();
  return config.enabled;
}

/**
 * Add a custom command
 */
export function addCommand(command: WhatsAppCommand): void {
  const config = loadCommandsConfig();

  // Check if command already exists
  const existingIndex = config.commands.findIndex(
    (c) => c.name.toLowerCase() === command.name.toLowerCase()
  );

  if (existingIndex >= 0) {
    config.commands[existingIndex] = command;
  } else {
    config.commands.push(command);
  }

  saveCommandsConfig(config);
}

/**
 * Remove a custom command
 */
export function removeCommand(name: string): boolean {
  const config = loadCommandsConfig();
  const initialLength = config.commands.length;

  config.commands = config.commands.filter(
    (c) => c.name.toLowerCase() !== name.toLowerCase()
  );

  if (config.commands.length < initialLength) {
    saveCommandsConfig(config);
    return true;
  }

  return false;
}

/**
 * Get list of available commands
 */
export function getAvailableCommands(): WhatsAppCommand[] {
  const config = loadCommandsConfig();
  return config.commands.filter((c) => c.enabled);
}
