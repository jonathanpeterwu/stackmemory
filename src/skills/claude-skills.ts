/**
 * Claude Skills for StackMemory
 * Custom skills that integrate with Claude Code to enhance workflow
 */

import {
  FrameHandoffManager,
  type HandoffMetadata,
} from '../core/context/frame-handoff-manager.js';
import { DualStackManager } from '../core/context/dual-stack-manager.js';
import { SQLiteAdapter } from '../core/database/sqlite-adapter.js';
import { ContextRetriever } from '../core/retrieval/context-retriever.js';
import { logger } from '../core/monitoring/logger.js';
import {
  RepoIngestionSkill,
  type RepoIngestionOptions,
} from './repo-ingestion-skill.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface SkillContext {
  projectId: string;
  userId: string;
  dualStackManager: DualStackManager;
  handoffManager: FrameHandoffManager;
  contextRetriever: ContextRetriever;
  database: SQLiteAdapter;
}

export interface SkillResult {
  success: boolean;
  message: string;
  data?: any;
  action?: string;
}

/**
 * Skill 1: Frame Handoff Orchestrator
 * Streamlines frame handoffs between team members
 */
export class HandoffSkill {
  constructor(private context: SkillContext) {}

  async execute(
    targetUser: string,
    message: string,
    options?: {
      frames?: string[];
      priority?: 'low' | 'medium' | 'high' | 'critical';
      autoDetect?: boolean;
    }
  ): Promise<SkillResult> {
    try {
      const activeStack = this.context.dualStackManager.getActiveStack();

      // Auto-detect frames if not specified
      let framesToHandoff = options?.frames || [];
      if (options?.autoDetect !== false && framesToHandoff.length === 0) {
        // Get recent frames that are completed or have errors
        const allFrames = await activeStack.getAllFrames();
        // Filter for completed frames OR frames with errors (not both conditions required)
        const relevantFrames = allFrames.filter(
          (f) =>
            f.state === 'completed' ||
            (f.outputs &&
              Array.isArray(f.outputs) &&
              f.outputs.some((o) => o.type === 'error'))
        );
        framesToHandoff = relevantFrames
          .slice(-5) // Last 5 relevant frames
          .map((f) => f.frameId);
      }

      if (framesToHandoff.length === 0) {
        return {
          success: false,
          message:
            'No frames to handoff. Specify frames or complete some work first.',
        };
      }

      // Generate comprehensive handoff summary
      const frameDetails = await Promise.all(
        framesToHandoff.map((id) => activeStack.getFrame(id))
      );

      const summary = this.generateHandoffSummary(frameDetails, message);

      // Create handoff metadata
      const metadata: HandoffMetadata = {
        initiatedAt: new Date(),
        initiatorId: this.context.userId,
        targetUserId: targetUser,
        frameContext: {
          totalFrames: framesToHandoff.length,
          frameTypes: [
            ...new Set(frameDetails.map((f) => f?.type || 'unknown')),
          ],
          estimatedSize: JSON.stringify(frameDetails).length,
          dependencies: this.extractDependencies(frameDetails),
        },
        businessContext: {
          priority: options?.priority || 'medium',
          stakeholders: [targetUser],
        },
      };

      // Get target stack (shared or create new)
      const availableStacks =
        await this.context.dualStackManager.getAvailableStacks();
      let targetStackId = availableStacks.find(
        (s) => s.type === 'shared'
      )?.stackId;

      if (!targetStackId) {
        targetStackId = await this.context.dualStackManager.createSharedStack(
          'team',
          `Handoff: ${message.slice(0, 50)}`,
          this.context.userId
        );
      }

      // Initiate handoff
      const handoffId = await this.context.handoffManager.initiateHandoff(
        targetStackId,
        framesToHandoff,
        metadata,
        targetUser,
        summary
      );

      // Create action items for recipient
      const actionItems = this.generateActionItems(frameDetails);

      return {
        success: true,
        message: `Handoff initiated to @${targetUser}`,
        data: {
          handoffId,
          frameCount: framesToHandoff.length,
          priority: options?.priority || 'medium',
          actionItems,
          targetStack: targetStackId,
        },
        action: `Notified ${targetUser}. Handoff ID: ${handoffId}`,
      };
    } catch (error: unknown) {
      logger.error('Handoff skill error:', error);
      return {
        success: false,
        message: `Failed to initiate handoff: ${error.message}`,
      };
    }
  }

