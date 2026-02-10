/**
 * Iteration Lifecycle Manager for Ralph-StackMemory Integration
 * Provides lifecycle hooks and event management for clean integration points
 */

import { EventEmitter } from 'events';
import { execSync } from 'child_process';
import { logger } from '../../../core/monitoring/logger.js';
import {
  RalphLoopState,
  RalphIteration,
  IterationEvent,
  IterationEventType,
  RalphStackMemoryConfig,
  Checkpoint,
  IterationContext,
} from '../types.js';

export interface LifecycleHooks {
  preIteration?: (context: IterationContext) => Promise<IterationContext>;
  postIteration?: (iteration: RalphIteration) => Promise<void>;
  onStateChange?: (
    oldState: RalphLoopState,
    newState: RalphLoopState
  ) => Promise<void>;
  onError?: (error: Error, context: any) => Promise<void>;
  onComplete?: (state: RalphLoopState) => Promise<void>;
  onCheckpoint?: (checkpoint: Checkpoint) => Promise<void>;
}

export class IterationLifecycle extends EventEmitter {
  private config: RalphStackMemoryConfig['lifecycle'];
  private hooks: LifecycleHooks = {};
  private checkpoints: Checkpoint[] = [];
  private currentIteration?: RalphIteration;
  private iterationHistory: IterationEvent[] = [];
  private activeTimers: Map<string, NodeJS.Timeout & { startTime?: number }> =
    new Map();

  constructor(
    config?: Partial<RalphStackMemoryConfig['lifecycle']>,
    hooks?: LifecycleHooks
  ) {
    super();

    this.config = {
      hooks: {
        preIteration: config?.hooks?.preIteration ?? true,
        postIteration: config?.hooks?.postIteration ?? true,
        onStateChange: config?.hooks?.onStateChange ?? true,
        onError: config?.hooks?.onError ?? true,
        onComplete: config?.hooks?.onComplete ?? true,
      },
      checkpoints: {
        enabled: config?.checkpoints?.enabled ?? true,
        frequency: config?.checkpoints?.frequency || 5,
        retentionDays: config?.checkpoints?.retentionDays || 7,
      },
    };

    if (hooks) {
      this.registerHooks(hooks);
    }

    this.setupEventHandlers();
  }

  /**
   * Register lifecycle hooks
   */
  registerHooks(hooks: LifecycleHooks): void {
    this.hooks = { ...this.hooks, ...hooks };

    logger.debug('Lifecycle hooks registered', {
      registered: Object.keys(hooks),
    });
  }

  /**
   * Start iteration with lifecycle management
   */
  async startIteration(
    iterationNumber: number,
    context: IterationContext
  ): Promise<IterationContext> {
    logger.info('Starting iteration', { iteration: iterationNumber });

    // Emit start event
    this.emitEvent({
      type: 'iteration.started',
      timestamp: Date.now(),
      iteration: iterationNumber,
      data: { context },
    });

    // Execute pre-iteration hook if configured
    let processedContext = context;
    if (this.config.hooks.preIteration && this.hooks.preIteration) {
      try {
        processedContext = await this.hooks.preIteration(context);
        logger.debug('Pre-iteration hook executed', {
          original: context.tokenCount,
          processed: processedContext.tokenCount,
        });
      } catch (error: any) {
        await this.handleError(error, { phase: 'preIteration', context });
      }
    }

    // Start iteration timer for metrics
    this.startTimer(`iteration-${iterationNumber}`);

    return processedContext;
  }

  /**
   * Complete iteration with lifecycle management
   */
  async completeIteration(iteration: RalphIteration): Promise<void> {
    logger.info('Completing iteration', { iteration: iteration.number });

    this.currentIteration = iteration;

    // Stop iteration timer
    const duration = this.stopTimer(`iteration-${iteration.number}`);

    // Execute post-iteration hook if configured
    if (this.config.hooks.postIteration && this.hooks.postIteration) {
      try {
        await this.hooks.postIteration(iteration);
        logger.debug('Post-iteration hook executed');
      } catch (error: any) {
        await this.handleError(error, { phase: 'postIteration', iteration });
      }
    }

    // Create checkpoint if needed
    if (this.shouldCreateCheckpoint(iteration.number)) {
      await this.createCheckpoint(iteration);
    }

    // Emit completion event
    this.emitEvent({
      type: 'iteration.completed',
      timestamp: Date.now(),
      iteration: iteration.number,
      data: {
        iteration,
        duration,
        success: iteration.validation.testsPass,
      },
    });

    // Clean old checkpoints
    await this.cleanOldCheckpoints();
  }

  /**
   * Handle iteration failure
   */
  async failIteration(
    iterationNumber: number,
    error: Error,
    context?: any
  ): Promise<void> {
    logger.error('Iteration failed', {
      iteration: iterationNumber,
      error: error.message,
    });

    // Stop iteration timer
    this.stopTimer(`iteration-${iterationNumber}`);

    // Execute error hook if configured
    if (this.config.hooks.onError && this.hooks.onError) {
      try {
        await this.hooks.onError(error, context);
      } catch (hookError: any) {
        logger.error('Error hook failed', { error: hookError.message });
      }
    }

    // Emit failure event
    this.emitEvent({
      type: 'iteration.failed',
      timestamp: Date.now(),
      iteration: iterationNumber,
      data: {
        error: error.message,
        stack: error.stack,
        context,
      },
    });
  }

