/**
 * Frame Recovery System
 * Handles crash recovery, integrity checks, and orphan cleanup
 *
 * Key responsibilities:
 * 1. Verify database integrity on startup
 * 2. Detect orphaned frames from crashed sessions
 * 3. Recover or close orphaned frames
 * 4. Provide data integrity validation
 */

import Database from 'better-sqlite3';
import { logger } from '../monitoring/logger.js';

export interface RecoveryReport {
  timestamp: string;
  integrityCheck: IntegrityCheckResult;
  orphanedFrames: OrphanedFrameResult;
  walStatus: WalStatus;
  recovered: boolean;
  errors: string[];
}

export interface IntegrityCheckResult {
  passed: boolean;
  foreignKeyViolations: number;
  corruptedRows: number;
  errors: string[];
}

export interface OrphanedFrameResult {
  detected: number;
  recovered: number;
  closed: number;
  frameIds: string[];
}

export interface WalStatus {
  enabled: boolean;
  checkpointNeeded: boolean;
  walSize: number;
}

interface OrphanedFrameRow {
  frame_id: string;
  run_id: string;
  project_id: string;
  name: string;
  type: string;
  created_at: number;
  depth: number;
}

interface ForeignKeyViolation {
  table: string;
  rowid: number;
  parent: string;
  fkid: number;
}

interface IntegrityRow {
  integrity_check: string;
}

interface WalRow {
  busy: number;
  log: number;
  checkpointed: number;
}

interface JournalModeRow {
  journal_mode: string;
}

/**
 * Frame Recovery Manager
 * Call recoverOnStartup() when initializing StackMemory
 */
export class FrameRecovery {
  // Sessions older than this are considered orphaned (default: 24 hours)
  private orphanThresholdMs: number;
  // Current session/run ID to exclude from orphan detection
  private currentRunId: string | null = null;

  constructor(
    private db: Database.Database,
    options: { orphanThresholdHours?: number } = {}
  ) {
    this.orphanThresholdMs =
      (options.orphanThresholdHours ?? 24) * 60 * 60 * 1000;
  }

  /**
   * Set the current run ID to exclude from orphan detection
   */
  setCurrentRunId(runId: string): void {
    this.currentRunId = runId;
  }

  /**
   * Main recovery entry point - call on startup
   */
  async recoverOnStartup(): Promise<RecoveryReport> {
    const errors: string[] = [];
    const timestamp = new Date().toISOString();

    logger.info('Starting crash recovery check');

    // 1. Check WAL status and checkpoint if needed
    const walStatus = this.checkWalStatus();
    if (walStatus.checkpointNeeded) {
      try {
        this.checkpointWal();
        logger.info('WAL checkpoint completed');
      } catch (err) {
        const msg = `WAL checkpoint failed: ${err instanceof Error ? err.message : String(err)}`;
        errors.push(msg);
        logger.warn(msg);
      }
    }

    // 2. Run integrity check
    const integrityCheck = this.runIntegrityCheck();
    if (!integrityCheck.passed) {
      logger.error('Database integrity check failed', {
        violations: integrityCheck.foreignKeyViolations,
        corrupted: integrityCheck.corruptedRows,
      });
    }

    // 3. Detect and handle orphaned frames
    const orphanedFrames = this.recoverOrphanedFrames();
    if (orphanedFrames.detected > 0) {
      logger.info('Orphaned frames processed', {
        detected: orphanedFrames.detected,
        recovered: orphanedFrames.recovered,
        closed: orphanedFrames.closed,
      });
    }

    const report: RecoveryReport = {
      timestamp,
      integrityCheck,
      orphanedFrames,
      walStatus,
      recovered:
        integrityCheck.passed &&
        orphanedFrames.detected === orphanedFrames.closed,
      errors,
    };

    logger.info('Crash recovery completed', {
      recovered: report.recovered,
      orphansFound: orphanedFrames.detected,
      integrityPassed: integrityCheck.passed,
    });

    return report;
  }