  private generateHandoffSummary(frames: any[], message: string): string {
    const completed = frames.filter((f) => f?.state === 'completed').length;
    const blocked = frames.filter((f) =>
      f?.outputs?.some((o) => o.type === 'error')
    ).length;

    return `
## Handoff Summary
**Message**: ${message}
**Frames**: ${frames.length} total (${completed} completed, ${blocked} blocked)

### Work Completed:
${frames
  .filter((f) => f?.state === 'completed')
  .map((f) => `- ${f.name}: ${f.digest_deterministic?.summary || 'No summary'}`)
  .join('\n')}

### Attention Required:
${
  frames
    .filter((f) => f?.outputs?.some((o) => o.type === 'error'))
    .map(
      (f) =>
        `- ${f.name}: ${f.outputs.find((o) => o.type === 'error')?.content || 'Error'}`
    )
    .join('\n') || 'None'
}

### Context:
${frames
  .map((f) => f?.digest_ai?.context || '')
  .filter(Boolean)
  .join('\n')}
    `.trim();
  }

  private extractDependencies(frames: any[]): string[] {
    const deps = new Set<string>();
    frames.forEach((frame) => {
      if (frame?.inputs?.dependencies) {
        if (Array.isArray(frame.inputs.dependencies)) {
          frame.inputs.dependencies.forEach((d) => deps.add(d));
        }
      }
      // Extract from outputs
      if (frame?.outputs) {
        frame.outputs.forEach((output) => {
          if (output.type === 'dependency') {
            deps.add(output.content);
          }
        });
      }
    });
    return Array.from(deps);
  }

  private generateActionItems(frames: any[]): string[] {
    const items: string[] = [];

    frames.forEach((frame) => {
      // Check for TODOs in outputs
      if (frame?.outputs) {
        frame.outputs.forEach((output) => {
          if (output.type === 'todo' || output.content?.includes('TODO')) {
            items.push(output.content);
          }
        });
      }

      // Check for errors that need resolution
      if (frame?.outputs?.some((o) => o.type === 'error')) {
        items.push(`Resolve error in ${frame.name}`);
      }

      // Check for pending tests - look in multiple places
      if (
        frame?.inputs?.tests === 'pending' ||
        frame?.type === 'implementation' ||
        (frame?.name && frame.name.toLowerCase().includes('implementation'))
      ) {
        items.push(`Write tests for ${frame.name}`);
      }
    });

    return items;
  }
}

/**
 * Skill 7: Recovery Checkpoint Manager
 * Create and manage recovery points
 */
export class CheckpointSkill {
  private checkpointDir: string;

  constructor(private context: SkillContext) {
    this.checkpointDir = path.join(
      os.homedir(),
      '.stackmemory',
      'checkpoints',
      context.projectId
    );
    fs.mkdirSync(this.checkpointDir, { recursive: true });
  }

  async create(
    description: string,
    options?: {
      autoDetectRisky?: boolean;
      includeFiles?: string[];
      metadata?: Record<string, any>;
    }
  ): Promise<SkillResult> {
    try {
      const timestamp = Date.now();
      const checkpointId = `checkpoint-${timestamp}-${Math.random().toString(36).slice(2, 8)}`;

      // Get current context
      const activeStack = this.context.dualStackManager.getActiveStack();
      const currentContext = this.context.dualStackManager.getCurrentContext();
      const allFrames = await activeStack.getAllFrames();

      // Create checkpoint data
      const checkpoint = {
        id: checkpointId,
        timestamp,
        description,
        context: {
          stackId: currentContext.stackId,
          stackType: currentContext.type,
          userId: this.context.userId,
          projectId: this.context.projectId,
        },
        frames: allFrames,
        metadata: {
          ...options?.metadata,
          frameCount: allFrames.length,
          activeFrames: allFrames.filter((f) => f.state === 'active').length,
          completedFrames: allFrames.filter((f) => f.state === 'completed')
            .length,
        },
        files: options?.includeFiles || [],
      };

      // Save checkpoint
      const checkpointPath = path.join(
        this.checkpointDir,
        `${checkpointId}.json`
      );
      fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));

