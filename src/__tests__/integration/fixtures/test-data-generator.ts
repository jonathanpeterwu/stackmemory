/**
 * Test Data Generators
 * Creates realistic test data for integration testing
 */

import type { Frame, Event } from '../../../core/context/frame-manager.js';

export interface TestFrameOptions {
  count?: number;
  projectId?: string;
  runId?: string;
  withErrors?: boolean;
  withNesting?: boolean;
  withDigests?: boolean;
}

export interface TestProjectOptions {
  name?: string;
  frameCount?: number;
  sessionCount?: number;
  includeErrors?: boolean;
  includePatterns?: boolean;
}

/**
 * Generate realistic test frames with various patterns
 */
export function generateTestFrames(options: TestFrameOptions = {}): Partial<Frame>[] {
  const {
    count = 10,
    projectId = 'test-project',
    runId = 'test-run',
    withErrors = false,
    withNesting = false,
    withDigests = true,
  } = options;

  const frames: Partial<Frame>[] = [];
  const frameTypes = ['operation', 'decision', 'observation', 'error', 'checkpoint'];
  const operations = [
    'file_edit',
    'test_execution',
    'git_commit',
    'api_call',
    'database_query',
    'cache_operation',
    'build_task',
    'deployment',
  ];

  for (let i = 0; i < count; i++) {
    const isError = withErrors && Math.random() < 0.2;
    const type = isError ? 'error' : frameTypes[Math.floor(Math.random() * (frameTypes.length - 1))];
    const operation = operations[Math.floor(Math.random() * operations.length)];
    
    const frame: Partial<Frame> = {
      frame_id: `frame-${Date.now()}-${i}`,
      parent_frame_id: withNesting && i > 0 && Math.random() < 0.5 
        ? `frame-${Date.now()}-${Math.floor(Math.random() * i)}`
        : null,
      project_id: projectId,
      run_id: runId,
      type: type as Frame['type'],
      name: `${operation}_${i}`,
      state: isError ? 'error' : 'completed',
      depth: withNesting ? Math.floor(Math.random() * 5) : 0,
      created_at: new Date(Date.now() - (count - i) * 60000).toISOString(),
      updated_at: new Date(Date.now() - (count - i) * 60000).toISOString(),
    };

    if (withDigests) {
      frame.digest_text = generateDigestText(type, operation, i);
      frame.digest_json = generateDigestJson(type, operation);
    }

    if (isError) {
      frame.error = {
        message: `Error in ${operation}: ${getRandomError()}`,
        stack: generateStackTrace(operation),
      };
    }

    frames.push(frame);
  }

  return frames;
}

/**
 * Generate a complete test project with history
 */
export function generateTestProject(options: TestProjectOptions = {}) {
  const {
    name = 'test-app',
    frameCount = 100,
    sessionCount = 5,
    includeErrors = true,
    includePatterns = true,
  } = options;

  const project = {
    id: `project-${Date.now()}`,
    name,
    description: 'Generated test project',
    created_at: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString(),
    sessions: [] as any[],
    patterns: includePatterns ? generatePatterns() : [],
  };

  // Generate sessions with frames
  for (let s = 0; s < sessionCount; s++) {
    const sessionFrameCount = Math.floor(frameCount / sessionCount);
    const session = {
      id: `session-${s}`,
      start_time: new Date(Date.now() - (sessionCount - s) * 24 * 60 * 60 * 1000).toISOString(),
      frames: generateTestFrames({
        count: sessionFrameCount,
        projectId: project.id,
        runId: `run-${s}`,
        withErrors: includeErrors,
        withNesting: true,
        withDigests: true,
      }),
    };
    project.sessions.push(session);
  }

  return project;
}

/**
 * Generate test events for frame activity
 */
export function generateTestEvents(frameId: string, count = 5): Event[] {
  const events: Event[] = [];
  const eventTypes = ['tool_call', 'user_input', 'system_event', 'state_change'];
  
  for (let i = 0; i < count; i++) {
    events.push({
      event_id: `event-${Date.now()}-${i}`,
      frame_id: frameId,
      type: eventTypes[Math.floor(Math.random() * eventTypes.length)],
      timestamp: new Date(Date.now() - (count - i) * 1000).toISOString(),
      data: {
        action: `action_${i}`,
        result: Math.random() < 0.8 ? 'success' : 'failure',
      },
    });
  }
  
  return events;
}

/**
 * Generate search queries for testing retrieval
 */
export function generateSearchQueries(): string[] {
  return [
    'authentication error',
    'database connection',
    'API endpoint implementation',
    'test failure in CI',
    'performance optimization',
    'memory leak investigation',
    'deployment configuration',
    'security vulnerability',
    'refactoring suggestions',
    'bug fix for user login',
    'implement new feature',
    'code review feedback',
    'migration script',
    'documentation update',
    'dependency upgrade',
  ];
}