  /**
   * Check WAL mode status
   */
  checkWalStatus(): WalStatus {
    try {
      const journalMode = this.db.pragma('journal_mode') as JournalModeRow[];
      const isWal = journalMode[0]?.journal_mode === 'wal';

      if (!isWal) {
        return { enabled: false, checkpointNeeded: false, walSize: 0 };
      }

      // Check WAL size
      const walInfo = this.db.pragma('wal_checkpoint(PASSIVE)') as WalRow[];
      const walSize = walInfo[0]?.log ?? 0;
      const checkpointed = walInfo[0]?.checkpointed ?? 0;

      return {
        enabled: true,
        checkpointNeeded: walSize > 1000, // Checkpoint if WAL has > 1000 pages
        walSize: walSize - checkpointed,
      };
    } catch (err) {
      logger.warn('Failed to check WAL status', { error: err });
      return { enabled: false, checkpointNeeded: false, walSize: 0 };
    }
  }

  /**
   * Force WAL checkpoint
   */
  checkpointWal(): void {
    this.db.pragma('wal_checkpoint(TRUNCATE)');
  }

  /**
   * Run database integrity checks
   */
  runIntegrityCheck(): IntegrityCheckResult {
    const errors: string[] = [];
    let foreignKeyViolations = 0;
    let corruptedRows = 0;

    try {
      // Check foreign key constraints
      const fkViolations = this.db.pragma(
        'foreign_key_check'
      ) as ForeignKeyViolation[];
      foreignKeyViolations = fkViolations.length;

      if (foreignKeyViolations > 0) {
        errors.push(`Found ${foreignKeyViolations} foreign key violations`);
        logger.warn('Foreign key violations detected', {
          count: foreignKeyViolations,
          samples: fkViolations.slice(0, 5),
        });
      }

      // Run integrity check
      const integrity = this.db.pragma('integrity_check') as IntegrityRow[];
      const integrityResult = integrity[0]?.integrity_check;

      if (integrityResult !== 'ok') {
        corruptedRows = integrity.length;
        errors.push(`Integrity check failed: ${integrityResult}`);
        logger.error('Database corruption detected', {
          result: integrityResult,
        });
      }
    } catch (err) {
      errors.push(
        `Integrity check error: ${err instanceof Error ? err.message : String(err)}`
      );
    }

    return {
      passed: foreignKeyViolations === 0 && corruptedRows === 0,
      foreignKeyViolations,
      corruptedRows,
      errors,
    };
  }

  /**
   * Detect and recover orphaned frames
   * Orphaned = active frames from sessions that are no longer running
   */
  recoverOrphanedFrames(): OrphanedFrameResult {
    const orphanThreshold = Date.now() - this.orphanThresholdMs;
    const thresholdUnix = Math.floor(orphanThreshold / 1000);

    // Find active frames older than threshold (likely from crashed sessions)
    const query = `
      SELECT frame_id, run_id, project_id, name, type, created_at, depth
      FROM frames
      WHERE state = 'active'
        AND created_at < ?
        ${this.currentRunId ? 'AND run_id != ?' : ''}
      ORDER BY created_at ASC
    `;

    const params = this.currentRunId
      ? [thresholdUnix, this.currentRunId]
      : [thresholdUnix];

    const orphaned = this.db
      .prepare(query)
      .all(...params) as OrphanedFrameRow[];

    if (orphaned.length === 0) {
      return { detected: 0, recovered: 0, closed: 0, frameIds: [] };
    }

    const frameIds = orphaned.map((f) => f.frame_id);
    let closed = 0;

    // Close orphaned frames with a "recovered" state marker
    const closeStmt = this.db.prepare(`
      UPDATE frames
      SET state = 'closed',
          closed_at = unixepoch(),
          outputs = json_set(COALESCE(outputs, '{}'), '$.recovered', true, '$.recoveryReason', 'orphan_cleanup')
      WHERE frame_id = ?
    `);

    const transaction = this.db.transaction(() => {
      for (const frame of orphaned) {
        try {
          closeStmt.run(frame.frame_id);
          closed++;
          logger.debug('Closed orphaned frame', {
            frameId: frame.frame_id,
            runId: frame.run_id,
            name: frame.name,
            age:
              Math.round((Date.now() / 1000 - frame.created_at) / 3600) + 'h',
          });
        } catch (err) {
          logger.warn('Failed to close orphaned frame', {
            frameId: frame.frame_id,
            error: err,
          });
        }
      }
    });

    transaction();

    return {
      detected: orphaned.length,
      recovered: 0, // Future: could attempt to resume some frames
      closed,
      frameIds,
    };
  }

