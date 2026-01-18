#!/usr/bin/env node
/**
 * Verify Railway schema version; exits non-zero if below latest
 */
import { Pool } from 'pg';
import Database from 'better-sqlite3';

function isPg(url: string): boolean {
  return url.startsWith('postgres://') || url.startsWith('postgresql://');
}

async function main() {
  const url = process.env.DATABASE_URL || '.stackmemory/railway.db';
  const latest = 3; // keep in sync with CLI

  if (isPg(url)) {
    const pool = new Pool({ connectionString: url });
    await pool.query('CREATE TABLE IF NOT EXISTS railway_schema_version (version INTEGER PRIMARY KEY, applied_at TIMESTAMPTZ DEFAULT NOW(), description TEXT)');
    const r = await pool.query('SELECT COALESCE(MAX(version), 0) AS v FROM railway_schema_version');
    const current = Number(r.rows[0]?.v || 0);
    console.log(JSON.stringify({ database: 'postgres', current, latest }));
    await pool.end();
    if (current < latest) process.exit(2);
  } else {
    const db = new Database(url);
    db.exec('CREATE TABLE IF NOT EXISTS railway_schema_version (version INTEGER PRIMARY KEY, applied_at DATETIME DEFAULT CURRENT_TIMESTAMP, description TEXT)');
    const row = db.prepare('SELECT COALESCE(MAX(version), 0) AS v FROM railway_schema_version').get() as any;
    const current = Number(row?.v || 0);
    console.log(JSON.stringify({ database: 'sqlite', current, latest }));
    if (current < latest) process.exit(2);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });

