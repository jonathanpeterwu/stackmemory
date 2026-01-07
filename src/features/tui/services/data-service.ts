/**
 * Data Service
 * Manages data fetching and caching for TUI dashboard
 */

import { EventEmitter } from 'events';
import Database from 'better-sqlite3';
import { SessionManager } from '../../../core/session/session-manager.js';
import { FrameManager } from '../../../core/context/frame-manager.js';
import { LinearTaskReader } from './linear-task-reader.js';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import type {
  SessionData,
  LinearTask,
  FrameData,
  SubagentData,
  PRData,
  IssueData,
  AnalyticsData,
} from '../types.js';

export class DataService extends EventEmitter {
  private db: Database.Database | null = null;
  private sessionManager: SessionManager | null = null;
  private frameManager: FrameManager | null = null;
  private taskReader: LinearTaskReader | null = null;
  private linearMappings: Map<string, any> = new Map();
  private cache: Map<string, { data: any; timestamp: number }> = new Map();
  private cacheTimeout = 5000; // 5 seconds

  async initialize(): Promise<void> {
    try {
      // Initialize database with error handling
      try {
        const dbPath = process.env.PROJECT_ROOT
          ? `${process.env.PROJECT_ROOT}/.stackmemory/context.db`
          : `${process.cwd()}/.stackmemory/context.db`;

        if (existsSync(dbPath)) {
          this.db = new Database(dbPath);
        }
      } catch (dbError) {
        if (process.env.DEBUG) {
          console.log('Database not accessible, continuing without it');
        }
      }

      // Initialize task reader for Linear-synced tasks
      try {
        this.taskReader = new LinearTaskReader(process.env.PROJECT_ROOT || process.cwd());
        
        // Load Linear mappings
        this.linearMappings = this.taskReader.getMappings();
        
        if (process.env.DEBUG) {
          const tasks = this.taskReader.getTasks();
          console.log(`LinearTaskReader initialized with ${tasks.length} tasks`);
        }
      } catch (tsError) {
        if (process.env.DEBUG) {
          console.log('Task reader initialization failed:', tsError.message);
        }
      }

      // Initialize managers with error handling
      try {
        this.sessionManager = new SessionManager({
          enableMonitoring: true,
        });
      } catch (smError) {
        if (process.env.DEBUG) {
          console.log('SessionManager initialization failed:', smError.message);
        }
        // Continue without session manager
      }

      if (this.db) {
        try {
          this.frameManager = new FrameManager(this.db, 'tui');
        } catch (fmError) {
          if (process.env.DEBUG) {
            console.log('FrameManager initialization failed:', fmError.message);
          }
          // Continue without frame manager
        }
      }

      // Note: Linear clients removed - all syncing happens via webhook or scheduled scripts
      // The TUI only displays locally synced tasks from the task store
      if (process.env.DEBUG) {
        console.log(
          'TUI: Using local task store only (no direct Linear API calls)'
        );
      }

      this.emit('data:ready');
    } catch (error) {
      if (process.env.DEBUG) {
        console.error('DataService initialization error:', error);
      }
      // Don't throw, just emit ready with mock data
      this.emit('data:ready');
    }
  }

  async getSessions(): Promise<SessionData[]> {
    const cached = this.getFromCache('sessions');
    if (cached) return cached;

    try {
      // Get active sessions from manager
      const activeSessions = this.sessionManager?.getActiveSessions() || [];

      // Try to get recent sessions from database
      let recentSessions = [];
      if (this.db) {
        try {
          const stmt = this.db.prepare(`
            SELECT * FROM sessions 
            WHERE created_at > datetime('now', '-24 hours')
            ORDER BY created_at DESC
            LIMIT 20
          `);
          recentSessions = stmt.all() || [];
        } catch (dbError) {
          // Database table might not exist, continue with mock data
          if (process.env.DEBUG) {
            console.log('Sessions table not found, using mock data');
          }
        }
      }

      // If no real data, provide mock sessions for demo
      if (activeSessions.length === 0 && recentSessions.length === 0) {
        const mockSessions = this.getMockSessions();
        this.setCache('sessions', mockSessions);
        return mockSessions;
      }

      // Combine and format
      const sessions: SessionData[] = [
        ...activeSessions.map(this.formatSession),
        ...recentSessions.map(this.formatDatabaseSession),
      ];

      this.setCache('sessions', sessions);
      return sessions;
    } catch (error) {
      if (process.env.DEBUG) {
        console.error('Error getting sessions:', error);
      }
      return this.getMockSessions();
    }
  }

