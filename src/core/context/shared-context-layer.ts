/**
 * Shared Context Layer for Cross-Session Reference
 *
 * This layer maintains a lightweight shared context across sessions while
 * preserving run_id isolation for write operations. It enables:
 * - Read access to frames from other sessions
 * - Automatic context inheritance
 * - Efficient caching and indexing
 * - Safe concurrent access
 *
 * Also includes ContextBridge for automatic synchronization between sessions
 * and shared context.
 */

import { v4 as uuidv4 } from 'uuid';
import * as fs from 'fs/promises';
import * as path from 'path';
import { sessionManager } from '../session/session-manager.js';
import type { Frame } from './frame-types.js';
import type { FrameManager } from './index.js';
import { logger } from '../monitoring/logger.js';

// Type-safe environment variable access

export interface SharedContext {
  projectId: string;
  branch?: string;
  lastUpdated: number;
  sessions: SharedSessionContext[];
  globalPatterns: ContextPattern[];
  decisionLog: Decision[];
  referenceIndex: ReferenceIndex;
}

export interface SharedSessionContext {
  sessionId: string;
  runId: string;
  summary: string;
  keyFrames: FrameSummary[];
  createdAt: number;
  lastActiveAt: number;
  metadata: Record<string, any>;
}

export interface FrameSummary {
  frameId: string;
  title: string;
  type: string;
  score: number;
  tags: string[];
  summary?: string;
  createdAt: number;
}

export interface ContextPattern {
  pattern: string;
  type: 'error' | 'success' | 'decision' | 'learning';
  frequency: number;
  lastSeen: number;
  resolution?: string;
}

export interface Decision {
  id: string;
  decision: string;
  reasoning: string;
  timestamp: number;
  sessionId: string;
  outcome?: 'success' | 'failure' | 'pending';
}

export interface ReferenceIndex {
  byTag: Map<string, string[]>;
  byType: Map<string, string[]>;
  byScore: string[];
  recentlyAccessed: string[];
}

export class SharedContextLayer {
  private static instance: SharedContextLayer;
  private contextDir: string;
  private cache: Map<string, SharedContext> = new Map();
  private readonly MAX_CACHE_SIZE = 100;
  private readonly CACHE_TTL = 5 * 60 * 1000; // 5 minutes
  private lastCacheClean = Date.now();

  private constructor() {
    const homeDir = process.env['HOME'] || process.env['USERPROFILE'] || '';
    this.contextDir = path.join(homeDir, '.stackmemory', 'shared-context');
  }

  static getInstance(): SharedContextLayer {
    if (!SharedContextLayer.instance) {
      SharedContextLayer.instance = new SharedContextLayer();
    }
    return SharedContextLayer.instance;
  }

  async initialize(): Promise<void> {
    await fs.mkdir(this.contextDir, { recursive: true });
    await fs.mkdir(path.join(this.contextDir, 'projects'), { recursive: true });
    await fs.mkdir(path.join(this.contextDir, 'patterns'), { recursive: true });
    await fs.mkdir(path.join(this.contextDir, 'decisions'), {
      recursive: true,
    });
  }

  /**
   * Get or create shared context for current project/branch
   */
  async getSharedContext(options?: {
    projectId?: string;
    branch?: string;
    includeOtherBranches?: boolean;
  }): Promise<SharedContext> {
    const session = sessionManager.getCurrentSession();
    const projectId = options?.projectId || session?.projectId || 'global';
    const branch = options?.branch || session?.branch;

    const cacheKey = `${projectId}:${branch || 'main'}`;

    // Check cache first
    if (this.cache.has(cacheKey)) {
      const cached = this.cache.get(cacheKey)!;
      if (Date.now() - cached.lastUpdated < this.CACHE_TTL) {
        return cached;
      }
    }

    // Load from disk
    const context = await this.loadProjectContext(projectId, branch);

    // Include other branches if requested
    if (options?.includeOtherBranches) {
      const otherBranches = await this.loadOtherBranchContexts(
        projectId,
        branch
      );
      context.sessions.push(...otherBranches);
    }

    // Update cache
    this.cache.set(cacheKey, context);
    this.cleanCache();

    return context;
  }

