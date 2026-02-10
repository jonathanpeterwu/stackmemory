/**
 * Tool Scoring Middleware for MCP
 * Integrates ConfigManager weight profiles with tool execution
 */

import { ConfigManager } from '../../../core/config/config-manager.js';
import { TraceDetector } from '../../../core/trace/trace-detector.js';
import { ToolCall } from '../../../core/trace/types.js';
import { logger } from '../../../core/monitoring/logger.js';
import { v4 as uuidv4 } from 'uuid';
import Database from 'better-sqlite3';

export interface ToolScoringMetrics {
  profileName: string;
  toolName: string;
  score: number;
  factors: {
    filesAffected: number;
    isPermanent: boolean;
    referenceCount: number;
  };
  timestamp: number;
}

export interface ProfileUsageStats {
  profileName: string;
  usageCount: number;
  totalScore: number;
  avgScore: number;
  highScoreTools: string[];
  lastUsed: number;
}

/**
 * Middleware for scoring tool calls and tracking profile effectiveness
 */
export class ToolScoringMiddleware {
  private configManager: ConfigManager;
  private traceDetector: TraceDetector;
  private metrics: ToolScoringMetrics[] = [];
  private profileStats: Map<string, ProfileUsageStats> = new Map();
  private db?: Database.Database;

  constructor(
    configManager?: ConfigManager,
    traceDetector?: TraceDetector,
    db?: Database.Database
  ) {
    this.configManager = configManager || new ConfigManager();
    this.traceDetector = traceDetector || new TraceDetector();
    this.db = db;

    this.initializeDatabase();
    this.loadMetrics();
  }