  async getTasks(): Promise<LinearTask[]> {
    const cached = this.getFromCache('tasks');
    if (cached) return cached;

    const tasks: LinearTask[] = [];

    // ONLY use locally synced tasks - no direct Linear API calls
    // Tasks should be synced via webhook or scheduled sync scripts
    if (this.taskReader) {
      try {
        // LinearTaskReader already returns tasks in the correct format
        const localTasks = this.taskReader.getTasks();
        tasks.push(...localTasks);

        if (process.env.DEBUG) {
          console.log(
            `Loaded ${tasks.length} tasks from local store (no Linear API calls)`
          );
        }
      } catch (error) {
        if (process.env.DEBUG) {
          console.log('Failed to get local tasks:', error.message);
        }
      }
    }

    // If no local tasks, show helpful message instead of mock data
    if (tasks.length === 0) {
      console.log(
        'ℹ️  No local tasks found. Run "npm run linear:sync" to sync tasks from Linear.'
      );
      const mockTasks = this.getMockTasks();
      this.setCache('tasks', mockTasks);
      return mockTasks;
    }

    this.setCache('tasks', tasks);
    return tasks;
  }

  async getFrames(): Promise<FrameData[]> {
    const cached = this.getFromCache('frames');
    if (cached) return cached;

    try {
      const frames = this.frameManager?.getAllFrames() || [];

      // If no frames, return mock data
      if (frames.length === 0) {
        const mockFrames = this.getMockFrames();
        this.setCache('frames', mockFrames);
        return mockFrames;
      }

      const formatted = frames.map(this.formatFrame);
      this.setCache('frames', formatted);
      return formatted;
    } catch (error) {
      if (process.env.DEBUG) {
        console.error('Error getting frames:', error);
      }
      // Return mock frames on error
      const mockFrames = this.getMockFrames();
      this.setCache('frames', mockFrames);
      return mockFrames;
    }
  }

  async getAgents(): Promise<SubagentData[]> {
    const cached = this.getFromCache('agents');
    if (cached) return cached;

    try {
      // Mock data for now - would integrate with actual agent manager
      const agents: SubagentData[] = [
        {
          id: 'agent-1',
          type: 'analyzer',
          status: 'active',
          currentTask: {
            id: 'task-1',
            description: 'Analyzing codebase for performance issues',
            progress: 0.65,
            startTime: Date.now() - 120000,
          },
          tasksCompleted: 42,
          tasksFailed: 3,
          averageTime: 180000,
          successRate: 0.93,
          cpuUsage: 45,
          memoryUsage: 62,
          tokenUsage: 125000,
        },
        {
          id: 'agent-2',
          type: 'builder',
          status: 'idle',
          tasksCompleted: 28,
          tasksFailed: 1,
          averageTime: 240000,
          successRate: 0.96,
          cpuUsage: 12,
          memoryUsage: 38,
          tokenUsage: 85000,
        },
        {
          id: 'agent-3',
          type: 'tester',
          status: 'error',
          tasksCompleted: 15,
          tasksFailed: 5,
          averageTime: 90000,
          successRate: 0.75,
          lastError: {
            message: 'Test suite timeout',
            timestamp: Date.now() - 60000,
            recoverable: true,
          },
          cpuUsage: 0,
          memoryUsage: 25,
          tokenUsage: 45000,
        },
      ];

      this.setCache('agents', agents);
      return agents;
    } catch (error) {
      this.emit('error', error);
      return [];
    }
  }

