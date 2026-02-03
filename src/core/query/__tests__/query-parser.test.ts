import { describe, it, expect, beforeEach } from 'vitest';
import {
  QueryParser,
  FrameType,
  FrameStatus,
  QueryResponse,
} from '../query-parser';

describe('QueryParser', () => {
  let parser: QueryParser;

  beforeEach(() => {
    parser = new QueryParser();
  });

  describe('parseNaturalLanguage', () => {
    it.each([
      ['provide context from the last day', { timeLast: '1d' }],
      ['show me what happened yesterday', { timeLast: '48h' }],
      ['get all work from last 3 weeks', { timeLast: '3w' }],
      ['what happened today', { timeLast: '24h' }],
      ['find all authentication work', { topicIncludes: 'authentication' }],
      [
        'show database migration frames',
        { topicIncludes: ['database', 'migration'] },
      ],
      ["show @alice's recent work", { ownerIncludes: 'alice' }],
      ['get team work from today', { team: '$current_team' }],
      [
        "show @alice's auth work from last week",
        { timeLast: '1w', ownerIncludes: 'alice', topicIncludes: 'auth' },
      ],
      ['get critical bugs', { scoreMin: 0.8, topicIncludes: 'bug' }],
      [
        'show high priority features',
        { scoreMin: 0.7, topicIncludes: 'feature' },
      ],
      ['find low priority tasks', { scoreMax: 0.3 }],
      ['show open frames', { statusIncludes: FrameStatus.OPEN }],
      ['get closed bugs', { statusIncludes: FrameStatus.CLOSED }],
    ])('should parse: %s', (input, checks) => {
      const query = parser.parseNaturalLanguage(input);
      if (checks.timeLast) expect(query.time?.last).toBe(checks.timeLast);
      if (checks.topicIncludes) {
        const topics = Array.isArray(checks.topicIncludes)
          ? checks.topicIncludes
          : [checks.topicIncludes];
        topics.forEach((t) => expect(query.content?.topic).toContain(t));
      }
      if (checks.ownerIncludes)
        expect(query.people?.owner).toContain(checks.ownerIncludes);
      if (checks.team) expect(query.people?.team).toBe(checks.team);
      if (checks.scoreMin)
        expect(query.frame?.score?.min).toBe(checks.scoreMin);
      if (checks.scoreMax)
        expect(query.frame?.score?.max).toBe(checks.scoreMax);
      if (checks.statusIncludes)
        expect(query.frame?.status).toContain(checks.statusIncludes);
    });

    it('should set default output settings', () => {
      expect(parser.parseNaturalLanguage('show recent work').output).toEqual({
        limit: 50,
        sort: 'time',
        format: 'summary',
      });
    });
  });

  describe('parseStructured', () => {
    it('should validate scores, apply defaults, and preserve settings', () => {
      // Score range validation
      const q1 = parser.parseStructured({
        frame: { score: { min: -0.5, max: 1.5 } },
      });
      expect(q1.frame?.score?.min).toBe(0);
      expect(q1.frame?.score?.max).toBe(1);

      // Default output settings
      expect(parser.parseStructured({ time: { last: '1d' } }).output).toEqual({
        limit: 50,
        sort: 'time',
        format: 'full',
      });

      // Preserve provided settings
      const input = {
        time: { last: '2h' },
        content: { topic: ['auth'] },
        output: { limit: 100, sort: 'score' as const, format: 'ids' as const },
      };
      expect(parser.parseStructured(input)).toEqual(input);
    });
  });

  describe('parseHybrid', () => {
    it('should merge and override natural language with modifiers', () => {
      const q1 = parser.parseHybrid('show auth work', {
        time: { last: '3d' },
        output: { limit: 20 },
      });
      expect(q1.content?.topic).toContain('auth');
      expect(q1.time?.last).toBe('3d');
      expect(q1.output?.limit).toBe(20);

      const q2 = parser.parseHybrid('show work from last week', {
        time: { last: '1d' },
      });
      expect(q2.time?.last).toBe('1d');
    });
  });

  describe('expandQuery', () => {
    it('should expand topics with synonyms', () => {
      const q1 = parser.expandQuery({ content: { topic: ['auth'] } });
      ['auth', 'authentication', 'oauth', 'login', 'jwt'].forEach((t) =>
        expect(q1.content?.topic).toContain(t)
      );

      const q2 = parser.expandQuery({
        content: { topic: ['bug', 'database'] },
      });
      ['bug', 'error', 'database', 'db', 'sql'].forEach((t) =>
        expect(q2.content?.topic).toContain(t)
      );

      const q3 = parser.expandQuery({ content: { topic: ['custom-topic'] } });
      expect(q3.content?.topic).toEqual(['custom-topic']);
    });
  });

  describe('parse (QueryResponse)', () => {
    it('should return complete QueryResponse for natural language and structured queries', () => {
      // Natural language
      const r1 = parser.parse('find authentication bugs from last week');
      expect(r1.original).toBe('find authentication bugs from last week');
      expect(r1.interpreted.time?.last).toBe('1w');
      expect(r1.interpreted.content?.topic).toContain('authentication');
      expect(r1.expanded.content?.topic).toContain('oauth');

      // Structured
      const sq = {
        time: { last: '24h' },
        content: { topic: ['database'] },
        output: { limit: 10 },
      };
      const r2 = parser.parse(sq);
      expect(r2.original).toBe(JSON.stringify(sq));
      expect(r2.expanded.content?.topic).toContain('db');
    });

    it('should detect validation errors', () => {
      const r = parser.parse({
        time: { since: new Date('2024-12-25'), until: new Date('2024-12-20') },
        frame: { score: { min: 0.9, max: 0.5 } },
        output: { limit: 5000 },
      });
      expect(r.validationErrors).toContain(
        'Time filter: "since" date is after "until" date'
      );
      expect(r.validationErrors).toContain(
        'Frame filter: Minimum score is greater than maximum score'
      );
      expect(r.validationErrors).toContain(
        'Output limit must be between 1 and 1000'
      );
    });

    it('should provide suggestions', () => {
      expect(parser.parse('show me everything').suggestions).toContain(
        'Try adding a time filter like "last 24h" or "today"'
      );
      expect(parser.parse({ time: { last: '24h' } }).suggestions).toContain(
        'You can use "today" as a shortcut for last 24 hours'
      );
      expect(
        parser.parse({ frame: { type: [FrameType.BUG, FrameType.DEBUG] } })
          .suggestions
      ).toContain('You can use "bugs" as a shortcut for bug and debug frames');
      expect(
        parser.parse({ frame: { type: [FrameType.BUG] } }).suggestions
      ).toContain('Add a time filter to focus on recent bugs');
      expect(
        parser.parse({ frame: { score: { min: 0.85 } } }).suggestions
      ).toContain(
        'Consider adding frame type filter with high score threshold'
      );
    });

    it('should handle complex queries and file patterns', () => {
      const r1 = parser.parse(
        "@alice's critical authentication work from yesterday"
      );
      expect(r1.interpreted.people?.owner).toContain('alice');
      expect(r1.interpreted.frame?.score?.min).toBe(0.8);
      expect(r1.interpreted.time?.last).toBe('48h');

      const r2 = parser.parse('show changes to *.ts and auth.js files today');
      expect(r2.interpreted.content?.files).toContain('*.ts');
      expect(r2.interpreted.time?.last).toBe('24h');
    });
  });
});