  /**
   * Add current session's important frames to shared context
   */
  async addToSharedContext(
    frames: Frame[],
    options?: {
      minScore?: number;
      tags?: string[];
    }
  ): Promise<void> {
    const session = sessionManager.getCurrentSession();
    if (!session) return;

    const context = await this.getSharedContext();
    const minScore = options?.minScore || 0.7;

    // Filter important frames
    const importantFrames = frames.filter((f) => {
      const score = this.calculateFrameScore(f);
      return score >= minScore;
    });

    // Create session context
    const sessionContext: SharedSessionContext = {
      sessionId: session.sessionId,
      runId: session.runId,
      summary: this.generateSessionSummary(importantFrames),
      keyFrames: importantFrames.map((f) => this.summarizeFrame(f)),
      createdAt: session.startedAt,
      lastActiveAt: Date.now(),
      metadata: session.metadata,
    };

    // Update or add session context
    const existingIndex = context.sessions.findIndex(
      (s) => s.sessionId === session.sessionId
    );
    if (existingIndex >= 0) {
      context.sessions[existingIndex] = sessionContext;
    } else {
      context.sessions.push(sessionContext);
    }

    // Update patterns
    this.updatePatterns(context, importantFrames);

    // Update reference index
    this.updateReferenceIndex(context, importantFrames);

    // Save context
    await this.saveProjectContext(context);
  }

  /**
   * Query shared context for relevant frames
   */
  async querySharedContext(query: {
    tags?: string[];
    type?: string;
    minScore?: number;
    sessionId?: string;
    limit?: number;
  }): Promise<FrameSummary[]> {
    const context = await this.getSharedContext({ includeOtherBranches: true });
    let results: FrameSummary[] = [];

    // Collect all frames from all sessions
    for (const session of context.sessions) {
      if (query.sessionId && session.sessionId !== query.sessionId) continue;

      // Skip sessions without keyFrames
      if (!session.keyFrames || !Array.isArray(session.keyFrames)) continue;

      const filtered = session.keyFrames.filter((f) => {
        if (query.tags && !query.tags.some((tag) => f.tags.includes(tag)))
          return false;
        if (query.type && f.type !== query.type) return false;
        if (query.minScore && f.score < query.minScore) return false;
        return true;
      });

      results.push(...filtered);
    }

    // Sort by score and recency
    results.sort((a, b) => {
      const scoreWeight = 0.7;
      const recencyWeight = 0.3;

      const aScore =
        a.score * scoreWeight +
        (1 - (Date.now() - a.createdAt) / (30 * 24 * 60 * 60 * 1000)) *
          recencyWeight;
      const bScore =
        b.score * scoreWeight +
        (1 - (Date.now() - b.createdAt) / (30 * 24 * 60 * 60 * 1000)) *
          recencyWeight;

      return bScore - aScore;
    });

    // Apply limit
    if (query.limit) {
      results = results.slice(0, query.limit);
    }

    // Update recently accessed
    const index = context.referenceIndex;
    if (!index.recentlyAccessed) {
      index.recentlyAccessed = [];
    }

    // Add frameIds to recently accessed, removing duplicates
    if (results.length > 0) {
      const frameIds = results.map((r) => r.frameId);
      index.recentlyAccessed = [
        ...frameIds,
        ...index.recentlyAccessed.filter((id: any) => !frameIds.includes(id)),
      ].slice(0, 100);

      // Save the updated context with recently accessed frames
      await this.saveProjectContext(context);
    }

    return results;
  }

  /**
   * Get relevant patterns from shared context
   */
  async getPatterns(type?: ContextPattern['type']): Promise<ContextPattern[]> {
    const context = await this.getSharedContext();

    if (type) {
      return context.globalPatterns.filter((p) => p.type === type);
    }

    return context.globalPatterns;
  }

  /**
   * Add a decision to the shared context
   */
  async addDecision(
    decision: Omit<Decision, 'id' | 'timestamp' | 'sessionId'>
  ): Promise<void> {
    const session = sessionManager.getCurrentSession();
    if (!session) return;

    const context = await this.getSharedContext();

    const newDecision: Decision = {
      id: uuidv4(),
      timestamp: Date.now(),
      sessionId: session.sessionId,
      outcome: 'pending',
      ...decision,
    };

    context.decisionLog.push(newDecision);

    // Keep only last 100 decisions
    if (context.decisionLog.length > 100) {
      context.decisionLog = context.decisionLog.slice(-100);
    }

    await this.saveProjectContext(context);
  }

