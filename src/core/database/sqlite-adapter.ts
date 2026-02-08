/**
 * SQLite Database Adapter
 * Maintains backward compatibility with existing SQLite implementation
 */

import Database from 'better-sqlite3';
import {
  FeatureAwareDatabaseAdapter,
  DatabaseFeatures,
  SearchOptions,
  QueryOptions,
  AggregationOptions,
  BulkOperation,
  DatabaseStats,
  CountResult,
  VersionResult,
  FrameRow,
} from './database-adapter.js';
import type { Frame, Event, Anchor } from '../context/index.js';
import { logger } from '../monitoring/logger.js';
import { DatabaseError, ErrorCode, ValidationError } from '../errors/index.js';
import type { EmbeddingProvider } from './embedding-provider.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface SQLiteConfig {
  dbPath: string;
  walMode?: boolean;
  busyTimeout?: number;
  cacheSize?: number;
  synchronous?: 'OFF' | 'NORMAL' | 'FULL' | 'EXTRA';
  embeddingProvider?: EmbeddingProvider;
  embeddingDimension?: number;
}

export class SQLiteAdapter extends FeatureAwareDatabaseAdapter {
  private db: Database.Database | null = null;
  private readonly dbPath: string;
  private inTransactionFlag = false;
  private ftsEnabled = false;
  private vecEnabled = false;
  private embeddingProvider?: EmbeddingProvider;
  private embeddingDimension: number;

  constructor(projectId: string, config: SQLiteConfig) {
    super(projectId, config);
    this.dbPath = config.dbPath;
    this.embeddingProvider = config.embeddingProvider;
    this.embeddingDimension = config.embeddingDimension || 384;
  }

  getFeatures(): DatabaseFeatures {
    return {
      supportsFullTextSearch: this.ftsEnabled,
      supportsVectorSearch: this.vecEnabled,
      supportsPartitioning: false,
      supportsAnalytics: false,
      supportsCompression: false,
      supportsMaterializedViews: false,
      supportsParallelQueries: false,
    };
  }

  async connect(): Promise<void> {
    if (this.db) return;

    const config = this.config as SQLiteConfig;

    // Ensure directory exists
    const dir = path.dirname(this.dbPath);
    await fs.mkdir(dir, { recursive: true });

    this.db = new Database(this.dbPath);

    // Enforce referential integrity
    this.db.pragma('foreign_keys = ON');

    // Configure SQLite for better performance
    if (config.walMode !== false) {
      this.db.pragma('journal_mode = WAL');
    }

    if (config.busyTimeout) {
      this.db.pragma(`busy_timeout = ${config.busyTimeout}`);
    }

    if (config.cacheSize) {
      this.db.pragma(`cache_size = ${config.cacheSize}`);
    }

    if (config.synchronous) {
      this.db.pragma(`synchronous = ${config.synchronous}`);
    }

    logger.info('SQLite database connected', { dbPath: this.dbPath });
  }

  async disconnect(): Promise<void> {
    if (!this.db) return;

    this.db.close();
    this.db = null;
    logger.info('SQLite database disconnected');
  }

  /**
   * Get raw database handle for testing purposes
   * @internal
   */
  getRawDatabase(): Database.Database | null {
    return this.db;
  }

  isConnected(): boolean {
    return this.db !== null && this.db.open;
  }