  /**
   * Validate data integrity for a specific project
   */
  validateProjectIntegrity(projectId: string): {
    valid: boolean;
    issues: string[];
  } {
    const issues: string[] = [];

    // Check for frames with invalid parent references
    const invalidParents = this.db
      .prepare(
        `
      SELECT f1.frame_id, f1.parent_frame_id
      FROM frames f1
      LEFT JOIN frames f2 ON f1.parent_frame_id = f2.frame_id
      WHERE f1.project_id = ?
        AND f1.parent_frame_id IS NOT NULL
        AND f2.frame_id IS NULL
    `
      )
      .all(projectId) as Array<{ frame_id: string; parent_frame_id: string }>;

    if (invalidParents.length > 0) {
      issues.push(
        `${invalidParents.length} frames with invalid parent references`
      );
    }

    // Check for depth inconsistencies
    const depthIssues = this.db
      .prepare(
        `
      SELECT f1.frame_id, f1.depth as child_depth, f2.depth as parent_depth
      FROM frames f1
      JOIN frames f2 ON f1.parent_frame_id = f2.frame_id
      WHERE f1.project_id = ?
        AND f1.depth != f2.depth + 1
    `
      )
      .all(projectId) as Array<{
      frame_id: string;
      child_depth: number;
      parent_depth: number;
    }>;

    if (depthIssues.length > 0) {
      issues.push(`${depthIssues.length} frames with incorrect depth values`);
    }

    // Check for events without valid frames
    const orphanEvents = this.db
      .prepare(
        `
      SELECT COUNT(*) as count
      FROM events e
      LEFT JOIN frames f ON e.frame_id = f.frame_id
      WHERE f.frame_id IS NULL
    `
      )
      .get() as { count: number };

    if (orphanEvents.count > 0) {
      issues.push(`${orphanEvents.count} orphaned events without valid frames`);
    }

    return {
      valid: issues.length === 0,
      issues,
    };
  }

  /**
   * Clean up orphaned events (events without valid frames)
   */
  cleanupOrphanedEvents(): number {
    const result = this.db
      .prepare(
        `
      DELETE FROM events
      WHERE frame_id NOT IN (SELECT frame_id FROM frames)
    `
      )
      .run();

    if (result.changes > 0) {
      logger.info('Cleaned up orphaned events', { count: result.changes });
    }

    return result.changes;
  }

  /**
   * Get recovery statistics
   */
  getRecoveryStats(): {
    totalFrames: number;
    activeFrames: number;
    closedFrames: number;
    recoveredFrames: number;
    oldestActiveFrame: string | null;
  } {
    const stats = this.db
      .prepare(
        `
      SELECT
        COUNT(*) as total,
        SUM(CASE WHEN state = 'active' THEN 1 ELSE 0 END) as active,
        SUM(CASE WHEN state = 'closed' THEN 1 ELSE 0 END) as closed,
        SUM(CASE WHEN json_extract(outputs, '$.recovered') = true THEN 1 ELSE 0 END) as recovered
      FROM frames
    `
      )
      .get() as {
      total: number;
      active: number;
      closed: number;
      recovered: number;
    };

    const oldest = this.db
      .prepare(
        `
      SELECT datetime(created_at, 'unixepoch') as created
      FROM frames
      WHERE state = 'active'
      ORDER BY created_at ASC
      LIMIT 1
    `
      )
      .get() as { created: string } | undefined;

    return {
      totalFrames: stats.total,
      activeFrames: stats.active,
      closedFrames: stats.closed,
      recoveredFrames: stats.recovered,
      oldestActiveFrame: oldest?.created ?? null,
    };
  }
}

/**
 * Convenience function to run recovery on a database
 */
export async function recoverDatabase(
  db: Database.Database,
  currentRunId?: string
): Promise<RecoveryReport> {
  const recovery = new FrameRecovery(db);
  if (currentRunId) {
    recovery.setCurrentRunId(currentRunId);
  }
  return recovery.recoverOnStartup();
}
