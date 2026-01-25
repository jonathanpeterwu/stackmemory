/**
 * SMS Webhook Handler for receiving Twilio responses
 * Can run as standalone server or integrate with existing Express app
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse as parseUrl } from 'url';
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { processIncomingResponse, loadSMSConfig } from './sms-notify.js';
import { queueAction } from './sms-action-runner.js';
import { execSync } from 'child_process';

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
  const dir = join(homedir(), '.stackmemory');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  const responsePath = join(dir, 'sms-latest-response.json');
  writeFileSync(
    responsePath,
    JSON.stringify({
      promptId,
      response,
      action,
      timestamp: new Date().toISOString(),
    })
  );
}

export function handleSMSWebhook(payload: TwilioWebhookPayload): {
  response: string;
  action?: string;
  queued?: boolean;
} {
  const { From, Body } = payload;

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

  // Execute action immediately if present
  if (result.action) {
    console.log(`[sms-webhook] Executing action: ${result.action}`);

    try {
      const output = execSync(result.action, {
        encoding: 'utf8',
        timeout: 60000,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      console.log(
        `[sms-webhook] Action completed: ${output.substring(0, 200)}`
      );

      return {
        response: `Done! Action executed successfully.`,
        action: result.action,
        queued: false,
      };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.log(`[sms-webhook] Action failed: ${error}`);

      // Queue for retry
      queueAction(
        result.prompt?.id || 'unknown',
        result.response || Body,
        result.action
      );

      return {
        response: `Action failed, queued for retry: ${error.substring(0, 50)}`,
        action: result.action,
        queued: true,
      };
    }
  }

  return {
    response: `Received: ${result.response}. Next action will be triggered.`,
  };
}

// Trigger notification when response received
function triggerResponseNotification(response: string): void {
  const message = `SMS Response: ${response}`;

  // macOS notification
  try {
    execSync(
      `osascript -e 'display notification "${message}" with title "StackMemory" sound name "Glass"'`,
      { stdio: 'ignore', timeout: 5000 }
    );
  } catch {
    // Ignore if not on macOS
  }

  // Write signal file for other processes
  try {
    const signalPath = join(homedir(), '.stackmemory', 'sms-signal.txt');
    writeFileSync(
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
        let body = '';
        req.on('data', (chunk) => {
          body += chunk;
        });

        req.on('end', () => {
          try {
            const payload = parseFormData(
              body
            ) as unknown as TwilioWebhookPayload;
            const result = handleSMSWebhook(payload);

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
            writeFileSync(statusPath, JSON.stringify(statuses, null, 2));

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
  });
}

// Express middleware for integration
export function smsWebhookMiddleware(
  req: { body: TwilioWebhookPayload },
  res: { type: (t: string) => void; send: (s: string) => void }
): void {
  const result = handleSMSWebhook(req.body);
  res.type('text/xml');
  res.send(twimlResponse(result.response));
}

// CLI entry
if (process.argv[1]?.endsWith('sms-webhook.js')) {
  const port = parseInt(process.env['SMS_WEBHOOK_PORT'] || '3456', 10);
  startWebhookServer(port);
}
