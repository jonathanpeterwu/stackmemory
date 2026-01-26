#!/usr/bin/env node
/**
 * Claude Code WhatsApp Hook
 * Automatically integrates WhatsApp messages into Claude Code sessions
 *
 * Installation:
 *   Add to ~/.claude/settings.json under "hooks":
 *   {
 *     "hooks": {
 *       "Stop": ["node", "/path/to/claude-code-whatsapp-hook.js", "stop"],
 *       "PreToolUse": ["node", "/path/to/claude-code-whatsapp-hook.js", "pre-tool"]
 *     }
 *   }
 *
 * Or add to ~/.claude/hooks/ directory
 */

import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { sendNotification, loadSMSConfig } from './sms-notify.js';
import {
  getFrameDigestData,
  generateMobileDigest,
  loadSyncOptions,
} from './whatsapp-sync.js';

const STACKMEMORY_DIR = join(homedir(), '.stackmemory');
const INCOMING_REQUEST_PATH = join(
  STACKMEMORY_DIR,
  'sms-incoming-request.json'
);
const LATEST_RESPONSE_PATH = join(STACKMEMORY_DIR, 'sms-latest-response.json');
const HOOK_STATE_PATH = join(STACKMEMORY_DIR, 'claude-hook-state.json');

interface HookState {
  sessionId?: string;
  lastCheckedAt?: string;
  lastDigestSentAt?: string;
  toolCount: number;
  significantChanges: boolean;
}

interface IncomingRequest {
  from: string;
  message: string;
  timestamp: string;
  processed: boolean;
}

/**
 * Load hook state
 */
function loadHookState(): HookState {
  try {
    if (existsSync(HOOK_STATE_PATH)) {
      return JSON.parse(readFileSync(HOOK_STATE_PATH, 'utf8'));
    }
  } catch {
    // Use defaults
  }
  return { toolCount: 0, significantChanges: false };
}

/**
 * Save hook state
 */
function saveHookState(state: HookState): void {
  try {
    writeFileSync(HOOK_STATE_PATH, JSON.stringify(state, null, 2));
  } catch {
    // Ignore
  }
}

/**
 * Check for incoming WhatsApp requests
 */
function checkIncomingRequests(): IncomingRequest | null {
  try {
    if (!existsSync(INCOMING_REQUEST_PATH)) return null;

    const data: IncomingRequest = JSON.parse(
      readFileSync(INCOMING_REQUEST_PATH, 'utf8')
    );
    if (data.processed) return null;

    return data;
  } catch {
    return null;
  }
}

/**
 * Mark incoming request as processed
 */
function markRequestProcessed(): void {
  try {
    if (!existsSync(INCOMING_REQUEST_PATH)) return;

    const data = JSON.parse(readFileSync(INCOMING_REQUEST_PATH, 'utf8'));
    data.processed = true;
    writeFileSync(INCOMING_REQUEST_PATH, JSON.stringify(data, null, 2));
  } catch {
    // Ignore
  }
}

/**
 * Get latest response from file
 */
