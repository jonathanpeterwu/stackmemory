#!/usr/bin/env node
/**
 * SMS Response Watcher
 * Watches for incoming SMS/WhatsApp responses and triggers notifications
 *
 * Run in background: stackmemory notify watch-responses &
 */

import { existsSync, readFileSync, watchFile, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

const RESPONSE_PATH = join(
  homedir(),
  '.stackmemory',
  'sms-latest-response.json'
);
const SIGNAL_PATH = join(homedir(), '.stackmemory', 'sms-signal.txt');

interface SMSResponse {
  promptId: string;
  response: string;
  timestamp: string;
}

let lastProcessedTimestamp = '';

function checkForResponse(): SMSResponse | null {
  try {
    if (existsSync(RESPONSE_PATH)) {
      const data = JSON.parse(
        readFileSync(RESPONSE_PATH, 'utf8')
      ) as SMSResponse;

      // Only process new responses
      if (data.timestamp !== lastProcessedTimestamp) {
        lastProcessedTimestamp = data.timestamp;
        return data;
      }
    }
  } catch {
    // Ignore errors
  }
  return null;
}

function triggerNotification(response: SMSResponse): void {
  const message = `SMS Response: "${response.response}"`;

  // macOS notification
  try {
    execSync(
      `osascript -e 'display notification "${message}" with title "StackMemory"'`,
      {
        stdio: 'ignore',
      }
    );
  } catch {
    // Ignore if not on macOS
  }

  // Terminal bell
  process.stdout.write('\x07');

  // Write to signal file (for other processes to detect)
  try {
    writeFileSync(
      SIGNAL_PATH,
      JSON.stringify({
        type: 'sms_response',
        response: response.response,
        promptId: response.promptId,
        timestamp: new Date().toISOString(),
      })
    );
  } catch {
    // Ignore
  }

  // Output to terminal
  console.log(`\n[SMS] User responded: "${response.response}"`);
  console.log(`[SMS] Run: stackmemory notify run-actions\n`);
}

export function startResponseWatcher(intervalMs: number = 2000): void {
  console.log('[SMS Watcher] Watching for responses...');
  console.log('[SMS Watcher] Press Ctrl+C to stop\n');

  // Initial check
  const initial = checkForResponse();
  if (initial) {
    triggerNotification(initial);
  }

  // Poll for changes
  setInterval(() => {
    const response = checkForResponse();
    if (response) {
      triggerNotification(response);
    }
  }, intervalMs);
}

// Also watch file for immediate notification
export function startFileWatcher(): void {
  console.log('[SMS Watcher] Watching for responses (file mode)...');

  watchFile(RESPONSE_PATH, { interval: 1000 }, () => {
    const response = checkForResponse();
    if (response) {
      triggerNotification(response);
    }
  });
}

// CLI entry
if (process.argv[1]?.includes('sms-watcher')) {
  startResponseWatcher();
}

export { checkForResponse, triggerNotification };
