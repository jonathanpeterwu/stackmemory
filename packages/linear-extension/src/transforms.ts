/**
 * Pure transformation functions - ZERO side effects
 * All functions are deterministic and testable in isolation
 */

import {
  type CapturedContent,
  type TicketDraft,
  type LinearAuth,
  type LinearIssueCreate,
  type LinearWebhookPayload,
  type SubagentSpawnConfig,
  type SubagentType,
  type GitHubContext,
  DEFAULT_CONFIG,
} from './types.js';
import { mapLinearPriority, extractGitHubContext } from './validation.js';

/**
 * Transform captured content into Linear description markdown
 */
export function capturedToDescription(captured: CapturedContent): string {
  const parts: string[] = [];

  // Add captured text in quote block
  if (captured.text) {
    parts.push('> ' + captured.text.split('\n').join('\n> '));
  }

  parts.push('');
  parts.push(
    `**Source:** [${new URL(captured.sourceUrl).hostname}](${captured.sourceUrl})`
  );

  // Add GitHub context if available
  if (captured.github) {
    parts.push('');
    parts.push('**GitHub Context:**');
    parts.push(...formatGitHubContext(captured.github));
  }

  parts.push('');
  parts.push('---');
  parts.push(
    `*Created via Linear Extension at ${new Date(captured.timestamp).toISOString()}*`
  );

  return parts.join('\n');
}

/**
 * Format GitHub context as markdown list
 */
function formatGitHubContext(github: GitHubContext): string[] {
  const lines: string[] = [];

  lines.push(`- Repository: \`${github.owner}/${github.repo}\``);

  if (github.prNumber) {
    lines.push(`- PR: #${github.prNumber}`);
  }

  if (github.filePath) {
    let fileRef = `- File: \`${github.filePath}\``;
    if (github.lineStart) {
      fileRef += github.lineEnd
        ? ` (lines ${github.lineStart}-${github.lineEnd})`
        : ` (line ${github.lineStart})`;
    }
    lines.push(fileRef);
  }

  if (github.branch) {
    lines.push(`- Branch: \`${github.branch}\``);
  }

  if (github.commitSha) {
    lines.push(`- Commit: \`${github.commitSha.slice(0, 7)}\``);
  }

  return lines;
}

/**
 * Transform ticket draft to Linear API create request
 */
export function draftToLinearCreate(
  draft: TicketDraft,
  auth: LinearAuth
): LinearIssueCreate {
  const description =
    draft.description || capturedToDescription(draft.captured);

  // Merge default labels with user-selected labels
  const labelIds = [...(draft.labelIds || [])];

  return {
    title: draft.title,
    description,
    teamId: auth.teamId,
    projectId: draft.projectId || undefined,
    priority: mapLinearPriority(draft.priority),
    labelIds: labelIds.length > 0 ? labelIds : undefined,
  };
}

/**
 * Transform webhook payload to subagent spawn config
 */
export function webhookToSpawnConfig(
  payload: LinearWebhookPayload,
  options?: Partial<SubagentSpawnConfig['options']>
): SubagentSpawnConfig {
  const { data } = payload;

  // Determine agent type from labels or default
  const agentType = determineAgentType(data.labels.map((l) => l.name));

  // Extract source URL and GitHub context from description
  const sourceInfo = extractSourceFromDescription(data.description || '');

  return {
    agentType,
    task: buildTaskPrompt(data.title, data.description),
    context: {
      linearIssueId: data.id,
      linearIdentifier: data.identifier,
      linearUrl: data.url,
      sourceUrl: sourceInfo.url || data.url,
      sourceText: sourceInfo.text || data.description || '',
      github: sourceInfo.github,
    },
    options: {
      autoCloseIssue: options?.autoCloseIssue ?? false,
      postResultsToLinear: options?.postResultsToLinear ?? true,
      timeout: options?.timeout ?? 5 * 60 * 1000, // 5 min default
      model: options?.model ?? 'sonnet',
      background: options?.background ?? true,
    },
  };
}

/**
 * Determine agent type from issue labels
 */
function determineAgentType(labels: string[]): SubagentType {
  const lowerLabels = labels.map((l) => l.toLowerCase());

  if (lowerLabels.some((l) => l.includes('review') || l.includes('pr'))) {
    return 'code-reviewer';
  }

  if (lowerLabels.some((l) => l.includes('bug') || l.includes('debug'))) {
    return 'debugger';
  }

  if (lowerLabels.some((l) => l.includes('github') || l.includes('workflow'))) {
    return 'github-workflow';
  }

  if (
    lowerLabels.some((l) => l.includes('explore') || l.includes('research'))
  ) {
    return 'Explore';
  }

  return DEFAULT_CONFIG.defaultAgentType;
}

/**
 * Build task prompt for subagent
 */
function buildTaskPrompt(title: string, description?: string): string {
  const parts = [title];

  if (description) {
    // Extract just the quoted content if present
    const quoteMatch = description.match(/^>\s*(.+?)(?:\n\n|$)/s);
    if (quoteMatch) {
      parts.push('');
      parts.push('Context:');
      parts.push(quoteMatch[1].replace(/^>\s*/gm, ''));
    }
  }

  return parts.join('\n');
}

/**
 * Extract source URL and text from description
 */
function extractSourceFromDescription(description: string): {
  url?: string;
  text?: string;
  github?: GitHubContext;
} {
  const result: { url?: string; text?: string; github?: GitHubContext } = {};

  // Extract quoted text
  const quoteMatch = description.match(/^>\s*(.+?)(?:\n\n|$)/s);
  if (quoteMatch) {
    result.text = quoteMatch[1].replace(/^>\s*/gm, '');
  }

  // Extract source URL
  const urlMatch = description.match(/\*\*Source:\*\*\s*\[.+?\]\((.+?)\)/);
  if (urlMatch) {
    result.url = urlMatch[1];
    result.github = extractGitHubContext(urlMatch[1]);
  }

  return result;
}

/**
 * Generate auto-title from captured text
 */
export function generateTitle(captured: CapturedContent): string {
  // Use first line or first N characters
  const firstLine = captured.text.split('\n')[0].trim();

  if (firstLine.length <= 60) {
    return firstLine;
  }

  // Truncate at word boundary
  const truncated = firstLine.slice(0, 57);
  const lastSpace = truncated.lastIndexOf(' ');

  if (lastSpace > 40) {
    return truncated.slice(0, lastSpace) + '...';
  }

  return truncated + '...';
}

/**
 * Create CapturedContent from current page info
 */
export function createCapturedContent(
  text: string,
  url: string
): CapturedContent {
  return {
    text,
    sourceUrl: url,
    timestamp: Date.now(),
    github: extractGitHubContext(url),
  };
}