      // Save file backups if specified
      if (options?.includeFiles && options.includeFiles.length > 0) {
        const filesDir = path.join(this.checkpointDir, checkpointId, 'files');
        fs.mkdirSync(filesDir, { recursive: true });

        for (const file of options.includeFiles) {
          if (fs.existsSync(file)) {
            const basename = path.basename(file);
            const backupPath = path.join(filesDir, basename);
            fs.copyFileSync(file, backupPath);
          }
        }
      }

      // Auto-detect risky operations
      if (options?.autoDetectRisky) {
        const riskyPatterns = [
          'migration',
          'database',
          'deploy',
          'production',
          'delete',
          'remove',
          'drop',
          'migrate', // Add more specific pattern
        ];

        const isRisky = allFrames.some((frame) => {
          const nameMatches =
            frame.name &&
            riskyPatterns.some((pattern) =>
              frame.name.toLowerCase().includes(pattern)
            );
          const commandMatches =
            frame.inputs?.command &&
            riskyPatterns.some((pattern) =>
              frame.inputs.command.toLowerCase().includes(pattern)
            );
          return nameMatches || commandMatches;
        });

        if (isRisky) {
          checkpoint.metadata.riskyOperation = true;
          checkpoint.metadata.autoCheckpoint = true;
        }
      }

      // Update the checkpoint data after risky operation detection
      fs.writeFileSync(checkpointPath, JSON.stringify(checkpoint, null, 2));

      logger.info(`Created checkpoint: ${checkpointId}`);

