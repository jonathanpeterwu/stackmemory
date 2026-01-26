/**
 * SMS Webhook Handler for receiving Twilio responses
 * Can run as standalone server or integrate with existing Express app
 *
 * Security features:
 * - Twilio signature verification
 * - Rate limiting per IP
 * - Body size limits
 * - Content-type validation
 * - Safe action execution (no shell injection)
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse as parseUrl } from 'url';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createHmac } from 'crypto';
import { execFileSync } from 'child_process';
import {
  processIncomingResponse,
  loadSMSConfig,
  cleanupExpiredPrompts,
  sendNotification,
} from './sms-notify.js';
import {
  queueAction,
  executeActionSafe,
  cleanupOldActions,
} from './sms-action-runner.js';
import { writeFileSecure, ensureSecureDir } from './secure-fs.js';
import {
  logWebhookRequest,
  logRateLimit,
  logSignatureInvalid,
  logBodyTooLarge,
  logContentTypeInvalid,
  logActionAllowed,
  logActionBlocked,
  logCleanup,
} from './security-logger.js';

// Cleanup interval (5 minutes)
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;

// Input validation constants
const MAX_SMS_BODY_LENGTH = 1000;
const MAX_PHONE_LENGTH = 20;

// Security constants
const MAX_BODY_SIZE = 50 * 1024; // 50KB max body
const RATE_LIMIT_WINDOW_MS = 60 * 1000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = 30; // 30 requests per minute per IP

// Rate limiting store (in production, use Redis)
const rateLimitStore = new Map<string, { count: number; resetTime: number }>();

function checkRateLimit(ip: string): boolean {
  const now = Date.now();
  const record = rateLimitStore.get(ip);

  if (!record || now > record.resetTime) {
    rateLimitStore.set(ip, { count: 1, resetTime: now + RATE_LIMIT_WINDOW_MS });
    return true;
  }

  if (record.count >= RATE_LIMIT_MAX_REQUESTS) {
    return false;
  }

  record.count++;
  return true;
}

// Twilio signature verification
function verifyTwilioSignature(
  url: string,
  params: Record<string, string>,
  signature: string
): boolean {
  const authToken = process.env['TWILIO_AUTH_TOKEN'];
  if (!authToken) {
    console.warn(
      '[sms-webhook] TWILIO_AUTH_TOKEN not set, skipping signature verification'
    );
    return true; // Allow in development, but log warning
  }

  // Build the data string (URL + sorted params)
  const sortedKeys = Object.keys(params).sort();
  let data = url;
  for (const key of sortedKeys) {
    data += key + params[key];
  }

  // Calculate expected signature
  const hmac = createHmac('sha1', authToken);
  hmac.update(data);
  const expectedSignature = hmac.digest('base64');

  return signature === expectedSignature;
}

interface TwilioWebhookPayload {
  From: string;
  To: string;
  Body: string;
  MessageSid: string;
}

function parseFormData(body: string): Record<string, string> {
  const params = new URLSearchParams(body);
  const result: Record<string, string> = {};
  params.forEach((value, key) => {
    result[key] = value;
  });
  return result;
}

// Store response for Claude hook to pick up
function storeLatestResponse(
  promptId: string,
  response: string,
  action?: string
): void {
  ensureSecureDir(join(homedir(), '.stackmemory'));
  const responsePath = join(
    homedir(),
    '.stackmemory',
    'sms-latest-response.json'
  );
  writeFileSecure(
    responsePath,
    JSON.stringify({
      promptId,
      response,
      action,
      timestamp: new Date().toISOString(),
    })
  );
}

export async function handleSMSWebhook(payload: TwilioWebhookPayload): Promise<{
  response: string;
  action?: string;
  queued?: boolean;
}> {
  const { From, Body } = payload;

  // Input length validation
  if (Body && Body.length > MAX_SMS_BODY_LENGTH) {
    console.log(`[sms-webhook] Body too long: ${Body.length} chars`);
    return { response: 'Message too long. Max 1000 characters.' };
  }

  if (From && From.length > MAX_PHONE_LENGTH) {
    console.log(`[sms-webhook] Invalid phone number length`);
    return { response: 'Invalid phone number.' };
  }

  console.log(`[sms-webhook] Received from ${From}: ${Body}`);

  const result = processIncomingResponse(From, Body);

  if (!result.matched) {
    if (result.prompt) {
      return {
        response: `Invalid response. Expected: ${result.prompt.options.map((o) => o.key).join(', ')}`,
      };
    }
    return { response: 'No pending prompt found.' };
  }

  // Store response for Claude hook
  storeLatestResponse(
    result.prompt?.id || 'unknown',
    result.response || Body,
    result.action
  );

  // Trigger notification to alert user/Claude
  triggerResponseNotification(result.response || Body);

  // Execute action safely if present (no shell injection)
  if (result.action) {
    console.log(`[sms-webhook] Executing action: ${result.action}`);

    const actionResult = await executeActionSafe(
      result.action,
      result.response || Body
    );

    if (actionResult.success) {
      logActionAllowed('sms-webhook', result.action);
      console.log(
        `[sms-webhook] Action completed: ${(actionResult.output || '').substring(0, 200)}`
      );

      return {
        response: `Done! Action executed successfully.`,
        action: result.action,
        queued: false,
      };
    } else {
      logActionBlocked(
        'sms-webhook',
        result.action,
        actionResult.error || 'unknown'
      );
      console.log(`[sms-webhook] Action failed: ${actionResult.error}`);

      // Queue for retry
      queueAction(
        result.prompt?.id || 'unknown',
        result.response || Body,
        result.action
      );

      return {
        response: `Action failed, queued for retry: ${(actionResult.error || '').substring(0, 50)}`,
        action: result.action,
        queued: true,
      };
    }
  }

  return {
    response: `Received: ${result.response}. Next action will be triggered.`,
  };
}

// Escape string for AppleScript (prevent injection)
function escapeAppleScript(str: string): string {
  return str
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, '\\n')
    .replace(/\r/g, '\\r')
    .substring(0, 200); // Limit length
}

// Trigger notification when response received
function triggerResponseNotification(response: string): void {
  const safeMessage = escapeAppleScript(`SMS Response: ${response}`);

  // macOS notification using execFile (safer than execSync with shell)
  try {
    execFileSync(
      'osascript',
      [
        '-e',
        `display notification "${safeMessage}" with title "StackMemory" sound name "Glass"`,
      ],
      { stdio: 'ignore', timeout: 5000 }
    );
  } catch {
    // Ignore if not on macOS
  }

  // Write signal file for other processes
  try {
    const signalPath = join(homedir(), '.stackmemory', 'sms-signal.txt');
    writeFileSecure(
      signalPath,
      JSON.stringify({
        type: 'sms_response',
        response,
        timestamp: new Date().toISOString(),
      })
    );
  } catch {
    // Ignore
  }

  console.log(`\n*** SMS RESPONSE RECEIVED: "${response}" ***`);
  console.log(`*** Run: stackmemory notify run-actions ***\n`);
}

// TwiML response helper
function twimlResponse(message: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Message>${escapeXml(message)}</Message>
</Response>`;
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

// Standalone webhook server
export function startWebhookServer(port: number = 3456): void {
  const server = createServer(
    async (req: IncomingMessage, res: ServerResponse) => {
      const url = parseUrl(req.url || '/', true);

      // Health check
      if (url.pathname === '/health') {
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ status: 'ok' }));
        return;
      }

      // SMS webhook endpoint (incoming messages)
      if (
        (url.pathname === '/sms' ||
          url.pathname === '/sms/incoming' ||
          url.pathname === '/webhook') &&
        req.method === 'POST'
      ) {
        const clientIp = req.socket.remoteAddress || 'unknown';

        // Log webhook request
        logWebhookRequest(
          'sms-webhook',
          req.method || 'POST',
          url.pathname || '/sms',
          clientIp
        );

        // Rate limiting
        if (!checkRateLimit(clientIp)) {
          logRateLimit('sms-webhook', clientIp);
          res.writeHead(429, {
            'Content-Type': 'text/xml',
            'Retry-After': '60',
          });
          res.end(twimlResponse('Too many requests. Please try again later.'));
          return;
        }

        // Content-type validation
        const contentType = req.headers['content-type'] || '';
        if (!contentType.includes('application/x-www-form-urlencoded')) {
          logContentTypeInvalid('sms-webhook', contentType, clientIp);
          res.writeHead(400, { 'Content-Type': 'text/xml' });
          res.end(twimlResponse('Invalid content type'));
          return;
        }

        let body = '';
        let bodyTooLarge = false;

        req.on('data', (chunk) => {
          body += chunk;
          // Body size limit
          if (body.length > MAX_BODY_SIZE) {
            bodyTooLarge = true;
            logBodyTooLarge('sms-webhook', body.length, clientIp);
            req.destroy();
          }
        });

        req.on('end', async () => {
          if (bodyTooLarge) {
            res.writeHead(413, { 'Content-Type': 'text/xml' });
            res.end(twimlResponse('Request too large'));
            return;
          }

          try {
            const payload = parseFormData(
              body
            ) as unknown as TwilioWebhookPayload;

            // Verify Twilio signature
            const twilioSignature = req.headers['x-twilio-signature'] as string;
            const webhookUrl = `${req.headers['x-forwarded-proto'] || 'http'}://${req.headers.host}${req.url}`;

            if (
              twilioSignature &&
              !verifyTwilioSignature(
                webhookUrl,
                payload as unknown as Record<string, string>,
                twilioSignature
              )
            ) {
              logSignatureInvalid('sms-webhook', clientIp);
              console.error('[sms-webhook] Invalid Twilio signature');
              res.writeHead(401, { 'Content-Type': 'text/xml' });
              res.end(twimlResponse('Unauthorized'));
              return;
            }

            const result = await handleSMSWebhook(payload);

            res.writeHead(200, { 'Content-Type': 'text/xml' });
            res.end(twimlResponse(result.response));
          } catch (err) {
            console.error('[sms-webhook] Error:', err);
            res.writeHead(500, { 'Content-Type': 'text/xml' });
            res.end(twimlResponse('Error processing message'));
          }
        });
        return;
      }

      // Status callback endpoint (delivery status updates)
      if (url.pathname === '/sms/status' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });

        req.on('end', () => {
          try {
            const payload = parseFormData(body);
            console.log(
              `[sms-webhook] Status update: ${payload['MessageSid']} -> ${payload['MessageStatus']}`
            );

            // Store status for tracking
            const statusPath = join(
              homedir(),
              '.stackmemory',
              'sms-status.json'
            );
            const statuses: Record<string, string> = existsSync(statusPath)
              ? JSON.parse(readFileSync(statusPath, 'utf8'))
              : {};
            statuses[payload['MessageSid']] = payload['MessageStatus'];
            writeFileSecure(statusPath, JSON.stringify(statuses, null, 2));

            res.writeHead(200, { 'Content-Type': 'text/plain' });
            res.end('OK');
          } catch (err) {
            console.error('[sms-webhook] Status error:', err);
            res.writeHead(500);
            res.end('Error');
          }
        });
        return;
      }

      // Server status endpoint
      if (url.pathname === '/status') {
        const config = loadSMSConfig();
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            enabled: config.enabled,
            pendingPrompts: config.pendingPrompts.length,
          })
        );
        return;
      }

      // Send outgoing notification endpoint
      if (url.pathname === '/send' && req.method === 'POST') {
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
          if (body.length > MAX_BODY_SIZE) {
            req.destroy();
          }
        });

        req.on('end', async () => {
          try {
            const payload = JSON.parse(body);
            const message = payload.message || payload.body || '';
            const title = payload.title || 'Notification';
            const type = payload.type || 'custom';

            if (!message) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(
                JSON.stringify({ success: false, error: 'Message required' })
              );
              return;
            }

            const result = await sendNotification({
              type: type as
                | 'task_complete'
                | 'review_ready'
                | 'error'
                | 'custom',
              title,
              message,
            });

            res.writeHead(result.success ? 200 : 500, {
              'Content-Type': 'application/json',
            });
            res.end(JSON.stringify(result));
          } catch (err) {
            console.error('[sms-webhook] Send error:', err);
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(
              JSON.stringify({
                success: false,
                error: err instanceof Error ? err.message : 'Send failed',
              })
            );
          }
        });
        return;
      }

      res.writeHead(404);
      res.end('Not found');
    }
  );

  server.listen(port, () => {
    console.log(`[sms-webhook] Server listening on port ${port}`);
    console.log(
      `[sms-webhook] Incoming messages: http://localhost:${port}/sms/incoming`
    );
    console.log(
      `[sms-webhook] Status callback:   http://localhost:${port}/sms/status`
    );
    console.log(`[sms-webhook] Configure these URLs in Twilio console`);

    // Start timed cleanup of expired prompts and old actions
    setInterval(() => {
      try {
        const expiredPrompts = cleanupExpiredPrompts();
        const oldActions = cleanupOldActions();
        if (expiredPrompts > 0 || oldActions > 0) {
          logCleanup('sms-webhook', expiredPrompts, oldActions);
          console.log(
            `[sms-webhook] Cleanup: ${expiredPrompts} expired prompts, ${oldActions} old actions`
          );
        }
      } catch {
        // Ignore cleanup errors
      }
    }, CLEANUP_INTERVAL_MS);
    console.log(
      `[sms-webhook] Cleanup interval: every ${CLEANUP_INTERVAL_MS / 1000}s`
    );
  });
}

// Express middleware for integration
export async function smsWebhookMiddleware(
  req: { body: TwilioWebhookPayload },
  res: { type: (t: string) => void; send: (s: string) => void }
): Promise<void> {
  const result = await handleSMSWebhook(req.body);
  res.type('text/xml');
  res.send(twimlResponse(result.response));
}

// CLI entry
if (process.argv[1]?.endsWith('sms-webhook.js')) {
  const port = parseInt(process.env['SMS_WEBHOOK_PORT'] || '3456', 10);
  startWebhookServer(port);
}