  /**
   * Handle state change
   */
  async handleStateChange(
    oldState: RalphLoopState,
    newState: RalphLoopState
  ): Promise<void> {
    logger.debug('State change detected', {
      old: oldState.status,
      new: newState.status,
      iteration: newState.iteration,
    });

    // Execute state change hook if configured
    if (this.config.hooks.onStateChange && this.hooks.onStateChange) {
      try {
        await this.hooks.onStateChange(oldState, newState);
      } catch (error: any) {
        await this.handleError(error, {
          phase: 'stateChange',
          oldState,
          newState,
        });
      }
    }

    // Emit state change event
    this.emitEvent({
      type: 'state.changed',
      timestamp: Date.now(),
      iteration: newState.iteration,
      data: {
        oldStatus: oldState.status,
        newStatus: newState.status,
        changes: this.detectStateChanges(oldState, newState),
      },
    });

    // Check for completion
    if (newState.status === 'completed' && oldState.status !== 'completed') {
      await this.handleCompletion(newState);
    }
  }

  /**
   * Handle loop completion
   */
  async handleCompletion(state: RalphLoopState): Promise<void> {
    logger.info('Loop completed', {
      iterations: state.iteration,
      duration: state.lastUpdateTime - state.startTime,
    });

    // Execute completion hook if configured
    if (this.config.hooks.onComplete && this.hooks.onComplete) {
      try {
        await this.hooks.onComplete(state);
      } catch (error: any) {
        await this.handleError(error, { phase: 'completion', state });
      }
    }

    // Create final checkpoint
    await this.createFinalCheckpoint(state);

    // Clean up timers
    this.cleanupTimers();
  }

  /**
   * Create checkpoint
   */
  async createCheckpoint(iteration: RalphIteration): Promise<Checkpoint> {
    const checkpoint: Checkpoint = {
      id: this.generateCheckpointId(),
      iteration: iteration.number,
      timestamp: Date.now(),
      state: await this.captureCurrentState(),
      gitCommit: await this.getCurrentGitCommit(),
      verified: false,
    };

    // Verify checkpoint
    checkpoint.verified = await this.verifyCheckpoint(checkpoint);

    this.checkpoints.push(checkpoint);

    logger.info('Checkpoint created', {
      id: checkpoint.id,
      iteration: checkpoint.iteration,
      verified: checkpoint.verified,
    });

    // Execute checkpoint hook if available
    if (this.hooks.onCheckpoint) {
      try {
        await this.hooks.onCheckpoint(checkpoint);
      } catch (error: any) {
        logger.error('Checkpoint hook failed', { error: error.message });
      }
    }

    // Emit checkpoint event
    this.emitEvent({
      type: 'checkpoint.created',
      timestamp: Date.now(),
      iteration: iteration.number,
      data: { checkpoint },
    });

    return checkpoint;
  }

  /**
   * Get checkpoints
   */
  getCheckpoints(): Checkpoint[] {
    return [...this.checkpoints];
  }

  /**
   * Get last checkpoint
   */
  getLastCheckpoint(): Checkpoint | undefined {
    return this.checkpoints[this.checkpoints.length - 1];
  }

  /**
   * Restore from checkpoint
   */
  async restoreFromCheckpoint(checkpointId: string): Promise<void> {
    const checkpoint = this.checkpoints.find((c) => c.id === checkpointId);

    if (!checkpoint) {
      throw new Error(`Checkpoint not found: ${checkpointId}`);
    }

    logger.info('Restoring from checkpoint', {
      id: checkpoint.id,
      iteration: checkpoint.iteration,
    });

    // Restore git state
    if (checkpoint.gitCommit) {
      await this.restoreGitState(checkpoint.gitCommit);
    }

    // Restore Ralph state
    await this.restoreRalphState(checkpoint.state);

    logger.info('Checkpoint restored successfully');
  }

  /**
   * Get iteration events
   */
  getEvents(filter?: {
    type?: IterationEventType;
    iteration?: number;
    since?: number;
  }): IterationEvent[] {
    let events = [...this.iterationHistory];

    if (filter?.type) {
      events = events.filter((e) => e.type === filter.type);
    }

    if (filter?.iteration !== undefined) {
      events = events.filter((e) => e.iteration === filter.iteration);
    }

    if (filter?.since) {
      events = events.filter((e) => e.timestamp >= filter.since);
    }

    return events;
  }

  /**
   * Clean up resources
   */
  cleanup(): void {
    this.cleanupTimers();
    this.removeAllListeners();
    this.iterationHistory = [];
    this.checkpoints = [];
  }

  /**
   * Setup internal event handlers
   */
  private setupEventHandlers(): void {
    // Log all events in debug mode
    this.on('*', (event: IterationEvent) => {
      logger.debug('Lifecycle event', {
        type: event.type,
        iteration: event.iteration,
      });
    });
  }