      return {
        success: true,
        message: `Checkpoint created: ${description}`,
        data: {
          checkpointId,
          timestamp: new Date(timestamp).toISOString(),
          frameCount: checkpoint.metadata.frameCount,
          location: checkpointPath,
        },
        action: `Saved checkpoint ${checkpointId}`,
      };
    } catch (error: unknown) {
      logger.error('Checkpoint creation error:', error);
      return {
        success: false,
        message: `Failed to create checkpoint: ${error.message}`,
      };
    }
  }

  async restore(checkpointId: string): Promise<SkillResult> {
    try {
      const checkpointPath = path.join(
        this.checkpointDir,
        `${checkpointId}.json`
      );

      if (!fs.existsSync(checkpointPath)) {
        // Try to find by partial ID
        const files = fs.readdirSync(this.checkpointDir);
        const match = files.find((f) => f.includes(checkpointId));
        if (match) {
          checkpointId = match.replace('.json', '');
        } else {
          return {
            success: false,
            message: `Checkpoint not found: ${checkpointId}`,
          };
        }
      }

      const checkpoint = JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'));

      // Switch to checkpoint's stack
      await this.context.dualStackManager.switchToStack(
        checkpoint.context.stackId
      );

      // Restore frames (this is a simplified version - real implementation would be more complex)
      // const activeStack = this.context.dualStackManager.getActiveStack();

      // Clear current frames and restore from checkpoint
      // Note: This is a conceptual implementation - actual frame restoration
      // would need more sophisticated state management

      // Restore files if they exist
      const filesDir = path.join(this.checkpointDir, checkpointId, 'files');
      if (fs.existsSync(filesDir)) {
        const files = fs.readdirSync(filesDir);
        for (const file of files) {
          const backupPath = path.join(filesDir, file);
          const originalPath = checkpoint.files.find(
            (f) => path.basename(f) === file
          );
          if (originalPath && fs.existsSync(backupPath)) {
            fs.copyFileSync(backupPath, originalPath);
          }
        }
      }

      logger.info(`Restored checkpoint: ${checkpointId}`);

      return {
        success: true,
        message: `Restored to checkpoint: ${checkpoint.description}`,
        data: {
          checkpointId,
          timestamp: new Date(checkpoint.timestamp).toISOString(),
          frameCount: checkpoint.metadata.frameCount,
          filesRestored: checkpoint.files.length,
        },
        action: `Restored checkpoint from ${new Date(checkpoint.timestamp).toLocaleString()}`,
      };
    } catch (error: unknown) {
      logger.error('Checkpoint restoration error:', error);
      return {
        success: false,
        message: `Failed to restore checkpoint: ${error.message}`,
      };
    }
  }

  async list(options?: { limit?: number; since?: Date }): Promise<SkillResult> {
    try {
      const files = fs
        .readdirSync(this.checkpointDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          const checkpointPath = path.join(this.checkpointDir, f);
          const checkpoint = JSON.parse(
            fs.readFileSync(checkpointPath, 'utf-8')
          );
          return checkpoint;
        })
        .filter((c) => !options?.since || c.timestamp > options.since.getTime())
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, options?.limit || 10);

      return {
        success: true,
        message: `Found ${files.length} checkpoints`,
        data: files.map((c) => ({
          id: c.id,
          description: c.description,
          timestamp: new Date(c.timestamp).toISOString(),
          frameCount: c.metadata.frameCount,
          risky: c.metadata.riskyOperation || false,
        })),
      };
    } catch (error: unknown) {
      logger.error('Checkpoint list error:', error);
      return {
        success: false,
        message: `Failed to list checkpoints: ${error.message}`,
      };
    }
  }

  async diff(checkpoint1: string, checkpoint2: string): Promise<SkillResult> {
    try {
      const cp1 = await this.loadCheckpoint(checkpoint1);
      const cp2 = await this.loadCheckpoint(checkpoint2);

      if (!cp1 || !cp2) {
        return {
          success: false,
          message: 'One or both checkpoints not found',
        };
      }

      const diff = {
        timeDiff: Math.abs(cp2.timestamp - cp1.timestamp),
        framesDiff: cp2.frames.length - cp1.frames.length,
        newFrames: cp2.frames.filter(
          (f2) => !cp1.frames.some((f1) => f1.frameId === f2.frameId)
        ),
        removedFrames: cp1.frames.filter(
          (f1) => !cp2.frames.some((f2) => f2.frameId === f1.frameId)
        ),
        modifiedFrames: cp2.frames.filter((f2) => {
          const f1 = cp1.frames.find((f) => f.frameId === f2.frameId);
          return f1 && JSON.stringify(f1) !== JSON.stringify(f2);
        }),
      };

      return {
        success: true,
        message: `Diff between ${cp1.description} and ${cp2.description}`,
        data: {
          timeDiff: `${Math.round(diff.timeDiff / 1000 / 60)} minutes`,
          framesDiff:
            diff.framesDiff > 0 ? `+${diff.framesDiff}` : `${diff.framesDiff}`,
          newFrames: diff.newFrames.length,
          removedFrames: diff.removedFrames.length,
          modifiedFrames: diff.modifiedFrames.length,
          details: diff,
        },
      };
    } catch (error: unknown) {
      logger.error('Checkpoint diff error:', error);
      return {
        success: false,
        message: `Failed to diff checkpoints: ${error.message}`,
      };
    }
  }

  private async loadCheckpoint(checkpointId: string): Promise<any> {
    const checkpointPath = path.join(
      this.checkpointDir,
      `${checkpointId}.json`
    );
    if (fs.existsSync(checkpointPath)) {
      return JSON.parse(fs.readFileSync(checkpointPath, 'utf-8'));
    }

    // Try partial match
    const files = fs.readdirSync(this.checkpointDir);
    const match = files.find((f) => f.includes(checkpointId));
    if (match) {
      const path = path.join(this.checkpointDir, match);
      return JSON.parse(fs.readFileSync(path, 'utf-8'));
    }

    return null;
  }
}

/**
 * Skill 2: Context Archaeologist
 * Deep historical context retrieval across sessions
 */
export class ArchaeologistSkill {
  constructor(private context: SkillContext) {}

