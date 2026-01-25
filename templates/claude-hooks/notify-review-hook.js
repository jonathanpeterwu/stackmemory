#!/usr/bin/env node
/**
 * Claude Code hook for SMS notifications on review-ready events
 *
 * Triggers notifications when:
 * - PR is created
 * - Task is marked complete
 * - User explicitly requests notification
 *
 * Install: stackmemory notify install-hook
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const https = require('https');

const CONFIG_PATH = path.join(os.homedir(), '.stackmemory', 'sms-notify.json');

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch {}
  return { enabled: false };
}

function shouldNotify(toolName, toolInput, output) {
  const config = loadConfig();
  if (!config.enabled) return null;

  // Check for PR creation
  if (toolName === 'Bash') {
    const cmd = toolInput?.command || '';
    const out = output || '';

    // gh pr create
    if (cmd.includes('gh pr create') && out.includes('github.com')) {
      const prUrl = out.match(/https:\/\/github\.com\/[^\s]+\/pull\/\d+/)?.[0];
      return {
        type: 'review_ready',
        title: 'PR Ready for Review',
        message: prUrl || 'Pull request created successfully',
        options: ['Approve', 'Review', 'Skip'],
      };
    }

    // npm publish
    if (cmd.includes('npm publish') && out.includes('+')) {
      const pkg = out.match(/\+ ([^\s]+)/)?.[1];
      return {
        type: 'task_complete',
        title: 'Package Published',
        message: pkg ? `Published ${pkg}` : 'Package published successfully',
      };
    }

    // Deployment
    if (
      (cmd.includes('deploy') || cmd.includes('railway up')) &&
      (out.includes('deployed') || out.includes('success'))
    ) {
      return {
        type: 'review_ready',
        title: 'Deployment Complete',
        message: 'Ready for verification',
        options: ['Verify', 'Rollback', 'Skip'],
      };
    }
  }

  return null;
}

function sendNotification(notification) {
  const config = loadConfig();

  if (
    !config.accountSid ||
    !config.authToken ||
    !config.fromNumber ||
    !config.toNumber
  ) {
    // Try env vars
    const sid = process.env.TWILIO_ACCOUNT_SID;
    const token = process.env.TWILIO_AUTH_TOKEN;
    const from = process.env.TWILIO_FROM_NUMBER;
    const to = process.env.TWILIO_TO_NUMBER;

    if (!sid || !token || !from || !to) {
      console.error('[notify-hook] Missing Twilio credentials');
      return;
    }

    config.accountSid = sid;
    config.authToken = token;
    config.fromNumber = from;
    config.toNumber = to;
  }

  let message = `${notification.title}\n\n${notification.message}`;

  if (notification.options) {
    message += '\n\n';
    notification.options.forEach((opt, i) => {
      message += `${i + 1}. ${opt}\n`;
    });
    message += '\nReply with number to select';
  }

  const postData = new URLSearchParams({
    From: config.fromNumber,
    To: config.toNumber,
    Body: message,
  }).toString();

  const options = {
    hostname: 'api.twilio.com',
    port: 443,
    path: `/2010-04-01/Accounts/${config.accountSid}/Messages.json`,
    method: 'POST',
    headers: {
      Authorization:
        'Basic ' +
        Buffer.from(`${config.accountSid}:${config.authToken}`).toString(
          'base64'
        ),
      'Content-Type': 'application/x-www-form-urlencoded',
      'Content-Length': Buffer.byteLength(postData),
    },
  };

  const req = https.request(options, (res) => {
    if (res.statusCode === 201) {
      console.error(`[notify-hook] Sent: ${notification.title}`);
    } else {
      console.error(`[notify-hook] Failed: ${res.statusCode}`);
    }
  });

  req.on('error', (e) => {
    console.error(`[notify-hook] Error: ${e.message}`);
  });

  req.write(postData);
  req.end();
}

// Read hook input from stdin (post-tool-use hook)
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => (input += chunk));
process.stdin.on('end', () => {
  try {
    const hookData = JSON.parse(input);
    const { tool_name, tool_input, tool_output } = hookData;

    const notification = shouldNotify(tool_name, tool_input, tool_output);

    if (notification) {
      sendNotification(notification);
    }

    // Always allow (post-tool hooks don't block)
    console.log(JSON.stringify({ status: 'ok' }));
  } catch (err) {
    console.error('[notify-hook] Error:', err.message);
    console.log(JSON.stringify({ status: 'ok' }));
  }
});
