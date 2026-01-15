#!/usr/bin/env node
import 'dotenv/config';
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

// Create the database directory if it doesn't exist
const dbPath = join(homedir(), '.stackmemory', 'context.db');
mkdirSync(dirname(dbPath), { recursive: true });

// Connect to the database
const db = new Database(dbPath);

// Create frames table with proper schema
db.exec(`
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
    FOREIGN KEY(frame_id) REFERENCES frames(frame_id)
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
    FOREIGN KEY(frame_id) REFERENCES frames(frame_id)
  );

  CREATE TABLE IF NOT EXISTS handoff_requests (
    request_id TEXT PRIMARY KEY,
    source_stack_id TEXT NOT NULL,
    target_stack_id TEXT NOT NULL,
    frame_ids TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    created_at INTEGER DEFAULT (unixepoch()),
    expires_at INTEGER,
    target_user_id TEXT,
    message TEXT
  );

  CREATE INDEX IF NOT EXISTS idx_frames_run ON frames(run_id);
  CREATE INDEX IF NOT EXISTS idx_frames_parent ON frames(parent_frame_id);
  CREATE INDEX IF NOT EXISTS idx_frames_state ON frames(state);
  CREATE INDEX IF NOT EXISTS idx_events_frame ON events(frame_id);
  CREATE INDEX IF NOT EXISTS idx_events_seq ON events(frame_id, seq);
  CREATE INDEX IF NOT EXISTS idx_anchors_frame ON anchors(frame_id);
  CREATE INDEX IF NOT EXISTS idx_handoff_requests_status ON handoff_requests(status);
  CREATE INDEX IF NOT EXISTS idx_handoff_requests_target ON handoff_requests(target_stack_id);
`);

console.log('✅ Frames database recreated at:', dbPath);

// Verify tables exist
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
console.log('📊 Tables created:', tables.map(t => t.name).join(', '));

// Check if we have any existing frames
const frameCount = db.prepare('SELECT COUNT(*) as count FROM frames').get();
console.log('📈 Existing frames:', frameCount.count);

db.close();