  async getPRs(): Promise<PRData[]> {
    const cached = this.getFromCache('prs');
    if (cached) return cached;

    try {
      // Mock data - would integrate with GitHub API
      const prs: PRData[] = [
        {
          id: 'pr-1',
          number: 142,
          title: 'feat: Add TUI monitoring dashboard',
          state: 'open',
          draft: false,
          author: { login: 'stackmemory-bot' },
          reviews: [{ user: 'reviewer1', state: 'approved' }],
          checks: {
            total: 5,
            passed: 3,
            failed: 0,
            pending: 2,
          },
          createdAt: new Date(Date.now() - 3600000).toISOString(),
          updatedAt: new Date().toISOString(),
          additions: 1250,
          deletions: 85,
          changedFiles: 12,
          comments: 3,
          labels: ['enhancement', 'monitoring'],
          linearTask: 'STA-100',
        },
      ];

      this.setCache('prs', prs);
      return prs;
    } catch (error) {
      this.emit('error', error);
      return [];
    }
  }

  async getIssues(): Promise<IssueData[]> {
    const cached = this.getFromCache('issues');
    if (cached) return cached;

    try {
      // Mock data - would integrate with GitHub API
      const issues: IssueData[] = [
        {
          id: 'issue-1',
          number: 89,
          title: 'Session monitoring improvements needed',
          state: 'open',
          author: { login: 'user1' },
          assignees: ['stackmemory-bot'],
          labels: ['enhancement', 'monitoring'],
          createdAt: new Date(Date.now() - 86400000).toISOString(),
          updatedAt: new Date().toISOString(),
          comments: 5,
        },
      ];

      this.setCache('issues', issues);
      return issues;
    } catch (error) {
      this.emit('error', error);
      return [];
    }
  }

  async getAnalytics(): Promise<AnalyticsData> {
    const cached = this.getFromCache('analytics');
    if (cached) return cached;

    try {
      // Generate analytics data
      const analytics: AnalyticsData = {
        sessions: {
          labels: ['1h', '2h', '3h', '4h', '5h', '6h'],
          values: [5, 8, 12, 15, 18, 22],
        },
        tokens: {
          labels: ['1h', '2h', '3h', '4h', '5h', '6h'],
          values: [12000, 25000, 45000, 62000, 78000, 95000],
        },
        tasks: {
          completed: 45,
          inProgress: 12,
          todo: 28,
          velocity: [8, 12, 15, 18, 20],
        },
        quality: {
          testsPassed: 142,
          testsFailed: 3,
          coverage: 78,
          lintErrors: 0,
        },
        performance: {
          avgResponseTime: [120, 115, 108, 105, 110],
          errorRate: [0.02, 0.015, 0.01, 0.008, 0.005],
          throughput: [100, 120, 135, 140, 145],
        },
      };

      this.setCache('analytics', analytics);
      return analytics;
    } catch (error) {
      this.emit('error', error);
      return {
        sessions: { labels: [], values: [] },
        tokens: { labels: [], values: [] },
        tasks: { completed: 0, inProgress: 0, todo: 0, velocity: [] },
        quality: { testsPassed: 0, testsFailed: 0, coverage: 0, lintErrors: 0 },
        performance: { avgResponseTime: [], errorRate: [], throughput: [] },
      };
    }
  }

  private formatSession(session: any): SessionData {
    return {
      id: session.id,
      startTime: session.startTime,
      lastActivity: session.lastActivity,
      completed: session.completed,
      error: session.error,
      totalTokens: session.totalTokens,
      contextUsage: session.contextUsage || 0,
      filesEdited: session.filesEdited,
      commandsRun: session.commandsRun,
      errors: session.errors,
      primaryFile: session.primaryFile,
      gitBranch: session.gitBranch,
      lastCommit: session.lastCommit,
      linearTask: session.linearTask,
      agentType: session.agentType,
      recentActivities: session.recentActivities,
    };
  }

