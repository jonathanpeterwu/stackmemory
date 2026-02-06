import { describe, it, expect } from 'vitest';
import {
  capturedToDescription,
  draftToLinearCreate,
  webhookToSpawnConfig,
  generateTitle,
  createCapturedContent,
} from '../src/transforms.js';
import type {
  CapturedContent,
  TicketDraft,
  LinearAuth,
  LinearWebhookPayload,
} from '../src/types.js';

describe('capturedToDescription', () => {
  it('should format captured text as blockquote', () => {
    const captured: CapturedContent = {
      text: 'This is the captured text',
      sourceUrl: 'https://example.com/page',
      timestamp: Date.now(),
    };

    const description = capturedToDescription(captured);
    expect(description).toContain('> This is the captured text');
    expect(description).toContain('**Source:**');
    expect(description).toContain('[example.com](https://example.com/page)');
  });

  it('should include GitHub context when present', () => {
    const captured: CapturedContent = {
      text: 'Code snippet',
      sourceUrl: 'https://github.com/owner/repo/blob/main/src/index.ts#L10-L20',
      timestamp: Date.now(),
      github: {
        owner: 'owner',
        repo: 'repo',
        branch: 'main',
        filePath: 'src/index.ts',
        lineStart: 10,
        lineEnd: 20,
      },
    };

    const description = capturedToDescription(captured);
    expect(description).toContain('**GitHub Context:**');
    expect(description).toContain('`owner/repo`');
    expect(description).toContain('`src/index.ts`');
    expect(description).toContain('lines 10-20');
  });

  it('should handle multiline text', () => {
    const captured: CapturedContent = {
      text: 'Line 1\nLine 2\nLine 3',
      sourceUrl: 'https://example.com',
      timestamp: Date.now(),
    };

    const description = capturedToDescription(captured);
    expect(description).toContain('> Line 1\n> Line 2\n> Line 3');
  });
});

describe('draftToLinearCreate', () => {
  const auth: LinearAuth = {
    accessToken: 'token',
    teamId: 'team-123',
    teamKey: 'STA',
    userId: 'user-123',
  };

  it('should transform draft to Linear create request', () => {
    const draft: TicketDraft = {
      title: 'Test Issue',
      description: 'Custom description',
      projectId: 'proj-123',
      priority: 'high',
      captured: {
        text: 'Captured text',
        sourceUrl: 'https://example.com',
        timestamp: Date.now(),
      },
    };

    const create = draftToLinearCreate(draft, auth);
    expect(create.title).toBe('Test Issue');
    expect(create.description).toBe('Custom description');
    expect(create.teamId).toBe('team-123');
    expect(create.projectId).toBe('proj-123');
    expect(create.priority).toBe(2); // high = 2
  });

  it('should generate description from captured if not provided', () => {
    const draft: TicketDraft = {
      title: 'Test Issue',
      description: '',
      projectId: 'proj-123',
      captured: {
        text: 'Captured text',
        sourceUrl: 'https://example.com',
        timestamp: Date.now(),
      },
    };

    const create = draftToLinearCreate(draft, auth);
    expect(create.description).toContain('> Captured text');
    expect(create.description).toContain('**Source:**');
  });
});

describe('webhookToSpawnConfig', () => {
  const basePayload: LinearWebhookPayload = {
    action: 'create',
    type: 'Issue',
    createdAt: '2024-01-01',
    data: {
      id: 'issue-123',
      identifier: 'STA-123',
      title: 'Fix the authentication bug',
      description:
        '> The login button fails\n\n**Source:** [github.com](https://github.com/owner/repo)',
      url: 'https://linear.app/team/STA-123',
      labels: [],
      team: { id: 'team-1', key: 'STA' },
      state: { id: 'state-1', name: 'Todo' },
      priority: 2,
    },
    url: 'https://linear.app',
    organizationId: 'org-1',
  };

  it('should create spawn config from webhook', () => {
    const config = webhookToSpawnConfig(basePayload);

    expect(config.agentType).toBe('general-purpose');
    expect(config.task).toContain('Fix the authentication bug');
    expect(config.context.linearIssueId).toBe('issue-123');
    expect(config.context.linearIdentifier).toBe('STA-123');
    expect(config.options.postResultsToLinear).toBe(true);
  });

  it('should detect code-reviewer agent from labels', () => {
    const payload = {
      ...basePayload,
      data: {
        ...basePayload.data,
        labels: [{ id: '1', name: 'code-review' }],
      },
    };

    const config = webhookToSpawnConfig(payload);
    expect(config.agentType).toBe('code-reviewer');
  });

  it('should detect debugger agent from labels', () => {
    const payload = {
      ...basePayload,
      data: {
        ...basePayload.data,
        labels: [{ id: '1', name: 'bug' }],
      },
    };

    const config = webhookToSpawnConfig(payload);
    expect(config.agentType).toBe('debugger');
  });

  it('should extract source URL from description', () => {
    const config = webhookToSpawnConfig(basePayload);
    expect(config.context.sourceUrl).toBe('https://github.com/owner/repo');
  });

  it('should apply custom options', () => {
    const config = webhookToSpawnConfig(basePayload, {
      autoCloseIssue: true,
      model: 'opus',
    });

    expect(config.options.autoCloseIssue).toBe(true);
    expect(config.options.model).toBe('opus');
  });
});

describe('generateTitle', () => {
  it('should use first line if short enough', () => {
    const captured: CapturedContent = {
      text: 'Short title',
      sourceUrl: 'https://example.com',
      timestamp: Date.now(),
    };

    expect(generateTitle(captured)).toBe('Short title');
  });

  it('should truncate long text at word boundary', () => {
    const captured: CapturedContent = {
      text: 'This is a very long title that should be truncated at a reasonable word boundary for readability',
      sourceUrl: 'https://example.com',
      timestamp: Date.now(),
    };

    const title = generateTitle(captured);
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title).toMatch(/\.\.\.$/);
  });

  it('should handle multiline text', () => {
    const captured: CapturedContent = {
      text: 'First line\nSecond line\nThird line',
      sourceUrl: 'https://example.com',
      timestamp: Date.now(),
    };

    expect(generateTitle(captured)).toBe('First line');
  });
});

describe('createCapturedContent', () => {
  it('should create captured content with timestamp', () => {
    const content = createCapturedContent(
      'Selected text',
      'https://example.com'
    );

    expect(content.text).toBe('Selected text');
    expect(content.sourceUrl).toBe('https://example.com');
    expect(content.timestamp).toBeDefined();
    expect(content.github).toBeUndefined();
  });

  it('should extract GitHub context from URL', () => {
    const content = createCapturedContent(
      'Code',
      'https://github.com/owner/repo/blob/main/file.ts'
    );

    expect(content.github).toBeDefined();
    expect(content.github?.owner).toBe('owner');
    expect(content.github?.repo).toBe('repo');
    expect(content.github?.filePath).toBe('file.ts');
  });
});