  /**
   * Initialize database tables for metrics
   */
  private initializeDatabase(): void {
    if (!this.db) return;

    // Create metrics table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tool_scoring_metrics (
        id TEXT PRIMARY KEY,
        profile_name TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        score REAL NOT NULL,
        files_affected INTEGER DEFAULT 0,
        is_permanent BOOLEAN DEFAULT FALSE,
        reference_count INTEGER DEFAULT 0,
        timestamp INTEGER NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create profile stats table
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profile_usage_stats (
        profile_name TEXT PRIMARY KEY,
        usage_count INTEGER DEFAULT 0,
        total_score REAL DEFAULT 0,
        avg_score REAL DEFAULT 0,
        high_score_tools TEXT,
        last_used INTEGER,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Create indexes
    this.db.exec(`
      CREATE INDEX IF NOT EXISTS idx_metrics_profile ON tool_scoring_metrics(profile_name);
      CREATE INDEX IF NOT EXISTS idx_metrics_tool ON tool_scoring_metrics(tool_name);
      CREATE INDEX IF NOT EXISTS idx_metrics_timestamp ON tool_scoring_metrics(timestamp);
    `);
  }

  /**
   * Load existing metrics from database
   */
  private loadMetrics(): void {
    if (!this.db) return;

    try {
      // Load recent metrics (last 7 days)
      const cutoff = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const stmt = this.db.prepare(`
        SELECT * FROM tool_scoring_metrics 
        WHERE timestamp > ? 
        ORDER BY timestamp DESC
      `);

      const rows = stmt.all(cutoff) as Array<{
        profile_name: string;
        tool_name: string;
        score: number;
        files_affected: number;
        is_permanent: number;
        reference_count: number;
        timestamp: number;
      }>;
      this.metrics = rows.map((row) => ({
        profileName: row.profile_name,
        toolName: row.tool_name,
        score: row.score,
        factors: {
          filesAffected: row.files_affected,
          isPermanent: row.is_permanent === 1,
          referenceCount: row.reference_count,
        },
        timestamp: row.timestamp,
      }));

      // Load profile stats
      const statsStmt = this.db.prepare(`
        SELECT * FROM profile_usage_stats
      `);

      const statsRows = statsStmt.all() as Array<{
        profile_name: string;
        usage_count: number;
        total_score: number;
        avg_score: number;
        high_score_tools: string | null;
        last_used: number;
      }>;
      statsRows.forEach((row) => {
        this.profileStats.set(row.profile_name, {
          profileName: row.profile_name,
          usageCount: row.usage_count,
          totalScore: row.total_score,
          avgScore: row.avg_score,
          highScoreTools: row.high_score_tools
            ? JSON.parse(row.high_score_tools)
            : [],
          lastUsed: row.last_used,
        });
      });

      logger.info('Loaded tool scoring metrics', {
        metricsCount: this.metrics.length,
        profilesCount: this.profileStats.size,
      });
    } catch (error: unknown) {
      logger.error('Failed to load metrics', error);
    }
  }

  /**
   * Score a tool call and track it
   */
  async scoreToolCall(
    toolName: string,
    args: any,
    result?: any,
    error?: string
  ): Promise<number> {
    // Extract factors from arguments and result
    const factors = this.extractScoringFactors(toolName, args, result);

    // Calculate score using current profile
    const score = this.configManager.calculateScore(toolName, factors);

    // Get current profile name
    const config = this.configManager.getConfig();
    const profileName = config.profile || 'default';

    // Track the metric
    const metric: ToolScoringMetrics = {
      profileName,
      toolName,
      score,
      factors,
      timestamp: Date.now(),
    };

    this.metrics.push(metric);
    this.updateProfileStats(profileName, toolName, score);

    // Save to database
    this.saveMetric(metric);

    // Add to trace detector if significant
    if (score > 0.3) {
      const toolCall: ToolCall = {
        id: uuidv4(),
        tool: toolName,
        arguments: args,
        timestamp: Date.now(),
        result,
        error,
        filesAffected:
          factors.filesAffected > 0 ? this.getFilesFromArgs(args) : undefined,
      };

      this.traceDetector.addToolCall(toolCall);
    }

    // Log high-importance operations
    if (score > 0.8) {
      logger.warn('High-importance tool call', {
        tool: toolName,
        score,
        profile: profileName,
        factors,
      });
    }

    return score;
  }

  /**
   * Extract scoring factors from tool arguments and results
   */
  private extractScoringFactors(
    toolName: string,
    args: any,
    result?: any
  ): { filesAffected: number; isPermanent: boolean; referenceCount: number } {
    let filesAffected = 0;
    let isPermanent = false;
    let referenceCount = 0;

    // Check for file-related arguments
    if (args.file || args.files || args.path || args.paths) {
      filesAffected = 1;
      if (args.files || args.paths) {
        filesAffected = Array.isArray(args.files || args.paths)
          ? (args.files || args.paths).length
          : 1;
      }
    }

    // Check if tool makes permanent changes
    const permanentTools = [
      'write',
      'edit',
      'create',
      'delete',
      'update',
      'add_decision',
      'create_task',
      'linear_update_task',
    ];

    if (permanentTools.some((t) => toolName.includes(t))) {
      isPermanent = true;
    }

    // Extract reference count from result if available
    if (result?.referenceCount !== undefined) {
      referenceCount = result.referenceCount;
    } else if (result?.references?.length) {
      referenceCount = result.references.length;
    }

    return { filesAffected, isPermanent, referenceCount };
  }

  /**
   * Get file paths from arguments
   */
  private getFilesFromArgs(args: any): string[] {
    const files: string[] = [];

    if (args.file) files.push(args.file);
    if (args.path) files.push(args.path);
    if (args.files && Array.isArray(args.files)) files.push(...args.files);
    if (args.paths && Array.isArray(args.paths)) files.push(...args.paths);

    return files;
  }

  /**
   * Update profile usage statistics
   */
  private updateProfileStats(
    profileName: string,
    toolName: string,
    score: number
  ): void {
    let stats = this.profileStats.get(profileName);

    if (!stats) {
      stats = {
        profileName,
        usageCount: 0,
        totalScore: 0,
        avgScore: 0,
        highScoreTools: [],
        lastUsed: Date.now(),
      };
      this.profileStats.set(profileName, stats);
    }

    stats.usageCount++;
    stats.totalScore += score;
    stats.avgScore = stats.totalScore / stats.usageCount;
    stats.lastUsed = Date.now();

    // Track high-score tools
    if (score > 0.7 && !stats.highScoreTools.includes(toolName)) {
      stats.highScoreTools.push(toolName);
      if (stats.highScoreTools.length > 10) {
        stats.highScoreTools.shift(); // Keep only last 10
      }
    }

    this.saveProfileStats(stats);
  }

  /**
   * Save metric to database
   */
  private saveMetric(metric: ToolScoringMetrics): void {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        INSERT INTO tool_scoring_metrics (
          id, profile_name, tool_name, score,
          files_affected, is_permanent, reference_count,
          timestamp
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        uuidv4(),
        metric.profileName,
        metric.toolName,
        metric.score,
        metric.factors.filesAffected,
        metric.factors.isPermanent ? 1 : 0,
        metric.factors.referenceCount,
        metric.timestamp
      );
    } catch (error: unknown) {
      logger.error('Failed to save metric', error);
    }
  }

