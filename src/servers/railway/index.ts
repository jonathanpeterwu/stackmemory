#!/usr/bin/env node
/**
 * Railway MCP Server Entry Point
 * Simplified production server for Railway deployment
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import cors from 'cors';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
// WebSocket transport will be handled differently for Railway
import Database from 'better-sqlite3';
import * as bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { Pool } from 'pg';
// import { BrowserMCPIntegration } from '../../features/browser/browser-mcp.js';
import { join, dirname } from 'path';
import { existsSync, mkdirSync } from 'fs';
import { AuthMiddleware } from '../production/auth-middleware.js';
// Type-safe environment variable access - kept for potential future use
// function getEnv(key: string, defaultValue?: string): string {
//   const value = process.env[key];
//   if (value === undefined) {
//     if (defaultValue !== undefined) return defaultValue;
//     throw new Error(`Environment variable ${key} is required`);
//   }
//   return value;
// }

// function getOptionalEnv(key: string): string | undefined {
//   return process.env[key];
// }

// Configuration
const config = {
  port: parseInt(process.env['PORT'] || '3000'),
  environment: process.env['NODE_ENV'] || 'development',
  corsOrigins: process.env['CORS_ORIGINS']?.split(',') || [
    'http://localhost:3000',
  ],
  authMode: process.env['AUTH_MODE'] || 'api_key',
  apiKeySecret: process.env['API_KEY_SECRET'] || 'development-secret',
  jwtSecret: process.env['JWT_SECRET'] || 'development-jwt-secret',
  databaseUrl:
    process.env['DATABASE_URL'] ||
    join(process.cwd(), '.stackmemory', 'railway.db'),
  rateLimitEnabled: process.env['RATE_LIMIT_ENABLED'] === 'true',
  rateLimitFree: parseInt(process.env['RATE_LIMIT_FREE'] || '100'),
  enableWebSocket: process.env['ENABLE_WEBSOCKET'] !== 'false',
  enableAnalytics: process.env['ENABLE_ANALYTICS'] === 'true',
};

// Simple in-memory rate limiter
const rateLimiter = new Map<string, { count: number; resetTime: number }>();

class RailwayMCPServer {
  private app: express.Application;
  private httpServer: any;
  private wss?: WebSocketServer;
  private mcpServer!: Server;
  private db!: Database.Database;
  private pgPool: Pool | null = null;
  private authMiddleware: AuthMiddleware | null = null;
  private connections: Map<string, any> = new Map();
  // Deprecated in-memory session cache; sessions are persisted in DB
  private adminSessions: Map<string, { id: string; role: string; createdAt: number }> = new Map();
  // private browserMCP: BrowserMCPIntegration;

  constructor() {
    this.app = express();
    this.httpServer = createServer(this.app);
    // Initialize database (supports Postgres or SQLite)
    // Fire-and-forget; routes check pool/db availability
    this.initializeDatabase().then(() => {
      // Start periodic TTL cleanup for admin sessions
      this.startAdminSessionCleanup();
    }).catch((err) => {
      console.error('Failed to initialize database:', err);
    });
    this.setupMiddleware();
    this.setupRoutes();
    // MCP server disabled for Railway - using REST API instead
    // this.setupMCPServer();

    // Browser MCP disabled for Railway deployment
    // this.browserMCP = new BrowserMCPIntegration({
    //   headless: true, // Always headless in production
    //   defaultViewport: { width: 1280, height: 720 },
    // });

    if (config.enableWebSocket) {
      this.setupWebSocket();
    }
  }

  private async initializeDatabase(): Promise<void> {
    const isPg = config.databaseUrl.startsWith('postgres://') || config.databaseUrl.startsWith('postgresql://');

    if (isPg) {
      console.log('Using PostgreSQL database');
      this.pgPool = new Pool({ connectionString: config.databaseUrl });
      // Basic schema for contexts/api_keys and users
      await this.pgPool.query(`
        CREATE TABLE IF NOT EXISTS contexts (
          id BIGSERIAL PRIMARY KEY,
          project_id TEXT NOT NULL,
          content TEXT NOT NULL,
          type TEXT DEFAULT 'general',
          metadata JSONB DEFAULT '{}'::jsonb,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await this.pgPool.query(`
        CREATE TABLE IF NOT EXISTS api_keys (
          id BIGSERIAL PRIMARY KEY,
          key_hash TEXT UNIQUE NOT NULL,
          user_id TEXT NOT NULL,
          name TEXT,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          last_used TIMESTAMPTZ,
          revoked BOOLEAN DEFAULT false
        );
      `);
      await this.pgPool.query(`
        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT,
          name TEXT,
          tier TEXT DEFAULT 'free',
          role TEXT DEFAULT 'user',
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      try { await this.pgPool.query(`ALTER TABLE users ADD COLUMN role TEXT DEFAULT 'user'`); } catch {}
      // Role constraints (best-effort)
      try { await this.pgPool.query(`ALTER TABLE project_members ADD CONSTRAINT project_members_role_check CHECK (role IN ('admin','owner','editor','viewer'))`); } catch {}
      try { await this.pgPool.query(`ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','user'))`); } catch {}
      await this.pgPool.query(`
        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT,
          is_public BOOLEAN DEFAULT false,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        );
      `);
      await this.pgPool.query(`
        CREATE TABLE IF NOT EXISTS project_members (
          project_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (project_id, user_id)
        );
      `);
      await this.pgPool.query('CREATE INDEX IF NOT EXISTS idx_contexts_project ON contexts(project_id);');
      await this.pgPool.query('CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);');
      await this.pgPool.query('CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);');
      await this.pgPool.query('CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);');
      // Admin sessions table
      await this.pgPool.query(`
        CREATE TABLE IF NOT EXISTS admin_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          expires_at TIMESTAMPTZ NOT NULL,
          user_agent TEXT,
          ip TEXT
        );
      `);
      await this.pgPool.query('CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(user_id);');
      // ENUM roles (best-effort)
      try { await this.pgPool.query("CREATE TYPE user_role AS ENUM ('admin','user')"); } catch {}
      try { await this.pgPool.query("CREATE TYPE member_role AS ENUM ('admin','owner','editor','viewer')"); } catch {}
      try { await this.pgPool.query("ALTER TABLE users ALTER COLUMN role TYPE user_role USING role::user_role"); } catch {}
      try { await this.pgPool.query("ALTER TABLE project_members ALTER COLUMN role TYPE member_role USING role::member_role"); } catch {}
      // Run formalized migrations (idempotent)
      await this.runMigrations('pg');
    } else {
      // Create database directory if it doesn't exist
      const dbDir = dirname(config.databaseUrl);
      if (!existsSync(dbDir)) {
        mkdirSync(dbDir, { recursive: true });
      }
      this.db = new Database(config.databaseUrl);
      this.db.pragma('foreign_keys = ON');
      // Initialize tables (contexts, api_keys, users)
      this.db.exec(`
        CREATE TABLE IF NOT EXISTS contexts (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          project_id TEXT NOT NULL,
          content TEXT NOT NULL,
          type TEXT DEFAULT 'general',
          metadata TEXT DEFAULT '{}',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS api_keys (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          key_hash TEXT UNIQUE NOT NULL,
          user_id TEXT NOT NULL,
          name TEXT,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          last_used DATETIME,
          revoked BOOLEAN DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS users (
          id TEXT PRIMARY KEY,
          email TEXT,
          name TEXT,
          tier TEXT DEFAULT 'free',
          role TEXT DEFAULT 'user',
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS projects (
          id TEXT PRIMARY KEY,
          name TEXT,
          is_public BOOLEAN DEFAULT 0,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS project_members (
          project_id TEXT NOT NULL,
          user_id TEXT NOT NULL,
          role TEXT NOT NULL CHECK (role IN ('admin','owner','editor','viewer')),
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (project_id, user_id)
        );

        CREATE INDEX IF NOT EXISTS idx_contexts_project ON contexts(project_id);
        CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
        CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
        CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id);

        CREATE TABLE IF NOT EXISTS admin_sessions (
          id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL,
          created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
          expires_at DATETIME NOT NULL,
          user_agent TEXT,
          ip TEXT
        );
        CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(user_id);
      `);
      // Run formalized migrations (idempotent)
      await this.runMigrations('sqlite');
    }
  }

  // Simple migration framework (Railway server scope)
  private async runMigrations(kind: 'pg' | 'sqlite'): Promise<void> {
    if (kind === 'pg') {
      // Create schema version table
      await this.pgPool!.query(`
        CREATE TABLE IF NOT EXISTS railway_schema_version (
          version INTEGER PRIMARY KEY,
          applied_at TIMESTAMPTZ DEFAULT NOW(),
          description TEXT
        );
      `);
      const r = await this.pgPool!.query('SELECT COALESCE(MAX(version), 0) AS v FROM railway_schema_version');
      let cur = Number(r.rows[0]?.v || 0);

      const apply = async (version: number, description: string, queries: string[]) => {
        if (cur >= version) return;
        for (const q of queries) {
          try { await this.pgPool!.query(q); } catch (e) { /* ignore best-effort */ }
        }
        await this.pgPool!.query('INSERT INTO railway_schema_version (version, description) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING', [version, description]);
        cur = version;
      };

      // v1: base schema (contexts, api_keys, users with role, projects, project_members, indexes)
      await apply(1, 'base schema', [
        `CREATE TABLE IF NOT EXISTS contexts (id BIGSERIAL PRIMARY KEY, project_id TEXT NOT NULL, content TEXT NOT NULL, type TEXT DEFAULT 'general', metadata JSONB DEFAULT '{}'::jsonb, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
        `CREATE TABLE IF NOT EXISTS api_keys (id BIGSERIAL PRIMARY KEY, key_hash TEXT UNIQUE NOT NULL, user_id TEXT NOT NULL, name TEXT, created_at TIMESTAMPTZ DEFAULT NOW(), last_used TIMESTAMPTZ, revoked BOOLEAN DEFAULT false)`,
        `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, name TEXT, tier TEXT DEFAULT 'free', role TEXT DEFAULT 'user', created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
        `CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT, is_public BOOLEAN DEFAULT false, created_at TIMESTAMPTZ DEFAULT NOW(), updated_at TIMESTAMPTZ DEFAULT NOW())`,
        `CREATE TABLE IF NOT EXISTS project_members (project_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), PRIMARY KEY (project_id, user_id))`,
        `CREATE INDEX IF NOT EXISTS idx_contexts_project ON contexts(project_id)`,
        `CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)`,
        `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
        `CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id)`
      ]);

      // v2: admin_sessions + index
      await apply(2, 'admin sessions', [
        `CREATE TABLE IF NOT EXISTS admin_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at TIMESTAMPTZ DEFAULT NOW(), expires_at TIMESTAMPTZ NOT NULL, user_agent TEXT, ip TEXT)`,
        `CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(user_id)`
      ]);

      // v3: role enums & checks
      await apply(3, 'role enums & checks', [
        `CREATE TYPE user_role AS ENUM ('admin','user')`,
        `CREATE TYPE member_role AS ENUM ('admin','owner','editor','viewer')`,
        `ALTER TABLE users ALTER COLUMN role TYPE user_role USING role::user_role`,
        `ALTER TABLE project_members ALTER COLUMN role TYPE member_role USING role::member_role`,
        `ALTER TABLE project_members ADD CONSTRAINT project_members_role_check CHECK (role IN ('admin','owner','editor','viewer'))`,
        `ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','user'))`
      ]);
    } else {
      // sqlite
      this.db.exec(`CREATE TABLE IF NOT EXISTS railway_schema_version (version INTEGER PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP, description TEXT)`);
      const row = this.db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM railway_schema_version').get() as any;
      let cur = Number(row?.v || 0);
      const apply = (version: number, description: string, statements: string[]) => {
        if (cur >= version) return;
        this.db.exec('BEGIN');
        try {
          for (const s of statements) {
            try { this.db.exec(s); } catch {}
          }
          this.db.prepare('INSERT OR IGNORE INTO railway_schema_version (version, description) VALUES (?, ?)').run(version, description);
          this.db.exec('COMMIT');
          cur = version;
        } catch {
          this.db.exec('ROLLBACK');
        }
      };

      apply(1, 'base schema', [
        `CREATE TABLE IF NOT EXISTS contexts (id INTEGER PRIMARY KEY AUTOINCREMENT, project_id TEXT NOT NULL, content TEXT NOT NULL, type TEXT DEFAULT 'general', metadata TEXT DEFAULT '{}', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS api_keys (id INTEGER PRIMARY KEY AUTOINCREMENT, key_hash TEXT UNIQUE NOT NULL, user_id TEXT NOT NULL, name TEXT, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, last_used DATETIME, revoked BOOLEAN DEFAULT 0)`,
        `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, name TEXT, tier TEXT DEFAULT 'free', role TEXT DEFAULT 'user', created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT, is_public BOOLEAN DEFAULT 0, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, updated_at DATETIME DEFAULT CURRENT_TIMESTAMP)`,
        `CREATE TABLE IF NOT EXISTS project_members (project_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL CHECK (role IN ('admin','owner','editor','viewer')), created_at DATETIME DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY (project_id, user_id))`,
        `CREATE INDEX IF NOT EXISTS idx_contexts_project ON contexts(project_id)`,
        `CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)`,
        `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
        `CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id)`
      ]);

      apply(2, 'admin sessions', [
        `CREATE TABLE IF NOT EXISTS admin_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at DATETIME DEFAULT CURRENT_TIMESTAMP, expires_at DATETIME NOT NULL, user_agent TEXT, ip TEXT)`,
        `CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(user_id)`
      ]);
    }
  }

  // TTL cleanup for admin sessions
  private startAdminSessionCleanup(): void {
    const minutes = parseInt(process.env['ADMIN_SESSION_CLEAN_INTERVAL_MIN'] || '15', 10);
    if (minutes <= 0) return;
    const run = async () => {
      try {
        if (this.pgPool) {
          await this.pgPool.query('DELETE FROM admin_sessions WHERE expires_at <= NOW()');
        } else if (this.db) {
          this.db.prepare('DELETE FROM admin_sessions WHERE datetime(expires_at) <= datetime("now")').run();
        }
      } catch {
        console.warn('Admin session cleanup failed:', e);
      }
    };
    // initial cleanup and then interval
    run();
    setInterval(run, Math.max(1, minutes) * 60 * 1000);
  }

  private setupMiddleware(): void {
    // CORS
    this.app.use(
      cors({
        origin: config.corsOrigins,
        credentials: true,
      })
    );

    // Body parsing
    this.app.use(express.json({ limit: '10mb' }));

    // Request logging
    this.app.use((req, res, next) => {
      console.log(`${new Date().toISOString()} ${req.method} ${req.path}`);
      next();
    });

    // Authentication middleware (JWT or DB-backed API keys)
    this.app.use('/api', this.authenticate.bind(this));
    // Also use auth for admin API
    this.app.use('/admin/api', this.authenticate.bind(this));

    // Rate limiting
    if (config.rateLimitEnabled) {
      this.app.use('/api', this.rateLimit.bind(this));
    }
  }

  private async authenticate(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ): any {
    // Skip auth for health check
    if (req.path === '/health' || req.path === '/health/db') {
      return next();
    }

    const authHeader = req.headers.authorization;

    // API key mode: validate against DB (PG or SQLite)
    if (config.authMode === 'api_key') {
      if (!authHeader?.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Missing API key' });
      }
      const apiKey = authHeader.substring(7);

      try {
        const valid = await this.validateApiKey(apiKey);
        if (!valid) {
          return res.status(403).json({ error: 'Invalid API key' });
        }
        (req as any).user = valid;
        return next();
      } catch (e: any) {
        return res.status(500).json({ error: e.message || 'Auth error' });
      }
    }

    // JWT mode: if configured, delegate to production auth middleware
    if (config.authMode === 'jwt' && process.env['AUTH0_DOMAIN']) {
      if (!this.authMiddleware) {
        this.authMiddleware = new AuthMiddleware({
          auth0Domain: process.env['AUTH0_DOMAIN']!,
          auth0Audience: process.env['AUTH0_AUDIENCE'] || 'stackmemory',
          redisUrl: process.env['REDIS_URL'] || 'redis://localhost:6379',
          bypassAuth: process.env['NODE_ENV'] !== 'production',
          dbPath: process.env['STACKMEMORY_AUTH_DB'] || '.stackmemory/auth.db',
        });
      }
      return (this.authMiddleware.authenticate as any)(req, res, next);
    }

    // Default: allow (useful for local tests)
    return next();
  }

  private async validateApiKey(apiKey: string): Promise<{ id: string; tier: string; name?: string; email?: string } | null> {
    if (this.pgPool) {
      const { rows } = await this.pgPool.query(
        `SELECT ak.id, ak.user_id, ak.key_hash, ak.revoked, u.name, u.email, u.tier, u.role
         FROM api_keys ak
         LEFT JOIN users u ON u.id = ak.user_id`
      );
      for (const row of rows as any[]) {
        if (row.revoked) continue;
        if (await bcrypt.compare(apiKey, row.key_hash)) {
          await this.pgPool.query('UPDATE api_keys SET last_used = NOW() WHERE id = $1', [row.id]);
          return { id: row.user_id || 'api-user', tier: row.tier || 'free', name: row.name || undefined, email: row.email || undefined, role: row.role || 'user' };
        }
      }
      return null;
    }

    const stmt = this.db.prepare(`
      SELECT ak.id, ak.user_id, ak.key_hash, ak.revoked, u.name, u.email, u.tier, u.role
      FROM api_keys ak
      LEFT JOIN users u ON u.id = ak.user_id
    `);
    const rows = stmt.all() as any[];
    for (const row of rows) {
      if (row.revoked) continue;
      if (await bcrypt.compare(apiKey, row.key_hash)) {
        this.db.prepare('UPDATE api_keys SET last_used = CURRENT_TIMESTAMP WHERE id = ?').run(row.id);
        return { id: row.user_id || 'api-user', tier: row.tier || 'free', name: row.name || undefined, email: row.email || undefined, role: row.role || 'user' };
      }
    }
    return null;
  }

  private rateLimit(
    req: express.Request,
    res: express.Response,
    next: express.NextFunction
  ): any {
    const userId = (req as any).user?.id || req.ip;
    const now = Date.now();
    const windowMs = 15 * 60 * 1000; // 15 minutes

    const userLimit = rateLimiter.get(userId);

    if (!userLimit || userLimit.resetTime < now) {
      rateLimiter.set(userId, {
        count: 1,
        resetTime: now + windowMs,
      });
      return next();
    }

    if (userLimit.count >= config.rateLimitFree) {
      const retryAfter = Math.ceil((userLimit.resetTime - now) / 1000);
      res.setHeader('Retry-After', retryAfter.toString());
      return res.status(429).json({
        error: 'Rate limit exceeded',
        retryAfter,
      });
    }

    userLimit.count++;
    next();
  }

  private setupRoutes(): void {
    // Health check
    this.app.get('/health', (req, res) => {
      const health = {
        status: 'healthy',
        version: '1.0.0',
        timestamp: new Date().toISOString(),
        uptime: process.uptime(),
        environment: config.environment,
      };
      res.json(health);
    });

    // Root route
    this.app.get('/', (req, res) => {
      res.json({
        name: 'StackMemory Railway Server',
        version: '1.0.0',
        health: '/health',
        api: {
          'POST /api/context/save': 'Save context',
          'GET /api/context/load': 'Load context',
          'POST /api/tools/execute': 'Execute tool'
        }
      });
    });

    // API Routes
    this.app.post('/api/context/save', async (req, res) => {
      try {
        const { projectId = 'default', content, type = 'general', metadata = {} } = req.body;
        // Write guardrails: block free-tier writes unless allowed
        const user = (req as any).user || { tier: 'free' };
        const allowFreeWrite = process.env['ALLOW_FREE_WRITE'] === 'true';
        if (user.tier === 'free' && !allowFreeWrite) {
          return res.status(403).json({ error: 'Write access denied for free tier', code: 'WRITE_FORBIDDEN' });
        }

        // Per-project permissions: ensure project exists and user has rights
        await this.ensureProjectOwner(projectId, (user as any).id || 'api-user');
        const role = await this.getProjectRole(projectId, (user as any).id || 'api-user');
        if (!this.hasWriteAccess(role)) {
          return res.status(403).json({ error: 'Insufficient permissions', code: 'PERMISSION_DENIED' });
        }
        if (this.pgPool) {
          const r = await this.pgPool.query(
            `INSERT INTO contexts (project_id, content, type, metadata) VALUES ($1, $2, $3, $4) RETURNING id`,
            [projectId, content, type, metadata]
          );
          return res.json({ success: true, id: r.rows[0].id });
        }
        const stmt = this.db.prepare('INSERT INTO contexts (project_id, content, type, metadata) VALUES (?, ?, ?, ?)');
        const result = stmt.run(projectId, content, type, JSON.stringify(metadata));
        return res.json({ success: true, id: result.lastInsertRowid });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    this.app.get('/api/context/load', async (req, res) => {
      try {
        const { projectId = 'default', limit = 10, offset = 0 } = req.query as any;
        const user = (req as any).user || { id: 'api-user' };
        const isPublic = await this.isProjectPublic(projectId);
        const role = await this.getProjectRole(projectId, (user as any).id || 'api-user');
        if (!this.hasReadAccess(role, isPublic)) {
          return res.status(403).json({ error: 'Insufficient permissions', code: 'PERMISSION_DENIED' });
        }
        if (this.pgPool) {
          const r = await this.pgPool.query(
            `SELECT * FROM contexts WHERE project_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`,
            [projectId, Number(limit), Number(offset)]
          );
          return res.json({ success: true, contexts: r.rows });
        }
        const stmt = this.db.prepare('SELECT * FROM contexts WHERE project_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?');
        const rows = stmt.all(projectId, limit, offset) as any[];
        return res.json({ success: true, contexts: rows.map((c) => ({ ...c, metadata: JSON.parse(c.metadata || '{}') })) });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Cookie/session helpers for admin dashboard
    const parseCookies = (cookieHeader?: string): Record<string, string> => {
      const out: Record<string, string> = {};
      if (!cookieHeader) return out;
      cookieHeader.split(';').forEach((p) => {
        const i = p.indexOf('=');
        if (i > -1) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1));
      });
      return out;
    };
    const setJwtCookie = (res: express.Response, token: string) => {
      const flags = ['Path=/','HttpOnly','SameSite=Lax'];
      if (process.env['NODE_ENV'] === 'production') flags.push('Secure');
      res.setHeader('Set-Cookie', `sm_admin_jwt=${encodeURIComponent(token)}; ${flags.join('; ')}`);
    };
    const clearJwtCookie = (res: express.Response) => {
      res.setHeader('Set-Cookie', 'sm_admin_jwt=; Path=/; HttpOnly; Max-Age=0; SameSite=Lax');
    };

    const verifyAdminJwt = (token: string): { sub: string; jti: string } | null => {
      try {
        const secret = process.env['ADMIN_JWT_SECRET'] || 'dev-admin-secret';
        const payload = jwt.verify(token, secret) as any;
        return { sub: payload.sub, jti: payload.jti };
      } catch {
        return null;
      }
    };

    const checkDbSession = async (jti: string): Promise<boolean> => {
      if (this.pgPool) {
        const r = await this.pgPool.query('SELECT 1 FROM admin_sessions WHERE id = $1 AND expires_at > NOW()', [jti]);
        return r.rowCount > 0;
      }
      const row = this.db.prepare('SELECT 1 FROM admin_sessions WHERE id = ? AND datetime(expires_at) > datetime("now")').get(jti) as any;
      return !!row;
    };
    const requireAdmin = (req: express.Request, res: express.Response, next: express.NextFunction) => {
      const user = (req as any).user || {};
      if (user.role === 'admin') return next();
      const cookies = parseCookies(req.headers.cookie);
      const t = cookies['sm_admin_jwt'];
      if (t) {
        const verified = verifyAdminJwt(t);
        if (verified) {
          checkDbSession(verified.jti).then((ok) => {
            if (ok) return next();
            // fall through to redirect/403
            if (req.path === '/admin' || req.path.startsWith('/admin')) {
              res.redirect('/admin/login');
            } else {
              res.status(403).json({ error: 'Admin access required', code: 'ADMIN_REQUIRED' });
            }
          }).catch(() => {
            if (req.path === '/admin' || req.path.startsWith('/admin')) {
              res.redirect('/admin/login');
            } else {
              res.status(403).json({ error: 'Admin access required', code: 'ADMIN_REQUIRED' });
            }
          });
          return;
        }
      }
      // Redirect to login if accessing HTML, else 403 for API
      if (req.path === '/admin' || req.path.startsWith('/admin')) {
        res.redirect('/admin/login');
        return;
      }
      return res.status(403).json({ error: 'Admin access required', code: 'ADMIN_REQUIRED' });
    };

    // List projects
    this.app.get('/admin/api/projects', requireAdmin, async (req, res) => {
      try {
        if (this.pgPool) {
          const r = await this.pgPool.query('SELECT id, name, is_public, created_at, updated_at FROM projects ORDER BY updated_at DESC');
          return res.json({ projects: r.rows });
        }
        const rows = this.db.prepare('SELECT id, name, is_public, created_at, updated_at FROM projects ORDER BY updated_at DESC').all();
        return res.json({ projects: rows });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Create project
    this.app.post('/admin/api/projects', requireAdmin, async (req, res) => {
      try {
        const { id, name, isPublic = false } = req.body || {};
        if (!id) return res.status(400).json({ error: 'id required' });
        if (this.pgPool) {
          await this.pgPool.query('INSERT INTO projects (id, name, is_public) VALUES ($1, $2, $3) ON CONFLICT (id) DO NOTHING', [id, name || id, !!isPublic]);
          return res.json({ success: true });
        }
        this.db.prepare('INSERT OR IGNORE INTO projects (id, name, is_public) VALUES (?, ?, ?)').run(id, name || id, isPublic ? 1 : 0);
        return res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Toggle project visibility
    this.app.patch('/admin/api/projects/:id/visibility', requireAdmin, async (req, res) => {
      try {
        const pid = req.params.id;
        const { isPublic } = req.body || {};
        if (typeof isPublic !== 'boolean') return res.status(400).json({ error: 'isPublic boolean required' });
        if (this.pgPool) {
          await this.pgPool.query('UPDATE projects SET is_public = $1, updated_at = NOW() WHERE id = $2', [isPublic, pid]);
          return res.json({ success: true });
        }
        this.db.prepare('UPDATE projects SET is_public = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(isPublic ? 1 : 0, pid);
        return res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // List members
    this.app.get('/admin/api/projects/:id/members', requireAdmin, async (req, res) => {
      try {
        const pid = req.params.id;
        if (this.pgPool) {
          const r = await this.pgPool.query(
            'SELECT pm.user_id, pm.role, u.email, u.name FROM project_members pm LEFT JOIN users u ON u.id = pm.user_id WHERE pm.project_id = $1 ORDER BY pm.role',
            [pid]
          );
          return res.json({ members: r.rows });
        }
        const stmt = this.db.prepare('SELECT pm.user_id, pm.role, u.email, u.name FROM project_members pm LEFT JOIN users u ON u.id = pm.user_id WHERE pm.project_id = ? ORDER BY pm.role');
        return res.json({ members: stmt.all(pid) });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Upsert member
    this.app.put('/admin/api/projects/:id/members', requireAdmin, async (req, res) => {
      try {
        const pid = req.params.id;
        const { userId, role } = req.body || {};
        if (!userId || !role) return res.status(400).json({ error: 'userId and role required' });
        const validRoles = ['admin', 'owner', 'editor', 'viewer'];
        if (!validRoles.includes(role)) return res.status(400).json({ error: 'invalid role' });
        if (this.pgPool) {
          await this.pgPool.query(
            'INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3) ON CONFLICT (project_id, user_id) DO UPDATE SET role = EXCLUDED.role',
            [pid, userId, role]
          );
          return res.json({ success: true });
        }
        // SQLite UPSERT syntax
        this.db.prepare('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?) ON CONFLICT(project_id, user_id) DO UPDATE SET role = ?').run(pid, userId, role, role);
        return res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Remove member
    this.app.delete('/admin/api/projects/:id/members/:userId', requireAdmin, async (req, res) => {
      try {
        const pid = req.params.id;
        const uid = req.params.userId;
        if (this.pgPool) {
          await this.pgPool.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2', [pid, uid]);
          return res.json({ success: true });
        }
        this.db.prepare('DELETE FROM project_members WHERE project_id = ? AND user_id = ?').run(pid, uid);
        return res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Admin sessions management
    this.app.get('/admin/api/sessions', requireAdmin, async (_req, res) => {
      try {
        if (this.pgPool) {
          const r = await this.pgPool.query('SELECT id, user_id, created_at, expires_at, user_agent, ip FROM admin_sessions ORDER BY created_at DESC');
          return res.json({ sessions: r.rows });
        }
        const rows = this.db.prepare('SELECT id, user_id, created_at, expires_at, user_agent, ip FROM admin_sessions ORDER BY created_at DESC').all();
        return res.json({ sessions: rows });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    this.app.delete('/admin/api/sessions/:id', requireAdmin, async (req, res) => {
      try {
        const id = req.params.id;
        if (this.pgPool) {
          await this.pgPool.query('DELETE FROM admin_sessions WHERE id = $1', [id]);
        } else {
          this.db.prepare('DELETE FROM admin_sessions WHERE id = ?').run(id);
        }
        res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Refresh current admin session (rotate JWT & session id)
    this.app.post('/admin/api/sessions/refresh', requireAdmin, async (req, res) => {
      try {
        const cookies = parseCookies(req.headers.cookie);
        const t = cookies['sm_admin_jwt'];
        if (!t) return res.status(400).json({ error: 'No session' });
        const secret = process.env['ADMIN_JWT_SECRET'] || 'dev-admin-secret';
        let payload: any;
        try { payload = jwt.verify(t, secret) as any; } catch { return res.status(401).json({ error: 'Invalid token' }); }

        // Rotate: delete old session, create new with new jti
        const oldJti = payload.jti;
        const userId = payload.sub;
        try {
          if (this.pgPool) {
            await this.pgPool.query('DELETE FROM admin_sessions WHERE id = $1', [oldJti]);
          } else {
            this.db.prepare('DELETE FROM admin_sessions WHERE id = ?').run(oldJti);
          }
        } catch {}

        const jti = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        const hours = parseInt(process.env['ADMIN_SESSION_HOURS'] || '8', 10);
        const expMs = Date.now() + hours * 3600 * 1000;
        const expDateIso = new Date(expMs).toISOString();
        const ua = req.headers['user-agent'] || '';
        const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
        if (this.pgPool) {
          await this.pgPool.query('INSERT INTO admin_sessions (id, user_id, expires_at, user_agent, ip) VALUES ($1, $2, $3, $4, $5)', [jti, userId, expDateIso, ua, ip]);
        } else {
          this.db.prepare('INSERT INTO admin_sessions (id, user_id, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?)').run(jti, userId, expDateIso, ua, ip);
        }
        const token = jwt.sign({ sub: userId, role: 'admin', jti }, secret, { expiresIn: hours + 'h' });
        const flags = ['Path=/','HttpOnly','SameSite=Lax']; if (process.env['NODE_ENV'] === 'production') flags.push('Secure');
        res.setHeader('Set-Cookie', `sm_admin_jwt=${encodeURIComponent(token)}; ${flags.join('; ')}`);
        return res.json({ success: true });
      } catch (e: any) {
        res.status(500).json({ error: e.message });
      }
    });

    // Minimal admin dashboard
    this.app.get('/admin', requireAdmin, (req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.send(`<!doctype html>
<html><head><meta charset="utf-8"/><title>StackMemory Admin</title>
<style>body{font-family:system-ui,Arial;margin:20px} table{border-collapse:collapse} th,td{border:1px solid #ddd;padding:6px} input,select{margin:4px} .row{margin-bottom:12px}</style>
</head><body>
<div style="display:flex;justify-content:space-between;align-items:center">
  <h2>Projects</h2>
  <div><a href="/admin/logout">Logout</a></div>
</div>
<div class="row">
  <input id="newId" placeholder="project id"/>
  <input id="newName" placeholder="name"/>
  <label title="Anyone with auth can read if public"><input type="checkbox" id="newPublic"/> public</label>
  <button onclick="createProject()">Create</button>
</div>
<div id="projects"></div>
<hr/>
<h2>Admin Sessions</h2>
<div class="row">
  <button onclick="refreshSession()">Refresh This Session</button>
  <button onclick="loadSessions()">Reload Sessions</button>
  <span id="refreshMsg" style="margin-left:10px;color:#090"></span>
</div>
<div id="sessions"></div>
<script>
const ROLES = ['owner','editor','viewer','admin'];
async function loadProjects(){
  const r = await fetch('/admin/api/projects'); const j = await r.json();
  const rows = (j.projects||[]).map(p=>\`<tr><td>\${p.id}</td><td>\${p.name||''}</td><td>\${p.is_public? 'yes':'no'}</td>
    <td><button onclick="togglePublic('\${p.id}',\${!p.is_public})">make \${!p.is_public?'public':'private'}</button>
    <button onclick="viewMembers('\${p.id}')">members</button></td></tr>\`).join('');
  document.getElementById('projects').innerHTML = \`<table><tr><th>id</th><th>name</th><th>public</th><th>actions</th></tr>\${rows}</table><div id="members"></div>\`;
}
async function createProject(){
  const id = document.getElementById('newId').value; const name = document.getElementById('newName').value; const isPublic = document.getElementById('newPublic').checked;
  await fetch('/admin/api/projects',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id,name,isPublic})});
  loadProjects();
}
async function togglePublic(id, isPublic){
  await fetch('/admin/api/projects/'+id+'/visibility',{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({isPublic})});
  loadProjects();
}
async function viewMembers(id){
  const r = await fetch('/admin/api/projects/'+id+'/members'); const j = await r.json();
  const rows = (j.members||[]).map(m=>\`<tr><td>\${m.user_id}</td><td>\${m.name||''}</td><td>\${m.email||''}</td><td>\${m.role}</td>
    <td><button onclick="removeMember('\${id}','\${m.user_id}')">remove</button></td></tr>\`).join('');
  document.getElementById('members').innerHTML = \`<h3>Members of \${id}</h3>
    <div class="row"><input id="mUser" placeholder="user id"/><select id="mRole">\${ROLES.map(r=>\`<option>\${r}</option>\`).join('')}</select>
    <button onclick="addMember('\${id}')">add/update</button></div>
    <table><tr><th>user</th><th>name</th><th>email</th><th>role</th><th>actions</th></tr>\${rows}</table>\`;
}
async function addMember(id){
  const userId = document.getElementById('mUser').value; const role = document.getElementById('mRole').value;
  if (!ROLES.includes(role)) { alert('Invalid role'); return; }
  await fetch('/admin/api/projects/'+id+'/members',{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({userId,role})});
  viewMembers(id);
}
async function removeMember(id, userId){
  await fetch('/admin/api/projects/'+id+'/members/'+userId,{method:'DELETE'});
  viewMembers(id);
}
async function loadSessions(){
  const r = await fetch('/admin/api/sessions'); const j = await r.json();
  const rows = (j.sessions||[]).map(s=>\`<tr><td>\${s.id}</td><td>\${s.user_id}</td><td>\${new Date(s.created_at).toLocaleString()}</td><td>\${new Date(s.expires_at).toLocaleString()}</td><td>\${s.ip||''}</td><td>\${(s.user_agent||'').slice(0,40)}</td><td><button onclick="killSession('\${s.id}')">terminate</button></td></tr>\`).join('');
  document.getElementById('sessions').innerHTML = \`<table><tr><th>id</th><th>user</th><th>created</th><th>expires</th><th>ip</th><th>agent</th><th>actions</th></tr>\${rows}</table>\`;
}
async function killSession(id){
  await fetch('/admin/api/sessions/'+id,{method:'DELETE'});
  loadSessions();
}
async function refreshSession(){
  const r = await fetch('/admin/api/sessions/refresh',{method:'POST'});
  if (r.ok){ document.getElementById('refreshMsg').textContent = 'Session refreshed.'; setTimeout(()=>document.getElementById('refreshMsg').textContent='',1500);} else { alert('Refresh failed'); }
}
loadProjects();
loadSessions();
</script>
</body></html>`);
    });

    // DB health endpoint
    this.app.get('/health/db', async (req, res) => {
      try {
        if (this.pgPool) {
          const r = await this.pgPool.query('SELECT 1 as ok');
          return res.json({ kind: 'postgres', ok: !!r.rows?.length });
        }
        const row = this.db.prepare('SELECT 1 as ok').get() as any;
        return res.json({ kind: 'sqlite', ok: row?.ok === 1 });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // MCP tool execution endpoint
    this.app.post('/api/tools/execute', async (req, res) => {
      try {
        const { tool, params } = req.body;
        // Write guardrails for save_context tool
        if (tool === 'save_context') {
          const user = (req as any).user || { tier: 'free' };
          const allowFreeWrite = process.env['ALLOW_FREE_WRITE'] === 'true';
          if (user.tier === 'free' && !allowFreeWrite) {
            return res.status(403).json({ error: 'Write access denied for free tier', code: 'WRITE_FORBIDDEN' });
          }

          // Per-project permissions
          const projectId = (params && params.projectId) || 'default';
          await this.ensureProjectOwner(projectId, (user as any).id || 'api-user');
          const role = await this.getProjectRole(projectId, (user as any).id || 'api-user');
          if (!this.hasWriteAccess(role)) {
            return res.status(403).json({ error: 'Insufficient permissions', code: 'PERMISSION_DENIED' });
          }
        }

        if (tool === 'load_context') {
          const user = (req as any).user || { id: 'api-user' };
          const projectId = (params && params.projectId) || 'default';
          const isPublic = await this.isProjectPublic(projectId);
          const role = await this.getProjectRole(projectId, (user as any).id || 'api-user');
          if (!this.hasReadAccess(role, isPublic)) {
            return res.status(403).json({ error: 'Insufficient permissions', code: 'PERMISSION_DENIED' });
          }
        }

        // Execute MCP tool
        const result = await this.executeMCPTool(tool, params);

        res.json({
          success: true,
          result,
        });
      } catch (error: any) {
        res.status(500).json({ error: error.message });
      }
    });

    // Analytics endpoint
    if (config.enableAnalytics) {
      this.app.get('/api/analytics', (req, res) => {
        try {
          const { projectId = 'default' } = req.query;

          const stats = this.db
            .prepare(
              `
            SELECT 
              COUNT(*) as total_contexts,
              COUNT(DISTINCT type) as unique_types,
              MAX(created_at) as last_activity
            FROM contexts
            WHERE project_id = ?
          `
            )
            .get(projectId);

          res.json({
            success: true,
            analytics: stats,
          });
        } catch (error: any) {
          res.status(500).json({ error: error.message });
        }
      });
    }
  }

  private setupWebSocket(): void {
    this.wss = new WebSocketServer({
      server: this.httpServer,
      path: '/ws',
    });

    this.wss.on('connection', (ws, _req) => {
      console.log('WebSocket connection established');

      const connectionId = Math.random().toString(36).substring(7);
      this.connections.set(connectionId, ws);

      ws.on('message', async (data) => {
        try {
          const message = JSON.parse(data.toString());
          const response = await this.handleWebSocketMessage(message);
          ws.send(JSON.stringify(response));
        } catch (error: any) {
          ws.send(
            JSON.stringify({
              error: error.message,
            })
          );
        }
      });

      ws.on('close', () => {
        this.connections.delete(connectionId);
        console.log('WebSocket connection closed');
      });
    });
  }

  private async handleWebSocketMessage(message: any): Promise<any> {
    const { type, tool, params } = message;

    switch (type) {
      case 'execute':
        return await this.executeMCPTool(tool, params);

      case 'ping':
        return { type: 'pong' };

      default:
        throw new Error(`Unknown message type: ${type}`);
    }
  }

  private async setupMCPServer(): Promise<void> {
    this.mcpServer = new Server(
      {
        name: 'stackmemory-railway',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    // Initialize Browser MCP with the server
    // Skip browser MCP in production/Railway environment
    // await this.browserMCP.initialize(this.mcpServer);

    // Register MCP tools
    this.mcpServer.setRequestHandler('tools/list' as any, async () => {
      return {
        tools: [
          {
            name: 'save_context',
            description: 'Save context to StackMemory',
            inputSchema: {
              type: 'object',
              properties: {
                content: { type: 'string' },
                type: { type: 'string' },
              },
            },
          },
          {
            name: 'load_context',
            description: 'Load context from StackMemory',
            inputSchema: {
              type: 'object',
              properties: {
                query: { type: 'string' },
                limit: { type: 'number' },
              },
            },
          },
        ],
      };
    });

    this.mcpServer.setRequestHandler(
      'tools/call' as any,
      async (request: any) => {
        const { name, arguments: args } = request.params;
        return await this.executeMCPTool(name, args);
      }
    );
  }

  private async executeMCPTool(tool: string, params: any): Promise<any> {
    switch (tool) {
      case 'save_context': {
        if (this.pgPool) {
          const r = await this.pgPool.query(
            `INSERT INTO contexts (project_id, content, type, metadata)
             VALUES ($1, $2, $3, $4) RETURNING id`,
            [params.projectId || 'default', params.content, params.type || 'general', params.metadata || {}]
          );
          return { id: r.rows[0].id, success: true };
        }
        const stmt = this.db.prepare(
          `INSERT INTO contexts (project_id, content, type, metadata) VALUES (?, ?, ?, ?)`
        );
        const result = stmt.run(
          params.projectId || 'default',
          params.content,
          params.type || 'general',
          JSON.stringify(params.metadata || {})
        );
        return { id: result.lastInsertRowid, success: true };
      }

      case 'load_context': {
        if (this.pgPool) {
          const r = await this.pgPool.query(
            `SELECT * FROM contexts
             WHERE project_id = $1 AND content ILIKE $2
             ORDER BY created_at DESC
             LIMIT $3`,
            [params.projectId || 'default', `%${params.query || ''}%`, params.limit || 10]
          );
          return { contexts: r.rows, success: true };
        }
        const stmt = this.db.prepare(
          `SELECT * FROM contexts WHERE project_id = ? AND content LIKE ? ORDER BY created_at DESC LIMIT ?`
        );
        const contexts = stmt.all(
          params.projectId || 'default',
          `%${params.query || ''}%`,
          params.limit || 10
        );
        return { contexts, success: true };
      }

      default:
        throw new Error(`Unknown tool: ${tool}`);
    }
  }

  // Permission helpers
  private hasReadAccess(role: string | null, isPublic: boolean): boolean {
    if (isPublic) return true;
    return role === 'admin' || role === 'owner' || role === 'editor' || role === 'viewer';
  }

  private hasWriteAccess(role: string | null): boolean {
    return role === 'admin' || role === 'owner' || role === 'editor';
  }

  private async getProjectRole(projectId: string, userId: string): Promise<string | null> {
    if (this.pgPool) {
      const r = await this.pgPool.query(
        'SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2',
        [projectId, userId]
      );
      return r.rows[0]?.role || null;
    }
    const row = this.db
      .prepare('SELECT role FROM project_members WHERE project_id = ? AND user_id = ?')
      .get(projectId, userId) as any;
    return row?.role || null;
  }

  private async isProjectPublic(projectId: string): Promise<boolean> {
    if (this.pgPool) {
      const r = await this.pgPool.query('SELECT is_public FROM projects WHERE id = $1', [projectId]);
      return !!r.rows[0]?.is_public;
    }
    const row = this.db.prepare('SELECT is_public FROM projects WHERE id = ?').get(projectId) as any;
    return !!row?.is_public;
  }

  private async ensureProjectOwner(projectId: string, userId: string): Promise<void> {
    if (this.pgPool) {
      const pr = await this.pgPool.query('SELECT 1 FROM projects WHERE id = $1', [projectId]);
      if (pr.rowCount === 0) {
        await this.pgPool.query('INSERT INTO projects (id, name, is_public) VALUES ($1, $2, $3)', [projectId, projectId, false]);
      }
      const mr = await this.pgPool.query(
        'SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2',
        [projectId, userId]
      );
      if (mr.rowCount === 0) {
        await this.pgPool.query(
          'INSERT INTO project_members (project_id, user_id, role) VALUES ($1, $2, $3)',
          [projectId, userId, 'owner']
        );
      }
      return;
    }
    const pr = this.db.prepare('SELECT 1 FROM projects WHERE id = ?').get(projectId) as any;
    if (!pr) {
      this.db.prepare('INSERT INTO projects (id, name, is_public) VALUES (?, ?, ?)').run(projectId, projectId, 0);
    }
    const mr = this.db
      .prepare('SELECT 1 FROM project_members WHERE project_id = ? AND user_id = ?')
      .get(projectId, userId) as any;
    if (!mr) {
      this.db
        .prepare('INSERT INTO project_members (project_id, user_id, role) VALUES (?, ?, ?)')
        .run(projectId, userId, 'owner');
    }
  }

  public start(): void {
    this.httpServer.listen(config.port, '0.0.0.0', () => {
      console.log(`
🚂 Railway MCP Server Started
================================
Environment: ${config.environment}
Port: ${config.port}
WebSocket: ${config.enableWebSocket ? 'Enabled' : 'Disabled'}
Analytics: ${config.enableAnalytics ? 'Enabled' : 'Disabled'}
Rate Limiting: ${config.rateLimitEnabled ? 'Enabled' : 'Disabled'}
Auth Mode: ${config.authMode}
================================
Health: http://localhost:${config.port}/health
      `);
    });
  }
}

// Start server
const server = new RailwayMCPServer();
server.start();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('Shutting down...');
  process.exit(0);
});
    // Admin login/logout
    this.app.get('/admin/login', (_req, res) => {
      res.setHeader('Content-Type', 'text/html');
      res.send(`<!doctype html><html><head><meta charset="utf-8"/><title>Admin Login</title>
<style>body{font-family:system-ui;margin:40px} input{padding:8px;margin:4px} button{padding:8px}</style></head>
<body><h3>Admin Login</h3>
<p>Paste an admin API key to manage projects and members.</p>
<form method="POST" action="/admin/login">
  <input type="password" name="apiKey" placeholder="sk-..." style="min-width:360px" required/>
  <div><button type="submit">Login</button></div>
  <p style="color:#666">Your key is validated server-side and not stored in the browser; a short-lived session cookie is created.</p>
</form>
</body></html>`);
    });
    // Accept urlencoded form
    this.app.post('/admin/login', express.urlencoded({ extended: false }), async (req, res) => {
      try {
        const apiKey = req.body?.apiKey || '';
        if (!apiKey) return res.status(400).send('Missing API key');
        const u = await this.validateApiKey(apiKey);
        if (!u || (u as any).role !== 'admin') return res.status(403).send('Not an admin API key');
        // Create DB-backed admin session and sign JWT
        const jti = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
        const hours = parseInt(process.env['ADMIN_SESSION_HOURS'] || '8', 10);
        const expMs = Date.now() + hours * 3600 * 1000;
        const expDateIso = new Date(expMs).toISOString();
        const ua = req.headers['user-agent'] || '';
        const ip = (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress || '';
        if (this.pgPool) {
          await this.pgPool.query('INSERT INTO admin_sessions (id, user_id, expires_at, user_agent, ip) VALUES ($1, $2, $3, $4, $5)', [jti, (u as any).id, expDateIso, ua, ip]);
        } else {
          this.db.prepare('INSERT INTO admin_sessions (id, user_id, expires_at, user_agent, ip) VALUES (?, ?, ?, ?, ?)').run(jti, (u as any).id, expDateIso, ua, ip);
        }
        const token = jwt.sign({ sub: (u as any).id, role: 'admin', jti }, process.env['ADMIN_JWT_SECRET'] || 'dev-admin-secret', { expiresIn: hours + 'h' });
        setJwtCookie(res, token);
        res.redirect('/admin');
      } catch (e: any) {
        res.status(500).send('Login failed');
      }
    });
    this.app.get('/admin/logout', async (req, res) => {
      const cookies = parseCookies(req.headers.cookie);
      const t = cookies['sm_admin_jwt'];
      if (t) {
        const verified = verifyAdminJwt(t);
        if (verified) {
          try {
            if (this.pgPool) {
              await this.pgPool.query('DELETE FROM admin_sessions WHERE id = $1', [verified.jti]);
            } else {
              this.db.prepare('DELETE FROM admin_sessions WHERE id = ?').run(verified.jti);
            }
          } catch {}
        }
      }
      clearJwtCookie(res);
      res.redirect('/admin/login');
    });