  async dig(
    query: string,
    options?: {
      depth?: string; // e.g., "6months", "30days", "all"
      patterns?: boolean;
      decisions?: boolean;
      timeline?: boolean;
    }
  ): Promise<SkillResult> {
    try {
      // Parse depth
      const depth = this.parseDepth(options?.depth || '30days');
      const since = new Date(Date.now() - depth);

      // Use context retriever for semantic search
      const results = await this.context.contextRetriever.retrieve({
        query,
        projectId: this.context.projectId,
        limit: 50,
        minScore: 0.3,
      });

      // Filter by date if specified
      const filtered = results.filter(
        (r) => !depth || new Date(r.timestamp) > since
      );

      // Extract patterns if requested
      let patterns: any[] = [];
      if (options?.patterns) {
        patterns = this.extractPatterns(filtered);
      }

      // Extract decisions if requested
      let decisions: any[] = [];
      if (options?.decisions) {
        decisions = this.extractDecisions(filtered);
      }

      // Generate timeline if requested
      let timeline: any[] = [];
      if (options?.timeline) {
        timeline = this.generateTimeline(filtered);
      }

      // Find most relevant context
      const topResults = filtered.slice(0, 10);
      const summary = this.generateArchaeologySummary(
        topResults,
        patterns,
        decisions,
        timeline
      );

      return {
        success: true,
        message: `Found ${filtered.length} relevant results`,
        data: {
          totalResults: filtered.length,
          timeRange: {
            from: since.toISOString(),
            to: new Date().toISOString(),
          },
          topResults: topResults.map((r) => ({
            frameId: r.frameId,
            score: r.score,
            timestamp: r.timestamp,
            summary: r.content.slice(0, 100) + '...',
          })),
          patterns,
          decisions,
          timeline,
          summary,
        },
        action: `Analyzed ${filtered.length} frames from ${options?.depth || '30days'} of history`,
      };
    } catch (error: unknown) {
      logger.error('Archaeology skill error:', error);
      return {
        success: false,
        message: `Failed to dig through context: ${error.message}`,
      };
    }
  }

  private parseDepth(depth: string): number {
    const match = depth.match(/^(\d+)(days?|weeks?|months?|years?|all)$/i);
    if (!match) {
      return 30 * 24 * 60 * 60 * 1000; // Default 30 days
    }

    const [, num, unit] = match;
    const value = parseInt(num);

    switch (unit.toLowerCase()) {
      case 'day':
      case 'days':
        return value * 24 * 60 * 60 * 1000;
      case 'week':
      case 'weeks':
        return value * 7 * 24 * 60 * 60 * 1000;
      case 'month':
      case 'months':
        return value * 30 * 24 * 60 * 60 * 1000;
      case 'year':
      case 'years':
        return value * 365 * 24 * 60 * 60 * 1000;
      case 'all':
        return Number.MAX_SAFE_INTEGER;
      default:
        return 30 * 24 * 60 * 60 * 1000;
    }
  }

  private extractPatterns(results: any[]): any[] {
    const patterns: Map<string, number> = new Map();

    // Common patterns to look for
    const patternTypes = [
      { regex: /test.*then.*implement/i, name: 'TDD' },
      { regex: /refactor/i, name: 'Refactoring' },
      { regex: /debug|fix|error|bug/i, name: 'Debugging' },
      { regex: /implement.*feature/i, name: 'Feature Development' },
      { regex: /review|code review/i, name: 'Code Review' },
      { regex: /deploy|release/i, name: 'Deployment' },
      { regex: /optimize|performance/i, name: 'Optimization' },
    ];

    results.forEach((result) => {
      patternTypes.forEach((pattern) => {
        if (pattern.regex.test(result.content)) {
          patterns.set(pattern.name, (patterns.get(pattern.name) || 0) + 1);
        }
      });
    });

    return Array.from(patterns.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }

  private extractDecisions(results: any[]): any[] {
    const decisions: any[] = [];

    // Keywords that indicate decisions
    const decisionKeywords = [
      'decided',
      'chose',
      'selected',
      'will use',
      'going with',
      'approach',
      'strategy',
      'solution',
    ];

    results.forEach((result) => {
      const content = result.content.toLowerCase();
      if (decisionKeywords.some((keyword) => content.includes(keyword))) {
        // Extract sentence containing the decision
        const sentences = result.content.split(/[.!?]+/);
        const decisionSentence = sentences.find((s) =>
          decisionKeywords.some((k) => s.toLowerCase().includes(k))
        );

        if (decisionSentence) {
          decisions.push({
            frameId: result.frameId,
            timestamp: result.timestamp,
            decision: decisionSentence.trim(),
            context: result.content.slice(0, 200),
          });
        }
      }
    });

    return decisions.slice(0, 10); // Top 10 decisions
  }

  private generateTimeline(results: any[]): any[] {
    // Group by day
    const timeline: Map<string, any[]> = new Map();

    results.forEach((result) => {
      const date = new Date(result.timestamp).toDateString();
      if (!timeline.has(date)) {
        timeline.set(date, []);
      }
      timeline.get(date)!.push(result);
    });

    return Array.from(timeline.entries())
      .map(([date, items]) => ({
        date,
        itemCount: items.length,
        highlights: items.slice(0, 3).map((item) => ({
          frameId: item.frameId,
          summary: item.content.slice(0, 50) + '...',
        })),
      }))
      .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  }

  private generateArchaeologySummary(
    results: any[],
    patterns: any[],
    decisions: any[],
    timeline: any[]
  ): string {
    let summary = '## Context Archaeology Report\n\n';

    if (results.length > 0) {
      summary += `### Most Relevant Context (${results.length} results)\n`;
      results.slice(0, 3).forEach((r) => {
        summary += `- **${new Date(r.timestamp).toLocaleDateString()}**: ${r.content.slice(0, 100)}...\n`;
      });
      summary += '\n';
    }

    if (patterns.length > 0) {
      summary += `### Detected Patterns\n`;
      patterns.slice(0, 5).forEach((p) => {
        summary += `- ${p.name}: ${p.count} occurrences\n`;
      });
      summary += '\n';
    }

    if (decisions.length > 0) {
      summary += `### Key Decisions\n`;
      decisions.slice(0, 5).forEach((d) => {
        summary += `- **${new Date(d.timestamp).toLocaleDateString()}**: ${d.decision}\n`;
      });
      summary += '\n';
    }

    if (timeline.length > 0) {
      summary += `### Activity Timeline\n`;
      timeline.slice(0, 5).forEach((t) => {
        summary += `- **${t.date}**: ${t.itemCount} activities\n`;
      });
    }

    return summary;
  }
}

/**
 * Main Claude Skills Manager
 */
export class ClaudeSkillsManager {
  private handoffSkill: HandoffSkill;
  private checkpointSkill: CheckpointSkill;
  private archaeologistSkill: ArchaeologistSkill;
  private dashboardLauncher: any; // DashboardLauncherSkill
  private repoIngestionSkill: RepoIngestionSkill | null = null;

