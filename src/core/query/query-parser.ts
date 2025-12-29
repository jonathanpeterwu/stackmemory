/**
 * Query Parser for StackMemory
 * Handles both natural language and structured queries
 */

export interface TimeFilter {
  last?: string; // "1d", "3h", "1w", "2m"
  since?: Date;
  until?: Date;
  between?: [Date, Date];
  specific?: Date;
}

export interface ContentFilter {
  topic?: string[];
  files?: string[];
  errors?: string[];
  tools?: string[];
}

export interface FrameFilter {
  type?: FrameType[];
  status?: FrameStatus[];
  score?: {
    min?: number;
    max?: number;
  };
  depth?: {
    min?: number;
    max?: number;
  };
}

export interface PeopleFilter {
  owner?: string[];
  contributors?: string[];
  team?: string;
}

export interface OutputControl {
  limit?: number;
  sort?: 'time' | 'score' | 'relevance';
  include?: ('digests' | 'events' | 'anchors')[];
  format?: 'full' | 'summary' | 'ids';
}

export interface StackMemoryQuery {
  time?: TimeFilter;
  content?: ContentFilter;
  frame?: FrameFilter;
  people?: PeopleFilter;
  output?: OutputControl;
}

export enum FrameType {
  TASK = 'task',
  DEBUG = 'debug',
  FEATURE = 'feature',
  ARCHITECTURE = 'architecture',
  BUG = 'bug',
  REFACTOR = 'refactor',
}

export enum FrameStatus {
  OPEN = 'open',
  CLOSED = 'closed',
  STALLED = 'stalled',
}

export class QueryParser {
  private shortcuts: Map<string, Partial<StackMemoryQuery>> = new Map([
    ['today', { time: { last: '24h' } }],
    [
      'yesterday',
      { time: { last: '48h', since: new Date(Date.now() - 48 * 3600000) } },
    ],
    ['this week', { time: { last: '7d' } }],
    ['bugs', { frame: { type: [FrameType.BUG, FrameType.DEBUG] } }],
    ['features', { frame: { type: [FrameType.FEATURE] } }],
    ['critical', { frame: { score: { min: 0.8 } } }],
    ['recent', { time: { last: '4h' } }],
  ]);

  /**
   * Parse natural language query into structured format
   */
  parseNaturalLanguage(query: string): StackMemoryQuery {
    const result: StackMemoryQuery = {};
    const lowerQuery = query.toLowerCase();

    // Time-based patterns
    this.parseTimePatterns(lowerQuery, result);

    // Topic-based patterns
    this.parseTopicPatterns(lowerQuery, result);

    // People-based patterns
    this.parsePeoplePatterns(lowerQuery, result);

    // Shortcut expansion
    this.expandShortcuts(lowerQuery, result);

    // Default output settings if not specified
    if (!result.output) {
      result.output = {
        limit: 50,
        sort: 'time',
        format: 'summary',
      };
    }

    return result;
  }

  /**
   * Parse structured query with validation
   */
  parseStructured(query: StackMemoryQuery): StackMemoryQuery {
    // Validate and normalize the query
    if (query.frame?.score) {
      if (query.frame.score.min !== undefined) {
        query.frame.score.min = Math.max(0, Math.min(1, query.frame.score.min));
      }
      if (query.frame.score.max !== undefined) {
        query.frame.score.max = Math.max(0, Math.min(1, query.frame.score.max));
      }
    }

    // Apply defaults
    if (!query.output) {
      query.output = {
        limit: 50,
        sort: 'time',
        format: 'full',
      };
    }

    return query;
  }

  /**
   * Parse hybrid query (natural language with structured modifiers)
   */
  parseHybrid(
    naturalQuery: string,
    modifiers?: Partial<StackMemoryQuery>
  ): StackMemoryQuery {
    const nlQuery = this.parseNaturalLanguage(naturalQuery);
    return this.mergeQueries(nlQuery, modifiers || {});
  }

