/**
 * Pure validation functions - ZERO side effects
 * All functions are deterministic and testable in isolation
 */

import {
  type LinearWebhookPayload,
  type WebhookValidation,
  type GitHubContext,
  type LinearPriority,
  type CapturedContent,
  type TicketDraft,
  AUTOMATION_LABELS,
  type ExtensionError,
  err,
  ok,
  type Result,
} from './types.js';

/**
 * Validate incoming webhook payload structure
 */
export function validateWebhookPayload(raw: unknown): WebhookValidation {
  if (!raw || typeof raw !== 'object') {
    return { valid: false, error: 'Payload must be an object' };
  }

  const payload = raw as Record<string, unknown>;

  // Required fields
  if (!payload.action || typeof payload.action !== 'string') {
    return { valid: false, error: 'Missing or invalid action' };
  }

  if (!['create', 'update', 'remove'].includes(payload.action)) {
    return { valid: false, error: `Invalid action: ${payload.action}` };
  }

  if (!payload.type || typeof payload.type !== 'string') {
    return { valid: false, error: 'Missing or invalid type' };
  }

  if (!payload.data || typeof payload.data !== 'object') {
    return { valid: false, error: 'Missing or invalid data' };
  }

  const data = payload.data as Record<string, unknown>;

  if (!data.id || typeof data.id !== 'string') {
    return { valid: false, error: 'Missing or invalid data.id' };
  }

  if (!data.identifier || typeof data.identifier !== 'string') {
    return { valid: false, error: 'Missing or invalid data.identifier' };
  }

  if (!data.title || typeof data.title !== 'string') {
    return { valid: false, error: 'Missing or invalid data.title' };
  }

  return {
    valid: true,
    payload: payload as unknown as LinearWebhookPayload,
  };
}

/**
 * Check if webhook should trigger a subagent
 * Triggers on: issue created with automation label
 */
export function shouldTriggerSubagent(payload: LinearWebhookPayload): boolean {
  // Only trigger on issue creation
  if (payload.type !== 'Issue' || payload.action !== 'create') {
    return false;
  }

  // Check for automation labels
  const labelNames = payload.data.labels.map((l) => l.name.toLowerCase());
  return AUTOMATION_LABELS.some((label) => labelNames.includes(label));
}

/**
 * Extract GitHub context from URL
 * Supports: repo pages, file views, PR pages, commit views
 */
export function extractGitHubContext(url: string): GitHubContext | undefined {
  try {
    const parsed = new URL(url);

    if (parsed.hostname !== 'github.com') {
      return undefined;
    }

    const pathParts = parsed.pathname.split('/').filter(Boolean);

    if (pathParts.length < 2) {
      return undefined;
    }

    const [owner, repo, ...rest] = pathParts;
    const context: GitHubContext = { owner, repo };

    if (rest.length === 0) {
      return context;
    }

    // /owner/repo/pull/123
    if (rest[0] === 'pull' && rest[1]) {
      context.prNumber = parseInt(rest[1], 10);
      return context;
    }

    // /owner/repo/blob/branch/path/to/file
    if (rest[0] === 'blob' && rest[1]) {
      context.branch = rest[1];
      context.filePath = rest.slice(2).join('/');

      // Check for line numbers: #L10 or #L10-L20
      const hash = parsed.hash;
      if (hash) {
        const lineMatch = hash.match(/#L(\d+)(?:-L(\d+))?/);
        if (lineMatch) {
          context.lineStart = parseInt(lineMatch[1], 10);
          if (lineMatch[2]) {
            context.lineEnd = parseInt(lineMatch[2], 10);
          }
        }
      }

      return context;
    }

    // /owner/repo/commit/sha
    if (rest[0] === 'commit' && rest[1]) {
      context.commitSha = rest[1];
      return context;
    }

    // /owner/repo/tree/branch
    if (rest[0] === 'tree' && rest[1]) {
      context.branch = rest[1];
      return context;
    }

    return context;
  } catch {
    return undefined;
  }
}

/**
 * Build task description from webhook payload
 */
export function buildSubagentTask(payload: LinearWebhookPayload): string {
  const { identifier, title, description } = payload.data;
  const parts = [`Linear Issue: ${identifier} - ${title}`];

  if (description) {
    parts.push('', 'Description:', description);
  }

  parts.push('', `URL: ${payload.data.url}`);

  return parts.join('\n');
}

/**
 * Map Linear priority string to API number
 * API: 0=none, 1=urgent, 2=high, 3=medium, 4=low
 */
export function mapLinearPriority(
  priority: LinearPriority | undefined
): number {
  switch (priority) {
    case 'urgent':
      return 1;
    case 'high':
      return 2;
    case 'medium':
      return 3;
    case 'low':
      return 4;
    case 'none':
    default:
      return 0;
  }
}

/**
 * Validate ticket draft before submission
 */
export function validateTicketDraft(
  draft: Partial<TicketDraft>
): Result<TicketDraft, ExtensionError> {
  if (!draft.title?.trim()) {
    return err({ code: 'INVALID_INPUT', message: 'Title is required' });
  }

  if (draft.title.length > 200) {
    return err({
      code: 'INVALID_INPUT',
      message: 'Title must be under 200 characters',
    });
  }

  if (!draft.projectId) {
    return err({ code: 'INVALID_INPUT', message: 'Project is required' });
  }

  if (!draft.captured) {
    return err({
      code: 'INVALID_INPUT',
      message: 'Captured content is required',
    });
  }

  return ok({
    title: draft.title.trim(),
    description: draft.description || '',
    projectId: draft.projectId,
    priority: draft.priority,
    labelIds: draft.labelIds,
    captured: draft.captured,
  });
}

/**
 * Validate captured content
 */
export function validateCapturedContent(
  content: Partial<CapturedContent>
): Result<CapturedContent, ExtensionError> {
  if (!content.text?.trim()) {
    return err({ code: 'INVALID_INPUT', message: 'Selected text is required' });
  }

  if (!content.sourceUrl) {
    return err({ code: 'INVALID_INPUT', message: 'Source URL is required' });
  }

  try {
    new URL(content.sourceUrl);
  } catch {
    return err({ code: 'INVALID_INPUT', message: 'Invalid source URL' });
  }

  return ok({
    text: content.text.trim(),
    sourceUrl: content.sourceUrl,
    timestamp: content.timestamp || Date.now(),
    github: content.github,
  });
}
