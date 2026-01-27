/**
 * Linear Task Picker
 * Picks the next best task from Linear queue, prioritizing tasks with test/validation requirements
 */

import { LinearClient, LinearIssue } from '../integrations/linear/client.js';
import { LinearAuthManager } from '../integrations/linear/auth.js';

export interface TaskSuggestion {
  id: string;
  identifier: string; // e.g., "STA-123"
  title: string;
  priority: number;
  hasTestRequirements: boolean;
  estimatedPoints?: number;
  url: string;
  score: number;
}

export interface PickerOptions {
  teamId?: string;
  preferTestTasks?: boolean;
  limit?: number;
}

// Keywords indicating test/validation requirements
const TEST_KEYWORDS = [
  'test',
  'spec',
  'unit test',
  'integration test',
  'e2e',
  'end-to-end',
  'jest',
  'vitest',
  'mocha',
];

const VALIDATION_KEYWORDS = [
  'validate',
  'verify',
  'verification',
  'acceptance criteria',
  'ac:',
  'acceptance:',
  'given when then',
  'criteria:',
];

const QA_KEYWORDS = ['qa', 'quality', 'regression', 'coverage', 'assertion'];

// Labels that indicate test requirements
const TEST_LABELS = [
  'needs-tests',
  'test-required',
  'qa-review',
  'has-ac',
  'acceptance-criteria',
  'tdd',
  'testing',
];

/**
 * Check if text contains any of the keywords (case-insensitive)
 */
function containsKeywords(text: string, keywords: string[]): boolean {
  const lowerText = text.toLowerCase();
  return keywords.some((kw) => lowerText.includes(kw.toLowerCase()));
}

/**
 * Score a task based on test/validation requirements
 */
function scoreTask(issue: LinearIssue, preferTestTasks: boolean): number {
  let score = 0;
  const description = issue.description || '';
  const title = issue.title || '';
  const fullText = `${title} ${description}`;

  // +10 if has test/validation keywords in description
  if (containsKeywords(fullText, TEST_KEYWORDS)) {
    score += preferTestTasks ? 10 : 5;
  }

  if (containsKeywords(fullText, VALIDATION_KEYWORDS)) {
    score += preferTestTasks ? 8 : 4;
  }

  if (containsKeywords(fullText, QA_KEYWORDS)) {
    score += preferTestTasks ? 5 : 2;
  }

  // +5 if has test-related labels
  const labelNames =
    issue.labels?.nodes?.map((l: { name: string }) => l.name.toLowerCase()) ||
    [];
  const hasTestLabel = TEST_LABELS.some((tl) =>
    labelNames.some((ln: string) => ln.includes(tl))
  );
  if (hasTestLabel) {
    score += preferTestTasks ? 5 : 3;
  }

  // +3 for higher priority (urgent=1, high=2)
  if (issue.priority === 1) {
    score += 5; // Urgent
  } else if (issue.priority === 2) {
    score += 3; // High
  } else if (issue.priority === 3) {
    score += 1; // Medium
  }

  // +2 if has acceptance criteria pattern
  if (
    description.includes('## Acceptance') ||
    description.includes('### AC') ||
    description.includes('- [ ]')
  ) {
    score += 2;
  }

  // +1 if has estimate (indicates well-scoped)
  if (issue.estimate) {
    score += 1;
  }

  return score;
}

/**
 * Get Linear client instance
 * Returns null if credentials are missing or invalid
 */
function getLinearClient(): LinearClient | null {
  // Try API key first - must be valid format (lin_api_*)
  const apiKey = process.env['LINEAR_API_KEY'];
  if (apiKey && apiKey.startsWith('lin_api_')) {
    return new LinearClient({ apiKey });
  }

  // Fall back to OAuth
  try {
    const authManager = new LinearAuthManager();
    const tokens = authManager.loadTokens();
    if (tokens?.accessToken) {
      return new LinearClient({ accessToken: tokens.accessToken });
    }
  } catch {
    // Auth not available
  }

  return null;
}

