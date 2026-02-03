import { describe, it, expect, beforeEach } from 'vitest';
import {
  QueryTemplates,
  InlineModifierParser,
  QueryTemplate,
} from '../query-templates';
import { FrameType, FrameStatus } from '../query-parser';

describe('QueryTemplates', () => {
  let templates: QueryTemplates;

  beforeEach(() => {
    templates = new QueryTemplates();
  });

  describe('matchTemplate', () => {
    it.each([
      [
        'standup for alice',
        { timeLast: '24h', hasOwner: 'alice', groupBy: 'frame' },
      ],
      [
        'investigate error in authentication',
        { timeLast: '48h', topicIncludes: 'error', frameType: FrameType.BUG },
      ],
      [
        'progress on payment feature',
        { keywordIncludes: 'payment', frameType: FrameType.FEATURE },
      ],
      [
        'code review for auth.js',
        { timeLast: '24h', fileIncludes: 'auth.js', format: 'full' },
      ],
      [
        'code review for authentication',
        { timeLast: '24h', topicIncludes: 'authentication' },
      ],
      [
        'retrospective for last sprint',
        { timeLast: '14d', team: '$current_team', groupBy: 'owner' },
      ],
      [
        'performance issues for dashboard',
        {
          timeLast: '7d',
          topicIncludes: 'performance',
          keywordIncludes: 'dashboard',
        },
      ],
      ['security audit', { topicIncludes: 'security', scoreMin: 0.7 }],
      [
        'deployment readiness for v2.0',
        {
          topicIncludes: 'deployment',
          keywordIncludes: 'v2.0',
          statusIncludes: FrameStatus.OPEN,
        },
      ],
    ])('should match: %s', (query, expected) => {
      const result = templates.matchTemplate(query);
      expect(result).toBeDefined();
      if (expected.timeLast) expect(result?.time?.last).toBe(expected.timeLast);
      if (expected.hasOwner)
        expect(result?.people?.owner).toContain(expected.hasOwner);
      if (expected.groupBy)
        expect(result?.output?.groupBy).toBe(expected.groupBy);
      if (expected.topicIncludes)
        expect(result?.content?.topic).toContain(expected.topicIncludes);
      if (expected.keywordIncludes)
        expect(result?.content?.keywords).toContain(expected.keywordIncludes);
      if (expected.fileIncludes)
        expect(result?.content?.files).toContain(expected.fileIncludes);
      if (expected.frameType)
        expect(result?.frame?.type).toContain(expected.frameType);
      if (expected.statusIncludes)
        expect(result?.frame?.status).toContain(expected.statusIncludes);
      if (expected.format) expect(result?.output?.format).toBe(expected.format);
      if (expected.team) expect(result?.people?.team).toBe(expected.team);
      if (expected.scoreMin)
        expect(result?.frame?.score?.min).toBe(expected.scoreMin);
    });

    it('should return null for non-matching queries', () => {
      expect(
        templates.matchTemplate('random query that does not match')
      ).toBeNull();
    });
  });

  describe('addTemplate', () => {
    it('should allow adding custom templates', () => {
      const customTemplate: QueryTemplate = {
        name: 'custom-test',
        description: 'Custom test template',
        pattern: /^custom test (\w+)$/i,
        builder: (match) => ({
          content: { topic: [match[1]] },
        }),
      };

      templates.addTemplate(customTemplate);
      const result = templates.matchTemplate('custom test authentication');
      expect(result).toBeDefined();
      expect(result?.content?.topic).toContain('authentication');
    });
  });

  describe('getTemplateInfo', () => {
    it('should return all template information', () => {
      const info = templates.getTemplateInfo();
      expect(info).toBeDefined();
      expect(info.length).toBeGreaterThan(0);
      expect(info[0]).toHaveProperty('name');
      expect(info[0]).toHaveProperty('description');
    });
  });
});

describe('InlineModifierParser', () => {
  let parser: InlineModifierParser;
  beforeEach(() => {
    parser = new InlineModifierParser();
  });

  it.each([
    ['auth work +last:3d', 'auth work', { timeLast: '3d' }],
    [
      'database work +since:2024-12-20 +until:2024-12-25',
      'database work',
      { hasSince: true, hasUntil: true },
    ],
    [
      'recent work +owner:alice +owner:bob',
      'recent work',
      { owners: ['alice', 'bob'] },
    ],
    ['sprint work +team:backend', 'sprint work', { team: 'backend' }],
    [
      'recent changes +topic:auth +file:*.js',
      'recent changes',
      { topicIncludes: 'auth', fileIncludes: '*.js' },
    ],
    [
      'all work +sort:score +limit:100 +format:full',
      'all work',
      { sort: 'score', limit: 100, format: 'full' },
    ],
    ['team work +group:owner', 'team work', { groupBy: 'owner' }],
    [
      'current tasks +status:open +status:stalled',
      'current tasks',
      { statuses: [FrameStatus.OPEN, FrameStatus.STALLED] },
    ],
    ['issues +priority:critical', 'issues', { scoreMin: 0.8 }],
    [
      'auth bugs +last:7d +owner:alice +priority:high +sort:time +limit:20',
      'auth bugs',
      {
        timeLast: '7d',
        owners: ['alice'],
        scoreMin: 0.7,
        sort: 'time',
        limit: 20,
      },
    ],
    ['simple query without modifiers', 'simple query without modifiers', {}],
    [
      '  auth    work  +last:3d   +owner:alice  ',
      'auth work',
      { timeLast: '3d' },
    ],
  ])('should parse: %s', (input, expectedClean, checks) => {
    const { cleanQuery, modifiers } = parser.parse(input);
    expect(cleanQuery).toBe(expectedClean);
    if (checks.timeLast) expect(modifiers.time?.last).toBe(checks.timeLast);
    if (checks.hasSince) expect(modifiers.time?.since).toBeDefined();
    if (checks.hasUntil) expect(modifiers.time?.until).toBeDefined();
    if (checks.owners)
      checks.owners.forEach((o: string) =>
        expect(modifiers.people?.owner).toContain(o)
      );
    if (checks.team) expect(modifiers.people?.team).toBe(checks.team);
    if (checks.topicIncludes)
      expect(modifiers.content?.topic).toContain(checks.topicIncludes);
    if (checks.fileIncludes)
      expect(modifiers.content?.files).toContain(checks.fileIncludes);
    if (checks.sort) expect(modifiers.output?.sort).toBe(checks.sort);
    if (checks.limit) expect(modifiers.output?.limit).toBe(checks.limit);
    if (checks.format) expect(modifiers.output?.format).toBe(checks.format);
    if (checks.groupBy) expect(modifiers.output?.groupBy).toBe(checks.groupBy);
    if (checks.statuses)
      checks.statuses.forEach((s: FrameStatus) =>
        expect(modifiers.frame?.status).toContain(s)
      );
    if (checks.scoreMin)
      expect(modifiers.frame?.score?.min).toBe(checks.scoreMin);
  });
});