  constructor(private context: SkillContext) {
    this.handoffSkill = new HandoffSkill(context);
    this.checkpointSkill = new CheckpointSkill(context);
    this.archaeologistSkill = new ArchaeologistSkill(context);

    // Initialize dashboard launcher (lazy import to avoid circular deps)
    import('./dashboard-launcher.js').then((module) => {
      this.dashboardLauncher = new module.DashboardLauncherSkill();
      // Auto-launch on session start
      this.dashboardLauncher.launch().catch((error: any) => {
        logger.warn('Dashboard auto-launch failed:', error);
      });
    });

    // Initialize repo ingestion skill if ChromaDB is configured
    const chromaConfig = {
      apiKey: process.env['CHROMADB_API_KEY'] || '',
      tenant: process.env['CHROMADB_TENANT'] || '',
      database: process.env['CHROMADB_DATABASE'] || 'stackmemory',
      collectionName: process.env['CHROMADB_COLLECTION'] || 'stackmemory_repos',
    };

    if (chromaConfig.apiKey && chromaConfig.tenant) {
      this.repoIngestionSkill = new RepoIngestionSkill(
        chromaConfig,
        context.userId,
        process.env['CHROMADB_TEAM_ID']
      );
      this.repoIngestionSkill.initialize().catch((error: any) => {
        logger.warn('Repo ingestion skill initialization failed:', error);
      });
    }
  }

