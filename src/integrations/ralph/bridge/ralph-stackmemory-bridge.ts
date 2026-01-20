/**
 * Ralph-StackMemory Bridge
 * Main integration point connecting Ralph Wiggum loops with StackMemory persistence
 */

import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';
import { execSync } from 'child_process';
import { logger } from '../../../core/monitoring/logger.js';
import { FrameManager } from '../../../core/context/frame-manager.js';
import { SessionManager } from '../../../core/session/session-manager.js';
import { ContextBudgetManager } from '../context/context-budget-manager.js';
import { StateReconciler } from '../state/state-reconciler.js';
import { IterationLifecycle, LifecycleHooks } from '../lifecycle/iteration-lifecycle.js';
import { PerformanceOptimizer } from '../performance/performance-optimizer.js';
import {
  RalphLoopState,
  RalphIteration,
  BridgeState,
  BridgeOptions,
  RalphStackMemoryConfig,
  IterationContext,
  Frame,
  FrameType,
  RecoveryState,
  Checkpoint,
  StateSource,
} from '../types.js';

export class RalphStackMemoryBridge {
  private state: BridgeState;
  private config: RalphStackMemoryConfig;
  private frameManager?: FrameManager;
  private sessionManager: SessionManager;
  private recoveryState?: RecoveryState;
  private readonly ralphDir = '.ralph';

  constructor(options?: BridgeOptions) {
    // Initialize configuration
    this.config = this.mergeConfig(options?.config);

    // Initialize managers
    this.state = {
      initialized: false,
      contextManager: new ContextBudgetManager(this.config.contextBudget),
      stateReconciler: new StateReconciler(this.config.stateReconciliation),
      performanceOptimizer: new PerformanceOptimizer(this.config.performance),
    };

    this.sessionManager = SessionManager.getInstance();

    // Setup lifecycle hooks
    this.setupLifecycleHooks(options);

    logger.info('Ralph-StackMemory Bridge initialized', {
      config: {
        maxTokens: this.config.contextBudget.maxTokens,
        asyncSaves: this.config.performance.asyncSaves,
        checkpoints: this.config.lifecycle.checkpoints.enabled,
      },
    });
  }

  /**
   * Initialize bridge with session
   */
  async initialize(options?: {
    sessionId?: string;
    loopId?: string;
    task?: string;
    criteria?: string;
  }): Promise<void> {
    logger.info('Initializing bridge', options);

    try {
      // Initialize session manager
      await this.sessionManager.initialize();

      // Get or create session
      const session = await this.sessionManager.getOrCreateSession({
        sessionId: options?.sessionId,
      });

      this.state.currentSession = session;

      // Initialize frame manager
      this.frameManager = new FrameManager();

      // Check for existing loop or create new
      if (options?.loopId) {
        await this.resumeLoop(options.loopId);
      } else if (options?.task && options?.criteria) {
        await this.createNewLoop(options.task, options.criteria);
      } else {
        // Try to recover from crash
        await this.attemptRecovery();
      }

      this.state.initialized = true;
      logger.info('Bridge initialized successfully');
    } catch (error: any) {
      logger.error('Bridge initialization failed', { error: error.message });
      throw error;
    }
  }

  /**
   * Create new Ralph loop with StackMemory integration
   */
  async createNewLoop(task: string, criteria: string): Promise<RalphLoopState> {
    logger.info('Creating new Ralph loop', { task: task.substring(0, 100) });

    const loopId = uuidv4();
    const startTime = Date.now();

    // Create Ralph loop state
    const loopState: RalphLoopState = {
      loopId,
      task,
      criteria,
      iteration: 0,
      status: 'initialized',
      startTime,
      lastUpdateTime: startTime,
      startCommit: await this.getCurrentGitCommit(),
    };

    // Initialize Ralph directory structure
    await this.initializeRalphDirectory(loopState);

    // Create root frame in StackMemory
    const rootFrame = await this.createRootFrame(loopState);

    // Save initial state
    await this.saveLoopState(loopState);

    this.state.activeLoop = loopState;

    logger.info('Ralph loop created', {
      loopId,
      frameId: rootFrame.frame_id,
    });

    return loopState;
  }