  /**
   * Get recent decisions from shared context
   */
  async getDecisions(limit: number = 10): Promise<Decision[]> {
    const context = await this.getSharedContext();
    return context.decisionLog.slice(-limit);
  }

  /**
   * Automatic context discovery on CLI startup
   */
  async autoDiscoverContext(): Promise<{
    hasSharedContext: boolean;
    sessionCount: number;
    recentPatterns: ContextPattern[];
    lastDecisions: Decision[];
    suggestedFrames: FrameSummary[];
  }> {
    const context = await this.getSharedContext({
      includeOtherBranches: false,
    });

    // Get recent patterns (last 7 days)
    const recentPatterns = context.globalPatterns
      .filter((p) => Date.now() - p.lastSeen < 7 * 24 * 60 * 60 * 1000)
      .sort((a, b) => b.frequency - a.frequency)
      .slice(0, 5);

    // Get last 5 decisions
    const lastDecisions = context.decisionLog.slice(-5);

    // Get suggested frames based on recent access and score
    const suggestedFrames = await this.querySharedContext({
      minScore: 0.8,
      limit: 5,
    });

    return {
      hasSharedContext: context.sessions.length > 0,
      sessionCount: context.sessions.length,
      recentPatterns,
      lastDecisions,
      suggestedFrames,
    };
  }

  private async loadProjectContext(
    projectId: string,
    branch?: string
  ): Promise<SharedContext> {
    const contextFile = path.join(
      this.contextDir,
      'projects',
      `${projectId}_${branch || 'main'}.json`
    );

    try {
      const data = await fs.readFile(contextFile, 'utf-8');
      const context = JSON.parse(data);

      // Reconstruct Maps
      context.referenceIndex.byTag = new Map(
        Object.entries(context.referenceIndex.byTag || {})
      );
      context.referenceIndex.byType = new Map(
        Object.entries(context.referenceIndex.byType || {})
      );

      return context;
    } catch {
      // Return empty context if file doesn't exist
      return {
        projectId,
        branch,
        lastUpdated: Date.now(),
        sessions: [],
        globalPatterns: [],
        decisionLog: [],
        referenceIndex: {
          byTag: new Map(),
          byType: new Map(),
          byScore: [],
          recentlyAccessed: [],
        },
      };
    }
  }

  private async saveProjectContext(context: SharedContext): Promise<void> {
    const contextFile = path.join(
      this.contextDir,
      'projects',
      `${context.projectId}_${context.branch || 'main'}.json`
    );

    // Convert Maps to objects for JSON serialization
    const serializable = {
      ...context,
      lastUpdated: Date.now(),
      referenceIndex: {
        ...context.referenceIndex,
        byTag: Object.fromEntries(context.referenceIndex.byTag),
        byType: Object.fromEntries(context.referenceIndex.byType),
      },
    };

    await fs.writeFile(contextFile, JSON.stringify(serializable, null, 2));
  }

  private async loadOtherBranchContexts(
    projectId: string,
    currentBranch?: string
  ): Promise<SharedSessionContext[]> {
    const projectsDir = path.join(this.contextDir, 'projects');
    const files = await fs.readdir(projectsDir);
    const sessions: SharedSessionContext[] = [];

    for (const file of files) {
      if (
        file.startsWith(`${projectId}_`) &&
        !file.includes(currentBranch || 'main')
      ) {
        try {
          const data = await fs.readFile(path.join(projectsDir, file), 'utf-8');
          const context = JSON.parse(data);
          sessions.push(...context.sessions);
        } catch {
          // Skip invalid files
        }
      }
    }

    return sessions;
  }

  private calculateFrameScore(frame: Frame): number {
    // Simple scoring algorithm
    let score = 0.5;

    // Boost for certain types
    if (frame.type === 'task' || frame.type === 'review') score += 0.2;
    if (frame.type === 'debug' || frame.type === 'write') score += 0.15;
    if (frame.type === 'error') score += 0.15; // Error frames are important for pattern extraction

    // Check for data property (used in tests)
    const frameWithData = frame as Frame & { data?: Record<string, unknown> };
    if (frameWithData.data) score += 0.2;

    // Boost for having outputs (indicates completion/results)
    if (frame.outputs && Object.keys(frame.outputs).length > 0) score += 0.2;
    if (
      frame.digest_text ||
      (frame.digest_json && Object.keys(frame.digest_json).length > 0)
    )
      score += 0.1;

    // Time decay (reduce score for older frames) - but handle missing created_at
    if (frame.created_at) {
      const age = Date.now() - frame.created_at;
      const daysSinceCreation = age / (24 * 60 * 60 * 1000);
      score *= Math.max(0.3, 1 - daysSinceCreation / 30);
    }

    return Math.min(1, score);
  }

  private summarizeFrame(frame: Frame): FrameSummary {
    return {
      frameId: frame.frame_id,
      title: frame.name,
      type: frame.type,
      score: this.calculateFrameScore(frame),
      tags: [],
      summary: this.generateFrameSummary(frame),
      createdAt: frame.created_at,
    };
  }

  private generateFrameSummary(frame: Frame): string {
    // Generate a brief summary of the frame
    const parts = [];
    const frameWithData = frame as Frame & {
      data?: Record<string, string>;
      title?: string;
    };

    if (frame.type) parts.push(`[${frame.type}]`);
    if (frame.name) parts.push(frame.name);
    if (frameWithData.title) parts.push(frameWithData.title);
    if (frameWithData.data?.error)
      parts.push(`Error: ${frameWithData.data.error}`);
    if (frameWithData.data?.resolution)
      parts.push(`Resolution: ${frameWithData.data.resolution}`);

    return parts.join(' - ').slice(0, 200);
  }

  private generateSessionSummary(frames: Frame[]): string {
    const types = [...new Set(frames.map((f) => f.type))];
    return `Session with ${frames.length} key frames: ${types.join(', ')}`;
  }

  private updatePatterns(context: SharedContext, frames: Frame[]): void {
    for (const frame of frames) {
      // Extract patterns from frame data
      // Handle frames with a data property (used in tests)
      const frameWithData = frame as Frame & { data?: Record<string, string> };
      if (frameWithData.data?.error) {
        this.addPattern(
          context,
          frameWithData.data.error,
          'error',
          frameWithData.data?.resolution
        );
      } else if (frame.type === 'error' && frame.name) {
        // Only extract from name/outputs if no data.error property
        const errorText = frame.outputs?.error || frame.name;
        const resolution = frame.outputs?.resolution;
        if (errorText) {
          this.addPattern(context, errorText, 'error', resolution);
        }
      }

      if (frame.type === 'decision' && frameWithData.data?.decision) {
        this.addPattern(context, frameWithData.data.decision, 'decision');
      } else if (frame.digest_json?.decision) {
        // Only extract from digest_json if no data.decision
        this.addPattern(context, frame.digest_json.decision, 'decision');
      }
    }
  }

  private addPattern(
    context: SharedContext,
    pattern: string,
    type: ContextPattern['type'],
    resolution?: string
  ): void {
    const existing = context.globalPatterns.find(
      (p) => p.pattern === pattern && p.type === type
    );

    if (existing) {
      existing.frequency++;
      existing.lastSeen = Date.now();
      if (resolution) existing.resolution = resolution;
    } else {
      context.globalPatterns.push({
        pattern,
        type,
        frequency: 1,
        lastSeen: Date.now(),
        resolution,
      });
    }

    // Keep only top 100 patterns
    if (context.globalPatterns.length > 100) {
      context.globalPatterns.sort((a, b) => b.frequency - a.frequency);
      context.globalPatterns = context.globalPatterns.slice(0, 100);
    }
  }

  private updateReferenceIndex(context: SharedContext, frames: Frame[]): void {
    for (const frame of frames) {
      const summary = this.summarizeFrame(frame);

      // Index by tags
      for (const tag of summary.tags) {
        if (!context.referenceIndex.byTag.has(tag)) {
          context.referenceIndex.byTag.set(tag, []);
        }
        context.referenceIndex.byTag.get(tag)!.push(frame.frameId);
      }

      // Index by type
      if (!context.referenceIndex.byType.has(frame.type)) {
        context.referenceIndex.byType.set(frame.type, []);
      }
      context.referenceIndex.byType.get(frame.type)!.push(frame.frameId);

      // Update score index
      const scoreIndex = context.referenceIndex.byScore;
      const insertIndex = scoreIndex.findIndex((id) => {
        const otherFrame = context.sessions
          .flatMap((s) => s.keyFrames)
          .find((f) => f.frameId === id);
        return otherFrame && otherFrame.score < summary.score;
      });

      if (insertIndex >= 0) {
        scoreIndex.splice(insertIndex, 0, frame.frameId);
      } else {
        scoreIndex.push(frame.frameId);
      }

      // Keep only top 1000 by score
      context.referenceIndex.byScore = scoreIndex.slice(0, 1000);
    }
  }

