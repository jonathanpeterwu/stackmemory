/**
 * Incremental Garbage Collection System (STA-288)
 *
 * Implements incremental GC strategy to avoid stop-the-world pauses
 * with generational aging and priority-based collection.
 */

import { FrameManager } from './index.js';
import type { Frame } from './index.js';
import { Logger } from '../monitoring/logger.js';

interface GCConfig {
  framesPerCycle: number; // Process in chunks (default: 100)
  cycleInterval: number; // Every minute (default: 60s)
  maxAge: number; // Max age before eligible for collection (30 days)
  generations: {
    young: number; // < 1 day
    mature: number; // 1-7 days
    old: number; // 7-30 days
  };
}

interface GCStats {
  totalFrames: number;
  collectedFrames: number;
  lastRunTime: number;
  cycleCount: number;
  avgCycleTime: number;
  protectedFrames: number;
}

export class IncrementalGarbageCollector {
  private logger: Logger;
  private config: GCConfig;
  private stats: GCStats;
  private isRunning: boolean = false;
  private cycleTimer: NodeJS.Timer | null = null;
  private frameManager: FrameManager;

  constructor(frameManager: FrameManager, config: Partial<GCConfig> = {}) {
    this.frameManager = frameManager;
    this.logger = new Logger('IncrementalGC');

    this.config = {
      framesPerCycle: config.framesPerCycle || 100,
      cycleInterval: config.cycleInterval || 60000, // 60 seconds
      maxAge: config.maxAge || 30 * 24 * 60 * 60 * 1000, // 30 days
      generations: {
        young: config.generations?.young || 24 * 60 * 60 * 1000, // 1 day
        mature: config.generations?.mature || 7 * 24 * 60 * 60 * 1000, // 7 days
        old: config.generations?.old || 30 * 24 * 60 * 60 * 1000, // 30 days
      },
    };

    this.stats = {
      totalFrames: 0,
      collectedFrames: 0,
      lastRunTime: 0,
      cycleCount: 0,
      avgCycleTime: 0,
      protectedFrames: 0,
    };

    this.logger.info('Incremental GC initialized', this.config);
  }

  /**
   * Start the garbage collection cycle
   */
  start(): void {
    if (this.isRunning) {
      this.logger.warn('GC already running');
      return;
    }

    this.isRunning = true;
    this.logger.info(
      `Starting incremental GC with ${this.config.cycleInterval}ms intervals`
    );

    this.cycleTimer = setInterval(() => {
      this.runCycle().catch((error) => {
        this.logger.error('GC cycle failed', error);
      });
    }, this.config.cycleInterval);
  }

  /**
   * Stop the garbage collection cycle
   */
  stop(): void {
    if (this.cycleTimer) {
      clearInterval(this.cycleTimer);
      this.cycleTimer = null;
    }
    this.isRunning = false;
    this.logger.info('Incremental GC stopped');
  }

  /**
   * Run a single GC cycle
   */
  async runCycle(): Promise<void> {
    const startTime = Date.now();
    this.logger.debug('Starting GC cycle', {
      cycle: this.stats.cycleCount + 1,
    });

    try {
      // Get all frames for analysis
      const allFrames = await this.frameManager.getAllFrames();
      this.stats.totalFrames = allFrames.length;

      if (allFrames.length === 0) {
        this.logger.debug('No frames to collect');
        return;
      }

      // Categorize frames by generation and protection status
      const categorized = this.categorizeFrames(allFrames);

      // Select candidates for collection (prioritized)
      const candidates = this.selectCollectionCandidates(categorized);

      // Process in chunks to avoid blocking
      const collected = await this.collectFramesIncremental(candidates);

      // Update statistics
      this.updateStats(startTime, collected.length);

      this.logger.info('GC cycle completed', {
        cycle: this.stats.cycleCount,
        collected: collected.length,
        protected: this.stats.protectedFrames,
        duration: Date.now() - startTime,
      });
    } catch (error: unknown) {
      this.logger.error('GC cycle error', error);
    }
  }

  /**
   * Categorize frames by generation and protection status
   */
  private categorizeFrames(frames: Frame[]): {
    young: Frame[];
    mature: Frame[];
    old: Frame[];
    protected: Frame[];
  } {
    const now = Date.now();
    const categories = { young: [], mature: [], old: [], protected: [] };

    for (const frame of frames) {
      const age = now - frame.created_at;

      // Check if frame is protected
      if (this.isProtected(frame)) {
        categories.protected.push(frame);
        continue;
      }

      // Categorize by age
      if (age < this.config.generations.young) {
        categories.young.push(frame);
      } else if (age < this.config.generations.mature) {
        categories.mature.push(frame);
      } else {
        categories.old.push(frame);
      }
    }

    this.stats.protectedFrames = categories.protected.length;

    this.logger.debug('Frame categorization', {
      young: categories.young.length,
      mature: categories.mature.length,
      old: categories.old.length,
      protected: categories.protected.length,
    });

    return categories;
  }

  /**
   * Check if a frame should be protected from collection
   */
  private isProtected(frame: Frame): boolean {
    // Protect current session/run frames
    const currentRunId = this.frameManager.getCurrentRunId?.();
    if (frame.run_id === currentRunId) {
      return true;
    }

    // Protect active frames
    if (frame.state === 'active') {
      return true;
    }

    // Protect recent frames (< 1 hour old)
    const recentThreshold = Date.now() - 60 * 60 * 1000; // 1 hour
    if (frame.created_at > recentThreshold) {
      return true;
    }

    // Protect frames with important outputs
    if (frame.outputs && Object.keys(frame.outputs).length > 0) {
      return true;
    }

    // Protect parent frames (have children)
    if (frame.depth === 0) {
      // Root frames
      return true;
    }

    return false;
  }