  /**
   * Resume existing loop
   */
  async resumeLoop(loopId: string): Promise<RalphLoopState> {
    logger.info('Resuming loop', { loopId });

    // Get state from all sources
    const sources = await this.gatherStateSources(loopId);

    // Reconcile state
    const reconciledState = await this.state.stateReconciler!.reconcile(sources);

    // Validate consistency
    if (this.config.stateReconciliation.validateConsistency) {
      const validation = await this.state.stateReconciler!.validateConsistency(reconciledState);
      
      if (validation.errors.length > 0) {
        logger.error('State validation failed', { errors: validation.errors });
        throw new Error(`Invalid state: ${validation.errors.join(', ')}`);
      }
    }

    this.state.activeLoop = reconciledState;

    // Load context from StackMemory
    const context = await this.loadIterationContext(reconciledState);

    logger.info('Loop resumed', {
      loopId,
      iteration: reconciledState.iteration,
      status: reconciledState.status,
    });

    return reconciledState;
  }

  /**
   * Run worker iteration
   */
  async runWorkerIteration(): Promise<RalphIteration> {
    if (!this.state.activeLoop) {
      throw new Error('No active loop');
    }

    const iterationNumber = this.state.activeLoop.iteration + 1;
    logger.info('Starting worker iteration', { iteration: iterationNumber });

    // Load and prepare context
    let context = await this.loadIterationContext(this.state.activeLoop);
    
    // Apply context budget management
    context = this.state.contextManager!.allocateBudget(context);
    
    if (this.config.contextBudget.compressionEnabled) {
      context = this.state.contextManager!.compressContext(context);
    }

    // Start iteration with lifecycle
    const lifecycle = this.getLifecycle();
    context = await lifecycle.startIteration(iterationNumber, context);

    // Execute iteration work
    const iteration = await this.executeWorkerIteration(context);

    // Save iteration results
    await this.saveIterationResults(iteration);

    // Complete iteration with lifecycle
    await lifecycle.completeIteration(iteration);

    // Update loop state
    this.state.activeLoop.iteration = iterationNumber;
    this.state.activeLoop.lastUpdateTime = Date.now();
    await this.saveLoopState(this.state.activeLoop);

    logger.info('Worker iteration completed', {
      iteration: iterationNumber,
      changes: iteration.changes.length,
      success: iteration.validation.testsPass,
    });

    return iteration;
  }

  /**
   * Run reviewer iteration
   */
  async runReviewerIteration(): Promise<{ complete: boolean; feedback?: string }> {
    if (!this.state.activeLoop) {
      throw new Error('No active loop');
    }

    logger.info('Starting reviewer iteration', {
      iteration: this.state.activeLoop.iteration,
    });

    // Evaluate against criteria
    const evaluation = await this.evaluateCompletion();

    if (evaluation.complete) {
      // Mark as complete
      this.state.activeLoop.status = 'completed';
      this.state.activeLoop.completionData = evaluation;
      await this.saveLoopState(this.state.activeLoop);

      // Handle completion
      const lifecycle = this.getLifecycle();
      await lifecycle.handleCompletion(this.state.activeLoop);

      logger.info('Task completed successfully');
      return { complete: true };
    }

    // Generate feedback for next iteration
    const feedback = this.generateFeedback(evaluation);
    this.state.activeLoop.feedback = feedback;
    
    await this.saveLoopState(this.state.activeLoop);

    logger.info('Reviewer iteration completed', {
      complete: false,
      feedbackLength: feedback.length,
    });

    return { complete: false, feedback };
  }

  /**
   * Rehydrate session from StackMemory
   */
  async rehydrateSession(sessionId: string): Promise<IterationContext> {
    logger.info('Rehydrating session', { sessionId });

    // Get session from StackMemory
    const session = await this.sessionManager.getSession(sessionId);
    
    if (!session) {
      throw new Error(`Session not found: ${sessionId}`);
    }

    // Load frames from session
    const frames = await this.loadSessionFrames(sessionId);

    // Extract Ralph loop information
    const ralphFrames = frames.filter(f => f.type === 'task' && f.name.startsWith('ralph-'));
    
    if (ralphFrames.length === 0) {
      throw new Error('No Ralph loops found in session');
    }

    // Get most recent Ralph loop
    const latestLoop = ralphFrames[ralphFrames.length - 1];

    // Reconstruct loop state
    const loopState = await this.reconstructLoopState(latestLoop);

    // Build context from frames
    const context = await this.buildContextFromFrames(frames, loopState);

    this.state.activeLoop = loopState;

    logger.info('Session rehydrated', {
      loopId: loopState.loopId,
      iteration: loopState.iteration,
      frameCount: frames.length,
    });

    return context;
  }

