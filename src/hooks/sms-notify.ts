/**
 * SMS Notification Hook for StackMemory
 * Sends text messages when tasks are ready for review
 * Supports interactive prompts with numbered options or yes/no
 *
 * Optional feature - requires Twilio setup
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { config as loadDotenv } from 'dotenv';
import { writeFileSecure, ensureSecureDir } from './secure-fs.js';
import { SMSConfigSchema, parseConfigSafe } from './schemas.js';

export type MessageChannel = 'whatsapp' | 'sms';

export interface SMSConfig {
  enabled: boolean;
  // Preferred channel: whatsapp is cheaper for back-and-forth conversations
  channel: MessageChannel;
  // Twilio credentials (from env or config)
  accountSid?: string;
  authToken?: string;
  // SMS numbers
  smsFromNumber?: string;
  smsToNumber?: string;
  // WhatsApp numbers (Twilio prefixes with 'whatsapp:' automatically)
  whatsappFromNumber?: string;
  whatsappToNumber?: string;
  // Legacy fields (backwards compatibility)
  fromNumber?: string;
  toNumber?: string;
  // Webhook URL for receiving responses
  webhookUrl?: string;
  // Notification preferences
  notifyOn: {
    taskComplete: boolean;
    reviewReady: boolean;
    error: boolean;
    custom: boolean;
    contextSync: boolean;
  };
  // Quiet hours (don't send during these times)
  quietHours?: {
    enabled: boolean;
    start: string; // "22:00"
    end: string; // "08:00"
  };
  // Response timeout (seconds)
  responseTimeout: number;
  // Pending prompts awaiting response
  pendingPrompts: PendingPrompt[];
}

export interface PendingPrompt {
  id: string;
  timestamp: string;
  message: string;
  options: PromptOption[];
  type: 'options' | 'yesno' | 'freeform';
  callback?: string; // Command to run with response
  expiresAt: string;
}

export interface PromptOption {
  key: string; // "1", "2", "y", "n", etc.
  label: string;
  action?: string; // Command to execute
}

export interface NotificationPayload {
  type: 'task_complete' | 'review_ready' | 'error' | 'custom' | 'context_sync';
  title: string;
  message: string;
  prompt?: {
    type: 'options' | 'yesno' | 'freeform';
    options?: PromptOption[];
    question?: string;
  };
  metadata?: Record<string, unknown>;
}

const CONFIG_PATH = join(homedir(), '.stackmemory', 'sms-notify.json');

const DEFAULT_CONFIG: SMSConfig = {
  enabled: false,
  channel: 'whatsapp', // WhatsApp is cheaper for conversations
  notifyOn: {
    taskComplete: true,
    reviewReady: true,
    error: true,
    custom: true,
    contextSync: true,
  },
  quietHours: {
    enabled: false,
    start: '22:00',
    end: '08:00',
  },
  responseTimeout: 300, // 5 minutes
  pendingPrompts: [],
};

export function loadSMSConfig(): SMSConfig {
  // Load .env files (project, home, global) - suppress debug logs
  loadDotenv({ path: join(process.cwd(), '.env'), debug: false });
  loadDotenv({ path: join(process.cwd(), '.env.local'), debug: false });
  loadDotenv({ path: join(homedir(), '.env'), debug: false });
  loadDotenv({ path: join(homedir(), '.stackmemory', '.env'), debug: false });

  try {
    if (existsSync(CONFIG_PATH)) {
      const data = readFileSync(CONFIG_PATH, 'utf8');
      const parsed = JSON.parse(data);
      // Validate with zod schema, fall back to defaults on invalid config
      const validated = parseConfigSafe(
        SMSConfigSchema,
        { ...DEFAULT_CONFIG, ...parsed },
        DEFAULT_CONFIG,
        'sms-notify'
      );
      applyEnvVars(validated);
      return validated;
    }
  } catch {
    // Use defaults
  }

  // Check environment variables
  const config = { ...DEFAULT_CONFIG };
  applyEnvVars(config);
  return config;
}

// Check what's missing for notifications to work
export function getMissingConfig(): {
  missing: string[];
  configured: string[];
  ready: boolean;
} {
  const config = loadSMSConfig();
  const missing: string[] = [];
  const configured: string[] = [];

  // Check credentials
  if (config.accountSid) {
    configured.push('TWILIO_ACCOUNT_SID');
  } else {
    missing.push('TWILIO_ACCOUNT_SID');
  }

  if (config.authToken) {
    configured.push('TWILIO_AUTH_TOKEN');
  } else {
    missing.push('TWILIO_AUTH_TOKEN');
  }

  // Check channel-specific numbers
  const channel = config.channel || 'whatsapp';

  if (channel === 'whatsapp') {
    const from = config.whatsappFromNumber || config.fromNumber;
    const to = config.whatsappToNumber || config.toNumber;

    if (from) {
      configured.push('TWILIO_WHATSAPP_FROM');
    } else {
      missing.push('TWILIO_WHATSAPP_FROM');
    }

    if (to) {
      configured.push('TWILIO_WHATSAPP_TO');
    } else {
      missing.push('TWILIO_WHATSAPP_TO');
    }
  } else {
    const from = config.smsFromNumber || config.fromNumber;
    const to = config.smsToNumber || config.toNumber;

    if (from) {
      configured.push('TWILIO_SMS_FROM');
    } else {
      missing.push('TWILIO_SMS_FROM');
    }

    if (to) {
      configured.push('TWILIO_SMS_TO');
    } else {
      missing.push('TWILIO_SMS_TO');
    }
  }

  return {
    missing,
    configured,
    ready: missing.length === 0,
  };
}

function applyEnvVars(config: SMSConfig): void {
  // Twilio credentials
  if (process.env['TWILIO_ACCOUNT_SID']) {
    config.accountSid = process.env['TWILIO_ACCOUNT_SID'];
  }
  if (process.env['TWILIO_AUTH_TOKEN']) {
    config.authToken = process.env['TWILIO_AUTH_TOKEN'];
  }

  // SMS numbers
  if (process.env['TWILIO_SMS_FROM'] || process.env['TWILIO_FROM_NUMBER']) {
    config.smsFromNumber =
      process.env['TWILIO_SMS_FROM'] || process.env['TWILIO_FROM_NUMBER'];
  }
  if (process.env['TWILIO_SMS_TO'] || process.env['TWILIO_TO_NUMBER']) {
    config.smsToNumber =
      process.env['TWILIO_SMS_TO'] || process.env['TWILIO_TO_NUMBER'];
  }

  // WhatsApp numbers
  if (process.env['TWILIO_WHATSAPP_FROM']) {
    config.whatsappFromNumber = process.env['TWILIO_WHATSAPP_FROM'];
  }
  if (process.env['TWILIO_WHATSAPP_TO']) {
    config.whatsappToNumber = process.env['TWILIO_WHATSAPP_TO'];
  }

  // Legacy support
  if (process.env['TWILIO_FROM_NUMBER']) {
    config.fromNumber = process.env['TWILIO_FROM_NUMBER'];
  }
  if (process.env['TWILIO_TO_NUMBER']) {
    config.toNumber = process.env['TWILIO_TO_NUMBER'];
  }

  // Channel preference
  if (process.env['TWILIO_CHANNEL']) {
    config.channel = process.env['TWILIO_CHANNEL'] as MessageChannel;
  }
}

export function saveSMSConfig(config: SMSConfig): void {
  try {
    ensureSecureDir(join(homedir(), '.stackmemory'));
    // Don't save sensitive credentials to file
    const safeConfig = { ...config };
    delete safeConfig.accountSid;
    delete safeConfig.authToken;
    writeFileSecure(CONFIG_PATH, JSON.stringify(safeConfig, null, 2));
  } catch {
    // Silently fail
  }
}

function isQuietHours(config: SMSConfig): boolean {
  if (!config.quietHours?.enabled) return false;

  const now = new Date();
  const currentTime = now.getHours() * 60 + now.getMinutes();

  const [startH, startM] = config.quietHours.start.split(':').map(Number);
  const [endH, endM] = config.quietHours.end.split(':').map(Number);

  const startTime = startH * 60 + startM;
  const endTime = endH * 60 + endM;

  // Handle overnight quiet hours (e.g., 22:00 - 08:00)
  if (startTime > endTime) {
    return currentTime >= startTime || currentTime < endTime;
  }

  return currentTime >= startTime && currentTime < endTime;
}

function generatePromptId(): string {
  return Math.random().toString(36).substring(2, 10);
}

function formatPromptMessage(payload: NotificationPayload): string {
  let message = `${payload.title}\n\n${payload.message}`;

  if (payload.prompt) {
    message += '\n\n';

    if (payload.prompt.question) {
      message += `${payload.prompt.question}\n`;
    }

    if (payload.prompt.type === 'yesno') {
      message += 'Reply Y for Yes, N for No';
    } else if (payload.prompt.type === 'options' && payload.prompt.options) {
      payload.prompt.options.forEach((opt) => {
        message += `${opt.key}. ${opt.label}\n`;
      });
      message += '\nReply with number to select';
    } else if (payload.prompt.type === 'freeform') {
      message += 'Reply with your response';
    }
  }

  // Always append session URL if available
  return appendSessionUrl(message);
}

function getChannelNumbers(config: SMSConfig): {
  from: string;
  to: string;
  channel: MessageChannel;
} | null {
  const channel = config.channel || 'whatsapp';

  if (channel === 'whatsapp') {
    // Try WhatsApp first
    const from = config.whatsappFromNumber || config.fromNumber;
    const to = config.whatsappToNumber || config.toNumber;
    if (from && to) {
      // Twilio requires 'whatsapp:' prefix for WhatsApp numbers
      return {
        from: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
        to: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
        channel: 'whatsapp',
      };
    }
  }

  // Fall back to SMS
  const from = config.smsFromNumber || config.fromNumber;
  const to = config.smsToNumber || config.toNumber;
  if (from && to) {
    return { from, to, channel: 'sms' };
  }

  return null;
}

export async function sendNotification(
  payload: NotificationPayload,
  channelOverride?: MessageChannel
): Promise<{
  success: boolean;
  promptId?: string;
  channel?: MessageChannel;
  error?: string;
}> {
  const config = loadSMSConfig();

  if (!config.enabled) {
    return { success: false, error: 'Notifications disabled' };
  }

  // Check notification type is enabled
  const typeMap: Record<string, keyof typeof config.notifyOn> = {
    task_complete: 'taskComplete',
    review_ready: 'reviewReady',
    error: 'error',
    custom: 'custom',
    context_sync: 'contextSync',
  };

  if (!config.notifyOn[typeMap[payload.type]]) {
    return {
      success: false,
      error: `Notifications for ${payload.type} disabled`,
    };
  }

  // Check quiet hours
  if (isQuietHours(config)) {
    return { success: false, error: 'Quiet hours active' };
  }

  // Validate credentials
  if (!config.accountSid || !config.authToken) {
    return {
      success: false,
      error:
        'Missing Twilio credentials. Set TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN',
    };
  }

  // Get channel numbers (prefer WhatsApp)
  const originalChannel = config.channel;
  if (channelOverride) {
    config.channel = channelOverride;
  }

  const numbers = getChannelNumbers(config);
  config.channel = originalChannel; // Restore

  if (!numbers) {
    return {
      success: false,
      error:
        config.channel === 'whatsapp'
          ? 'Missing WhatsApp numbers. Set TWILIO_WHATSAPP_FROM and TWILIO_WHATSAPP_TO'
          : 'Missing SMS numbers. Set TWILIO_SMS_FROM and TWILIO_SMS_TO',
    };
  }

  const message = formatPromptMessage(payload);
  let promptId: string | undefined;

  // Store pending prompt if interactive
  if (payload.prompt) {
    promptId = generatePromptId();
    const expiresAt = new Date(
      Date.now() + config.responseTimeout * 1000
    ).toISOString();

    const pendingPrompt: PendingPrompt = {
      id: promptId,
      timestamp: new Date().toISOString(),
      message: payload.message,
      options: payload.prompt.options || [],
      type: payload.prompt.type,
      expiresAt,
    };

    config.pendingPrompts.push(pendingPrompt);
    saveSMSConfig(config);
  }

  try {
    // Use Twilio API (same endpoint for SMS and WhatsApp)
    const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${config.accountSid}/Messages.json`;

    const response = await fetch(twilioUrl, {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' +
          Buffer.from(`${config.accountSid}:${config.authToken}`).toString(
            'base64'
          ),
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({
        From: numbers.from,
        To: numbers.to,
        Body: message,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      return {
        success: false,
        channel: numbers.channel,
        error: `Twilio error: ${errorData}`,
      };
    }

    return { success: true, promptId, channel: numbers.channel };
  } catch (err) {
    return {
      success: false,
      channel: numbers.channel,
      error: `Failed to send ${numbers.channel}: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}

// Backwards compatible alias
export async function sendSMSNotification(
  payload: NotificationPayload
): Promise<{ success: boolean; promptId?: string; error?: string }> {
  return sendNotification(payload);
}

export function processIncomingResponse(
  from: string,
  body: string
): {
  matched: boolean;
  prompt?: PendingPrompt;
  response?: string;
  action?: string;
} {
  const config = loadSMSConfig();

  // Normalize response
  const response = body.trim().toLowerCase();

  // Find matching pending prompt (most recent first)
  const now = new Date();
  const validPrompts = config.pendingPrompts.filter(
    (p) => new Date(p.expiresAt) > now
  );

  if (validPrompts.length === 0) {
    return { matched: false };
  }

  // Get most recent prompt
  const prompt = validPrompts[validPrompts.length - 1];

  let matchedOption: PromptOption | undefined;

  if (prompt.type === 'yesno') {
    if (response === 'y' || response === 'yes') {
      matchedOption = { key: 'y', label: 'Yes' };
    } else if (response === 'n' || response === 'no') {
      matchedOption = { key: 'n', label: 'No' };
    }
  } else if (prompt.type === 'options') {
    matchedOption = prompt.options.find(
      (opt) => opt.key.toLowerCase() === response
    );
  } else if (prompt.type === 'freeform') {
    matchedOption = { key: response, label: response };
  }

  // Remove processed prompt
  config.pendingPrompts = config.pendingPrompts.filter(
    (p) => p.id !== prompt.id
  );
  saveSMSConfig(config);

  if (matchedOption) {
    return {
      matched: true,
      prompt,
      response: matchedOption.key,
      action: matchedOption.action,
    };
  }

  return { matched: false, prompt };
}

// Get session ID from environment or generate short ID
function getSessionId(): string {
  return (
    process.env['CLAUDE_INSTANCE_ID'] ||
    process.env['STACKMEMORY_SESSION_ID'] ||
    Math.random().toString(36).substring(2, 8)
  );
}

// Get Claude session URL if available
export function getSessionUrl(): string | undefined {
  // Check for remote session URL in environment
  const sessionId = process.env['CLAUDE_SESSION_ID'];
  if (sessionId?.startsWith('session_')) {
    return `https://claude.ai/code/${sessionId}`;
  }
  // Check for explicit URL
  return process.env['CLAUDE_SESSION_URL'];
}

// Format message with session URL
function appendSessionUrl(message: string): string {
  const url = getSessionUrl();
  if (url) {
    return `${message}\n\nSession: ${url}`;
  }
  return message;
}

// Convenience functions for common notifications

export async function notifyReviewReady(
  title: string,
  description: string,
  options?: { label: string; action?: string }[]
): Promise<{ success: boolean; promptId?: string; error?: string }> {
  const sessionId = getSessionId();

  // Ensure minimum 2 options
  let finalOptions = options || [];
  if (finalOptions.length < 2) {
    const defaults = [
      { label: 'Approve', action: 'echo "Approved"' },
      { label: 'Request changes', action: 'echo "Changes requested"' },
    ];
    finalOptions = [...finalOptions, ...defaults].slice(
      0,
      Math.max(2, finalOptions.length)
    );
  }

  const payload: NotificationPayload = {
    type: 'review_ready',
    title: `[Claude ${sessionId}] Review Ready: ${title}`,
    message: description,
    prompt: {
      type: 'options',
      options: finalOptions.map((opt, i) => ({
        key: String(i + 1),
        label: opt.label,
        action: opt.action,
      })),
      question: 'What would you like to do?',
    },
  };

  return sendSMSNotification(payload);
}

export async function notifyWithYesNo(
  title: string,
  question: string,
  yesAction?: string,
  noAction?: string
): Promise<{ success: boolean; promptId?: string; error?: string }> {
  const sessionId = getSessionId();
  return sendSMSNotification({
    type: 'custom',
    title: `[Claude ${sessionId}] ${title}`,
    message: question,
    prompt: {
      type: 'yesno',
      options: [
        { key: 'y', label: 'Yes', action: yesAction },
        { key: 'n', label: 'No', action: noAction },
      ],
    },
  });
}

export async function notifyTaskComplete(
  taskName: string,
  summary: string
): Promise<{ success: boolean; promptId?: string; error?: string }> {
  const sessionId = getSessionId();
  return sendSMSNotification({
    type: 'task_complete',
    title: `[Claude ${sessionId}] Task Complete: ${taskName}`,
    message: summary,
    prompt: {
      type: 'options',
      options: [
        { key: '1', label: 'Start next task', action: 'claude-sm' },
        { key: '2', label: 'View details', action: 'stackmemory status' },
      ],
    },
  });
}

export async function notifyError(
  error: string,
  context?: string
): Promise<{ success: boolean; promptId?: string; error?: string }> {
  const sessionId = getSessionId();
  return sendSMSNotification({
    type: 'error',
    title: `[Claude ${sessionId}] Error Alert`,
    message: context ? `${error}\n\nContext: ${context}` : error,
    prompt: {
      type: 'options',
      options: [
        { key: '1', label: 'Retry', action: 'claude-sm' },
        {
          key: '2',
          label: 'View logs',
          action: 'tail -50 ~/.claude/logs/*.log',
        },
      ],
    },
  });
}

// Clean up expired prompts
export function cleanupExpiredPrompts(): number {
  const config = loadSMSConfig();
  const now = new Date();
  const before = config.pendingPrompts.length;

  config.pendingPrompts = config.pendingPrompts.filter(
    (p) => new Date(p.expiresAt) > now
  );

  const removed = before - config.pendingPrompts.length;
  if (removed > 0) {
    saveSMSConfig(config);
  }

  return removed;
}

// ============================================================================
// SIMPLIFIED API - Use these for basic notifications
// ============================================================================

/**
 * Send a simple status notification
 * Always includes session URL if available
 */
