/**
 * SMS Webhook Handler for receiving Twilio responses
 * Can run as standalone server or integrate with existing Express app
 */

import { createServer, IncomingMessage, ServerResponse } from 'http';
import { parse as parseUrl } from 'url';
import { existsSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { processIncomingResponse, loadSMSConfig } from './sms-notify.js';
import { queueAction } from './sms-action-runner.js';

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

  // Queue action for execution (instead of immediate execution)
  if (result.action) {
    const actionId = queueAction(
      result.prompt?.id || 'unknown',
      result.response || Body,
      result.action
    );
    console.log(`[sms-webhook] Queued action ${actionId}: ${result.action}`);

    return {
      response: `Got it! Queued action: ${result.action.substring(0, 30)}...`,
      action: result.action,
      queued: true,
    };
  }

  return {
    response: `Received: ${result.response}. Next action will be triggered.`,
  };
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

      // SMS webhook endpoint
      if (url.pathname === '/sms' && req.method === 'POST') {
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

      // Status endpoint
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
    console.log(`[sms-webhook] Webhook URL: http://localhost:${port}/sms`);
    console.log(`[sms-webhook] Configure this URL in Twilio console`);
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