  /**
   * Create checkpoint
   */
  async createCheckpoint(): Promise<Checkpoint> {
    if (!this.state.activeLoop) {
      throw new Error('No active loop');
    }

    const lifecycle = this.getLifecycle();
    
    // Create dummy iteration for checkpoint
    const iteration: RalphIteration = {
      number: this.state.activeLoop.iteration,
      timestamp: Date.now(),
      analysis: {
        filesCount: 0,
        testsPass: true,
        testsFail: 0,
        lastChange: await this.getCurrentGitCommit(),
      },
      plan: {
        summary: 'Checkpoint',
        steps: [],
        priority: 'low',
      },
      changes: [],
      validation: {
        testsPass: true,
        lintClean: true,
        buildSuccess: true,
        errors: [],
        warnings: [],
      },
    };

    const checkpoint = await lifecycle.createCheckpoint(iteration);

    logger.info('Checkpoint created', {
      id: checkpoint.id,
      iteration: checkpoint.iteration,
    });

    return checkpoint;
  }

  /**
   * Restore from checkpoint
   */
  async restoreFromCheckpoint(checkpointId: string): Promise<void> {
    const lifecycle = this.getLifecycle();
    await lifecycle.restoreFromCheckpoint(checkpointId);

    // Reload loop state
    const sources = await this.gatherStateSources(this.state.activeLoop?.loopId || '');
    const reconciledState = await this.state.stateReconciler!.reconcile(sources);
    
    this.state.activeLoop = reconciledState;

    logger.info('Restored from checkpoint', {
      checkpointId,
      iteration: reconciledState.iteration,
    });
  }

  /**
   * Get performance metrics
   */
  getPerformanceMetrics() {
    return this.state.performanceOptimizer!.getMetrics();
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    logger.info('Cleaning up bridge resources');

    // Flush any pending saves
    await this.state.performanceOptimizer!.flushBatch();

    // Clean up lifecycle
    this.getLifecycle().cleanup();

    // Clean up optimizer
    this.state.performanceOptimizer!.cleanup();

    logger.info('Bridge cleanup completed');
  }

  /**
   * Merge configuration with defaults
   */
  private mergeConfig(config?: Partial<RalphStackMemoryConfig>): RalphStackMemoryConfig {
    return {
      contextBudget: {
        maxTokens: 4000,
        priorityWeights: {
          task: 0.3,
          recentWork: 0.25,
          feedback: 0.2,
          gitHistory: 0.15,
          dependencies: 0.1,
        },
        compressionEnabled: true,
        adaptiveBudgeting: true,
        ...config?.contextBudget,
      },
      stateReconciliation: {
        precedence: ['git', 'files', 'memory'],
        conflictResolution: 'automatic',
        syncInterval: 5000,
        validateConsistency: true,
        ...config?.stateReconciliation,
      },
      lifecycle: {
        hooks: {
          preIteration: true,
          postIteration: true,
          onStateChange: true,
          onError: true,
          onComplete: true,
        },
        checkpoints: {
          enabled: true,
          frequency: 5,
          retentionDays: 7,
        },
        ...config?.lifecycle,
      },
      performance: {
        asyncSaves: true,
        batchSize: 10,
        compressionLevel: 2,
        cacheEnabled: true,
        parallelOperations: true,
        ...config?.performance,
      },
    };
  }

  /**
   * Setup lifecycle hooks
   */
  private setupLifecycleHooks(options?: BridgeOptions): void {
    const hooks: LifecycleHooks = {
      preIteration: async (context) => {
        logger.debug('Pre-iteration hook', {
          iteration: context.task.currentIteration,
        });
        return context;
      },
      postIteration: async (iteration) => {
        // Save to StackMemory
        await this.saveIterationFrame(iteration);
      },
      onStateChange: async (oldState, newState) => {
        // Update StackMemory with state change
        await this.updateStateFrame(oldState, newState);
      },
      onError: async (error, context) => {
        logger.error('Iteration error', { error: error.message, context });
        // Save error frame
        await this.saveErrorFrame(error, context);
      },
      onComplete: async (state) => {
        // Close root frame
        await this.closeRootFrame(state);
      },
    };

    const lifecycle = new IterationLifecycle(this.config.lifecycle, hooks);
    (this.state as any).lifecycle = lifecycle;
  }