  private formatDatabaseSession(row: any): SessionData {
    return {
      id: row.id,
      startTime: new Date(row.created_at).getTime(),
      lastActivity: row.updated_at
        ? new Date(row.updated_at).getTime()
        : undefined,
      completed: row.status === 'completed',
      totalTokens: row.token_count,
      contextUsage: row.context_usage || 0,
      filesEdited: row.files_edited ? JSON.parse(row.files_edited) : [],
      commandsRun: row.commands_run || 0,
    };
  }

  private formatLinearTask(task: any): LinearTask {
    return {
      id: task.id,
      identifier: task.identifier,
      title: task.title,
      description: task.description,
      // Use Linear state.type for stable mapping ('unstarted'|'started'|...)
      state: task.state?.type || task.state?.name,
      priority: task.priority,
      estimate: task.estimate,
      dueDate: task.dueDate,
      assignee: task.assignee
        ? {
            id: task.assignee.id,
            name: task.assignee.name,
            email: task.assignee.email,
          }
        : undefined,
      labels: task.labels?.nodes.map((l: any) => l.name),
      project: task.project
        ? {
            id: task.project.id,
            name: task.project.name,
            key: task.project.key,
          }
        : undefined,
    };
  }

  private formatRestLinearTask(task: any): LinearTask {
    // Map Linear state.type to TUI display states
    const stateMap: Record<string, string> = {
      backlog: 'Backlog',
      unstarted: 'To Do',
      started: 'In Progress',
      completed: 'Done',
      canceled: 'Canceled',
    };

    return {
      id: task.id,
      identifier: task.identifier,
      title: task.title,
      description: task.description,
      state: stateMap[task.state.type] || task.state.name,
      priority: task.priority,
      estimate: task.estimate,
      assignee: task.assignee ? task.assignee.name : undefined,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
    };
  }

  private formatFrame(frame: any): FrameData {
    return {
      id: frame.id,
      sessionId: frame.sessionId,
      parentId: frame.parentId,
      type: frame.type || 'leaf',
      inputs: frame.inputs,
      outputs: frame.outputs,
      tools: frame.tools,
      digest: frame.digest,
      timestamp: frame.timestamp,
      tokenCount: frame.tokenCount || 0,
      tier: frame.tier || 'hot',
      compressionRatio: frame.compressionRatio,
      score: frame.score,
      children: frame.children,
      references: frame.references,
    };
  }

