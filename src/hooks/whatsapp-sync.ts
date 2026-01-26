/**
 * WhatsApp Context Sync Engine
 * Push frame digests and context updates to WhatsApp
 *
 * Uses the frame lifecycle hooks system to receive frame close events.
 * Call `registerWhatsAppSyncHook()` to enable automatic sync on frame close.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  sendNotification,
  loadSMSConfig,
  saveSMSConfig,
  type NotificationPayload,
} from './sms-notify.js';
import { writeFileSecure, ensureSecureDir } from './secure-fs.js';
import { SyncOptionsSchema, parseConfigSafe } from './schemas.js';
import {
  frameLifecycleHooks,
  type FrameCloseData,
} from '../core/context/frame-lifecycle-hooks.js';

export interface SyncOptions {
  autoSyncOnClose: boolean;
  minFrameDuration: number; // seconds, skip short frames
  includeDecisions: boolean;
  includeFiles: boolean;
  includeTests: boolean;
  maxDigestLength: number; // chars, default 400
}

export interface SyncResult {
  success: boolean;
  messageId?: string;
  channel?: 'whatsapp' | 'sms';
  error?: string;
  digestLength?: number;
}

export interface FrameDigestData {
  frameId: string;
  name: string;
  type: string;
  status: 'success' | 'failure' | 'partial' | 'ongoing';
  durationSeconds: number;
  filesModified: Array<{ path: string; operation: string }>;
  testsRun: Array<{ name: string; status: string }>;
  decisions: string[];
  risks: string[];
  toolCallCount: number;
  errors: Array<{ type: string; message: string; resolved: boolean }>;
}

const SYNC_CONFIG_PATH = join(homedir(), '.stackmemory', 'whatsapp-sync.json');

const DEFAULT_SYNC_OPTIONS: SyncOptions = {
  autoSyncOnClose: false,
  minFrameDuration: 30, // Skip frames shorter than 30 seconds
  includeDecisions: true,
  includeFiles: true,
  includeTests: true,
  maxDigestLength: 400,
};

/**
 * Load sync options from config file
 */
export function loadSyncOptions(): SyncOptions {
  try {
    if (existsSync(SYNC_CONFIG_PATH)) {
      const data = JSON.parse(readFileSync(SYNC_CONFIG_PATH, 'utf8'));
      return parseConfigSafe(
        SyncOptionsSchema,
        { ...DEFAULT_SYNC_OPTIONS, ...data },
        DEFAULT_SYNC_OPTIONS,
        'whatsapp-sync'
      );
    }
  } catch {
    // Use defaults
  }
  return { ...DEFAULT_SYNC_OPTIONS };
}

/**
 * Save sync options to config file
 */
export function saveSyncOptions(options: SyncOptions): void {
  try {
    ensureSecureDir(join(homedir(), '.stackmemory'));
    writeFileSecure(SYNC_CONFIG_PATH, JSON.stringify(options, null, 2));
  } catch {
    // Silently fail
  }
}

/**
 * Format duration for mobile display
 */
function formatDuration(seconds: number): string {
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return secs > 0 ? `${mins}m${secs}s` : `${mins}m`;
  } else {
    const hours = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return mins > 0 ? `${hours}h${mins}m` : `${hours}h`;
  }
}

/**
 * Truncate text to max length with ellipsis
 */
function truncate(text: string, maxLen: number): string {
  if (text.length <= maxLen) return text;
  return text.slice(0, maxLen - 3) + '...';
}

/**
 * Get status symbol for mobile display
 */
function getStatusSymbol(status: string): string {
  switch (status) {
    case 'success':
      return 'OK';
    case 'failure':
      return 'FAIL';
    case 'partial':
      return 'PARTIAL';
    case 'ongoing':
      return 'ACTIVE';
    default:
      return '?';
  }
}

/**
 * Generate WhatsApp-friendly digest (300-400 chars max)
 * Optimized for mobile readability
 */