function getLatestResponse(): {
  promptId: string;
  response: string;
  timestamp: string;
} | null {
  try {
    if (!existsSync(LATEST_RESPONSE_PATH)) return null;
    return JSON.parse(readFileSync(LATEST_RESPONSE_PATH, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Send context digest to WhatsApp
 */
async function sendDigest(): Promise<void> {
  const data = await getFrameDigestData();
  if (!data) return;

  const options = loadSyncOptions();
  const digest = generateMobileDigest(data, options);

  await sendNotification({
    type: 'context_sync',
    title: 'Context Update',
    message: digest,
  });
}

/**
 * Handle PreToolUse hook - check for incoming messages
 */
async function handlePreToolUse(): Promise<void> {
  const state = loadHookState();
  state.toolCount++;

  // Check for incoming WhatsApp messages every 5 tool uses
  if (state.toolCount % 5 === 0) {
    const incoming = checkIncomingRequests();
    if (incoming) {
      // Print to stderr so Claude sees it
      console.error(`\n[WhatsApp] Message from ${incoming.from}:`);
      console.error(`  "${incoming.message}"`);
      console.error(`  (Received at ${incoming.timestamp})\n`);

      // Mark as processed
      markRequestProcessed();
    }
  }

  saveHookState(state);
}

/**
 * Handle Stop hook - send session summary to WhatsApp
 */
async function handleStop(): Promise<void> {
  const config = loadSMSConfig();
  if (!config.enabled) return;

  // Load state for logging
  const state = loadHookState();
  console.error(`[WhatsApp] Session ended after ${state.toolCount} tool calls`);

  // Send final digest
  try {
    await sendDigest();
    console.error('[WhatsApp] Session digest sent');
  } catch (err) {
    console.error('[WhatsApp] Failed to send digest:', err);
  }

  // Reset state
  saveHookState({ toolCount: 0, significantChanges: false });
}

/**
 * Handle Notification hook - relay Claude's output to WhatsApp if requested
 */
async function handleNotification(input: string): Promise<void> {
  // Check if user requested WhatsApp notification
  if (input.includes('[notify]') || input.includes('[whatsapp]')) {
    const message = input.replace(/\[notify\]|\[whatsapp\]/gi, '').trim();

    await sendNotification({
      type: 'custom',
      title: 'Claude',
      message: message.slice(0, 300),
    });
  }
}

/**
 * Poll for WhatsApp responses (for long-running tasks)
 */
async function pollForResponse(
  timeoutMs: number = 60000
): Promise<string | null> {
  const startTime = Date.now();
  const pollInterval = 2000;

  while (Date.now() - startTime < timeoutMs) {
    const response = getLatestResponse();
    if (response) {
      const responseAge = Date.now() - new Date(response.timestamp).getTime();
      if (responseAge < 5000) {
        // Fresh response (within 5 seconds)
        return response.response;
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return null;
}

/**
 * Send a prompt to WhatsApp and wait for response
 */
export async function askViaWhatsApp(
  question: string,
  options?: { key: string; label: string }[]
): Promise<string | null> {
  const config = loadSMSConfig();
  if (!config.enabled) {
    console.error('[WhatsApp] Notifications not enabled');
    return null;
  }

  // Send the question
  await sendNotification({
    type: 'custom',
    title: 'Claude Question',
    message: question,
    prompt: options
      ? {
          type: 'options',
          options: options.map((o) => ({ ...o, action: o.key })),
        }
      : undefined,
  });

  // Wait for response
  return pollForResponse(120000); // 2 minute timeout
}

/**
 * Main entry point
 */
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const hookType = args[0];

  // Read stdin for hook input
  let input = '';
  if (!process.stdin.isTTY) {
    input = readFileSync(0, 'utf8');
  }

  switch (hookType) {
    case 'pre-tool':
    case 'PreToolUse':
      await handlePreToolUse();
      break;

    case 'stop':
    case 'Stop':
      await handleStop();
      break;

    case 'notification':
    case 'Notification':
      await handleNotification(input);
      break;

    case 'check':
      // Just check for incoming messages
      const incoming = checkIncomingRequests();
      if (incoming) {
        console.log(JSON.stringify(incoming));
      }
      break;

    case 'send-digest':
      await sendDigest();
      break;

    case 'poll':
      const response = await pollForResponse(parseInt(args[1] || '60000', 10));
      if (response) {
        console.log(response);
      }
      break;

    default:
      console.error('Usage: claude-code-whatsapp-hook.js <hook-type>');
      console.error(
        'Hook types: pre-tool, stop, notification, check, send-digest, poll'
      );
      process.exit(1);
  }
}

// Run if called directly
if (process.argv[1]?.includes('claude-code-whatsapp-hook')) {
  main().catch(console.error);
}