/**
 * Generate workflow templates for testing
 */
export function generateWorkflowTemplates() {
  return {
    tdd: {
      name: 'Test-Driven Development',
      phases: [
        { name: 'write-failing-tests', duration: 1800000 },
        { name: 'implement-code', duration: 3600000 },
        { name: 'refactor', duration: 1800000 },
      ],
    },
    bugfix: {
      name: 'Bug Fix Workflow',
      phases: [
        { name: 'reproduce', duration: 900000 },
        { name: 'diagnose', duration: 1800000 },
        { name: 'fix', duration: 1800000 },
        { name: 'verify', duration: 900000 },
      ],
    },
    feature: {
      name: 'Feature Development',
      phases: [
        { name: 'design', duration: 3600000 },
        { name: 'implement', duration: 7200000 },
        { name: 'test', duration: 3600000 },
        { name: 'document', duration: 1800000 },
      ],
    },
  };
}

// Helper functions

function generateDigestText(type: string, operation: string, index: number): string {
  const templates = {
    operation: [
      `Completed ${operation} successfully`,
      `Executed ${operation} with optimizations`,
      `Processed ${operation} in parallel`,
    ],
    decision: [
      `Decided to use ${operation} approach`,
      `Selected ${operation} based on performance metrics`,
      `Chose ${operation} for better maintainability`,
    ],
    observation: [
      `Noticed ${operation} could be improved`,
      `Observed ${operation} performance degradation`,
      `Found opportunity in ${operation}`,
    ],
    error: [
      `Failed to complete ${operation}`,
      `Error occurred during ${operation}`,
      `${operation} encountered unexpected issue`,
    ],
    checkpoint: [
      `Saved state before ${operation}`,
      `Created checkpoint for ${operation}`,
      `Backup created for ${operation}`,
    ],
  };

  const typeTemplates = templates[type as keyof typeof templates] || templates.operation;
  return typeTemplates[index % typeTemplates.length];
}

function generateDigestJson(type: string, operation: string) {
  return {
    type,
    operation,
    metrics: {
      duration: Math.floor(Math.random() * 10000),
      memory_used: Math.floor(Math.random() * 100),
      cpu_usage: Math.floor(Math.random() * 100),
    },
    tags: generateTags(operation),
    confidence: Math.random(),
  };
}

function generateTags(operation: string): string[] {
  const tagPool = [
    'performance',
    'security',
    'refactoring',
    'testing',
    'documentation',
    'bugfix',
    'feature',
    'optimization',
    'cleanup',
    'migration',
  ];
  
  const tagCount = Math.floor(Math.random() * 3) + 1;
  const tags = new Set<string>();
  
  tags.add(operation.split('_')[0]); // Add operation type as tag
  
  while (tags.size < tagCount) {
    tags.add(tagPool[Math.floor(Math.random() * tagPool.length)]);
  }
  
  return Array.from(tags);
}

function getRandomError(): string {
  const errors = [
    'Connection timeout',
    'Invalid credentials',
    'Resource not found',
    'Permission denied',
    'Validation failed',
    'Rate limit exceeded',
    'Memory allocation failed',
    'Disk space insufficient',
    'Network unreachable',
    'Syntax error',
  ];
  
  return errors[Math.floor(Math.random() * errors.length)];
}

function generateStackTrace(operation: string): string {
  return `Error: ${getRandomError()}
    at ${operation}Handler (src/handlers/${operation}.ts:42:15)
    at processOperation (src/core/processor.ts:128:20)
    at async executeFrame (src/core/frame-executor.ts:67:12)
    at async FrameManager.execute (src/core/frame-manager.ts:234:18)`;
}

function generatePatterns() {
  return [
    {
      name: 'TDD Cycle',
      occurrences: Math.floor(Math.random() * 20) + 5,
      confidence: Math.random() * 0.5 + 0.5,
    },
    {
      name: 'Error-Fix Pattern',
      occurrences: Math.floor(Math.random() * 15) + 3,
      confidence: Math.random() * 0.5 + 0.5,
    },
    {
      name: 'Refactoring Sessions',
      occurrences: Math.floor(Math.random() * 10) + 2,
      confidence: Math.random() * 0.5 + 0.5,
    },
  ];
}

/**
 * Generate large dataset for performance testing
 */
export function generateLargeDataset(size: 'small' | 'medium' | 'large' | 'xlarge') {
  const sizes = {
    small: { frames: 100, events: 500 },
    medium: { frames: 1000, events: 5000 },
    large: { frames: 10000, events: 50000 },
    xlarge: { frames: 100000, events: 500000 },
  };
  
  const config = sizes[size];
  
  return {
    frames: generateTestFrames({
      count: config.frames,
      withErrors: true,
      withNesting: true,
      withDigests: true,
    }),
    eventCount: config.events,
    estimatedSize: `${Math.round(config.frames * 2 + config.events * 0.5)} KB`,
  };
}