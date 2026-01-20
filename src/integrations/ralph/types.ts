/**
 * Type definitions for Ralph-StackMemory integration
 */

import { Frame, FrameType } from '../../core/context/frame-manager.js';
import { Session } from '../../core/session/session-manager.js';

// Ralph Loop types
export interface RalphLoopState {
  loopId: string;
  task: string;
  criteria: string;
  iteration: number;
  status: 'initialized' | 'running' | 'completed' | 'failed';
  startTime: number;
  lastUpdateTime: number;
  startCommit?: string;
  currentCommit?: string;
  feedback?: string;
  completionData?: Record<string, any>;
}

export interface RalphIteration {
  number: number;
  timestamp: number;
  analysis: IterationAnalysis;
  plan: IterationPlan;
  changes: IterationChange[];
  validation: ValidationResult;
  feedback?: string;
}

export interface IterationAnalysis {
  filesCount: number;
  testsPass: boolean;
  testsFail: number;
  lastChange: string;
  gitStatus?: string;
  dependencies?: string[];
  issues?: string[];
}

export interface IterationPlan {
  summary: string;
  steps: string[];
  priority: 'low' | 'medium' | 'high' | 'critical';
  estimatedTime?: number;
  dependencies?: string[];
}

export interface IterationChange {
  type: 'file' | 'config' | 'dependency' | 'test' | 'other';
  path: string;
  operation: 'create' | 'modify' | 'delete' | 'rename';
  description: string;
  timestamp: number;
  diff?: string;
}

export interface ValidationResult {
  testsPass: boolean;
  lintClean: boolean;
  buildSuccess: boolean;
  errors: string[];
  warnings: string[];
  metrics?: {
    coverage?: number;
    performance?: Record<string, number>;
    complexity?: number;
  };
}

// Integration types
export interface RalphStackMemoryConfig {
  // Context budget configuration
  contextBudget: {
    maxTokens: number; // Max tokens per iteration (default: 4000)
    priorityWeights: {
      task: number;
      recentWork: number;
      feedback: number;
      gitHistory: number;
      dependencies: number;
    };
    compressionEnabled: boolean;
    adaptiveBudgeting: boolean; // Adjust based on iteration complexity
  };
  
  // State reconciliation configuration
  stateReconciliation: {
    precedence: ('git' | 'files' | 'memory')[];
    conflictResolution: 'automatic' | 'manual' | 'interactive';
    syncInterval: number; // ms between sync checks
    validateConsistency: boolean;
  };
  
  // Lifecycle configuration
  lifecycle: {
    hooks: {
      preIteration: boolean;
      postIteration: boolean;
      onStateChange: boolean;
      onError: boolean;
      onComplete: boolean;
    };
    checkpoints: {
      enabled: boolean;
      frequency: number; // Every N iterations
      retentionDays: number;
    };
  };
  
  // Performance configuration
  performance: {
    asyncSaves: boolean;
    batchSize: number;
    compressionLevel: 0 | 1 | 2 | 3; // 0=none, 3=maximum
    cacheEnabled: boolean;
    parallelOperations: boolean;
  };
}

// Context types
export interface IterationContext {
  task: TaskContext;
  history: HistoryContext;
  environment: EnvironmentContext;
  memory: MemoryContext;
  tokenCount: number;
}

export interface TaskContext {
  description: string;
  criteria: string[];
  currentIteration: number;
  feedback?: string;
  priority: string;
}

export interface HistoryContext {
  recentIterations: IterationSummary[];
  gitCommits: GitCommit[];
  changedFiles: string[];
  testResults: TestResult[];
}

export interface EnvironmentContext {
  projectPath: string;
  branch: string;
  dependencies: Record<string, string>;
  configuration: Record<string, any>;
}

export interface MemoryContext {
  relevantFrames: Frame[];
  decisions: Decision[];
  patterns: Pattern[];
  blockers: Blocker[];
}

export interface IterationSummary {
  iteration: number;
  timestamp: number;
  changesCount: number;
  success: boolean;
  summary: string;
}

export interface GitCommit {
  hash: string;
  message: string;
  author: string;
  timestamp: number;
  files: string[];
}

export interface TestResult {
  suite: string;
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
}

export interface Decision {
  id: string;
  iteration: number;
  description: string;
  rationale: string;
  impact: 'low' | 'medium' | 'high';
  timestamp: number;
}

export interface Pattern {
  id: string;
  name: string;
  description: string;
  occurrences: number;
  successRate: number;
  lastUsed: number;
}

export interface Blocker {
  id: string;
  description: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  iteration: number;
  resolved: boolean;
}

// Event types
export interface IterationEvent {
  type: IterationEventType;
  timestamp: number;
  iteration: number;
  data: Record<string, any>;
}

export type IterationEventType =
  | 'iteration.started'
  | 'iteration.completed'
  | 'iteration.failed'
  | 'state.changed'
  | 'checkpoint.created'
  | 'context.loaded'
  | 'memory.saved'
  | 'conflict.detected'
  | 'conflict.resolved';

// Bridge types
export interface BridgeState {
  initialized: boolean;
  activeLoop?: RalphLoopState;
  currentSession?: Session;
  contextManager?: ContextBudgetManager;
  stateReconciler?: StateReconciler;
  performanceOptimizer?: PerformanceOptimizer;
}

export interface BridgeOptions {
  config?: Partial<RalphStackMemoryConfig>;
  sessionId?: string;
  loopId?: string;
  autoRecover?: boolean;
  debug?: boolean;
}

// Performance types
export interface PerformanceMetrics {
  iterationTime: number;
  contextLoadTime: number;
  stateSaveTime: number;
  memoryUsage: number;
  tokenCount: number;
  cacheHitRate: number;
}

export interface OptimizationStrategy {
  name: string;
  enabled: boolean;
  priority: number;
  apply: (data: any) => Promise<any>;
  metrics: () => PerformanceMetrics;
}

// Recovery types
export interface RecoveryState {
  lastKnownGood: RalphLoopState;
  checkpoints: Checkpoint[];
  recoveryAttempts: number;
  recoveryLog: RecoveryLogEntry[];
}

export interface Checkpoint {
  id: string;
  iteration: number;
  timestamp: number;
  state: RalphLoopState;
  gitCommit: string;
  verified: boolean;
}

export interface RecoveryLogEntry {
  timestamp: number;
  type: 'attempt' | 'success' | 'failure';
  message: string;
  details?: Record<string, any>;
}

// Token estimation
export interface TokenEstimate {
  text: string;
  tokens: number;
  category: 'task' | 'history' | 'environment' | 'memory' | 'other';
}

export interface ContextBudgetManager {
  estimateTokens(text: string): number;
  allocateBudget(context: IterationContext): IterationContext;
  compressContext(context: IterationContext): IterationContext;
  getUsage(): { used: number; available: number; categories: Record<string, number> };
}

export interface StateReconciler {
  reconcile(sources: StateSource[]): Promise<RalphLoopState>;
  detectConflicts(sources: StateSource[]): Conflict[];
  resolveConflict(conflict: Conflict): Promise<Resolution>;
  validateConsistency(state: RalphLoopState): ValidationResult;
}

export interface StateSource {
  type: 'git' | 'files' | 'memory';
  state: Partial<RalphLoopState>;
  timestamp: number;
  confidence: number;
}

export interface Conflict {
  field: string;
  sources: StateSource[];
  severity: 'low' | 'medium' | 'high';
  suggestedResolution?: any;
}

export interface Resolution {
  field: string;
  value: any;
  source: 'git' | 'files' | 'memory' | 'manual';
  rationale: string;
}