  /**
   * Save profile stats to database
   */
  private saveProfileStats(stats: ProfileUsageStats): void {
    if (!this.db) return;

    try {
      const stmt = this.db.prepare(`
        INSERT OR REPLACE INTO profile_usage_stats (
          profile_name, usage_count, total_score, avg_score,
          high_score_tools, last_used
        ) VALUES (?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        stats.profileName,
        stats.usageCount,
        stats.totalScore,
        stats.avgScore,
        JSON.stringify(stats.highScoreTools),
        stats.lastUsed
      );
    } catch (error: unknown) {
      logger.error('Failed to save profile stats', error);
    }
  }

  /**
   * Get profile effectiveness report
   */
  getProfileReport(profileName?: string): any {
    if (profileName) {
      const stats = this.profileStats.get(profileName);
      if (!stats) {
        return { error: `Profile '${profileName}' not found or not used yet` };
      }

      return {
        profile: profileName,
        usage: stats.usageCount,
        avgScore: stats.avgScore.toFixed(3),
        highScoreTools: stats.highScoreTools,
        lastUsed: new Date(stats.lastUsed).toISOString(),
      };
    }

    // Return report for all profiles
    const profiles = Array.from(this.profileStats.values()).sort(
      (a, b) => b.avgScore - a.avgScore
    );

    return {
      profileCount: profiles.length,
      mostEffective: profiles[0]?.profileName || 'none',
      profiles: profiles.map((p: any) => ({
        name: p.profileName,
        usage: p.usageCount,
        avgScore: p.avgScore.toFixed(3),
      })),
    };
  }

  /**
   * Get tool scoring trends
   */
  getToolTrends(toolName: string, hours: number = 24): any {
    const cutoff = Date.now() - hours * 60 * 60 * 1000;
    const relevantMetrics = this.metrics.filter(
      (m: any) => m.toolName === toolName && m.timestamp > cutoff
    );

    if (relevantMetrics.length === 0) {
      return { tool: toolName, message: 'No recent data' };
    }

    const scores = relevantMetrics.map((m: any) => m.score);
    const avgScore = scores.reduce((a, b) => a + b, 0) / scores.length;
    const maxScore = Math.max(...scores);
    const minScore = Math.min(...scores);

    return {
      tool: toolName,
      period: `${hours}h`,
      count: relevantMetrics.length,
      avgScore: avgScore.toFixed(3),
      maxScore: maxScore.toFixed(3),
      minScore: minScore.toFixed(3),
      trend: this.calculateTrend(relevantMetrics),
    };
  }

  /**
   * Calculate score trend
   */
  private calculateTrend(metrics: ToolScoringMetrics[]): string {
    if (metrics.length < 2) return 'stable';

    const firstHalf = metrics.slice(0, Math.floor(metrics.length / 2));
    const secondHalf = metrics.slice(Math.floor(metrics.length / 2));

    const firstAvg =
      firstHalf.reduce((a, m) => a + m.score, 0) / firstHalf.length;
    const secondAvg =
      secondHalf.reduce((a, m) => a + m.score, 0) / secondHalf.length;

    const diff = secondAvg - firstAvg;

    if (diff > 0.1) return 'increasing';
    if (diff < -0.1) return 'decreasing';
    return 'stable';
  }

  /**
   * Clean old metrics
   */
  cleanOldMetrics(daysToKeep: number = 30): number {
    const cutoff = Date.now() - daysToKeep * 24 * 60 * 60 * 1000;
    const oldCount = this.metrics.length;

    this.metrics = this.metrics.filter((m: any) => m.timestamp > cutoff);

    if (this.db) {
      try {
        const stmt = this.db.prepare(`
          DELETE FROM tool_scoring_metrics WHERE timestamp < ?
        `);
        stmt.run(cutoff);
      } catch (error: unknown) {
        logger.error('Failed to clean old metrics', error);
      }
    }

    return oldCount - this.metrics.length;
  }
}
