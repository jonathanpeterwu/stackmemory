import { describe, it, expect, beforeEach } from 'vitest';
import { QueryParser, FrameType, FrameStatus } from '../query-parser';

describe('QueryParser', () => {
  let parser: QueryParser;

  beforeEach(() => {
    parser = new QueryParser();
  });

  describe('parseNaturalLanguage', () => {
    it('should parse time-based queries', () => {
      const query1 = parser.parseNaturalLanguage(
        'provide context from the last day'
      );
      expect(query1.time?.last).toBe('1d');

      const query2 = parser.parseNaturalLanguage(
        'show me what happened yesterday'
      );
      expect(query2.time?.last).toBe('48h');

      const query3 = parser.parseNaturalLanguage(
        'get all work from last 3 weeks'
      );
      expect(query3.time?.last).toBe('3w');

      const query4 = parser.parseNaturalLanguage('what happened today');
      expect(query4.time?.last).toBe('24h');
    });

    it('should parse topic-based queries', () => {
      const query1 = parser.parseNaturalLanguage(
        'find all authentication work'
      );
      expect(query1.content?.topic).toContain('authentication');

      const query2 = parser.parseNaturalLanguage(
        'show database migration frames'
      );
      expect(query2.content?.topic).toContain('database');
      expect(query2.content?.topic).toContain('migration');

      const query3 = parser.parseNaturalLanguage(
        'get frames about the login bug'
      );
      expect(query3.content?.topic).toContain('login');
      expect(query3.content?.topic).toContain('bug');
    });

    it('should parse people-based queries', () => {
      const query1 = parser.parseNaturalLanguage("show @alice's recent work");
      expect(query1.people?.owner).toContain('alice');

      const query2 = parser.parseNaturalLanguage(
        "what did bob's changes include"
      );
      expect(query2.people?.owner).toContain('bob');

      const query3 = parser.parseNaturalLanguage('get team work from today');
      expect(query3.people?.team).toBe('$current_team');
    });

    it('should parse combined queries', () => {
      const query = parser.parseNaturalLanguage(
        "show @alice's auth work from last week"
      );
      expect(query.time?.last).toBe('1w');
      expect(query.people?.owner).toContain('alice');
      expect(query.content?.topic).toContain('auth');
    });

    it('should parse priority shortcuts', () => {
      const query1 = parser.parseNaturalLanguage('get critical bugs');
      expect(query1.frame?.score?.min).toBe(0.8);
      expect(query1.content?.topic).toContain('bug');

      const query2 = parser.parseNaturalLanguage('show high priority features');
      expect(query2.frame?.score?.min).toBe(0.7);
      expect(query2.content?.topic).toContain('feature');

      const query3 = parser.parseNaturalLanguage('find low priority tasks');
      expect(query3.frame?.score?.max).toBe(0.3);
    });

    it('should parse status shortcuts', () => {
      const query1 = parser.parseNaturalLanguage('show open frames');
      expect(query1.frame?.status).toContain(FrameStatus.OPEN);

      const query2 = parser.parseNaturalLanguage('get closed bugs');
      expect(query2.frame?.status).toContain(FrameStatus.CLOSED);

      const query3 = parser.parseNaturalLanguage('find active work');
      expect(query3.frame?.status).toContain(FrameStatus.OPEN);
    });

    it('should set default output settings', () => {
      const query = parser.parseNaturalLanguage('show recent work');
      expect(query.output).toEqual({
        limit: 50,
        sort: 'time',
        format: 'summary',
      });
    });
  });

  describe('parseStructured', () => {
    it('should validate score ranges', () => {
      const query = parser.parseStructured({
        frame: {
          score: {
            min: -0.5,
            max: 1.5,
          },
        },
      });
      expect(query.frame?.score?.min).toBe(0);
      expect(query.frame?.score?.max).toBe(1);
    });

    it('should apply default output settings', () => {
      const query = parser.parseStructured({
        time: { last: '1d' },
      });
      expect(query.output).toEqual({
        limit: 50,
        sort: 'time',
        format: 'full',
      });
    });

    it('should preserve provided settings', () => {
      const input = {
        time: { last: '2h' },
        content: { topic: ['auth'] },
        output: {
          limit: 100,
          sort: 'score' as const,
          format: 'ids' as const,
        },
      };
      const query = parser.parseStructured(input);
      expect(query).toEqual(input);
    });
  });

  describe('parseHybrid', () => {
    it('should merge natural language with structured modifiers', () => {
      const query = parser.parseHybrid('show auth work', {
        time: { last: '3d' },
        output: { limit: 20 },
      });

      expect(query.content?.topic).toContain('auth');
      expect(query.time?.last).toBe('3d');
      expect(query.output?.limit).toBe(20);
      expect(query.output?.format).toBe('summary');
    });

    it('should override natural language with modifiers', () => {
      const query = parser.parseHybrid('show work from last week', {
        time: { last: '1d' },
      });

      expect(query.time?.last).toBe('1d');
    });
  });

  describe('expandQuery', () => {
    it('should expand topics with synonyms', () => {
      const query = parser.expandQuery({
        content: { topic: ['auth'] },
      });

      expect(query.content?.topic).toContain('auth');
      expect(query.content?.topic).toContain('authentication');
      expect(query.content?.topic).toContain('oauth');
      expect(query.content?.topic).toContain('login');
      expect(query.content?.topic).toContain('jwt');
    });

    it('should expand multiple topics', () => {
      const query = parser.expandQuery({
        content: { topic: ['bug', 'database'] },
      });

      expect(query.content?.topic).toContain('bug');
      expect(query.content?.topic).toContain('error');
      expect(query.content?.topic).toContain('issue');
      expect(query.content?.topic).toContain('database');
      expect(query.content?.topic).toContain('db');
      expect(query.content?.topic).toContain('sql');
    });

    it('should preserve non-expandable topics', () => {
      const query = parser.expandQuery({
        content: { topic: ['custom-topic'] },
      });

      expect(query.content?.topic).toContain('custom-topic');
      expect(query.content?.topic?.length).toBe(1);
    });
  });
});
