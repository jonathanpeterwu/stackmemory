/**
 * Security Event Logger for hooks
 * Logs security-relevant events for audit trail
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { ensureSecureDir } from './secure-fs.js';

const LOG_DIR = join(homedir(), '.stackmemory', 'logs');
const SECURITY_LOG = join(LOG_DIR, 'security.log');
const MAX_LOG_ENTRIES = 10000;

export type SecurityEventType =
  | 'auth_success'
  | 'auth_failure'
  | 'rate_limit'
  | 'action_allowed'
  | 'action_blocked'
  | 'config_invalid'
  | 'config_loaded'
  | 'webhook_request'
  | 'signature_invalid'
  | 'body_too_large'
  | 'content_type_invalid'
  | 'cleanup';

export interface SecurityEvent {
  timestamp: string;
  type: SecurityEventType;
  source: string;
  message: string;
  details?: Record<string, unknown>;
  ip?: string;
}

let logCount = 0;

/**
 * Log a security event
 */
export function logSecurityEvent(
  type: SecurityEventType,
  source: string,
  message: string,
  details?: Record<string, unknown>,
  ip?: string
): void {
  try {
    ensureSecureDir(LOG_DIR);

    const event: SecurityEvent = {
      timestamp: new Date().toISOString(),
      type,
      source,
      message,
      ...(details && { details }),
      ...(ip && { ip: maskIp(ip) }),
    };

    const logLine = JSON.stringify(event) + '\n';
    appendFileSync(SECURITY_LOG, logLine, { mode: 0o600 });

    logCount++;

    // Rotate log if too large (simple rotation - truncate)
    if (logCount > MAX_LOG_ENTRIES) {
      rotateLog();
    }
  } catch {
    // Don't let logging failures break the application
  }
}

/**
 * Mask IP address for privacy (keep first two octets)
 */
function maskIp(ip: string): string {
  if (!ip) return 'unknown';

  // Handle IPv6 localhost
  if (ip === '::1' || ip === '::ffff:127.0.0.1') return '127.0.0.x';

  // Handle IPv4
  const parts = ip.replace('::ffff:', '').split('.');
  if (parts.length === 4) {
    return `${parts[0]}.${parts[1]}.x.x`;
  }

  // Handle IPv6 - mask last 64 bits
  if (ip.includes(':')) {
    const segments = ip.split(':');
    if (segments.length >= 4) {
      return segments.slice(0, 4).join(':') + ':x:x:x:x';
    }
  }

  return 'masked';
}

/**
 * Simple log rotation - keep last half of entries
 */
function rotateLog(): void {
  try {
    if (existsSync(SECURITY_LOG)) {
      const content = readFileSync(SECURITY_LOG, 'utf8');
      const lines = content.trim().split('\n');
      const keepLines = lines.slice(-MAX_LOG_ENTRIES / 2);
      writeFileSync(SECURITY_LOG, keepLines.join('\n') + '\n', { mode: 0o600 });
      logCount = keepLines.length;
    }
  } catch {
    // Ignore rotation errors
  }
}

// Convenience functions for common events

export function logAuthSuccess(
  source: string,
  details?: Record<string, unknown>
): void {
  logSecurityEvent(
    'auth_success',
    source,
    'Authentication successful',
    details
  );
}

export function logAuthFailure(
  source: string,
  reason: string,
  ip?: string,
  details?: Record<string, unknown>
): void {
  logSecurityEvent(
    'auth_failure',
    source,
    `Authentication failed: ${reason}`,
    details,
    ip
  );
}

export function logRateLimit(source: string, ip: string): void {
  logSecurityEvent('rate_limit', source, 'Rate limit exceeded', undefined, ip);
}

export function logActionAllowed(source: string, action: string): void {
  logSecurityEvent(
    'action_allowed',
    source,
    `Action executed: ${action.substring(0, 100)}`
  );
}

export function logActionBlocked(
  source: string,
  action: string,
  reason: string
): void {
  logSecurityEvent('action_blocked', source, `Action blocked: ${reason}`, {
    action: action.substring(0, 100),
  });
}

export function logConfigInvalid(source: string, errors: string[]): void {
  logSecurityEvent('config_invalid', source, 'Invalid config rejected', {
    errors: errors.slice(0, 5),
  });
}

export function logWebhookRequest(
  source: string,
  method: string,
  path: string,
  ip?: string
): void {
  logSecurityEvent(
    'webhook_request',
    source,
    `${method} ${path}`,
    undefined,
    ip
  );
}

export function logSignatureInvalid(source: string, ip?: string): void {
  logSecurityEvent(
    'signature_invalid',
    source,
    'Invalid request signature',
    undefined,
    ip
  );
}

export function logBodyTooLarge(
  source: string,
  size: number,
  ip?: string
): void {
  logSecurityEvent(
    'body_too_large',
    source,
    `Request body too large: ${size} bytes`,
    undefined,
    ip
  );
}

export function logContentTypeInvalid(
  source: string,
  contentType: string,
  ip?: string
): void {
  logSecurityEvent(
    'content_type_invalid',
    source,
    `Invalid content type: ${contentType}`,
    undefined,
    ip
  );
}

export function logCleanup(
  source: string,
  expiredPrompts: number,
  oldActions: number
): void {
  if (expiredPrompts > 0 || oldActions > 0) {
    logSecurityEvent('cleanup', source, 'Cleanup completed', {
      expiredPrompts,
      oldActions,
    });
  }
}