  private cleanCache(): void {
    if (Date.now() - this.lastCacheClean < 60000) return; // Clean every minute

    if (this.cache.size > this.MAX_CACHE_SIZE) {
      const entries = Array.from(this.cache.entries()).sort(
        (a, b) => b[1].lastUpdated - a[1].lastUpdated
      );

      this.cache = new Map(entries.slice(0, this.MAX_CACHE_SIZE / 2));
    }

    this.lastCacheClean = Date.now();
  }
}

export const sharedContextLayer = SharedContextLayer.getInstance();

// ============================================================================
// Context Bridge - Automatic synchronization between sessions and shared context
// ============================================================================

export interface BridgeOptions {
  autoSync: boolean;
  syncInterval: number;
  minFrameScore: number;
  importantTags: string[];
}

export class ContextBridge {
  private static instance: ContextBridge;
  private frameManager: FrameManager | null = null;
  private syncTimer: NodeJS.Timeout | null = null;
  private lastSyncTime: number = 0;
  private options: BridgeOptions = {
    autoSync: true,
    syncInterval: 60000, // 1 minute
    minFrameScore: 0.5, // Include frames with score above 0.5
    importantTags: ['decision', 'error', 'milestone', 'learning'],
  };

  private constructor() {}

  static getInstance(): ContextBridge {
    if (!ContextBridge.instance) {
      ContextBridge.instance = new ContextBridge();
    }
    return ContextBridge.instance;
  }

  /**
   * Initialize the bridge with a frame manager
   */
  async initialize(
    frameManager: FrameManager,
    options?: Partial<BridgeOptions>
  ): Promise<void> {
    this.frameManager = frameManager;
    this.options = { ...this.options, ...options };

    // Load shared context on initialization
    await this.loadSharedContext();

    // Start auto-sync if enabled
    if (this.options.autoSync) {
      this.startAutoSync();
    }

    logger.info('Context bridge initialized', {
      autoSync: this.options.autoSync,
      syncInterval: this.options.syncInterval,
    });
  }

  /**
   * Load relevant shared context into current session
   */
  async loadSharedContext(): Promise<void> {
    try {
      const session = sessionManager.getCurrentSession();
      if (!session) return;

      // Get context discovery
      const discovery = await sharedContextLayer.autoDiscoverContext();

      if (!discovery.hasSharedContext) {
        logger.info('No shared context available to load');
        return;
      }

      // Load recent patterns as metadata
      if (discovery.recentPatterns.length > 0) {
        logger.info('Loaded recent patterns from shared context', {
          patternCount: discovery.recentPatterns.length,
        });
      }

      // Load last decisions for reference
      if (discovery.lastDecisions.length > 0) {
        logger.info('Loaded recent decisions from shared context', {
          decisionCount: discovery.lastDecisions.length,
        });
      }

      // Store suggested frames in metadata for quick reference
      if (discovery.suggestedFrames.length > 0) {
        const metadata = {
          suggestedFrames: discovery.suggestedFrames,
          loadedAt: Date.now(),
        };

        // Store in frame manager's context
        if (this.frameManager) {
          await this.frameManager.addContext(
            'shared-context-suggestions',
            metadata
          );
        }

        logger.info('Loaded suggested frames from shared context', {
          frameCount: discovery.suggestedFrames.length,
        });
      }
    } catch (error: unknown) {
      logger.error('Failed to load shared context', error as Error);
    }
  }

  /**
   * Sync current session's important frames to shared context
   */
  async syncToSharedContext(): Promise<void> {
    try {
      if (!this.frameManager) return;

      const session = sessionManager.getCurrentSession();
      if (!session) return;

      // Get all active frames (filter out any nulls from missing frames)
      const activeFrames = this.frameManager
        .getActiveFramePath()
        .filter(Boolean);

      // Get recent closed frames (last 100)
      const recentFrames = await this.frameManager.getRecentFrames(100);

      // Combine and filter important frames
      const allFrames = [...activeFrames, ...recentFrames].filter(Boolean);
      const importantFrames = this.filterImportantFrames(allFrames);

      if (importantFrames.length === 0) {
        logger.debug('No important frames to sync');
        return;
      }

      // Add to shared context
      await sharedContextLayer.addToSharedContext(importantFrames, {
        minScore: this.options.minFrameScore,
        tags: this.options.importantTags,
      });

      this.lastSyncTime = Date.now();

      logger.info('Synced frames to shared context', {
        frameCount: importantFrames.length,
        sessionId: session.sessionId,
      });
    } catch (error: unknown) {
      logger.error('Failed to sync to shared context', error as Error);
    }
  }