  async ping(): Promise<boolean> {
    if (!this.db) return false;

    try {
      this.db.prepare('SELECT 1').get();
      return true;
    } catch (error: unknown) {
      // Database may be closed or corrupted
      logger.debug('Database ping failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  async initializeSchema(): Promise<void> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    this.db.exec(`
      CREATE TABLE IF NOT EXISTS frames (
        frame_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        parent_frame_id TEXT REFERENCES frames(frame_id),
        depth INTEGER NOT NULL DEFAULT 0,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        state TEXT DEFAULT 'active',
        inputs TEXT DEFAULT '{}',
        outputs TEXT DEFAULT '{}',
        digest_text TEXT,
        digest_json TEXT DEFAULT '{}',
        created_at INTEGER DEFAULT (unixepoch()),
        closed_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS events (
        event_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        frame_id TEXT NOT NULL,
        seq INTEGER NOT NULL,
        event_type TEXT NOT NULL,
        payload TEXT NOT NULL,
        ts INTEGER DEFAULT (unixepoch()),
        FOREIGN KEY(frame_id) REFERENCES frames(frame_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS anchors (
        anchor_id TEXT PRIMARY KEY,
        frame_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        type TEXT NOT NULL,
        text TEXT NOT NULL,
        priority INTEGER DEFAULT 0,
        created_at INTEGER DEFAULT (unixepoch()),
        metadata TEXT DEFAULT '{}',
        FOREIGN KEY(frame_id) REFERENCES frames(frame_id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS schema_version (
        version INTEGER PRIMARY KEY,
        applied_at INTEGER DEFAULT (unixepoch())
      );

      -- Indexes for performance
      CREATE INDEX IF NOT EXISTS idx_frames_run ON frames(run_id);
      CREATE INDEX IF NOT EXISTS idx_frames_project ON frames(project_id);
      CREATE INDEX IF NOT EXISTS idx_frames_parent ON frames(parent_frame_id);
      CREATE INDEX IF NOT EXISTS idx_frames_state ON frames(state);
      CREATE INDEX IF NOT EXISTS idx_frames_created ON frames(created_at DESC);
      CREATE INDEX IF NOT EXISTS idx_events_frame ON events(frame_id);
      CREATE INDEX IF NOT EXISTS idx_events_seq ON events(frame_id, seq);
      CREATE INDEX IF NOT EXISTS idx_anchors_frame ON anchors(frame_id);

      -- Set initial schema version if not exists
      INSERT OR IGNORE INTO schema_version (version) VALUES (1);
    `);

    // Ensure cascade constraints exist on dependent tables for existing DBs
    try {
      this.ensureCascadeConstraints();
    } catch (e) {
      logger.warn('Failed to ensure cascade constraints', e as Error);
    }

    // Initialize FTS5 full-text search
    this.initializeFts();

    // Initialize sqlite-vec if provider is configured
    this.initializeVec();
  }

  /**
   * Ensure ON DELETE CASCADE exists for events/anchors referencing frames
   * Migrates existing tables in-place if needed without data loss.
   */
  private ensureCascadeConstraints(): void {
    if (!this.db) return;

    const needsCascade = (table: string): boolean => {
      const rows = this.db!.prepare(
        `PRAGMA foreign_key_list(${table})`
      ).all() as any[];
      // If any FK points to frames without cascade, we need migration
      return rows.some(
        (r) =>
          r.table === 'frames' &&
          String(r.on_delete).toUpperCase() !== 'CASCADE'
      );
    };

    const migrateTable = (table: 'events' | 'anchors') => {
      const createSql =
        table === 'events'
          ? `CREATE TABLE events_new (
              event_id TEXT PRIMARY KEY,
              run_id TEXT NOT NULL,
              frame_id TEXT NOT NULL,
              seq INTEGER NOT NULL,
              event_type TEXT NOT NULL,
              payload TEXT NOT NULL,
              ts INTEGER DEFAULT (unixepoch()),
              FOREIGN KEY(frame_id) REFERENCES frames(frame_id) ON DELETE CASCADE
            );`
          : `CREATE TABLE anchors_new (
              anchor_id TEXT PRIMARY KEY,
              frame_id TEXT NOT NULL,
              project_id TEXT NOT NULL,
              type TEXT NOT NULL,
              text TEXT NOT NULL,
              priority INTEGER DEFAULT 0,
              created_at INTEGER DEFAULT (unixepoch()),
              metadata TEXT DEFAULT '{}',
              FOREIGN KEY(frame_id) REFERENCES frames(frame_id) ON DELETE CASCADE
            );`;

      const cols =
        table === 'events'
          ? 'event_id, run_id, frame_id, seq, event_type, payload, ts'
          : 'anchor_id, frame_id, project_id, type, text, priority, created_at, metadata';

      const idxSql =
        table === 'events'
          ? [
              'CREATE INDEX IF NOT EXISTS idx_events_frame ON events(frame_id);',
              'CREATE INDEX IF NOT EXISTS idx_events_seq ON events(frame_id, seq);',
            ]
          : [
              'CREATE INDEX IF NOT EXISTS idx_anchors_frame ON anchors(frame_id);',
            ];

      this.db!.exec('PRAGMA foreign_keys = OFF;');
      this.db!.exec('BEGIN;');
      this.db!.exec(createSql);
      this.db!.prepare(
        `INSERT INTO ${table === 'events' ? 'events_new' : 'anchors_new'} (${cols}) SELECT ${cols} FROM ${table}`
      ).run();
      this.db!.exec(`DROP TABLE ${table};`);
      this.db!.exec(`ALTER TABLE ${table}_new RENAME TO ${table};`);
      for (const stmt of idxSql) this.db!.exec(stmt);
      this.db!.exec('COMMIT;');
      this.db!.exec('PRAGMA foreign_keys = ON;');
      logger.info(`Migrated ${table} to include ON DELETE CASCADE`);
    };

    if (needsCascade('events')) migrateTable('events');
    if (needsCascade('anchors')) migrateTable('anchors');
  }

  /**
   * Initialize FTS5 virtual table and sync triggers
   */
  private initializeFts(): void {
    if (!this.db) return;

    try {
      // Create FTS5 virtual table (external content, references frames)
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS frames_fts USING fts5(
          name, digest_text, inputs, outputs,
          content='frames', content_rowid='rowid'
        );
      `);

      // Create triggers to keep FTS in sync
      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS frames_ai AFTER INSERT ON frames BEGIN
          INSERT INTO frames_fts(rowid, name, digest_text, inputs, outputs)
          VALUES (new.rowid, new.name, new.digest_text, new.inputs, new.outputs);
        END;
      `);

      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS frames_ad AFTER DELETE ON frames BEGIN
          INSERT INTO frames_fts(frames_fts, rowid, name, digest_text, inputs, outputs)
          VALUES ('delete', old.rowid, old.name, old.digest_text, old.inputs, old.outputs);
        END;
      `);

      this.db.exec(`
        CREATE TRIGGER IF NOT EXISTS frames_au AFTER UPDATE ON frames BEGIN
          INSERT INTO frames_fts(frames_fts, rowid, name, digest_text, inputs, outputs)
          VALUES ('delete', old.rowid, old.name, old.digest_text, old.inputs, old.outputs);
          INSERT INTO frames_fts(rowid, name, digest_text, inputs, outputs)
          VALUES (new.rowid, new.name, new.digest_text, new.inputs, new.outputs);
        END;
      `);

      // Populate FTS index for existing data (schema version migration 1→2)
      this.migrateToFts();

      this.ftsEnabled = true;
      logger.info('FTS5 full-text search initialized');
    } catch (e) {
      logger.warn(
        'FTS5 initialization failed, falling back to LIKE search',
        e as Error
      );
      this.ftsEnabled = false;
    }
  }

  /**
   * One-time migration: populate FTS index from existing frames data
   */
  private migrateToFts(): void {
    if (!this.db) return;

    const version =
      (
        this.db
          .prepare('SELECT MAX(version) as version FROM schema_version')
          .get() as { version: number }
      )?.version || 1;

    if (version < 2) {
      // Populate FTS from existing data
      this.db.exec(`
        INSERT OR IGNORE INTO frames_fts(rowid, name, digest_text, inputs, outputs)
        SELECT rowid, name, digest_text, inputs, outputs FROM frames;
      `);
      this.db
        .prepare('INSERT OR REPLACE INTO schema_version (version) VALUES (?)')
        .run(2);
      logger.info(
        'FTS5 index populated from existing frames (migration v1→v2)'
      );
    }
  }

  /**
   * Initialize sqlite-vec for vector search
   */
  private initializeVec(): void {
    if (!this.db || !this.embeddingProvider) return;

    try {
      // Try to load sqlite-vec extension
      let sqliteVec;
      try {
        sqliteVec = require('sqlite-vec');
      } catch {
        logger.info('sqlite-vec not installed, vector search disabled');
        return;
      }

      sqliteVec.load(this.db);

      // Create vec0 virtual table for embeddings
      this.db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS frame_embeddings USING vec0(
          frame_id TEXT PRIMARY KEY,
          embedding float[${this.embeddingDimension}]
        );
      `);

      this.vecEnabled = true;
      logger.info('sqlite-vec vector search initialized', {
        dimension: this.embeddingDimension,
      });
    } catch (e) {
      logger.warn(
        'sqlite-vec initialization failed, vector search disabled',
        e as Error
      );
      this.vecEnabled = false;
    }
  }

  /**
   * Rebuild the FTS5 index (for maintenance)
   */
  async rebuildFtsIndex(): Promise<void> {
    if (!this.db) {
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );
    }
    if (!this.ftsEnabled) {
      logger.warn('FTS not enabled, skipping rebuild');
      return;
    }
    this.db.exec("INSERT INTO frames_fts(frames_fts) VALUES('rebuild')");
    logger.info('FTS5 index rebuilt');
  }

  async migrateSchema(targetVersion: number): Promise<void> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    const currentVersion = await this.getSchemaVersion();

    if (currentVersion >= targetVersion) {
      logger.info('Schema already at target version', {
        currentVersion,
        targetVersion,
      });
      return;
    }

    // Apply migrations sequentially
    for (let v = currentVersion + 1; v <= targetVersion; v++) {
      logger.info(`Applying migration to version ${v}`);
      // Migration logic would go here
      this.db.prepare('UPDATE schema_version SET version = ?').run(v);
    }
  }

  async getSchemaVersion(): Promise<number> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    try {
      const result = this.db
        .prepare('SELECT MAX(version) as version FROM schema_version')
        .get() as VersionResult;
      return result?.version || 0;
    } catch (error: unknown) {
      // Table may not exist yet in a fresh database
      logger.debug('Schema version table not found, returning 0', {
        error: error instanceof Error ? error.message : String(error),
      });
      return 0;
    }
  }

  // Frame operations
  async createFrame(frame: Partial<Frame>): Promise<string> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    const frameId = frame.frame_id || this.generateId();

    this.db
      .prepare(
        `
      INSERT INTO frames (
        frame_id, run_id, project_id, parent_frame_id, depth,
        type, name, state, inputs, outputs, digest_text, digest_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        frameId,
        frame.run_id,
        frame.project_id || this.projectId,
        frame.parent_frame_id || null,
        frame.depth || 0,
        frame.type,
        frame.name,
        frame.state || 'active',
        JSON.stringify(frame.inputs || {}),
        JSON.stringify(frame.outputs || {}),
        frame.digest_text || null,
        JSON.stringify(frame.digest_json || {})
      );

    return frameId;
  }

  async getFrame(frameId: string): Promise<Frame | null> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    const row = this.db
      .prepare('SELECT * FROM frames WHERE frame_id = ?')
      .get(frameId) as FrameRow | undefined;

    if (!row) return null;

    return {
      ...row,
      inputs: JSON.parse(row.inputs || '{}'),
      outputs: JSON.parse(row.outputs || '{}'),
      digest_json: JSON.parse(row.digest_json || '{}'),
    };
  }

  async updateFrame(frameId: string, updates: Partial<Frame>): Promise<void> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    const fields = [];
    const values = [];

    if (updates.state !== undefined) {
      fields.push('state = ?');
      values.push(updates.state);
    }

    if (updates.outputs !== undefined) {
      fields.push('outputs = ?');
      values.push(JSON.stringify(updates.outputs));
    }

    if (updates.digest_text !== undefined) {
      fields.push('digest_text = ?');
      values.push(updates.digest_text);
    }

    if (updates.digest_json !== undefined) {
      fields.push('digest_json = ?');
      values.push(JSON.stringify(updates.digest_json));
    }

    if (updates.closed_at !== undefined) {
      fields.push('closed_at = ?');
      values.push(updates.closed_at);
    }

    if (fields.length === 0) return;

    values.push(frameId);

    this.db
      .prepare(
        `
      UPDATE frames SET ${fields.join(', ')} WHERE frame_id = ?
    `
      )
      .run(...values);
  }

  async deleteFrame(frameId: string): Promise<void> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    // Delete in order due to foreign keys
    await this.deleteFrameAnchors(frameId);
    await this.deleteFrameEvents(frameId);

    this.db.prepare('DELETE FROM frames WHERE frame_id = ?').run(frameId);
  }

  async getActiveFrames(runId?: string): Promise<Frame[]> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    let query = "SELECT * FROM frames WHERE state = 'active'";
    const params = [];

    if (runId) {
      query += ' AND run_id = ?';
      params.push(runId);
    }

    query += ' ORDER BY depth ASC, created_at ASC';

    const rows = this.db.prepare(query).all(...params) as any[];

    return rows.map((row) => ({
      ...row,
      inputs: JSON.parse(row.inputs || '{}'),
      outputs: JSON.parse(row.outputs || '{}'),
      digest_json: JSON.parse(row.digest_json || '{}'),
    }));
  }

  async closeFrame(frameId: string, outputs?: any): Promise<void> {
    await this.updateFrame(frameId, {
      state: 'closed',
      outputs,
      closed_at: Date.now(),
    });
  }

  // Event operations
  async createEvent(event: Partial<Event>): Promise<string> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    const eventId = event.event_id || this.generateId();

    this.db
      .prepare(
        `
      INSERT INTO events (event_id, run_id, frame_id, seq, event_type, payload, ts)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        eventId,
        event.run_id,
        event.frame_id,
        event.seq || 0,
        event.event_type,
        JSON.stringify(event.payload || {}),
        event.ts || Date.now()
      );

    return eventId;
  }

  async getFrameEvents(
    frameId: string,
    options?: QueryOptions
  ): Promise<Event[]> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    let query = 'SELECT * FROM events WHERE frame_id = ?';
    query += this.buildOrderByClause(
      options?.orderBy || 'seq',
      options?.orderDirection
    );
    query += this.buildLimitClause(options?.limit, options?.offset);

    const rows = this.db.prepare(query).all(frameId) as any[];

    return rows.map((row) => ({
      ...row,
      payload: JSON.parse(row.payload || '{}'),
    }));
  }

  async deleteFrameEvents(frameId: string): Promise<void> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    this.db.prepare('DELETE FROM events WHERE frame_id = ?').run(frameId);
  }

  // Anchor operations
  async createAnchor(anchor: Partial<Anchor>): Promise<string> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    const anchorId = anchor.anchor_id || this.generateId();

    this.db
      .prepare(
        `
      INSERT INTO anchors (anchor_id, frame_id, project_id, type, text, priority, metadata)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `
      )
      .run(
        anchorId,
        anchor.frame_id,
        anchor.project_id || this.projectId,
        anchor.type,
        anchor.text,
        anchor.priority || 0,
        JSON.stringify(anchor.metadata || {})
      );

    return anchorId;
  }

  async getFrameAnchors(frameId: string): Promise<Anchor[]> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    const rows = this.db
      .prepare(
        `
      SELECT * FROM anchors WHERE frame_id = ? 
      ORDER BY priority DESC, created_at ASC
    `
      )
      .all(frameId) as any[];

    return rows.map((row) => ({
      ...row,
      metadata: JSON.parse(row.metadata || '{}'),
    }));
  }

  async deleteFrameAnchors(frameId: string): Promise<void> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    this.db.prepare('DELETE FROM anchors WHERE frame_id = ?').run(frameId);
  }

  // Full-text search with FTS5 + BM25 ranking (fallback to LIKE)
  async search(
    options: SearchOptions
  ): Promise<Array<Frame & { score: number }>> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    if (this.ftsEnabled) {
      try {
        return this.searchFts(options);
      } catch (e) {
        // FTS MATCH can fail on bad syntax — fall back to LIKE
        logger.debug('FTS search failed, falling back to LIKE', {
          error: e instanceof Error ? e.message : String(e),
          query: options.query,
        });
      }
    }

    return this.searchLike(options);
  }

  /**
   * FTS5 MATCH search with BM25 ranking
   */
  private searchFts(options: SearchOptions): Array<Frame & { score: number }> {
    // BM25 weights: name=10, digest_text=5, inputs=2, outputs=1
    const boost = options.boost || {};
    const w0 = boost['name'] || 10.0;
    const w1 = boost['digest_text'] || 5.0;
    const w2 = boost['inputs'] || 2.0;
    const w3 = boost['outputs'] || 1.0;

    const sql = `
      SELECT f.*, -bm25(frames_fts, ${w0}, ${w1}, ${w2}, ${w3}) as score
      FROM frames_fts fts
      JOIN frames f ON f.rowid = fts.rowid
      WHERE frames_fts MATCH ?
      ORDER BY score DESC
      LIMIT ? OFFSET ?
    `;

    const limit = options.limit || 50;
    const offset = options.offset || 0;

    const rows = this.db!.prepare(sql).all(
      options.query,
      limit,
      offset
    ) as any[];

    // Note: scoreThreshold is not applied to FTS results because BM25 scores
    // are on a different scale than LIKE-based scores. FTS results are already
    // ranked by relevance via ORDER BY score DESC.

    return rows.map((row) => ({
      ...row,
      inputs: JSON.parse(row.inputs || '{}'),
      outputs: JSON.parse(row.outputs || '{}'),
      digest_json: JSON.parse(row.digest_json || '{}'),
    }));
  }

  /**
   * Fallback LIKE search for when FTS is unavailable
   */
  private searchLike(options: SearchOptions): Array<Frame & { score: number }> {
    const sql = `
      SELECT *,
        CASE
          WHEN name LIKE ? THEN 1.0
          WHEN digest_text LIKE ? THEN 0.8
          WHEN inputs LIKE ? THEN 0.6
          ELSE 0.5
        END as score
      FROM frames
      WHERE name LIKE ? OR digest_text LIKE ? OR inputs LIKE ?
      ORDER BY score DESC
    `;

    const params = Array(6).fill(`%${options.query}%`);

    let rows = this.db!.prepare(sql).all(...params) as any[];

    if (options.scoreThreshold) {
      rows = rows.filter((row) => row.score >= options.scoreThreshold);
    }

    if (options.limit || options.offset) {
      const start = options.offset || 0;
      const end = options.limit ? start + options.limit : rows.length;
      rows = rows.slice(start, end);
    }

    return rows.map((row) => ({
      ...row,
      inputs: JSON.parse(row.inputs || '{}'),
      outputs: JSON.parse(row.outputs || '{}'),
      digest_json: JSON.parse(row.digest_json || '{}'),
    }));
  }

  async searchByVector(
    embedding: number[],
    options?: QueryOptions
  ): Promise<Array<Frame & { similarity: number }>> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    if (!this.vecEnabled) {
      logger.warn('Vector search not available (sqlite-vec not loaded)');
      return [];
    }

    const limit = options?.limit || 20;
    const sql = `
      SELECT f.*, ve.distance as similarity
      FROM frame_embeddings ve
      JOIN frames f ON f.frame_id = ve.frame_id
      WHERE ve.embedding MATCH ?
      ORDER BY ve.distance
      LIMIT ?
    `;

    const rows = this.db
      .prepare(sql)
      .all(JSON.stringify(embedding), limit) as any[];

    return rows.map((row) => ({
      ...row,
      inputs: JSON.parse(row.inputs || '{}'),
      outputs: JSON.parse(row.outputs || '{}'),
      digest_json: JSON.parse(row.digest_json || '{}'),
    }));
  }

  async searchHybrid(
    textQuery: string,
    embedding: number[],
    weights?: { text: number; vector: number }
  ): Promise<Array<Frame & { score: number }>> {
    const textWeight = weights?.text ?? 0.6;
    const vecWeight = weights?.vector ?? 0.4;

    // Get text results
    const textResults = await this.search({ query: textQuery, limit: 50 });

    // Get vector results if available
    const vecResults = this.vecEnabled
      ? await this.searchByVector(embedding, { limit: 50 })
      : [];

    if (vecResults.length === 0) {
      return textResults;
    }

    // Merge: build score map by frame_id
    const scoreMap = new Map<string, { frame: Frame; score: number }>();

    // Normalize text scores: max becomes 1.0
    const maxText = Math.max(...textResults.map((r) => r.score), 1);
    for (const r of textResults) {
      const normalizedScore = (r.score / maxText) * textWeight;
      scoreMap.set(r.frame_id, { frame: r, score: normalizedScore });
    }

    // Normalize vec scores: smaller distance = higher score
    const maxDist = Math.max(...vecResults.map((r) => r.similarity), 1);
    for (const r of vecResults) {
      const normalizedScore = (1 - r.similarity / maxDist) * vecWeight;
      const existing = scoreMap.get(r.frame_id);
      if (existing) {
        existing.score += normalizedScore;
      } else {
        scoreMap.set(r.frame_id, { frame: r, score: normalizedScore });
      }
    }

    return Array.from(scoreMap.values())
      .sort((a, b) => b.score - a.score)
      .map(({ frame, score }) => ({ ...frame, score }));
  }

  /**
   * Store an embedding for a frame
   */
  async storeEmbedding(frameId: string, embedding: number[]): Promise<void> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    if (!this.vecEnabled) return;

    this.db
      .prepare(
        'INSERT OR REPLACE INTO frame_embeddings (frame_id, embedding) VALUES (?, ?)'
      )
      .run(frameId, JSON.stringify(embedding));
  }

  /**
   * Get frames that are missing embeddings
   */
  async getFramesMissingEmbeddings(limit: number = 50): Promise<Frame[]> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    const sql = `
      SELECT f.* FROM frames f
      LEFT JOIN frame_embeddings ve ON f.frame_id = ve.frame_id
      WHERE ve.frame_id IS NULL
      LIMIT ?
    `;

    const rows = this.db.prepare(sql).all(limit) as any[];
    return rows.map((row) => ({
      ...row,
      inputs: JSON.parse(row.inputs || '{}'),
      outputs: JSON.parse(row.outputs || '{}'),
      digest_json: JSON.parse(row.digest_json || '{}'),
    }));
  }

  // Basic aggregation
  async aggregate(
    table: string,
    options: AggregationOptions
  ): Promise<Record<string, any>[]> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    const metrics = options.metrics
      .map(
        (m) =>
          `${m.operation}(${m.field}) AS ${m.alias || `${m.operation}_${m.field}`}`
      )
      .join(', ');

    let sql = `SELECT ${options.groupBy.join(', ')}, ${metrics} FROM ${table}`;
    sql += ` GROUP BY ${options.groupBy.join(', ')}`;

    if (options.having) {
      const havingClauses = Object.entries(options.having).map(
        ([key, value]) =>
          `${key} ${typeof value === 'object' ? value.op : '='} ?`
      );
      sql += ` HAVING ${havingClauses.join(' AND ')}`;
    }

    return this.db
      .prepare(sql)
      .all(...Object.values(options.having || {})) as any[];
  }

  // Pattern detection (basic)
  async detectPatterns(timeRange?: { start: Date; end: Date }): Promise<
    Array<{
      pattern: string;
      type: string;
      frequency: number;
      lastSeen: Date;
    }>
  > {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    let sql = `
      SELECT type as pattern, type, COUNT(*) as frequency, MAX(created_at) as last_seen
      FROM frames
    `;

    const params = [];
    if (timeRange) {
      sql += ' WHERE created_at >= ? AND created_at <= ?';
      params.push(
        Math.floor(timeRange.start.getTime() / 1000),
        Math.floor(timeRange.end.getTime() / 1000)
      );
    }

    sql += ' GROUP BY type HAVING COUNT(*) > 1 ORDER BY frequency DESC';

    const rows = this.db.prepare(sql).all(...params) as any[];

    return rows.map((row) => ({
      pattern: row.pattern,
      type: row.type,
      frequency: row.frequency,
      lastSeen: new Date(row.last_seen * 1000),
    }));
  }

  // Bulk operations
  async executeBulk(operations: BulkOperation[]): Promise<void> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    await this.inTransaction(async () => {
      for (const op of operations) {
        switch (op.type) {
          case 'insert':
            // Build insert dynamically based on data
            const insertCols = Object.keys(op.data);
            const insertPlaceholders = insertCols.map(() => '?').join(',');
            this.db!.prepare(
              `INSERT INTO ${op.table} (${insertCols.join(',')}) VALUES (${insertPlaceholders})`
            ).run(...Object.values(op.data));
            break;

          case 'update':
            const updateSets = Object.keys(op.data)
              .map((k) => `${k} = ?`)
              .join(',');
            const whereClause = this.buildWhereClause(op.where || {});
            this.db!.prepare(
              `UPDATE ${op.table} SET ${updateSets} ${whereClause}`
            ).run(...Object.values(op.data), ...Object.values(op.where || {}));
            break;

          case 'delete':
            const deleteWhere = this.buildWhereClause(op.where || {});
            this.db!.prepare(`DELETE FROM ${op.table} ${deleteWhere}`).run(
              ...Object.values(op.where || {})
            );
            break;
        }
      }
    });
  }

  async vacuum(): Promise<void> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    this.db.pragma('vacuum');
    logger.info('SQLite database vacuumed');
  }

  async analyze(): Promise<void> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    this.db.pragma('analyze');
    logger.info('SQLite database analyzed');
  }

  // Statistics
  async getStats(): Promise<DatabaseStats> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    const stats = {
      totalFrames: (
        this.db
          .prepare('SELECT COUNT(*) as count FROM frames')
          .get() as CountResult
      ).count,
      activeFrames: (
        this.db
          .prepare(
            "SELECT COUNT(*) as count FROM frames WHERE state = 'active'"
          )
          .get() as CountResult
      ).count,
      totalEvents: (
        this.db
          .prepare('SELECT COUNT(*) as count FROM events')
          .get() as CountResult
      ).count,
      totalAnchors: (
        this.db
          .prepare('SELECT COUNT(*) as count FROM anchors')
          .get() as CountResult
      ).count,
      diskUsage: 0,
    };

    // Get file size
    try {
      const fileStats = await fs.stat(this.dbPath);
      stats.diskUsage = fileStats.size;
    } catch (error: unknown) {
      // File may not exist yet or be inaccessible - disk usage remains 0
      logger.debug('Failed to get database file size', {
        dbPath: this.dbPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return stats;
  }

  async getQueryStats(): Promise<
    Array<{
      query: string;
      calls: number;
      meanTime: number;
      totalTime: number;
    }>
  > {
    // SQLite doesn't have built-in query stats
    logger.warn('Query stats not available for SQLite');
    return [];
  }

  // Transaction support
  async beginTransaction(): Promise<void> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    this.db.prepare('BEGIN').run();
    this.inTransactionFlag = true;
  }

  async commitTransaction(): Promise<void> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    this.db.prepare('COMMIT').run();
    this.inTransactionFlag = false;
  }

  async rollbackTransaction(): Promise<void> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    this.db.prepare('ROLLBACK').run();
    this.inTransactionFlag = false;
  }

  async inTransaction(
    callback: (adapter: DatabaseAdapter) => Promise<void>
  ): Promise<void> {
    await this.beginTransaction();

    try {
      await callback(this);
      await this.commitTransaction();
    } catch (error: unknown) {
      await this.rollbackTransaction();
      throw error;
    }
  }

  // Export/Import
  async exportData(
    tables: string[],
    format: 'json' | 'parquet' | 'csv'
  ): Promise<Buffer> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    if (format !== 'json') {
      throw new ValidationError(
        `Format ${format} not supported for SQLite export`,
        ErrorCode.VALIDATION_FAILED,
        { format, supportedFormats: ['json'] }
      );
    }

    const data: Record<string, any[]> = {};

    for (const table of tables) {
      data[table] = this.db.prepare(`SELECT * FROM ${table}`).all();
    }

    return Buffer.from(JSON.stringify(data, null, 2));
  }

  async importData(
    data: Buffer,
    format: 'json' | 'parquet' | 'csv',
    options?: { truncate?: boolean; upsert?: boolean }
  ): Promise<void> {
    if (!this.db)
      throw new DatabaseError(
        'Database not connected',
        ErrorCode.DB_CONNECTION_FAILED
      );

    if (format !== 'json') {
      throw new ValidationError(
        `Format ${format} not supported for SQLite import`,
        ErrorCode.VALIDATION_FAILED,
        { format, supportedFormats: ['json'] }
      );
    }

    const parsed = JSON.parse(data.toString());

    await this.inTransaction(async () => {
      for (const [table, rows] of Object.entries(parsed)) {
        if (options?.truncate) {
          this.db!.prepare(`DELETE FROM ${table}`).run();
        }

        for (const row of rows as any[]) {
          const cols = Object.keys(row);
          const placeholders = cols.map(() => '?').join(',');

          if (options?.upsert) {
            const updates = cols.map((c) => `${c} = excluded.${c}`).join(',');
            this.db!.prepare(
              `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})
               ON CONFLICT DO UPDATE SET ${updates}`
            ).run(...Object.values(row));
          } else {
            this.db!.prepare(
              `INSERT INTO ${table} (${cols.join(',')}) VALUES (${placeholders})`
            ).run(...Object.values(row));
          }
        }
      }
    });
  }
}
