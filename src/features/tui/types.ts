/**
 * Type definitions for StackMemory TUI
 */

export interface DashboardConfig {
  refreshInterval?: number;
  wsUrl?: string;
  theme?: 'dark' | 'light';
  enableNotifications?: boolean;
  maxSessions?: number;
  maxFrames?: number;
}

export interface SessionData {
  id: string;
  startTime: number;
  lastActivity?: number;
  completed?: boolean;
  error?: string;

  // Metrics
  totalTokens?: number;
  contextUsage: number; // 0-1 percentage
  filesEdited?: string[];
  commandsRun?: number;
  errors?: Array<{
    timestamp: number;
    message: string;
    stack?: string;
  }>;

  // Context
  primaryFile?: string;
  gitBranch?: string;
  lastCommit?: string;
  linearTask?: LinearTask;
  agentType?: string;

  // Activities
  recentActivities?: Array<{
    timestamp: number;
    type: 'file_edit' | 'command' | 'error' | 'completion';
    description: string;
    data?: any;
  }>;
}

export interface SessionMetrics {
  tokens: number;
  duration: string;
  filesEdited: number;
  commandsRun: number;
  errorsEncountered: number;
}

export interface LinearTask {
  id: string;
  identifier: string;
  title: string;
  description?: string;
  state: string;
  priority?: number;
  estimate?: number;
  progress?: number;
  dueDate?: string;

  assignee?:
    | {
        id: string;
        name: string;
        email: string;
        avatar?: string;
      }
    | string;

  labels?: string[];

  comments?: Array<{
    id: string;
    author: string;
    body: string;
    createdAt: string;
  }>;

  subtasks?: Array<{
    id: string;
    title: string;
    completed: boolean;
  }>;

  cycle?: {
    id: string;
    name: string;
    startsAt: string;
    endsAt: string;
  };

  project?: {
    id: string;
    name: string;
    key: string;
  };
}

export interface TaskColumn {
  id: string;
  title: string;
  color: string;
}

export interface TaskData {
  tasks: LinearTask[];
  updated: number;
}

export interface FrameData {
  id: string;
  sessionId: string;
  parentId?: string;
  type: 'root' | 'branch' | 'leaf';

  // Content
  inputs?: string[];
  outputs?: string[];
  tools?: string[];
  digest?: string;

  // Metadata
  timestamp: number;
  tokenCount: number;
  tier: 'hot' | 'warm' | 'cold';
  compressionRatio?: number;
  score?: number;

  // Relationships
  children?: string[];
  references?: string[];
}

export interface FrameNode {
  id: string;
  label: string;
  children?: FrameNode[];
  extended?: boolean;
  tier: string;
  score: number;
}

export interface SubagentData {
  id: string;
  type: string;
  status: 'idle' | 'active' | 'error' | 'completed';

  // Current task
  currentTask?: {
    id: string;
    description: string;
    progress: number;
    startTime: number;
  };

  // Metrics
  tasksCompleted: number;
  tasksFailed: number;
  averageTime: number;
  successRate: number;

  // Resources
  cpuUsage?: number;
  memoryUsage?: number;
  tokenUsage?: number;

  // Error info
  lastError?: {
    message: string;
    timestamp: number;
    recoverable: boolean;
  };
}

export interface PRData {
  id: string;
  number: number;
  title: string;
  state: 'open' | 'closed' | 'merged';
  draft: boolean;

  author: {
    login: string;
    avatar?: string;
  };

  // Review status
  reviews: Array<{
    user: string;
    state: 'approved' | 'changes_requested' | 'commented';
  }>;

  // CI status
  checks?: {
    total: number;
    passed: number;
    failed: number;
    pending: number;
  };

  // Metadata
  createdAt: string;
  updatedAt: string;
  mergedAt?: string;

  // Stats
  additions: number;
  deletions: number;
  changedFiles: number;
  comments: number;

  // Labels
  labels?: string[];

  // Associated
  linkedIssues?: string[];
  linearTask?: string;
}

export interface IssueData {
  id: string;
  number: number;
  title: string;
  state: 'open' | 'closed';

  author: {
    login: string;
  };

  assignees?: string[];
  labels?: string[];

  createdAt: string;
  updatedAt: string;
  closedAt?: string;

  comments: number;
  reactions?: {
    '+1': number;
    '-1': number;
    laugh: number;
    confused: number;
    heart: number;
    hooray: number;
    rocket: number;
    eyes: number;
  };
}

export interface AnalyticsData {
  sessions: {
    labels: string[];
    values: number[];
  };

  tokens: {
    labels: string[];
    values: number[];
  };

  tasks: {
    completed: number;
    inProgress: number;
    todo: number;
    velocity: number[];
  };

  quality: {
    testsPassed: number;
    testsFailed: number;
    coverage: number;
    lintErrors: number;
  };

  performance: {
    avgResponseTime: number[];
    errorRate: number[];
    throughput: number[];
  };
}