  /**
   * Emit and track event
   */
  private emitEvent(event: IterationEvent): void {
    this.iterationHistory.push(event);
    this.emit(event.type, event);
    this.emit('*', event); // Wildcard for all events
  }

  /**
   * Should create checkpoint based on frequency
   */
  private shouldCreateCheckpoint(iteration: number): boolean {
    if (!this.config.checkpoints.enabled) {
      return false;
    }

    return iteration % this.config.checkpoints.frequency === 0;
  }

  /**
   * Generate checkpoint ID
   */
  private generateCheckpointId(): string {
    return `chk-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Capture current state
   */
  private async captureCurrentState(): Promise<RalphLoopState> {
    // This would capture the full Ralph loop state
    // Placeholder implementation
    return {
      loopId: 'current',
      task: '',
      criteria: '',
      iteration: this.currentIteration?.number || 0,
      status: 'running',
      startTime: Date.now(),
      lastUpdateTime: Date.now(),
    };
  }

  /**
   * Get current git commit
   */
  private async getCurrentGitCommit(): Promise<string> {
    try {
      // execSync already imported at top
      return execSync('git rev-parse HEAD', { encoding: 'utf8' }).trim();
    } catch {
      return '';
    }
  }

  /**
   * Verify checkpoint integrity
   */
  private async verifyCheckpoint(checkpoint: Checkpoint): Promise<boolean> {
    try {
      // Verify state consistency
      if (!checkpoint.state.loopId || !checkpoint.state.task) {
        return false;
      }

      // Verify git commit exists
      if (checkpoint.gitCommit) {
        // execSync already imported at top
        execSync(`git rev-parse ${checkpoint.gitCommit}`, { encoding: 'utf8' });
      }

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clean old checkpoints based on retention
   */
  private async cleanOldCheckpoints(): Promise<void> {
    const cutoff =
      Date.now() - this.config.checkpoints.retentionDays * 24 * 60 * 60 * 1000;

    const before = this.checkpoints.length;
    this.checkpoints = this.checkpoints.filter((c) => c.timestamp >= cutoff);
    const removed = before - this.checkpoints.length;

    if (removed > 0) {
      logger.debug('Cleaned old checkpoints', { removed });
    }
  }

  /**
   * Create final checkpoint
   */
  private async createFinalCheckpoint(state: RalphLoopState): Promise<void> {
    const checkpoint: Checkpoint = {
      id: `final-${this.generateCheckpointId()}`,
      iteration: state.iteration,
      timestamp: Date.now(),
      state,
      gitCommit: await this.getCurrentGitCommit(),
      verified: true,
    };

    this.checkpoints.push(checkpoint);

    logger.info('Final checkpoint created', {
      id: checkpoint.id,
      iterations: state.iteration,
    });
  }

  /**
   * Restore git state
   */
  private async restoreGitState(commit: string): Promise<void> {
    // Stash any uncommitted changes
    execSync('git stash', { encoding: 'utf8' });

    // Checkout the commit
    execSync(`git checkout ${commit}`, { encoding: 'utf8' });
  }

  /**
   * Restore Ralph state
   */
  private async restoreRalphState(state: RalphLoopState): Promise<void> {
    // This would restore the Ralph loop state files
    // Placeholder implementation
    logger.debug('Ralph state restored', { iteration: state.iteration });
  }

  /**
   * Detect state changes
   */
  private detectStateChanges(
    oldState: RalphLoopState,
    newState: RalphLoopState
  ): string[] {
    const changes: string[] = [];

    for (const key of Object.keys(newState) as (keyof RalphLoopState)[]) {
      if (JSON.stringify(oldState[key]) !== JSON.stringify(newState[key])) {
        changes.push(key);
      }
    }

    return changes;
  }

  /**
   * Handle errors
   */
  private async handleError(error: Error, context: any): Promise<void> {
    logger.error('Lifecycle error', {
      error: error.message,
      context,
    });

    if (this.config.hooks.onError && this.hooks.onError) {
      try {
        await this.hooks.onError(error, context);
      } catch (hookError: any) {
        logger.error('Error hook failed', { error: hookError.message });
      }
    }
  }

  /**
   * Start timer for metrics
   */
  private startTimer(name: string): void {
    const start = Date.now();
    const timeout = setTimeout(() => {
      this.activeTimers.delete(name);
    }, 0) as NodeJS.Timeout & { startTime?: number };
    timeout.startTime = start;
    this.activeTimers.set(name, timeout);
  }

  /**
   * Stop timer and get duration
   */
  private stopTimer(name: string): number {
    const timer = this.activeTimers.get(name);
    if (!timer) return 0;

    const duration = Date.now() - (timer.startTime || Date.now());
    clearTimeout(timer);
    this.activeTimers.delete(name);

    return duration;
  }

  /**
   * Clean up all timers
   */
  private cleanupTimers(): void {
    for (const timer of this.activeTimers.values()) {
      clearTimeout(timer);
    }
    this.activeTimers.clear();
  }
}