export function generateMobileDigest(
  data: FrameDigestData,
  options: SyncOptions = DEFAULT_SYNC_OPTIONS
): string {
  const parts: string[] = [];
  const maxLen = options.maxDigestLength;

  // Header: FRAME: Name [type] - duration status
  const header = `FRAME: ${truncate(data.name, 30)} [${data.type}] - ${formatDuration(data.durationSeconds)} ${getStatusSymbol(data.status)}`;
  parts.push(header);

  // Activity summary line
  const activityParts: string[] = [];

  if (options.includeFiles && data.filesModified.length > 0) {
    activityParts.push(`FILES: ${data.filesModified.length}`);
  }

  if (data.toolCallCount > 0) {
    activityParts.push(`TOOLS: ${data.toolCallCount}`);
  }

  if (options.includeTests && data.testsRun.length > 0) {
    const passed = data.testsRun.filter((t) => t.status === 'passed').length;
    const failed = data.testsRun.filter((t) => t.status === 'failed').length;
    if (failed > 0) {
      activityParts.push(`TESTS: ${passed}ok/${failed}fail`);
    } else {
      activityParts.push(`TESTS: ${passed} pass`);
    }
  }

  if (activityParts.length > 0) {
    parts.push(activityParts.join(' | '));
  }

  // Files modified (compact)
  if (options.includeFiles && data.filesModified.length > 0) {
    const fileList = data.filesModified
      .slice(0, 3)
      .map((f) => {
        const basename = f.path.split('/').pop() || f.path;
        const op = f.operation.charAt(0).toUpperCase();
        return `${op}:${truncate(basename, 20)}`;
      })
      .join(', ');
    const more =
      data.filesModified.length > 3 ? ` +${data.filesModified.length - 3}` : '';
    parts.push(`  ${fileList}${more}`);
  }

  // Decisions (high value)
  if (options.includeDecisions && data.decisions.length > 0) {
    parts.push('');
    parts.push('DECISIONS:');
    data.decisions.slice(0, 3).forEach((d) => {
      parts.push(`  ${truncate(d, 60)}`);
    });
    if (data.decisions.length > 3) {
      parts.push(`  +${data.decisions.length - 3} more`);
    }
  }

  // Risks (important to surface)
  if (data.risks.length > 0) {
    parts.push('');
    parts.push('RISKS:');
    data.risks.slice(0, 2).forEach((r) => {
      parts.push(`  ${truncate(r, 50)}`);
    });
  }

  // Errors (unresolved only)
  const unresolvedErrors = data.errors.filter((e) => !e.resolved);
  if (unresolvedErrors.length > 0) {
    parts.push('');
    parts.push(`ERRORS: ${unresolvedErrors.length} unresolved`);
    unresolvedErrors.slice(0, 2).forEach((e) => {
      parts.push(`  ${truncate(e.message, 50)}`);
    });
  }

  // Next action suggestion
  parts.push('');
  if (data.status === 'success') {
    parts.push('NEXT: commit & test');
  } else if (data.status === 'failure') {
    parts.push('NEXT: fix errors');
  } else if (data.status === 'partial') {
    parts.push('NEXT: review & continue');
  } else {
    parts.push('NEXT: check status');
  }

  // Join and truncate final result
  let result = parts.join('\n');

  // If too long, trim aggressively
  if (result.length > maxLen) {
    // Remove less important sections
    const essentialParts = [header];

    if (activityParts.length > 0) {
      essentialParts.push(activityParts.join(' | '));
    }

    if (options.includeDecisions && data.decisions.length > 0) {
      essentialParts.push('');
      essentialParts.push(`DECISIONS: ${data.decisions.length}`);
      essentialParts.push(`  ${truncate(data.decisions[0], 50)}`);
    }

    if (unresolvedErrors.length > 0) {
      essentialParts.push('');
      essentialParts.push(`ERRORS: ${unresolvedErrors.length} unresolved`);
    }

    essentialParts.push('');
    essentialParts.push(
      data.status === 'success' ? 'NEXT: commit' : 'NEXT: review'
    );

    result = essentialParts.join('\n');
  }

  return result.slice(0, maxLen);
}

/**
 * Get frame digest data from stackmemory database
 * Returns null if frame not found or context unavailable
 */