export async function notify(
  message: string
): Promise<{ success: boolean; error?: string }> {
  const sessionId = getSessionId();
  return sendNotification({
    type: 'custom',
    title: `[Claude ${sessionId}]`,
    message,
  });
}

/**
 * Send a notification with A/B choice (1 or 2)
 * Always includes session URL if available
 */
export async function notifyChoice(
  message: string,
  optionA: string,
  optionB: string
): Promise<{ success: boolean; promptId?: string; error?: string }> {
  const sessionId = getSessionId();
  return sendNotification({
    type: 'custom',
    title: `[Claude ${sessionId}]`,
    message,
    prompt: {
      type: 'options',
      options: [
        { key: '1', label: optionA },
        { key: '2', label: optionB },
      ],
    },
  });
}

/**
 * Send a notification with Yes/No choice
 * Always includes session URL if available
 */
export async function notifyYesNo(
  message: string
): Promise<{ success: boolean; promptId?: string; error?: string }> {
  const sessionId = getSessionId();
  return sendNotification({
    type: 'custom',
    title: `[Claude ${sessionId}]`,
    message,
    prompt: { type: 'yesno' },
  });
}

/**
 * Send step completion notification
 * Always includes session URL if available
 */
export async function notifyStep(
  step: string,
  status: 'done' | 'failed' | 'waiting' = 'done'
): Promise<{ success: boolean; error?: string }> {
  const sessionId = getSessionId();
  const symbol = status === 'done' ? '✓' : status === 'failed' ? '✗' : '⏳';
  return sendNotification({
    type: 'task_complete',
    title: `[Claude ${sessionId}]`,
    message: `${symbol} ${step}`,
  });
}