  private getFromCache(key: string): any {
    const cached = this.cache.get(key);
    if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
      return cached.data;
    }
    return null;
  }

  private setCache(key: string, data: any): void {
    this.cache.set(key, { data, timestamp: Date.now() });
  }

  private mapLocalStatusToLinearState(status: string): string {
    const statusMap: Record<string, string> = {
      pending: 'To Do',
      in_progress: 'In Progress',
      completed: 'Done',
      cancelled: 'Canceled',
      blocked: 'To Do',
    };
    return statusMap[status] || 'To Do';
  }

  private mapLocalPriorityToLinear(priority: string): number {
    const priorityMap: Record<string, number> = {
      urgent: 0,
      high: 1,
      medium: 2,
      low: 3,
    };
    return priorityMap[priority] || 2;
  }

  cleanup(): void {
    if (this.db) {
      this.db.close();
    }
    this.cache.clear();
  }

  // Mock data methods for demo/offline mode
  private getMockSessions(): SessionData[] {
    const now = Date.now();
    return [
      {
        id: 'demo-session-1',
        startTime: now - 8100000, // 2h 15m ago
        lastActivity: now - 60000, // 1 minute ago
        completed: false,
        totalTokens: 45000,
        contextUsage: 0.45, // 45%
        filesEdited: ['src/components/Dashboard.tsx', 'src/hooks/useAuth.ts'],
        commandsRun: 23,
        primaryFile: 'src/components/Dashboard.tsx',
        gitBranch: 'feature/tui-dashboard',
        agentType: 'frontend',
        recentActivities: [
          {
            timestamp: now - 120000,
            type: 'file_edit' as const,
            description: 'Modified Dashboard.tsx',
          },
          {
            timestamp: now - 60000,
            type: 'command' as const,
            description: 'npm run test',
          },
        ],
      },
      {
        id: 'demo-session-2',
        startTime: now - 2700000, // 45m ago
        lastActivity: now - 300000, // 5 minutes ago
        completed: false,
        totalTokens: 22000,
        contextUsage: 0.22, // 22%
        filesEdited: ['src/api/endpoints.ts', 'src/middleware/auth.ts'],
        commandsRun: 15,
        primaryFile: 'src/api/endpoints.ts',
        gitBranch: 'main',
        agentType: 'backend',
        recentActivities: [
          {
            timestamp: now - 600000,
            type: 'file_edit' as const,
            description: 'Updated API endpoints',
          },
        ],
      },
    ];
  }

  private getMockFrames(): FrameData[] {
    return [
      {
        id: 'frame-1',
        sessionId: 'demo-session-1',
        type: 'root',
        tier: 'hot' as const,
        timestamp: new Date().toISOString(),
        tokenCount: 2500,
        score: 95,
        compressionRatio: 2.3,
        digest: 'Implementing React component with hooks',
        tools: ['Edit', 'Read', 'MultiEdit'],
        inputs: ['Create user dashboard'],
        outputs: ['Dashboard component created'],
        children: [],
        references: [],
      },
      {
        id: 'frame-2',
        sessionId: 'demo-session-1',
        type: 'branch',
        tier: 'warm' as const,
        timestamp: new Date(Date.now() - 3600000).toISOString(),
        tokenCount: 1800,
        score: 78,
        compressionRatio: 1.8,
        digest: 'Setting up API endpoints',
        tools: ['Write', 'Edit'],
        inputs: ['Setup REST API'],
        outputs: ['API routes configured'],
        children: [],
        references: [],
      },
    ];
  }

  private getMockTasks(): LinearTask[] {
    return [
      {
        id: 'task-1',
        identifier: 'STA-101',
        title: 'Implement TUI dashboard',
        state: 'In Progress',
        priority: 2,
        assignee: 'demo-user',
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        updatedAt: new Date().toISOString(),
      },
      {
        id: 'task-2',
        identifier: 'STA-102',
        title: 'Add terminal compatibility',
        state: 'Done',
        priority: 1,
        assignee: 'demo-user',
        createdAt: new Date(Date.now() - 172800000).toISOString(),
        updatedAt: new Date().toISOString(),
      },
    ];
  }

  private getMockAgents(): SubagentData[] {
    return [
      {
        id: 'agent-1',
        name: 'code-reviewer',
        type: 'reviewer',
        status: 'idle',
        tasksCompleted: 45,
        averageTime: '2.3s',
        successRate: 98.5,
        lastActive: new Date().toISOString(),
      },
      {
        id: 'agent-2',
        name: 'test-runner',
        type: 'qa',
        status: 'active',
        tasksCompleted: 156,
        averageTime: '5.6s',
        successRate: 95.2,
        lastActive: new Date().toISOString(),
      },
    ];
  }

  private getMockPRs(): PRData[] {
    return [
      {
        id: 'pr-1',
        number: 123,
        title: 'feat: Add terminal compatibility layer',
        state: 'open',
        author: { login: 'demo-user' },
        assignees: [],
        labels: ['enhancement', 'tui'],
        createdAt: new Date(Date.now() - 86400000).toISOString(),
        updatedAt: new Date().toISOString(),
        comments: 3,
        reviews: 1,
        checks: {
          total: 5,
          passed: 5,
          failed: 0,
          pending: 0,
        },
      },
    ];
  }
}