/**
 * Pick the next best task from Linear
 */
export async function pickNextLinearTask(
  options: PickerOptions = {}
): Promise<TaskSuggestion | null> {
  const client = getLinearClient();
  if (!client) {
    return null;
  }

  const { teamId, preferTestTasks = true, limit = 20 } = options;

  try {
    // Fetch backlog and unstarted issues
    const [backlogIssues, unstartedIssues] = await Promise.all([
      client.getIssues({ teamId, stateType: 'backlog', limit }),
      client.getIssues({ teamId, stateType: 'unstarted', limit }),
    ]);

    const allIssues = [...backlogIssues, ...unstartedIssues];

    // Filter out assigned issues (we want unassigned ones)
    const unassignedIssues = allIssues.filter((issue) => !issue.assignee);

    if (unassignedIssues.length === 0) {
      // If no unassigned, consider all
      if (allIssues.length === 0) {
        return null;
      }
    }

    const issuesToScore =
      unassignedIssues.length > 0 ? unassignedIssues : allIssues;

    // Score and sort
    const scoredIssues = issuesToScore.map((issue) => ({
      issue,
      score: scoreTask(issue, preferTestTasks),
    }));

    scoredIssues.sort((a, b) => b.score - a.score);

    const best = scoredIssues[0];
    if (!best) {
      return null;
    }

    const description = best.issue.description || '';
    const hasTestRequirements =
      containsKeywords(description, TEST_KEYWORDS) ||
      containsKeywords(description, VALIDATION_KEYWORDS);

    return {
      id: best.issue.id,
      identifier: best.issue.identifier,
      title: best.issue.title,
      priority: best.issue.priority,
      hasTestRequirements,
      estimatedPoints: best.issue.estimate,
      url: best.issue.url,
      score: best.score,
    };
  } catch (error) {
    // Silent fail for auth errors (401/403) - expected when not configured
    const isAuthError =
      error instanceof Error &&
      (error.message.includes('401') || error.message.includes('403'));
    if (!isAuthError) {
      console.error('[linear-task-picker] Error fetching tasks:', error);
    }
    return null;
  }
}

/**
 * Get multiple task suggestions (for showing options)
 */
export async function getTopTaskSuggestions(
  options: PickerOptions = {},
  count: number = 3
): Promise<TaskSuggestion[]> {
  const client = getLinearClient();
  if (!client) {
    return [];
  }

  const { teamId, preferTestTasks = true, limit = 30 } = options;

  try {
    const [backlogIssues, unstartedIssues] = await Promise.all([
      client.getIssues({ teamId, stateType: 'backlog', limit }),
      client.getIssues({ teamId, stateType: 'unstarted', limit }),
    ]);

    const allIssues = [...backlogIssues, ...unstartedIssues];
    const unassignedIssues = allIssues.filter((issue) => !issue.assignee);
    const issuesToScore =
      unassignedIssues.length > 0 ? unassignedIssues : allIssues;

    const scoredIssues = issuesToScore.map((issue) => ({
      issue,
      score: scoreTask(issue, preferTestTasks),
    }));

    scoredIssues.sort((a, b) => b.score - a.score);

    return scoredIssues.slice(0, count).map(({ issue, score }) => {
      const description = issue.description || '';
      const hasTestRequirements =
        containsKeywords(description, TEST_KEYWORDS) ||
        containsKeywords(description, VALIDATION_KEYWORDS);

      return {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        priority: issue.priority,
        hasTestRequirements,
        estimatedPoints: issue.estimate,
        url: issue.url,
        score,
      };
    });
  } catch (error) {
    // Silent fail for auth errors (401/403) - expected when not configured
    const isAuthError =
      error instanceof Error &&
      (error.message.includes('401') || error.message.includes('403'));
    if (!isAuthError) {
      console.error('[linear-task-picker] Error fetching tasks:', error);
    }
    return [];
  }
}
