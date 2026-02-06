/**
 * Linear Chrome Extension - Core Types
 *
 * These types define the ENTIRE system. Review carefully.
 * If these are wrong, everything cascades.
 */

// === EXTENSION DOMAIN ===

/** What the user captures from a webpage */
export interface CapturedContent {
  text: string;
  sourceUrl: string;
  timestamp: number;
  /** GitHub-specific context when on github.com */
  github?: GitHubContext;
}

/** GitHub-specific captured context */
export interface GitHubContext {
  owner: string;
  repo: string;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  prNumber?: number;
  branch?: string;
  commitSha?: string;
}

/** User's ticket creation input */
export interface TicketDraft {
  title: string;
  description: string;
  projectId: string;
  priority?: LinearPriority;
  labelIds?: string[];
  captured: CapturedContent;
}

export type LinearPriority = 'urgent' | 'high' | 'medium' | 'low' | 'none';

// === LINEAR API DOMAIN ===

/** Linear OAuth tokens (stored in chrome.storage) */
export interface LinearAuth {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
  teamId: string;
  teamKey: string; // e.g., "STA"
  userId: string;
}

/** Linear issue creation request */
export interface LinearIssueCreate {
  title: string;
  description: string;
  teamId: string;
  projectId?: string;
  priority?: number; // 0=none, 1=urgent, 2=high, 3=medium, 4=low
  labelIds?: string[];
}

/** Linear issue response */
export interface LinearIssue {
  id: string;
  identifier: string; // "STA-123"
  title: string;
  url: string;
  state: {
    id: string;
    name: string;
  };
}

/** Linear project (for dropdown) */
export interface LinearProject {
  id: string;
  name: string;
  state: string;
}

/** Linear label (for selection) */
export interface LinearLabel {
  id: string;
  name: string;
  color: string;
}

// === WEBHOOK DOMAIN ===

/** Incoming Linear webhook payload */
export interface LinearWebhookPayload {
  action: 'create' | 'update' | 'remove';
  type: 'Issue' | 'Comment' | 'Project';
  createdAt: string;
  data: LinearWebhookIssueData;
  url: string;
  organizationId: string;
}

export interface LinearWebhookIssueData {
  id: string;
  identifier: string; // "STA-123"
  title: string;
  description?: string;
  url: string;
  labels: Array<{ id: string; name: string }>;
  team: { id: string; key: string };
  project?: { id: string; name: string };
  assignee?: { id: string; name: string };
  state: { id: string; name: string };
  priority: number;
}

/** Webhook validation result */
export interface WebhookValidation {
  valid: boolean;
  error?: string;
  payload?: LinearWebhookPayload;
}

/** Labels that trigger automated processing */
export const AUTOMATION_LABELS = [
  'automated',
  'claude-code',
  'stackmemory',
] as const;
export type AutomationLabel = (typeof AUTOMATION_LABELS)[number];

// === SUBAGENT DOMAIN ===

/** Agent types available for spawning */
export type SubagentType =
  | 'general-purpose'
  | 'code-reviewer'
  | 'debugger'
  | 'github-workflow'
  | 'Explore';

/** Config for spawning a Claude Code subagent */
export interface SubagentSpawnConfig {
  agentType: SubagentType;
  task: string;
  context: SubagentContext;
  options: SubagentOptions;
}

export interface SubagentContext {
  linearIssueId: string;
  linearIdentifier: string; // "STA-123"
  linearUrl: string;
  sourceUrl: string;
  sourceText: string;
  github?: GitHubContext;
}

export interface SubagentOptions {
  /** Close Linear issue when agent completes successfully */
  autoCloseIssue: boolean;
  /** Post agent output as comment on Linear issue */
  postResultsToLinear: boolean;
  /** Timeout in ms (default: 5 min) */
  timeout?: number;
  /** Model to use */
  model?: 'sonnet' | 'opus' | 'haiku';
  /** Run in background */
  background?: boolean;
}

/** Subagent execution result */
export interface SubagentResult {
  sessionId: string;
  status: SubagentStatus;
  output?: string;
  error?: string;
  duration?: number;
  linearCommentId?: string;
}

export type SubagentStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'timeout';

// === ERROR DOMAIN ===

export type ExtensionErrorCode =
  | 'AUTH_REQUIRED'
  | 'AUTH_EXPIRED'
  | 'LINEAR_API_ERROR'
  | 'WEBHOOK_INVALID'
  | 'WEBHOOK_SIGNATURE_MISMATCH'
  | 'SUBAGENT_SPAWN_FAILED'
  | 'SUBAGENT_TIMEOUT'
  | 'NETWORK_ERROR'
  | 'INVALID_INPUT';

export interface ExtensionError {
  code: ExtensionErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

/** Type guard for ExtensionError */
export function isExtensionError(value: unknown): value is ExtensionError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'code' in value &&
    'message' in value
  );
}

// === RESULT TYPE ===

/** Discriminated union for operation results */
export type Result<T, E = ExtensionError> =
  | { ok: true; value: T }
  | { ok: false; error: E };

/** Helper to create success result */
export function ok<T>(value: T): Result<T, never> {
  return { ok: true, value };
}

/** Helper to create error result */
export function err<E>(error: E): Result<never, E> {
  return { ok: false, error };
}

// === CONFIG ===

/** Extension configuration */
export interface ExtensionConfig {
  /** StackMemory webhook endpoint */
  webhookUrl: string;
  /** Default labels to apply to created issues */
  defaultLabels: string[];
  /** Auto-spawn subagent on issue creation */
  autoSpawnSubagent: boolean;
  /** Default agent type for spawning */
  defaultAgentType: SubagentType;
}

/** Default extension config */
export const DEFAULT_CONFIG: ExtensionConfig = {
  webhookUrl: 'http://localhost:3456/api/webhooks/linear',
  defaultLabels: ['automated'],
  autoSpawnSubagent: true,
  defaultAgentType: 'general-purpose',
};