  /**
   * Query shared context for relevant frames
   */
  async querySharedFrames(query: {
    tags?: string[];
    type?: string;
    limit?: number;
  }): Promise<FrameSummary[]> {
    try {
      const results = await sharedContextLayer.querySharedContext({
        ...query,
        minScore: this.options.minFrameScore,
      });

      logger.info('Queried shared context', {
        query,
        resultCount: results.length,
      });

      return results;
    } catch (error: unknown) {
      logger.error('Failed to query shared context', error as Error);
      return [];
    }
  }

  /**
   * Add a decision to shared context
   */
  async addDecision(decision: string, reasoning: string): Promise<void> {
    try {
      await sharedContextLayer.addDecision({
        decision,
        reasoning,
        outcome: 'pending',
      });

      logger.info('Added decision to shared context', { decision });
    } catch (error: unknown) {
      logger.error('Failed to add decision', error as Error);
    }
  }

  /**
   * Start automatic synchronization
   */
  private startAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
    }

    this.syncTimer = setInterval(() => {
      this.syncToSharedContext().catch((error) => {
        logger.error('Auto-sync failed', error as Error);
      });
    }, this.options.syncInterval);

    // Also sync on important events
    this.setupEventListeners();
  }

  /**
   * Stop automatic synchronization
   */
  stopAutoSync(): void {
    if (this.syncTimer) {
      clearInterval(this.syncTimer);
      this.syncTimer = null;
    }
  }

  /**
   * Filter frames that are important enough to share
   */
  private filterImportantFrames(frames: Frame[]): Frame[] {
    return frames.filter((frame) => {
      // Check if frame has important tags
      const hasImportantTag = this.options.importantTags.some((tag) =>
        frame.metadata?.tags?.includes(tag)
      );

      // Check frame type importance
      const isImportantType = [
        'task',
        'milestone',
        'error',
        'resolution',
        'decision',
      ].includes(frame.type);

      // Check metadata importance flag
      const markedImportant = frame.metadata?.importance === 'high';

      return hasImportantTag || isImportantType || markedImportant;
    });
  }

  /**
   * Setup event listeners for automatic syncing
   */
  private setupEventListeners(): void {
    if (!this.frameManager) return;

    // Sync when a frame is closed
    const originalClose = this.frameManager.closeFrame.bind(this.frameManager);
    this.frameManager.closeFrame = async (frameId: string, metadata?: any) => {
      const result = await originalClose(frameId, metadata);

      // Sync if it was an important frame
      const frame = await this.frameManager!.getFrame(frameId);
      if (frame && this.filterImportantFrames([frame]).length > 0) {
        await this.syncToSharedContext();
      }

      return result;
    };

    // Sync when a milestone is reached
    const originalMilestone = this.frameManager.createFrame.bind(
      this.frameManager
    );
    this.frameManager.createFrame = async (params: any) => {
      const result = await originalMilestone(params);

      if (params.type === 'milestone') {
        await this.syncToSharedContext();
      }

      return result;
    };
  }

  /**
   * Get sync statistics
   */
  getSyncStats(): {
    lastSyncTime: number;
    autoSyncEnabled: boolean;
    syncInterval: number;
  } {
    return {
      lastSyncTime: this.lastSyncTime,
      autoSyncEnabled: this.options.autoSync,
      syncInterval: this.options.syncInterval,
    };
  }

  /**
   * Manual trigger for immediate sync
   */
  async forceSyncNow(): Promise<void> {
    logger.info('Force sync triggered');
    await this.syncToSharedContext();
  }
}

export const contextBridge = ContextBridge.getInstance();

// Export for testing
export {
  SharedContext,
  SharedSessionContext,
  FrameSummary,
  ContextPattern,
  Decision,
  ReferenceIndex,
  BridgeOptions,
};
