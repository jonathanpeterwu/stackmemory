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
  it('should reject non-object payloads', () => {
    expect(validateWebhookPayload(null)).toEqual({
      valid: false,
      error: 'Payload must be an object',
    });
    expect(validateWebhookPayload('string')).toEqual({
      valid: false,
      error: 'Payload must be an object',
    });
  });

  it('should reject missing action', () => {
    expect(validateWebhookPayload({ type: 'Issue', data: {} })).toEqual({
      valid: false,
      error: 'Missing or invalid action',
    });
  });

  it('should reject invalid action', () => {
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

  it('should not trigger for update actions', () => {
    expect(shouldTriggerSubagent({ ...basePayload, action: 'update' })).toBe(
      false
    );
  });

  it('should not trigger for non-Issue types', () => {
    expect(shouldTriggerSubagent({ ...basePayload, type: 'Comment' })).toBe(
      false
    );
  });

  it('should not trigger without automation labels', () => {
    expect(shouldTriggerSubagent(basePayload)).toBe(false);
  });

  it('should trigger with "automated" label', () => {
    const payload = {
      ...basePayload,
      data: {
        ...basePayload.data,
        labels: [{ id: '1', name: 'automated' }],
      },
    };
    expect(shouldTriggerSubagent(payload)).toBe(true);
  });

  it('should trigger with "claude-code" label (case insensitive)', () => {
    const payload = {
      ...basePayload,
      data: {
        ...basePayload.data,
        labels: [{ id: '1', name: 'Claude-Code' }],
      },
    };
    expect(shouldTriggerSubagent(payload)).toBe(true);
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

  it('should reject empty title', () => {
    const result = validateTicketDraft({
      title: '',
      projectId: 'proj-1',
      captured: validCaptured,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('INVALID_INPUT');
    }
  });

  it('should reject title over 200 chars', () => {
    const result = validateTicketDraft({
      title: 'a'.repeat(201),
      projectId: 'proj-1',
      captured: validCaptured,
    });
    expect(result.ok).toBe(false);
  });

  it('should accept valid draft', () => {
    const result = validateTicketDraft({
      title: 'Valid title',
      projectId: 'proj-1',
      captured: validCaptured,
    });
    expect(result.ok).toBe(true);
  });
});

describe('validateCapturedContent', () => {
  it('should reject empty text', () => {
    const result = validateCapturedContent({
      text: '',
      sourceUrl: 'https://example.com',
    });
    expect(result.ok).toBe(false);
  });

  it('should reject invalid URL', () => {
    const result = validateCapturedContent({
      text: 'Some text',
      sourceUrl: 'not-a-url',
    });
    expect(result.ok).toBe(false);
  });

  it('should accept valid content', () => {
    const result = validateCapturedContent({
      text: 'Some text',
      sourceUrl: 'https://example.com',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.text).toBe('Some text');
      expect(result.value.timestamp).toBeDefined();
    }
  });
});