  /**
   * Select collection candidates with priority ordering
   */
  private selectCollectionCandidates(categorized: any): Frame[] {
    const candidates: Frame[] = [];

    // Priority 1: Closed frames without outputs
    const emptyClosedFrames = categorized.old.filter(
      (f: Frame) =>
        f.state === 'closed' &&
        (!f.outputs || Object.keys(f.outputs).length === 0)
    );

    // Priority 2: Orphaned frames (no dependencies)
    const orphaned = [...categorized.mature, ...categorized.old].filter(
      (f: Frame) => this.isOrphaned(f)
    );

    // Priority 3: Duplicate traces
    const duplicates = this.findDuplicateTraces([
      ...categorized.mature,
      ...categorized.old,
    ]);

    // Priority 4: Old mature frames
    const oldMature = categorized.mature.filter((f: Frame) => {
      const age = Date.now() - f.created_at;
      return age > this.config.generations.mature * 0.8; // 80% of mature threshold
    });

    // Combine with priority ordering
    candidates.push(...emptyClosedFrames);
    candidates.push(...orphaned);
    candidates.push(...duplicates);
    candidates.push(...oldMature);

    // Remove duplicates and limit to cycle size
    const uniqueCandidates = Array.from(new Set(candidates));
    return uniqueCandidates.slice(0, this.config.framesPerCycle);
  }

  /**
   * Check if frame is orphaned (no dependencies)
   */
  private isOrphaned(frame: Frame): boolean {
    // Check if frame has any references from other frames
    // This is a simplified check - in practice, would analyze actual dependencies
    return (
      !frame.parent_frame_id && frame.depth > 0 && frame.state === 'closed'
    );
  }

  /**
   * Find duplicate trace signatures
   */
  private findDuplicateTraces(frames: Frame[]): Frame[] {
    const signatureMap = new Map<string, Frame[]>();

    for (const frame of frames) {
      // Create a signature from trace content
      const signature = this.createTraceSignature(frame);
      if (!signatureMap.has(signature)) {
        signatureMap.set(signature, []);
      }
      signatureMap.get(signature)!.push(frame);
    }

    // Return duplicates (keep newest, mark older for collection)
    const duplicates: Frame[] = [];
    for (const [signature, frameList] of signatureMap) {
      if (frameList.length > 1) {
        // Sort by timestamp, keep newest
        frameList.sort((a, b) => b.timestamp - a.timestamp);
        duplicates.push(...frameList.slice(1)); // Mark older ones for collection
      }
    }

    return duplicates;
  }

  /**
   * Create a signature for duplicate detection
   */
  private createTraceSignature(frame: Frame): string {
    // Create signature from key frame properties
    const type = frame.type;
    const name = frame.name;
    const outputs = JSON.stringify(frame.outputs || {});
    const digestText = frame.digest_text || '';
    return `${type}:${name}:${outputs}:${digestText}`.toLowerCase();
  }

  /**
   * Collect frames incrementally to avoid blocking
   */
  private async collectFramesIncremental(
    candidates: Frame[]
  ): Promise<Frame[]> {
    const collected: Frame[] = [];
    const chunkSize = Math.min(10, Math.ceil(candidates.length / 10)); // Process in small chunks

    for (let i = 0; i < candidates.length; i += chunkSize) {
      const chunk = candidates.slice(i, i + chunkSize);

      for (const frame of chunk) {
        try {
          await this.frameManager.deleteFrame(frame.frame_id);
          collected.push(frame);

          this.logger.debug(`Collected frame ${frame.frame_id}`, {
            age: Date.now() - frame.created_at,
            type: frame.type,
            reason: this.getCollectionReason(frame),
          });
        } catch (error: unknown) {
          this.logger.warn(`Failed to collect frame ${frame.frame_id}`, error);
        }
      }

      // Yield control to avoid blocking
      await new Promise((resolve) => setImmediate(resolve));
    }

    return collected;
  }

  /**
   * Get human-readable collection reason
   */
  private getCollectionReason(frame: Frame): string {
    const age = Date.now() - frame.created_at;
    const ageHours = Math.floor(age / (60 * 60 * 1000));

    if (
      frame.state === 'closed' &&
      (!frame.outputs || Object.keys(frame.outputs).length === 0)
    ) {
      return 'empty-closed';
    }
    if (this.isOrphaned(frame)) return 'orphaned';
    if (ageHours > 24 * 30) return `old (${ageHours}h)`;
    return 'duplicate';
  }

  /**
   * Update GC statistics
   */
  private updateStats(startTime: number, collectedCount: number): void {
    const cycleTime = Date.now() - startTime;

    this.stats.cycleCount++;
    this.stats.collectedFrames += collectedCount;
    this.stats.lastRunTime = startTime;
    this.stats.avgCycleTime =
      (this.stats.avgCycleTime * (this.stats.cycleCount - 1) + cycleTime) /
      this.stats.cycleCount;
  }

  /**
   * Get GC statistics
   */
  getStats(): GCStats {
    return { ...this.stats };
  }

  /**
   * Force a manual GC cycle
   */
  async forceCollection(): Promise<void> {
    this.logger.info('Forcing manual GC cycle');
    await this.runCycle();
  }

  /**
   * Update GC configuration
   */
  updateConfig(newConfig: Partial<GCConfig>): void {
    this.config = { ...this.config, ...newConfig };
    this.logger.info('GC configuration updated', this.config);

    // Restart with new interval if running
    if (this.isRunning && newConfig.cycleInterval) {
      this.stop();
      this.start();
    }
  }
}