  /**
   * Get lifecycle instance
   */
  private getLifecycle(): IterationLifecycle {
    return (this.state as any).lifecycle;
  }

  /**
   * Initialize Ralph directory structure
   */
  private async initializeRalphDirectory(state: RalphLoopState): Promise<void> {
    await fs.mkdir(this.ralphDir, { recursive: true });
    await fs.mkdir(path.join(this.ralphDir, 'history'), { recursive: true });

    // Write initial files
    await fs.writeFile(path.join(this.ralphDir, 'task.md'), state.task);
    await fs.writeFile(path.join(this.ralphDir, 'completion-criteria.md'), state.criteria);
    await fs.writeFile(path.join(this.ralphDir, 'iteration.txt'), '0');
    await fs.writeFile(path.join(this.ralphDir, 'feedback.txt'), '');
    await fs.writeFile(
      path.join(this.ralphDir, 'state.json'),
      JSON.stringify(state, null, 2)
    );
  }

  /**
   * Create root frame for Ralph loop
   */
  private async createRootFrame(state: RalphLoopState): Promise<Frame> {
    if (!this.frameManager) {
      throw new Error('Frame manager not initialized');
    }

    const frame: Partial<Frame> = {
      type: 'task' as FrameType,
      name: `ralph-${state.loopId}`,
      inputs: {
        task: state.task,
        criteria: state.criteria,
        loopId: state.loopId,
      },
      digest_json: {
        type: 'ralph_loop',
        status: 'started',
      },
    };

    return await this.frameManager.pushFrame(frame as any);
  }

  /**
   * Load iteration context from StackMemory
   */
  private async loadIterationContext(state: RalphLoopState): Promise<IterationContext> {
    const frames = await this.loadRelevantFrames(state.loopId);
    
    return {
      task: {
        description: state.task,
        criteria: state.criteria.split('\n').filter(Boolean),
        currentIteration: state.iteration,
        feedback: state.feedback,
        priority: 'medium',
      },
      history: {
        recentIterations: await this.loadRecentIterations(state.loopId),
        gitCommits: await this.loadGitCommits(),
        changedFiles: await this.loadChangedFiles(),
        testResults: [],
      },
      environment: {
        projectPath: process.cwd(),
        branch: await this.getCurrentBranch(),
        dependencies: {},
        configuration: {},
      },
      memory: {
        relevantFrames: frames,
        decisions: [],
        patterns: [],
        blockers: [],
      },
      tokenCount: 0,
    };
  }

  /**
   * Execute worker iteration
   */
  private async executeWorkerIteration(context: IterationContext): Promise<RalphIteration> {
    // This would integrate with the actual Ralph loop implementation
    // For now, returning a mock iteration
    return {
      number: context.task.currentIteration + 1,
      timestamp: Date.now(),
      analysis: {
        filesCount: 10,
        testsPass: true,
        testsFail: 0,
        lastChange: 'Mock change',
      },
      plan: {
        summary: 'Mock iteration plan',
        steps: ['Step 1', 'Step 2'],
        priority: 'medium',
      },
      changes: [],
      validation: {
        testsPass: true,
        lintClean: true,
        buildSuccess: true,
        errors: [],
        warnings: [],
      },
    };
  }

  /**
   * Save iteration results
   */
  private async saveIterationResults(iteration: RalphIteration): Promise<void> {
    // Save with performance optimization
    await this.state.performanceOptimizer!.saveIteration(iteration);

    // Save iteration artifacts to Ralph directory
    const iterDir = path.join(
      this.ralphDir,
      'history',
      `iteration-${String(iteration.number).padStart(3, '0')}`
    );
    
    await fs.mkdir(iterDir, { recursive: true });
    await fs.writeFile(
      path.join(iterDir, 'artifacts.json'),
      JSON.stringify(iteration, null, 2)
    );
  }

