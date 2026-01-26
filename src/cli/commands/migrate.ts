#!/usr/bin/env node
/**
 * Railway schema migration CLI
 * Usage examples:
 *  - DATABASE_URL=... tsx src/cli/commands/migrate.ts list
 *  - DATABASE_URL=... tsx src/cli/commands/migrate.ts status
 *  - DATABASE_URL=... tsx src/cli/commands/migrate.ts apply --to latest
 *  - DATABASE_URL=... tsx src/cli/commands/migrate.ts rollback --to 2
 */

import { Command } from 'commander';
import { Pool } from 'pg';
import Database from 'better-sqlite3';
import {
  DatabaseError,
  ValidationError,
  ErrorCode,
} from '../../core/errors/index.js';

type DbKind = 'pg' | 'sqlite';

interface Migrator {
  kind: DbKind;
  pg?: Pool;
  sqlite?: Database.Database;
}

const MIGRATIONS: Array<{
  version: number;
  description: string;
  statements: string[];
}> = [
  {
    version: 1,
    description: 'base schema',
    statements: [
      // contexts
      `CREATE TABLE IF NOT EXISTS contexts (id ${isPg() ? 'BIGSERIAL' : 'INTEGER PRIMARY KEY AUTOINCREMENT'} PRIMARY KEY, project_id TEXT NOT NULL, content TEXT NOT NULL, type TEXT DEFAULT 'general', ${isPg() ? "metadata JSONB DEFAULT '{}'::jsonb" : "metadata TEXT DEFAULT '{}'"}, created_at ${isPg() ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${isPg() ? 'NOW()' : 'CURRENT_TIMESTAMP'}, updated_at ${isPg() ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${isPg() ? 'NOW()' : 'CURRENT_TIMESTAMP'})`,
      // api_keys
      `CREATE TABLE IF NOT EXISTS api_keys (id ${isPg() ? 'BIGSERIAL' : 'INTEGER PRIMARY KEY AUTOINCREMENT'} PRIMARY KEY, key_hash TEXT UNIQUE NOT NULL, user_id TEXT NOT NULL, name TEXT, created_at ${isPg() ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${isPg() ? 'NOW()' : 'CURRENT_TIMESTAMP'}, ${isPg() ? 'last_used TIMESTAMPTZ' : 'last_used DATETIME'}, revoked ${isPg() ? 'BOOLEAN' : 'BOOLEAN'} DEFAULT ${isPg() ? 'false' : '0'})`,
      // users with role
      `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, email TEXT, name TEXT, tier TEXT DEFAULT 'free', role TEXT DEFAULT 'user', created_at ${isPg() ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${isPg() ? 'NOW()' : 'CURRENT_TIMESTAMP'}, updated_at ${isPg() ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${isPg() ? 'NOW()' : 'CURRENT_TIMESTAMP'})`,
      // projects
      `CREATE TABLE IF NOT EXISTS projects (id TEXT PRIMARY KEY, name TEXT, is_public ${isPg() ? 'BOOLEAN' : 'BOOLEAN'} DEFAULT ${isPg() ? 'false' : '0'}, created_at ${isPg() ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${isPg() ? 'NOW()' : 'CURRENT_TIMESTAMP'}, updated_at ${isPg() ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${isPg() ? 'NOW()' : 'CURRENT_TIMESTAMP'})`,
      // project members
      `CREATE TABLE IF NOT EXISTS project_members (project_id TEXT NOT NULL, user_id TEXT NOT NULL, role TEXT NOT NULL ${isPg() ? '' : "CHECK (role IN ('admin','owner','editor','viewer'))"}, created_at ${isPg() ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${isPg() ? 'NOW()' : 'CURRENT_TIMESTAMP'}, PRIMARY KEY (project_id, user_id))`,
      // indexes
      `CREATE INDEX IF NOT EXISTS idx_contexts_project ON contexts(project_id)`,
      `CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash)`,
      `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
      `CREATE INDEX IF NOT EXISTS idx_project_members_user ON project_members(user_id)`,
    ],
  },
  {
    version: 2,
    description: 'admin sessions',
    statements: [
      `CREATE TABLE IF NOT EXISTS admin_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, created_at ${isPg() ? 'TIMESTAMPTZ' : 'DATETIME'} DEFAULT ${isPg() ? 'NOW()' : 'CURRENT_TIMESTAMP'}, expires_at ${isPg() ? 'TIMESTAMPTZ' : 'DATETIME'} NOT NULL, user_agent TEXT, ip TEXT)`,
      `CREATE INDEX IF NOT EXISTS idx_admin_sessions_user ON admin_sessions(user_id)`,
    ],
  },
  {
    version: 3,
    description: 'role enums & checks',
    statements: [
      // PG enum upgrades; for SQLite CHECK already present
      `CREATE TYPE user_role AS ENUM ('admin','user')`,
      `CREATE TYPE member_role AS ENUM ('admin','owner','editor','viewer')`,
      `ALTER TABLE users ALTER COLUMN role TYPE user_role USING role::user_role`,
      `ALTER TABLE project_members ALTER COLUMN role TYPE member_role USING role::member_role`,
      `ALTER TABLE project_members ADD CONSTRAINT project_members_role_check CHECK (role IN ('admin','owner','editor','viewer'))`,
      `ALTER TABLE users ADD CONSTRAINT users_role_check CHECK (role IN ('admin','user'))`,
    ],
  },
];

function isPg(): boolean {
  const url = process.env.DATABASE_URL || '';
  return url.startsWith('postgres://') || url.startsWith('postgresql://');
}

async function connect(): Promise<Migrator> {
  if (isPg()) {
    const pool = new Pool({ connectionString: process.env.DATABASE_URL });
    // ensure version table
    await pool.query(
      `CREATE TABLE IF NOT EXISTS railway_schema_version (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW(), description TEXT)`
    );
    return { kind: 'pg', pg: pool };
  } else {
    const path = process.env.DATABASE_URL || '.stackmemory/railway.db';
    const db = new Database(path);
    db.exec(
      `CREATE TABLE IF NOT EXISTS railway_schema_version (version INTEGER PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP, description TEXT)`
    );
    return { kind: 'sqlite', sqlite: db };
  }
}

async function getCurrentVersion(m: Migrator): Promise<number> {
  if (m.kind === 'pg') {
    const r = await m.pg!.query(
      'SELECT COALESCE(MAX(version), 0) AS v FROM railway_schema_version'
    );
    return Number(r.rows[0]?.v || 0);
  }
  const row = m
    .sqlite!.prepare(
      'SELECT COALESCE(MAX(version), 0) AS v FROM railway_schema_version'
    )
    .get() as any;
  return Number(row?.v || 0);
}

async function listApplied(
  m: Migrator
): Promise<Array<{ version: number; description: string }>> {
  if (m.kind === 'pg') {
    const r = await m.pg!.query(
      'SELECT version, description, applied_at FROM railway_schema_version ORDER BY version ASC'
    );
    return r.rows.map((row) => ({
      version: Number(row.version),
      description: row.description,
    }));
  }
  const rows = m
    .sqlite!.prepare(
      'SELECT version, description, applied_at FROM railway_schema_version ORDER BY version ASC'
    )
    .all() as any[];
  return rows.map((row) => ({
    version: Number(row.version),
    description: row.description,
  }));
}

async function applyTo(m: Migrator, target: number): Promise<void> {
  const current = await getCurrentVersion(m);
  const pending = MIGRATIONS.filter(
    (mig) => mig.version > current && mig.version <= target
  );
  for (const mig of pending) {
    if (m.kind === 'pg') {
      for (const s of mig.statements) {
        try {
          await m.pg!.query(s);
        } catch {}
      }
      await m.pg!.query(
        'INSERT INTO railway_schema_version (version, description) VALUES ($1, $2) ON CONFLICT (version) DO NOTHING',
        [mig.version, mig.description]
      );
    } else {
      m.sqlite!.exec('BEGIN');
      try {
        for (const s of mig.statements) {
          try {
            m.sqlite!.exec(s);
          } catch {}
        }
        m.sqlite!.prepare(
          'INSERT OR IGNORE INTO railway_schema_version (version, description) VALUES (?, ?)'
        ).run(mig.version, mig.description);
        m.sqlite!.exec('COMMIT');
      } catch {
        m.sqlite!.exec('ROLLBACK');
        throw new DatabaseError(
          `Migration ${mig.version} failed`,
          ErrorCode.DB_MIGRATION_FAILED,
          { version: mig.version, description: mig.description }
        );
      }
    }
    console.log(`Applied migration v${mig.version}: ${mig.description}`);
  }
}

async function rollbackTo(m: Migrator, target: number): Promise<void> {
  const current = await getCurrentVersion(m);
  if (target >= current) {
    console.log('Nothing to rollback');
    return;
  }
  // Soft rollback: move version pointer back; does not drop objects
  if (m.kind === 'pg') {
    await m.pg!.query('DELETE FROM railway_schema_version WHERE version > $1', [
      target,
    ]);
  } else {
    m.sqlite!.prepare(
      'DELETE FROM railway_schema_version WHERE version > ?'
    ).run(target);
  }
  console.log(
    `Rolled back schema version pointer from ${current} to ${target}`
  );
}

async function main() {
  const program = new Command();
  program
    .name('railway-migrate')
    .description('Manage Railway server schema migrations')
    .option('-d, --database <url>', 'DATABASE_URL override');

  program
    .command('list')
    .description('List applied migrations')
    .action(async () => {
      if (program.opts().database)
        process.env.DATABASE_URL = program.opts().database;
      const m = await connect();
      const applied = await listApplied(m);
      const current = await getCurrentVersion(m);
      console.log('Current version:', current);
      if (applied.length === 0) console.log('(no migrations applied)');
      applied.forEach((a) => console.log(`v${a.version} - ${a.description}`));
      process.exit(0);
    });

  program
    .command('status')
    .description('Show current version and pending migrations')
    .action(async () => {
      if (program.opts().database)
        process.env.DATABASE_URL = program.opts().database;
      const m = await connect();
      const current = await getCurrentVersion(m);
      const latest = Math.max(...MIGRATIONS.map((m) => m.version));
      const pending = MIGRATIONS.filter((mig) => mig.version > current);
      console.log('Current version:', current);
      console.log('Latest available:', latest);
      if (pending.length === 0) console.log('No pending migrations.');
      else {
        console.log('Pending:');
        pending.forEach((p) => console.log(`- v${p.version} ${p.description}`));
      }
      process.exit(0);
    });

  program
    .command('apply')
    .description('Apply migrations up to a target')
    .option(
      '--to <version|latest>',
      'Target version (number or "latest")',
      'latest'
    )
    .action(async (cmd) => {
      if (program.opts().database)
        process.env.DATABASE_URL = program.opts().database;
      const m = await connect();
      const latest = Math.max(...MIGRATIONS.map((m) => m.version));
      const target = cmd.to === 'latest' ? latest : parseInt(cmd.to, 10);
      if (!Number.isFinite(target))
        throw new ValidationError(
          'Invalid target version',
          ErrorCode.INVALID_INPUT,
          { target: cmd.to }
        );
      await applyTo(m, target);
      console.log('Done.');
      process.exit(0);
    });

  program
    .command('rollback')
    .description('Rollback schema version pointer (non-destructive)')
    .option('--to <version>', 'Target version number', '0')
    .action(async (cmd) => {
      if (program.opts().database)
        process.env.DATABASE_URL = program.opts().database;
      const m = await connect();
      const target = parseInt(cmd.to, 10);
      if (!Number.isFinite(target))
        throw new ValidationError(
          'Invalid target version',
          ErrorCode.INVALID_INPUT,
          { target: cmd.to }
        );
      await rollbackTo(m, target);
      console.log('Done.');
      process.exit(0);
    });

  await program.parseAsync(process.argv);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