  private parseTimePatterns(query: string, result: StackMemoryQuery): void {
    // "last day", "last week", "last month"
    const lastPattern = /last\s+(\d+)?\s*(day|hour|week|month)s?/i;
    const match = query.match(lastPattern);
    if (match) {
      const quantity = match[1] ? parseInt(match[1]) : 1;
      const unit = match[2].toLowerCase();
      const unitMap: Record<string, string> = {
        hour: 'h',
        day: 'd',
        week: 'w',
        month: 'm',
      };
      result.time = { last: `${quantity}${unitMap[unit]}` };
    }

    // "yesterday", "today", "this week"
    for (const [shortcut, value] of this.shortcuts) {
      if (query.includes(shortcut) && value.time) {
        result.time = { ...result.time, ...value.time };
      }
    }

    // Date patterns "December 15", "2024-12-20"
    const datePattern =
      /(\d{4}-\d{2}-\d{2})|((jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\s+\d{1,2})/i;
    const dateMatch = query.match(datePattern);
    if (dateMatch) {
      try {
        const date = new Date(dateMatch[0]);
        if (!isNaN(date.getTime())) {
          result.time = { ...result.time, specific: date };
        }
      } catch {
        // Invalid date, ignore
      }
    }
  }

  private parseTopicPatterns(query: string, result: StackMemoryQuery): void {
    // Common topics
    const topics = [
      'auth',
      'authentication',
      'login',
      'oauth',
      'database',
      'migration',
      'cache',
      'api',
      'bug',
      'error',
      'fix',
      'feature',
      'test',
      'security',
      'performance',
    ];

    const foundTopics: string[] = [];
    for (const topic of topics) {
      if (query.includes(topic)) {
        foundTopics.push(topic);
      }
    }

    if (foundTopics.length > 0) {
      result.content = { ...result.content, topic: foundTopics };
    }

    // File patterns
    const filePattern = /(\w+\.\w+)|(\*\.\w+)/g;
    const files = query.match(filePattern);
    if (files) {
      result.content = { ...result.content, files };
    }
  }

  private parsePeoplePatterns(query: string, result: StackMemoryQuery): void {
    // "@alice", "@bob" mentions
    const mentionPattern = /@(\w+)/g;
    const mentions = [...query.matchAll(mentionPattern)].map((m) => m[1]);
    if (mentions.length > 0) {
      result.people = { owner: mentions };
    }

    // "alice's work", "bob's changes"
    const possessivePattern = /(\w+)'s\s+(work|changes|commits|frames)/i;
    const possMatch = query.match(possessivePattern);
    if (possMatch) {
      const person = possMatch[1].toLowerCase();
      result.people = { ...result.people, owner: [person] };
    }

    // "team work"
    if (query.includes('team')) {
      result.people = { ...result.people, team: '$current_team' };
    }
  }

  private expandShortcuts(query: string, result: StackMemoryQuery): void {
    // Priority shortcuts
    if (query.includes('critical')) {
      result.frame = {
        ...result.frame,
        score: { min: 0.8 },
      };
    } else if (query.includes('high')) {
      result.frame = {
        ...result.frame,
        score: { min: 0.7 },
      };
    }

    if (query.includes('low priority')) {
      result.frame = {
        ...result.frame,
        score: { max: 0.3 },
      };
    }

    // Status shortcuts
    if (query.includes('open') || query.includes('active')) {
      result.frame = {
        ...result.frame,
        status: [FrameStatus.OPEN],
      };
    }

    if (query.includes('closed') || query.includes('done')) {
      result.frame = {
        ...result.frame,
        status: [FrameStatus.CLOSED],
      };
    }
  }

  private mergeQueries(
    base: StackMemoryQuery,
    overlay: Partial<StackMemoryQuery>
  ): StackMemoryQuery {
    return {
      time: { ...base.time, ...overlay.time },
      content: { ...base.content, ...overlay.content },
      frame: { ...base.frame, ...overlay.frame },
      people: { ...base.people, ...overlay.people },
      output: { ...base.output, ...overlay.output },
    };
  }

  /**
   * Expand query with synonyms and related terms
   */
  expandQuery(query: StackMemoryQuery): StackMemoryQuery {
    const synonyms: Record<string, string[]> = {
      auth: ['authentication', 'oauth', 'login', 'session', 'jwt'],
      bug: ['error', 'issue', 'problem', 'fix', 'defect'],
      database: ['db', 'sql', 'postgres', 'migration', 'schema'],
      test: ['testing', 'spec', 'unit', 'integration', 'e2e'],
    };

    if (query.content?.topic) {
      const expandedTopics = new Set(query.content.topic);
      for (const topic of query.content.topic) {
        const syns = synonyms[topic.toLowerCase()];
        if (syns) {
          syns.forEach((s) => expandedTopics.add(s));
        }
      }
      query.content.topic = Array.from(expandedTopics);
    }

    return query;
  }
}
