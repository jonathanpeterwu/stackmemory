#!/usr/bin/env node
/**
 * Claude Code hook for processing SMS responses and triggering next actions
 *
 * This hook:
 * 1. Checks for pending SMS responses on startup
 * 2. Executes queued actions from SMS responses
 * 3. Injects response context into Claude session
 *
 * Install: stackmemory notify install-response-hook
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');

const QUEUE_PATH = path.join(
  os.homedir(),
  '.stackmemory',
  'sms-action-queue.json'
);
const RESPONSE_PATH = path.join(
  os.homedir(),
  '.stackmemory',
  'sms-latest-response.json'
);

function loadActionQueue() {
  try {
    if (fs.existsSync(QUEUE_PATH)) {
      return JSON.parse(fs.readFileSync(QUEUE_PATH, 'utf8'));
    }
  } catch {}
  return { actions: [] };
}

function saveActionQueue(queue) {
  const dir = path.join(os.homedir(), '.stackmemory');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(QUEUE_PATH, JSON.stringify(queue, null, 2));
}

function loadLatestResponse() {
  try {
    if (fs.existsSync(RESPONSE_PATH)) {
      const data = JSON.parse(fs.readFileSync(RESPONSE_PATH, 'utf8'));
      // Only return if less than 5 minutes old
      const age = Date.now() - new Date(data.timestamp).getTime();
      if (age < 5 * 60 * 1000) {
        return data;
      }
    }
  } catch {}
  return null;
}

function clearLatestResponse() {
  try {
    if (fs.existsSync(RESPONSE_PATH)) {
      fs.unlinkSync(RESPONSE_PATH);
    }
  } catch {}
}

function executeAction(action) {
  try {
    console.error(`[sms-hook] Executing: ${action.action}`);
    const output = execSync(action.action, {
      encoding: 'utf8',
      timeout: 60000,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { success: true, output };
  } catch (err) {
    return { success: false, error: err.message };
  }
}

function processPendingActions() {
  const queue = loadActionQueue();
  const pending = queue.actions.filter((a) => a.status === 'pending');

  if (pending.length === 0) return null;

  const results = [];

  for (const action of pending) {
    action.status = 'running';
    saveActionQueue(queue);

    const result = executeAction(action);

    action.status = result.success ? 'completed' : 'failed';
    action.result = result.output;
    action.error = result.error;
    saveActionQueue(queue);

    results.push({
      action: action.action,
      response: action.response,
      success: result.success,
      output: result.output?.substring(0, 500),
      error: result.error,
    });
  }

  return results;
}

// Read hook input from stdin
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  try {
    const hookData = JSON.parse(input);
    const { hook_type } = hookData;

    // On session start, check for pending responses
    if (hook_type === 'on_startup' || hook_type === 'pre_tool_use') {
      // Check for SMS response waiting
      const latestResponse = loadLatestResponse();
      if (latestResponse) {
        console.error(
          `[sms-hook] SMS response received: "${latestResponse.response}"`
        );

        // Inject context for Claude
        const context = {
          type: 'sms_response',
          response: latestResponse.response,
          promptId: latestResponse.promptId,
          timestamp: latestResponse.timestamp,
          message: `User responded via SMS: "${latestResponse.response}"`,
        };

        clearLatestResponse();

        console.log(
          JSON.stringify({
            decision: 'allow',
            context: context,
            user_message: `[SMS Response] User replied: "${latestResponse.response}"`,
          })
        );
        return;
      }

      // Process any pending actions
      const results = processPendingActions();
      if (results && results.length > 0) {
        console.error(`[sms-hook] Processed ${results.length} action(s)`);

        const summary = results
          .map((r) =>
            r.success
              ? `Executed: ${r.action.substring(0, 50)}...`
              : `Failed: ${r.action.substring(0, 50)}... (${r.error})`
          )
          .join('\n');

        console.log(
          JSON.stringify({
            decision: 'allow',
            context: {
              type: 'sms_actions_executed',
              results,
            },
            user_message: `[SMS Actions] Executed queued actions:\n${summary}`,
          })
        );
        return;
      }
    }

    // Default: allow everything
    console.log(JSON.stringify({ decision: 'allow' }));
  } catch (err) {
    console.error('[sms-hook] Error:', err.message);
    console.log(JSON.stringify({ decision: 'allow' }));
  }
});
