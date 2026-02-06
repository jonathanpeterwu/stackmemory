import { describe, it, expect } from 'vitest';
import {
  validateWebhookPayload,
  shouldTriggerSubagent,
  extractGitHubContext,
  buildSubagentTask,
  mapLinearPriority,
  validateTicketDraft,
  validateCapturedContent,
} from '../src/validation.js';
import type { LinearWebhookPayload } from '../src/types.js';

describe('validateWebhookPayload', () => {
  it('should reject invalid payloads', () => {
    expect(validateWebhookPayload(null)).toEqual({
      valid: false,
      error: 'Payload must be an object',
    });
    expect(validateWebhookPayload('string')).toEqual({
      valid: false,
      error: 'Payload must be an object',
    });
    expect(validateWebhookPayload({ type: 'Issue', data: {} })).toEqual({
      valid: false,
      error: 'Missing or invalid action',
    });
    expect(
      validateWebhookPayload({ action: 'invalid', type: 'Issue', data: {} })
    ).toEqual({
      valid: false,
      error: 'Invalid action: invalid',
    });
  });

  it('should validate a proper payload', () => {
    const payload = {
      action: 'create',
      type: 'Issue',
      createdAt: '2024-01-01',
      data: {
        id: 'issue-123',
        identifier: 'STA-123',
        title: 'Test Issue',
        url: 'https://linear.app/test',
        labels: [],
        team: { id: 'team-1', key: 'STA' },
      },
      url: 'https://linear.app',
      organizationId: 'org-1',
    };

    const result = validateWebhookPayload(payload);
    expect(result.valid).toBe(true);
    expect(result.payload).toBeDefined();
  });
});

describe('shouldTriggerSubagent', () => {
  const basePayload: LinearWebhookPayload = {
    action: 'create',
    type: 'Issue',
    createdAt: '2024-01-01',
    data: {
      id: 'issue-123',
      identifier: 'STA-123',
      title: 'Test',
      url: 'https://linear.app/test',
      labels: [],
      team: { id: 'team-1', key: 'STA' },
      state: { id: 'state-1', name: 'Todo' },
      priority: 0,
    },
    url: 'https://linear.app',
    organizationId: 'org-1',
  };

  it('should not trigger for non-create, non-Issue, or unlabeled payloads', () => {
    expect(shouldTriggerSubagent({ ...basePayload, action: 'update' })).toBe(
      false
    );
    expect(shouldTriggerSubagent({ ...basePayload, type: 'Comment' })).toBe(
      false
    );
    expect(shouldTriggerSubagent(basePayload)).toBe(false);
  });

  it('should trigger with automation labels', () => {
    const automated = {
      ...basePayload,
      data: {
        ...basePayload.data,
        labels: [{ id: '1', name: 'automated' }],
      },
    };
    expect(shouldTriggerSubagent(automated)).toBe(true);

    const claudeCode = {
      ...basePayload,
      data: {
        ...basePayload.data,
        labels: [{ id: '1', name: 'Claude-Code' }],
      },
    };
    expect(shouldTriggerSubagent(claudeCode)).toBe(true);
  });
});

describe('extractGitHubContext', () => {
  it('should return undefined for non-GitHub URLs', () => {
    expect(extractGitHubContext('https://google.com')).toBeUndefined();
    expect(extractGitHubContext('https://gitlab.com/foo/bar')).toBeUndefined();
  });

  it('should extract owner and repo', () => {
    expect(extractGitHubContext('https://github.com/owner/repo')).toEqual({
      owner: 'owner',
      repo: 'repo',
    });
  });

  it('should extract PR number', () => {
    expect(
      extractGitHubContext('https://github.com/owner/repo/pull/123')
    ).toEqual({
      owner: 'owner',
      repo: 'repo',
      prNumber: 123,
    });
  });

  it('should extract file path and branch', () => {
    expect(
      extractGitHubContext(
        'https://github.com/owner/repo/blob/main/src/index.ts'
      )
    ).toEqual({
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      filePath: 'src/index.ts',
    });
  });

  it('should extract line numbers', () => {
    expect(
      extractGitHubContext(
        'https://github.com/owner/repo/blob/main/src/index.ts#L10-L20'
      )
    ).toEqual({
      owner: 'owner',
      repo: 'repo',
      branch: 'main',
      filePath: 'src/index.ts',
      lineStart: 10,
      lineEnd: 20,
    });
  });

  it('should extract commit SHA', () => {
    expect(
      extractGitHubContext('https://github.com/owner/repo/commit/abc123def')
    ).toEqual({
      owner: 'owner',
      repo: 'repo',
      commitSha: 'abc123def',
    });
  });
});

describe('buildSubagentTask', () => {
  it('should build task from payload', () => {
    const payload: LinearWebhookPayload = {
      action: 'create',
      type: 'Issue',
      createdAt: '2024-01-01',
      data: {
        id: 'issue-123',
        identifier: 'STA-123',
        title: 'Fix the bug',
        description: 'The button does not work',
        url: 'https://linear.app/test/STA-123',
        labels: [],
        team: { id: 'team-1', key: 'STA' },
        state: { id: 'state-1', name: 'Todo' },
        priority: 0,
      },
      url: 'https://linear.app',
      organizationId: 'org-1',
    };

    const task = buildSubagentTask(payload);
    expect(task).toContain('STA-123');
    expect(task).toContain('Fix the bug');
    expect(task).toContain('The button does not work');
    expect(task).toContain('https://linear.app/test/STA-123');
  });
});

describe('mapLinearPriority', () => {
  it('should map priority strings to numbers', () => {
    expect(mapLinearPriority('urgent')).toBe(1);
    expect(mapLinearPriority('high')).toBe(2);
    expect(mapLinearPriority('medium')).toBe(3);
    expect(mapLinearPriority('low')).toBe(4);
    expect(mapLinearPriority('none')).toBe(0);
    expect(mapLinearPriority(undefined)).toBe(0);
  });
});

describe('validateTicketDraft', () => {
  const validCaptured = {
    text: 'Some text',
    sourceUrl: 'https://example.com',
    timestamp: Date.now(),
  };

  it('should validate title and accept valid drafts', () => {
    // Reject empty title
    const empty = validateTicketDraft({
      title: '',
      projectId: 'proj-1',
      captured: validCaptured,
    });
    expect(empty.ok).toBe(false);
    if (!empty.ok) {
      expect(empty.error.code).toBe('INVALID_INPUT');
    }

    // Reject title over 200 chars
    const long = validateTicketDraft({
      title: 'a'.repeat(201),
      projectId: 'proj-1',
      captured: validCaptured,
    });
    expect(long.ok).toBe(false);

    // Accept valid draft
    const valid = validateTicketDraft({
      title: 'Valid title',
      projectId: 'proj-1',
      captured: validCaptured,
    });
    expect(valid.ok).toBe(true);
  });
});

describe('validateCapturedContent', () => {
  it('should validate text, URL, and accept valid content', () => {
    // Reject empty text
    expect(
      validateCapturedContent({ text: '', sourceUrl: 'https://example.com' }).ok
    ).toBe(false);

    // Reject invalid URL
    expect(
      validateCapturedContent({ text: 'Some text', sourceUrl: 'not-a-url' }).ok
    ).toBe(false);

    // Accept valid content
    const valid = validateCapturedContent({
      text: 'Some text',
      sourceUrl: 'https://example.com',
    });
    expect(valid.ok).toBe(true);
    if (valid.ok) {
      expect(valid.value.text).toBe('Some text');
      expect(valid.value.timestamp).toBeDefined();
    }
  });
});