  async executeSkill(
    skillName: string,
    args: string[],
    options?: Record<string, any>
  ): Promise<SkillResult> {
    switch (skillName) {
      case 'handoff':
        return this.handoffSkill.execute(args[0], args[1], options);

      case 'checkpoint':
        const subcommand = args[0];
        switch (subcommand) {
          case 'create':
            return this.checkpointSkill.create(args[1], options);
          case 'restore':
            return this.checkpointSkill.restore(args[1]);
          case 'list':
            return this.checkpointSkill.list(options);
          case 'diff':
            return this.checkpointSkill.diff(args[1], args[2]);
          default:
            return {
              success: false,
              message: `Unknown checkpoint subcommand: ${subcommand}`,
            };
        }

      case 'dig':
        return this.archaeologistSkill.dig(args[0], options);

      case 'repo':
      case 'ingest':
        if (!this.repoIngestionSkill) {
          return {
            success: false,
            message:
              'Repo ingestion skill not initialized. Please configure ChromaDB.',
          };
        }

        const repoCommand = args[0];
        switch (repoCommand) {
          case 'ingest':
            const repoPath = args[1] || process.cwd();
            const repoName = args[2] || path.basename(repoPath);
            return await this.repoIngestionSkill.ingestRepository(
              repoPath,
              repoName,
              options as RepoIngestionOptions
            );

          case 'update':
            const updatePath = args[1] || process.cwd();
            const updateName = args[2] || path.basename(updatePath);
            return await this.repoIngestionSkill.updateRepository(
              updatePath,
              updateName,
              options as RepoIngestionOptions
            );

          case 'search':
            const query = args[1];
            if (!query) {
              return {
                success: false,
                message: 'Search query required',
              };
            }
            const results = await this.repoIngestionSkill.searchCode(query, {
              repoName: options?.repoName as string,
              language: options?.language as string,
              limit: options?.limit as number,
              includeContext: options?.includeContext as boolean,
            });
            return {
              success: true,
              message: `Found ${results.length} results`,
              data: results,
            };

          case 'stats':
            const stats = await this.repoIngestionSkill.getRepoStats(args[1]);
            return {
              success: true,
              message: 'Repository statistics',
              data: stats,
            };

          default:
            return {
              success: false,
              message: `Unknown repo command: ${repoCommand}. Use: ingest, update, search, or stats`,
            };
        }

      case 'dashboard':
        const dashboardCmd = args[0];
        if (!this.dashboardLauncher) {
          return {
            success: false,
            message: 'Dashboard launcher not yet initialized',
          };
        }
        switch (dashboardCmd) {
          case 'launch':
            await this.dashboardLauncher.launch();
            return {
              success: true,
              message: 'Dashboard launched',
              action: 'open-browser',
            };
          case 'stop':
            await this.dashboardLauncher.stop();
            return {
              success: true,
              message: 'Dashboard stopped',
            };
          default:
            await this.dashboardLauncher.launch();
            return {
              success: true,
              message: 'Dashboard launched',
              action: 'open-browser',
            };
        }

      default:
        return {
          success: false,
          message: `Unknown skill: ${skillName}`,
        };
    }
  }

  getAvailableSkills(): string[] {
    const skills = ['handoff', 'checkpoint', 'dig', 'dashboard'];
    if (this.repoIngestionSkill) {
      skills.push('repo');
    }
    return skills;
  }

  getSkillHelp(skillName: string): string {
    switch (skillName) {
      case 'handoff':
        return `
/handoff @user "message" [--priority high] [--frames frame1,frame2]
Streamline frame handoffs between team members
`;

      case 'checkpoint':
        return `
/checkpoint create "description" [--files file1,file2] [--auto-detect-risky]
/checkpoint restore <id>
/checkpoint list [--limit 10] [--since "2024-01-01"]
/checkpoint diff <id1> <id2>
Create and manage recovery points
`;

      case 'dig':
        return `
/dig "query" [--depth 6months] [--patterns] [--decisions] [--timeline]
Deep historical context retrieval across sessions
`;

      case 'dashboard':
        return `
/dashboard [launch|stop]
Launch the StackMemory web dashboard for real-time monitoring
- launch: Start the web dashboard and open in browser (default)
- stop: Stop the dashboard server
Auto-launches on new sessions when configured
`;

      case 'repo':
        return `
/repo ingest [path] [name] [--incremental] [--include-tests] [--include-docs]
/repo update [path] [name] [--force-update]
/repo search "query" [--repo-name name] [--language lang] [--limit n]
/repo stats [repo-name]

Ingest and search code repositories in ChromaDB:
- ingest: Index a new repository (defaults to current directory)
- update: Update an existing repository with changes
- search: Semantic search across ingested code
- stats: View statistics about ingested repositories

Options:
- --incremental: Only process changed files
- --include-tests: Include test files in indexing
- --include-docs: Include documentation files
- --force-update: Force re-indexing of all files
- --language: Filter search by programming language
- --limit: Maximum search results (default: 20)
`;

      default:
        return `Unknown skill: ${skillName}`;
    }
  }
}
