/**
 * Retrieval Audit Store
 * Records retrieval decisions for auditing and debugging
 */

import Database from 'better-sqlite3';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '../monitoring/logger.js';
import { LLMAnalysisResponse } from './types.js';

/**
 * A single retrieval audit entry
 */
export interface RetrievalAuditEntry {
  id: string;
  timestamp: number;
  projectId: string;
  query: string;
  reasoning: string;
  framesRetrieved: string[];
  confidenceScore: number;
  provider: 'anthropic' | 'heuristic' | 'cached';
  tokensUsed: number;
  tokenBudget: number;
  analysisTimeMs: number;
  queryComplexity: 'simple' | 'moderate' | 'complex';
}

/**
 * Stores retrieval audit entries for later inspection
 */
export class RetrievalAuditStore {
  private db: Database.Database;
  private projectId: string;
  private initialized = false;

  constructor(db: Database.Database, projectId: string) {
    this.db = db;
    this.projectId = projectId;
    this.initSchema();
  }

  /**
   * Initialize the audit table schema
   */
  private initSchema(): void {
    if (this.initialized) return;

    try {
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS retrieval_audit (
          id TEXT PRIMARY KEY,
          timestamp INTEGER NOT NULL,
          project_id TEXT NOT NULL,
          query TEXT NOT NULL,
          reasoning TEXT NOT NULL,
          frames_retrieved TEXT NOT NULL,
          confidence_score REAL NOT NULL,
          provider TEXT NOT NULL,
          tokens_used INTEGER NOT NULL,
          token_budget INTEGER NOT NULL,
          analysis_time_ms INTEGER NOT NULL,
          query_complexity TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_retrieval_audit_project_time
        ON retrieval_audit(project_id, timestamp DESC);

        CREATE INDEX IF NOT EXISTS idx_retrieval_audit_query
        ON retrieval_audit(project_id, query);
      `);

      this.initialized = true;
      logger.debug('Retrieval audit schema initialized');
    } catch (error) {
      logger.warn('Failed to initialize retrieval audit schema', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  /**
   * Record a retrieval decision
   */
  record(
    query: string,
    analysis: LLMAnalysisResponse,
    options: {
      tokensUsed: number;
      tokenBudget: number;
      provider: 'anthropic' | 'heuristic' | 'cached';
    }
  ): string {
    const id = uuidv4();
    const timestamp = Date.now();

    try {
      const stmt = this.db.prepare(`
        INSERT INTO retrieval_audit (
          id, timestamp, project_id, query, reasoning, frames_retrieved,
          confidence_score, provider, tokens_used, token_budget,
          analysis_time_ms, query_complexity
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      stmt.run(
        id,
        timestamp,
        this.projectId,
        query,
        analysis.reasoning,
        JSON.stringify(analysis.framesToRetrieve.map((f) => f.frameId)),
        analysis.confidenceScore,
        options.provider,
        options.tokensUsed,
        options.tokenBudget,
        analysis.metadata.analysisTimeMs,
        analysis.metadata.queryComplexity
      );

      logger.debug('Recorded retrieval audit entry', {
        id,
        query: query.slice(0, 50),
      });
      return id;
    } catch (error) {
      logger.warn('Failed to record retrieval audit', {
        error: error instanceof Error ? error.message : String(error),
      });
      return id; // Return ID even on failure
    }
  }

  /**
   * Get recent retrieval audit entries
   */
  getRecent(limit = 10): RetrievalAuditEntry[] {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM retrieval_audit
        WHERE project_id = ?
        ORDER BY timestamp DESC
        LIMIT ?
      `);

      const rows = stmt.all(this.projectId, limit) as any[];
      return rows.map(this.rowToEntry);
    } catch (error) {
      logger.warn('Failed to get recent audit entries', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Get audit entry by ID
   */
  getById(id: string): RetrievalAuditEntry | null {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM retrieval_audit WHERE id = ?
      `);

      const row = stmt.get(id) as any;
      return row ? this.rowToEntry(row) : null;
    } catch (error) {
      logger.warn('Failed to get audit entry', {
        error: error instanceof Error ? error.message : String(error),
        id,
      });
      return null;
    }
  }

  /**
   * Search audit entries by query text
   */
  searchByQuery(searchTerm: string, limit = 10): RetrievalAuditEntry[] {
    try {
      const stmt = this.db.prepare(`
        SELECT * FROM retrieval_audit
        WHERE project_id = ? AND query LIKE ?
        ORDER BY timestamp DESC
        LIMIT ?
      `);

      const rows = stmt.all(this.projectId, `%${searchTerm}%`, limit) as any[];
      return rows.map(this.rowToEntry);
    } catch (error) {
      logger.warn('Failed to search audit entries', {
        error: error instanceof Error ? error.message : String(error),
      });
      return [];
    }
  }

  /**
   * Get statistics about retrieval patterns
   */
  getStats(): {
    totalRetrievals: number;
    avgConfidence: number;
    providerBreakdown: Record<string, number>;
    avgTokensUsed: number;
    avgAnalysisTime: number;
  } {
    try {
      const statsStmt = this.db.prepare(`
        SELECT
          COUNT(*) as total,
          AVG(confidence_score) as avg_confidence,
          AVG(tokens_used) as avg_tokens,
          AVG(analysis_time_ms) as avg_time
        FROM retrieval_audit
        WHERE project_id = ?
      `);

      const providerStmt = this.db.prepare(`
        SELECT provider, COUNT(*) as count
        FROM retrieval_audit
        WHERE project_id = ?
        GROUP BY provider
      `);

      const stats = statsStmt.get(this.projectId) as any;
      const providers = providerStmt.all(this.projectId) as any[];

      const providerBreakdown: Record<string, number> = {};
      for (const p of providers) {
        providerBreakdown[p.provider] = p.count;
      }

      return {
        totalRetrievals: stats?.total || 0,
        avgConfidence: stats?.avg_confidence || 0,
        providerBreakdown,
        avgTokensUsed: stats?.avg_tokens || 0,
        avgAnalysisTime: stats?.avg_time || 0,
      };
    } catch (error) {
      logger.warn('Failed to get audit stats', {
        error: error instanceof Error ? error.message : String(error),
      });
      return {
        totalRetrievals: 0,
        avgConfidence: 0,
        providerBreakdown: {},
        avgTokensUsed: 0,
        avgAnalysisTime: 0,
      };
    }
  }

  /**
   * Clean up old audit entries
   */
  cleanup(maxAgeMs = 7 * 24 * 60 * 60 * 1000): number {
    try {
      const cutoff = Date.now() - maxAgeMs;
      const stmt = this.db.prepare(`
        DELETE FROM retrieval_audit
        WHERE project_id = ? AND timestamp < ?
      `);

      const result = stmt.run(this.projectId, cutoff);
      logger.info('Cleaned up old audit entries', { deleted: result.changes });
      return result.changes;
    } catch (error) {
      logger.warn('Failed to cleanup audit entries', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  private rowToEntry(row: any): RetrievalAuditEntry {
    return {
      id: row.id,
      timestamp: row.timestamp,
      projectId: row.project_id,
      query: row.query,
      reasoning: row.reasoning,
      framesRetrieved: JSON.parse(row.frames_retrieved),
      confidenceScore: row.confidence_score,
      provider: row.provider as 'anthropic' | 'heuristic' | 'cached',
      tokensUsed: row.tokens_used,
      tokenBudget: row.token_budget,
      analysisTimeMs: row.analysis_time_ms,
      queryComplexity: row.query_complexity as
        | 'simple'
        | 'moderate'
        | 'complex',
    };
  }
}