export async function getFrameDigestData(
  frameId?: string
): Promise<FrameDigestData | null> {
  try {
    // Try to load from recent frame digests
    const digestPath = join(
      homedir(),
      '.stackmemory',
      'latest-frame-digest.json'
    );

    if (existsSync(digestPath)) {
      const data = JSON.parse(readFileSync(digestPath, 'utf8'));

      // If frameId specified, check if it matches
      if (frameId && data.frameId !== frameId) {
        return null;
      }

      return data as FrameDigestData;
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Store frame digest for sync
 */
export function storeFrameDigest(data: FrameDigestData): void {
  try {
    ensureSecureDir(join(homedir(), '.stackmemory'));
    const digestPath = join(
      homedir(),
      '.stackmemory',
      'latest-frame-digest.json'
    );
    writeFileSecure(digestPath, JSON.stringify(data, null, 2));
  } catch {
    // Silently fail
  }
}

/**
 * Push current context to WhatsApp
 */
export async function syncContext(): Promise<SyncResult> {
  const options = loadSyncOptions();
  const data = await getFrameDigestData();

  if (!data) {
    return {
      success: false,
      error: 'No context data available. Run a task first.',
    };
  }

  return syncFrameData(data, options);
}

/**
 * Sync specific frame by ID
 */
export async function syncFrame(frameId: string): Promise<SyncResult> {
  const options = loadSyncOptions();
  const data = await getFrameDigestData(frameId);

  if (!data) {
    return {
      success: false,
      error: `Frame not found: ${frameId}`,
    };
  }

  return syncFrameData(data, options);
}

/**
 * Sync frame data to WhatsApp
 */
async function syncFrameData(
  data: FrameDigestData,
  options: SyncOptions
): Promise<SyncResult> {
  const config = loadSMSConfig();

  if (!config.enabled) {
    return { success: false, error: 'Notifications disabled' };
  }

  // Check minimum duration
  if (data.durationSeconds < options.minFrameDuration) {
    return {
      success: false,
      error: `Frame too short (${data.durationSeconds}s < ${options.minFrameDuration}s min)`,
    };
  }

  // Generate mobile digest
  const digest = generateMobileDigest(data, options);

  // Send notification
  const payload: NotificationPayload = {
    type: 'custom',
    title: 'Context Sync',
    message: digest,
    prompt: {
      type: 'options',
      options: [
        { key: '1', label: 'Commit', action: 'git add -A && git commit' },
        { key: '2', label: 'Status', action: 'stackmemory status' },
        { key: '3', label: 'Continue', action: 'echo "Continuing..."' },
      ],
      question: 'Action?',
    },
  };

  const result = await sendNotification(payload);

  return {
    success: result.success,
    messageId: result.promptId,
    channel: result.channel,
    error: result.error,
    digestLength: digest.length,
  };
}

/**
 * Enable auto-sync on frame close
 */
export function enableAutoSync(options?: Partial<SyncOptions>): void {
  const current = loadSyncOptions();
  const updated: SyncOptions = {
    ...current,
    ...options,
    autoSyncOnClose: true,
  };
  saveSyncOptions(updated);

  // Update SMS config to enable context_sync notifications
  const smsConfig = loadSMSConfig();
  if (!smsConfig.notifyOn.custom) {
    smsConfig.notifyOn.custom = true;
    saveSMSConfig(smsConfig);
  }
}

/**
 * Disable auto-sync
 */
export function disableAutoSync(): void {
  const current = loadSyncOptions();
  current.autoSyncOnClose = false;
  saveSyncOptions(current);
}

/**
 * Check if auto-sync is enabled
 */
export function isAutoSyncEnabled(): boolean {
  const options = loadSyncOptions();
  return options.autoSyncOnClose;
}

/**
 * Callback for frame manager to trigger auto-sync
 * Call this when a frame closes
 */
export async function onFrameClosed(
  frameData: FrameDigestData
): Promise<SyncResult | null> {
  if (!isAutoSyncEnabled()) {
    return null;
  }

  // Store for potential manual sync later
  storeFrameDigest(frameData);

  // Auto-sync
  const options = loadSyncOptions();
  return syncFrameData(frameData, options);
}

/**
 * Internal hook handler that receives FrameCloseData from lifecycle hooks
 */
async function handleFrameCloseHook(data: FrameCloseData): Promise<void> {
  const digestData = createFrameDigestData(
    data.frame,
    data.events,
    data.anchors
  );
  await onFrameClosed(digestData);
}

// Track if hook is registered to avoid duplicates
let hookUnregister: (() => void) | null = null;

/**
 * Register WhatsApp sync as a frame lifecycle hook
 * This enables automatic sync when frames are closed
 * Call this during app initialization to enable the integration
 *
 * @returns Unregister function to disable the hook
 */
export function registerWhatsAppSyncHook(): () => void {
  // Avoid duplicate registration
  if (hookUnregister) {
    return hookUnregister;
  }

  hookUnregister = frameLifecycleHooks.onFrameClosed(
    'whatsapp-sync',
    handleFrameCloseHook,
    -10 // Low priority - run after other hooks
  );

  return () => {
    if (hookUnregister) {
      hookUnregister();
      hookUnregister = null;
    }
  };
}

/**
 * Check if the WhatsApp sync hook is currently registered
 */
export function isHookRegistered(): boolean {
  return hookUnregister !== null;
}

/**
 * Create frame digest data from raw frame info
 * Helper for integration with frame-manager
 */
export function createFrameDigestData(
  frame: {
    frame_id: string;
    name: string;
    type: string;
    created_at: number;
    closed_at?: number;
  },
  events: Array<{
    event_type: string;
    payload: Record<string, unknown>;
  }>,
  anchors: Array<{
    type: string;
    text: string;
  }>
): FrameDigestData {
  const now = Math.floor(Date.now() / 1000);
  const duration = (frame.closed_at || now) - frame.created_at;

  // Extract files from tool_call events
  const filesModified: Array<{ path: string; operation: string }> = [];
  const filesSeen = new Set<string>();

  events
    .filter((e) => e.event_type === 'tool_call')
    .forEach((e) => {
      const path = e.payload['path'] as string | undefined;
      if (path && !filesSeen.has(path)) {
        filesSeen.add(path);
        const toolName = (e.payload['tool_name'] as string) || '';
        let operation = 'modify';
        if (toolName.includes('Write') || toolName.includes('Create')) {
          operation = 'create';
        } else if (toolName.includes('Read')) {
          operation = 'read';
        } else if (toolName.includes('Delete')) {
          operation = 'delete';
        }
        filesModified.push({ path, operation });
      }
    });

  // Extract tests
  const testsRun: Array<{ name: string; status: string }> = [];
  events
    .filter(
      (e) =>
        e.event_type === 'tool_result' &&
        String(e.payload['output'] || '').includes('test')
    )
    .forEach((e) => {
      const output = String(e.payload['output'] || '');
      // Simple test result extraction
      const passMatch = output.match(/(\d+) pass/i);
      const failMatch = output.match(/(\d+) fail/i);
      if (passMatch) {
        testsRun.push({ name: 'Tests', status: 'passed' });
      }
      if (failMatch && parseInt(failMatch[1]) > 0) {
        testsRun.push({ name: 'Tests', status: 'failed' });
      }
    });

  // Extract decisions and risks from anchors
  const decisions = anchors
    .filter((a) => a.type === 'DECISION')
    .map((a) => a.text);

  const risks = anchors.filter((a) => a.type === 'RISK').map((a) => a.text);

  // Extract errors
  const errors: Array<{ type: string; message: string; resolved: boolean }> =
    [];
  events
    .filter((e) => e.payload['error'] || e.payload['status'] === 'error')
    .forEach((e) => {
      const errorMsg =
        (e.payload['error'] as string) ||
        (e.payload['message'] as string) ||
        'Unknown error';
      errors.push({
        type: (e.payload['type'] as string) || 'error',
        message: errorMsg,
        resolved: false,
      });
    });

  // Determine status
  let status: 'success' | 'failure' | 'partial' | 'ongoing' = 'ongoing';
  if (frame.closed_at) {
    if (errors.filter((e) => !e.resolved).length > 0) {
      status = 'failure';
    } else if (
      testsRun.some((t) => t.status === 'failed') ||
      filesModified.length === 0
    ) {
      status = 'partial';
    } else {
      status = 'success';
    }
  }

  // Count tool calls
  const toolCallCount = events.filter(
    (e) => e.event_type === 'tool_call'
  ).length;

  return {
    frameId: frame.frame_id,
    name: frame.name,
    type: frame.type,
    status,
    durationSeconds: duration,
    filesModified: filesModified.filter((f) => f.operation !== 'read'),
    testsRun,
    decisions,
    risks,
    toolCallCount,
    errors,
  };
}
