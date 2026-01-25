/**
 * SMS Notification Hook for StackMemory
 * Sends text messages when tasks are ready for review
 * Supports interactive prompts with numbered options or yes/no
 *
 * Optional feature - requires Twilio setup
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export interface SMSConfig {
  enabled: boolean;
  // Twilio credentials (from env or config)
  accountSid?: string;
  authToken?: string;
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
  type: 'task_complete' | 'review_ready' | 'error' | 'custom';
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
  notifyOn: {
    taskComplete: true,
    reviewReady: true,
    error: true,
    custom: true,
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
  try {
    if (existsSync(CONFIG_PATH)) {
      const data = readFileSync(CONFIG_PATH, 'utf8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
    }
  } catch {
    // Use defaults
  }

  // Check environment variables
  const config = { ...DEFAULT_CONFIG };
  if (process.env['TWILIO_ACCOUNT_SID']) {
    config.accountSid = process.env['TWILIO_ACCOUNT_SID'];
  }
  if (process.env['TWILIO_AUTH_TOKEN']) {
    config.authToken = process.env['TWILIO_AUTH_TOKEN'];
  }
  if (process.env['TWILIO_FROM_NUMBER']) {
    config.fromNumber = process.env['TWILIO_FROM_NUMBER'];
  }
  if (process.env['TWILIO_TO_NUMBER']) {
    config.toNumber = process.env['TWILIO_TO_NUMBER'];
  }

  return config;
}

export function saveSMSConfig(config: SMSConfig): void {
  try {
    const dir = join(homedir(), '.stackmemory');
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
    // Don't save sensitive credentials to file
    const safeConfig = { ...config };
    delete safeConfig.accountSid;
    delete safeConfig.authToken;
    writeFileSync(CONFIG_PATH, JSON.stringify(safeConfig, null, 2));
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

  return message;
}

export async function sendSMSNotification(
  payload: NotificationPayload
): Promise<{ success: boolean; promptId?: string; error?: string }> {
  const config = loadSMSConfig();

  if (!config.enabled) {
    return { success: false, error: 'SMS notifications disabled' };
  }

  // Check notification type is enabled
  const typeMap: Record<string, keyof typeof config.notifyOn> = {
    task_complete: 'taskComplete',
    review_ready: 'reviewReady',
    error: 'error',
    custom: 'custom',
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
  if (
    !config.accountSid ||
    !config.authToken ||
    !config.fromNumber ||
    !config.toNumber
  ) {
    return {
      success: false,
      error:
        'Missing Twilio credentials. Set TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM_NUMBER, TWILIO_TO_NUMBER',
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
    // Use Twilio API
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
        From: config.fromNumber,
        To: config.toNumber,
        Body: message,
      }),
    });

    if (!response.ok) {
      const errorData = await response.text();
      return { success: false, error: `Twilio error: ${errorData}` };
    }

    return { success: true, promptId };
  } catch (err) {
    return {
      success: false,
      error: `Failed to send SMS: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
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

// Convenience functions for common notifications

export async function notifyReviewReady(
  title: string,
  description: string,
  options?: { label: string; action?: string }[]
): Promise<{ success: boolean; promptId?: string; error?: string }> {
  const payload: NotificationPayload = {
    type: 'review_ready',
    title: `Review Ready: ${title}`,
    message: description,
  };

  if (options && options.length > 0) {
    payload.prompt = {
      type: 'options',
      options: options.map((opt, i) => ({
        key: String(i + 1),
        label: opt.label,
        action: opt.action,
      })),
      question: 'What would you like to do?',
    };
  }

  return sendSMSNotification(payload);
}

export async function notifyWithYesNo(
  title: string,
  question: string,
  yesAction?: string,
  noAction?: string
): Promise<{ success: boolean; promptId?: string; error?: string }> {
  return sendSMSNotification({
    type: 'custom',
    title,
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
): Promise<{ success: boolean; error?: string }> {
  return sendSMSNotification({
    type: 'task_complete',
    title: `Task Complete: ${taskName}`,
    message: summary,
  });
}

export async function notifyError(
  error: string,
  context?: string
): Promise<{ success: boolean; error?: string }> {
  return sendSMSNotification({
    type: 'error',
    title: 'Error Alert',
    message: context ? `${error}\n\nContext: ${context}` : error,
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