  /**
   * Save iteration frame to StackMemory
   */
  private async saveIterationFrame(iteration: RalphIteration): Promise<void> {
    if (!this.frameManager || !this.state.activeLoop) return;

    const frame: Partial<Frame> = {
      type: 'subtask' as FrameType,
      name: `iteration-${iteration.number}`,
      inputs: {
        iterationNumber: iteration.number,
        loopId: this.state.activeLoop.loopId,
      },
      outputs: {
        changes: iteration.changes.length,
        success: iteration.validation.testsPass,
      },
      digest_json: iteration,
    };

    await this.state.performanceOptimizer!.saveFrame(frame as Frame);
  }

  /**
   * Additional helper methods
   */
  private async getCurrentGitCommit(): Promise<string> {
    try {
      // execSync already imported at top
      return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch {
      return '';
    }
  }

  private async getCurrentBranch(): Promise<string> {
    try {
      // execSync already imported at top
      return execSync('git branch --show-current', { encoding: 'utf8' }).trim();
    } catch {
      return 'main';
    }
  }

  private async saveLoopState(state: RalphLoopState): Promise<void> {
    await fs.writeFile(
      path.join(this.ralphDir, 'state.json'),
      JSON.stringify(state, null, 2)
    );
  }

  private async gatherStateSources(loopId: string): Promise<StateSource[]> {
    const sources: StateSource[] = [];

    // Get git state
    sources.push(await this.state.stateReconciler!.getGitState());

    // Get file state
    sources.push(await this.state.stateReconciler!.getFileState());

    // Get memory state
    sources.push(await this.state.stateReconciler!.getMemoryState(loopId));

    return sources;
  }

  private async attemptRecovery(): Promise<void> {
    logger.info('Attempting crash recovery');

    try {
      // Check for incomplete loops in file system
      const stateFile = path.join(this.ralphDir, 'state.json');
      const exists = await fs.stat(stateFile).then(() => true).catch(() => false);

      if (exists) {
        const stateData = await fs.readFile(stateFile, 'utf8');
        const state = JSON.parse(stateData) as RalphLoopState;

        if (state.status !== 'completed') {
          logger.info('Found incomplete loop', { loopId: state.loopId });
          await this.resumeLoop(state.loopId);
        }
      }
    } catch (error: any) {
      logger.error('Recovery failed', { error: error.message });
    }
  }

  private async evaluateCompletion(): Promise<any> {
    // This would evaluate completion criteria
    // Placeholder implementation
    return {
      complete: false,
      criteria: {},
      unmet: ['criteria1', 'criteria2'],
    };
  }

  private generateFeedback(evaluation: any): string {
    if (evaluation.unmet.length === 0) {
      return 'All criteria met';
    }
    return `Still need to address:\n${evaluation.unmet.map((c: string) => `- ${c}`).join('\n')}`;
  }

  private async loadRelevantFrames(loopId: string): Promise<Frame[]> {
    // This would load frames from StackMemory
    // Placeholder implementation
    return [];
  }

  private async loadRecentIterations(loopId: string): Promise<any[]> {
    // Load recent iteration summaries
    return [];
  }

  private async loadGitCommits(): Promise<any[]> {
    // Load recent git commits
    return [];
  }

  private async loadChangedFiles(): Promise<string[]> {
    // Load recently changed files
    return [];
  }

  private async loadSessionFrames(sessionId: string): Promise<Frame[]> {
    // Load frames from session
    return [];
  }

  private async reconstructLoopState(frame: Frame): Promise<RalphLoopState> {
    // Reconstruct loop state from frame
    return {
      loopId: frame.inputs.loopId || '',
      task: frame.inputs.task || '',
      criteria: frame.inputs.criteria || '',
      iteration: 0,
      status: 'running',
      startTime: frame.created_at,
      lastUpdateTime: Date.now(),
    };
  }

  private async buildContextFromFrames(
    frames: Frame[],
    state: RalphLoopState
  ): Promise<IterationContext> {
    // Build context from frames
    return await this.loadIterationContext(state);
  }

  private async updateStateFrame(
    oldState: RalphLoopState,
    newState: RalphLoopState
  ): Promise<void> {
    // Update state in StackMemory
    logger.debug('State frame updated');
  }

  private async saveErrorFrame(error: Error, context: any): Promise<void> {
    // Save error as frame
    logger.debug('Error frame saved');
  }

  private async closeRootFrame(state: RalphLoopState): Promise<void> {
    // Close the root frame
    logger.debug('Root frame closed');
  }
}