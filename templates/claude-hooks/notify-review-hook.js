#!/usr/bin/env node
/**
 * Claude Code hook for WhatsApp/SMS notifications
 *
 * Triggers notifications when:
 * - AskUserQuestion tool is used (allows remote response)
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

// Load .env files (check multiple locations)
const envPaths = [
  path.join(process.cwd(), '.env'),
  path.join(os.homedir(), 'Dev/stackmemory/.env'),
  path.join(os.homedir(), '.stackmemory/.env'),
  path.join(os.homedir(), '.env'),
];
for (const envPath of envPaths) {
  if (fs.existsSync(envPath)) {
    try {
      const content = fs.readFileSync(envPath, 'utf8');
      for (const line of content.split('\n')) {
        const match = line.match(/^([^#=]+)=(.*)$/);
        if (match && !process.env[match[1].trim()]) {
          process.env[match[1].trim()] = match[2]
            .trim()
            .replace(/^["']|["']$/g, '');
        }
      }
    } catch {}
  }
}

const CONFIG_PATH = path.join(os.homedir(), '.stackmemory', 'sms-notify.json');
const PENDING_PATH = path.join(
  os.homedir(),
  '.stackmemory',
  'sms-pending-prompts.json'
);

function loadConfig() {
  try {
    if (fs.existsSync(CONFIG_PATH)) {
      return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
    }
  } catch {}
  return { enabled: false };
}

function savePendingPrompt(prompt) {
  try {
    const dir = path.join(os.homedir(), '.stackmemory');
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    let pending = { prompts: [] };
    if (fs.existsSync(PENDING_PATH)) {
      pending = JSON.parse(fs.readFileSync(PENDING_PATH, 'utf8'));
    }
    pending.prompts.push(prompt);
    // Keep only last 10 prompts
    if (pending.prompts.length > 10) {
      pending.prompts = pending.prompts.slice(-10);
    }
    fs.writeFileSync(PENDING_PATH, JSON.stringify(pending, null, 2));
  } catch (err) {
    console.error('[notify-hook] Failed to save pending prompt:', err.message);
  }
}

function shouldNotify(toolName, toolInput, output) {
  const config = loadConfig();
  if (!config.enabled) return null;

  // AskUserQuestion - send question via WhatsApp for remote response
  if (toolName === 'AskUserQuestion') {
    const questions = toolInput?.questions || [];
    if (questions.length === 0) return null;

    // Format questions for WhatsApp
    const formattedQuestions = questions.map((q, qIdx) => {
      let text = q.question;
      if (q.options && q.options.length > 0) {
        text += '\n';
        q.options.forEach((opt, i) => {
          text += `${i + 1}. ${opt.label}`;
          if (opt.description) {
            text += ` - ${opt.description}`;
          }
          text += '\n';
        });
        text += `${q.options.length + 1}. Other (type your answer)`;
      }
      return { index: qIdx, text, options: q.options, header: q.header };
    });

    // Store pending prompt for response matching
    const promptId = Math.random().toString(36).substring(2, 10);
    const pendingPrompt = {
      id: promptId,
      timestamp: new Date().toISOString(),
      questions: formattedQuestions,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min
    };
    savePendingPrompt(pendingPrompt);

    // Build message
    const message = formattedQuestions.map((q) => q.text).join('\n\n');

    return {
      type: 'custom',
      title: 'Claude needs your input',
      message: message,
      promptId: promptId,
      isQuestion: true,
    };
  }

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

function getChannelNumbers(config) {
  const channel = config.channel || 'whatsapp';

  if (channel === 'whatsapp') {
    const from = config.whatsappFromNumber || config.fromNumber;
    const to = config.whatsappToNumber || config.toNumber;
    if (from && to) {
      return {
        from: from.startsWith('whatsapp:') ? from : `whatsapp:${from}`,
        to: to.startsWith('whatsapp:') ? to : `whatsapp:${to}`,
        channel: 'whatsapp',
      };
    }
  }

  // Fallback to SMS
  const from = config.smsFromNumber || config.fromNumber;
  const to = config.smsToNumber || config.toNumber;
  if (from && to) {
    return { from, to, channel: 'sms' };
  }

  return null;
}

function sendNotification(notification) {
  let config = loadConfig();

  // Apply env vars
  config.accountSid = config.accountSid || process.env.TWILIO_ACCOUNT_SID;
  config.authToken = config.authToken || process.env.TWILIO_AUTH_TOKEN;
  config.channel = config.channel || process.env.TWILIO_CHANNEL || 'whatsapp';

  // WhatsApp numbers
  config.whatsappFromNumber =
    config.whatsappFromNumber || process.env.TWILIO_WHATSAPP_FROM;
  config.whatsappToNumber =
    config.whatsappToNumber || process.env.TWILIO_WHATSAPP_TO;

  // SMS numbers (fallback)
  config.smsFromNumber =
    config.smsFromNumber ||
    process.env.TWILIO_SMS_FROM ||
    process.env.TWILIO_FROM_NUMBER;
  config.smsToNumber =
    config.smsToNumber ||
    process.env.TWILIO_SMS_TO ||
    process.env.TWILIO_TO_NUMBER;

  // Legacy support
  config.fromNumber = config.fromNumber || process.env.TWILIO_FROM_NUMBER;
  config.toNumber = config.toNumber || process.env.TWILIO_TO_NUMBER;

  if (!config.accountSid || !config.authToken) {
    console.error('[notify-hook] Missing Twilio credentials');
    return;
  }

  const numbers = getChannelNumbers(config);
  if (!numbers) {
    console.error(
      '[notify-hook] Missing phone numbers for channel:',
      config.channel
    );
    return;
  }

  let message = `${notification.title}\n\n${notification.message}`;

  if (notification.options) {
    message += '\n\n';
    notification.options.forEach((opt, i) => {
      message += `${i + 1}. ${opt}\n`;
    });
    message += '\nReply with number to select';
  }

  // For questions, add reply instruction
  if (notification.isQuestion) {
    message += '\n\nReply with your choice number or type your answer.';
    if (notification.promptId) {
      message += `\n[ID: ${notification.promptId}]`;
    }
  }

  const postData = new URLSearchParams({
    From: numbers.from,
    To: numbers.to,
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
    let body = '';
    res.on('data', (chunk) => (body += chunk));
    res.on('end', () => {
      if (res.statusCode === 201) {
        console.error(
          `[notify-hook] Sent via ${numbers.channel}: ${notification.title}`
        );
      } else {
        console.error(`[notify-hook] Failed (${res.statusCode}): ${body}`);
      }
    });
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
