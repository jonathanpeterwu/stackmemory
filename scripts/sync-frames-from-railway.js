#!/usr/bin/env node
import 'dotenv/config';
import pg from 'pg';
import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { homedir } from 'os';

const { Client } = pg;

// Railway PostgreSQL connection
const RAILWAY_DATABASE_URL = 'postgresql://postgres:YTSFXqPzFhghOcefgwPvJyWOBTYHbYxd@postgres.railway.internal:5432/railway';

// Local SQLite database path
const dbPath = join(homedir(), '.stackmemory', 'context.db');
mkdirSync(dirname(dbPath), { recursive: true });

async function syncFramesFromRailway() {
  console.log('🔄 Starting sync from Railway database...\n');
  
  // Connect to Railway PostgreSQL
  const pgClient = new Client({
    connectionString: RAILWAY_DATABASE_URL,
  });
  
  try {
    await pgClient.connect();
    console.log('✅ Connected to Railway PostgreSQL database');
    
    // Connect to local SQLite
    const sqliteDb = new Database(dbPath);
    console.log('✅ Connected to local SQLite database\n');
    
    // Check if frames table exists in PostgreSQL
    const tableCheckQuery = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'frames'
      );
    `;
    
    const tableExists = await pgClient.query(tableCheckQuery);
    
    if (!tableExists.rows[0].exists) {
      console.log('⚠️  No frames table found in Railway database');
      console.log('   The Railway deployment may not have created frames yet.\n');
      
      // Check for other relevant tables
      const tablesQuery = `
        SELECT table_name 
        FROM information_schema.tables 
        WHERE table_schema = 'public'
        ORDER BY table_name;
      `;
      
      const tables = await pgClient.query(tablesQuery);
      console.log('📊 Available tables in Railway database:');
      tables.rows.forEach(row => {
        console.log(`   - ${row.table_name}`);
      });
      
      return;
    }
    
    // Fetch frames from Railway
    const framesQuery = `
      SELECT 
        frame_id,
        run_id,
        project_id,
        parent_frame_id,
        depth,
        type,
        name,
        state,
        inputs,
        outputs,
        digest_text,
        digest_json,
        created_at,
        closed_at
      FROM frames
      ORDER BY created_at DESC
      LIMIT 1000;
    `;
    
    const framesResult = await pgClient.query(framesQuery);
    console.log(`📥 Found ${framesResult.rows.length} frames in Railway database\n`);
    
    if (framesResult.rows.length === 0) {
      console.log('ℹ️  No frames to sync. The Railway database is empty.');
      return;
    }
    
    // Prepare SQLite insert statement
    const insertStmt = sqliteDb.prepare(`
      INSERT OR REPLACE INTO frames (
        frame_id, run_id, project_id, parent_frame_id, depth,
        type, name, state, inputs, outputs, digest_text, digest_json,
        created_at, closed_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    
    // Begin transaction for bulk insert
    const insertMany = sqliteDb.transaction((frames) => {
      for (const frame of frames) {
        insertStmt.run(
          frame.frame_id,
          frame.run_id,
          frame.project_id,
          frame.parent_frame_id,
          frame.depth,
          frame.type,
          frame.name,
          frame.state,
          typeof frame.inputs === 'object' ? JSON.stringify(frame.inputs) : frame.inputs,
          typeof frame.outputs === 'object' ? JSON.stringify(frame.outputs) : frame.outputs,
          frame.digest_text,
          typeof frame.digest_json === 'object' ? JSON.stringify(frame.digest_json) : frame.digest_json,
          frame.created_at ? new Date(frame.created_at).getTime() : Date.now(),
          frame.closed_at ? new Date(frame.closed_at).getTime() : null
        );
      }
    });
    
    // Execute bulk insert
    insertMany(framesResult.rows);
    console.log(`✅ Synced ${framesResult.rows.length} frames to local database\n`);
    
    // Also sync events if they exist
    const eventsCheckQuery = `
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_name = 'events'
      );
    `;
    
    const eventsExist = await pgClient.query(eventsCheckQuery);
    
    if (eventsExist.rows[0].exists) {
      const eventsQuery = `
        SELECT 
          event_id,
          run_id,
          frame_id,
          seq,
          event_type,
          payload,
          ts
        FROM events
        ORDER BY ts DESC
        LIMIT 5000;
      `;
      
      const eventsResult = await pgClient.query(eventsQuery);
      
      if (eventsResult.rows.length > 0) {
        console.log(`📥 Found ${eventsResult.rows.length} events in Railway database`);
        
        const eventInsertStmt = sqliteDb.prepare(`
          INSERT OR REPLACE INTO events (
            event_id, run_id, frame_id, seq, event_type, payload, ts
          ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        
        const insertEvents = sqliteDb.transaction((events) => {
          for (const event of events) {
            eventInsertStmt.run(
              event.event_id,
              event.run_id,
              event.frame_id,
              event.seq,
              event.event_type,
              typeof event.payload === 'object' ? JSON.stringify(event.payload) : event.payload,
              event.ts ? new Date(event.ts).getTime() : Date.now()
            );
          }
        });
        
        insertEvents(eventsResult.rows);
        console.log(`✅ Synced ${eventsResult.rows.length} events to local database\n`);
      }
    }
    
    // Verify the sync
    const frameCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM frames').get();
    const eventCount = sqliteDb.prepare('SELECT COUNT(*) as count FROM events').get();
    
    console.log('📊 Local database statistics:');
    console.log(`   - Frames: ${frameCount.count}`);
    console.log(`   - Events: ${eventCount.count}`);
    
    // Show recent frames
    const recentFrames = sqliteDb.prepare(`
      SELECT frame_id, name, type, state, datetime(created_at/1000, 'unixepoch') as created
      FROM frames
      ORDER BY created_at DESC
      LIMIT 5
    `).all();
    
    if (recentFrames.length > 0) {
      console.log('\n🕐 Recent frames:');
      recentFrames.forEach(frame => {
        console.log(`   - ${frame.name} (${frame.type}) - ${frame.state} - ${frame.created}`);
      });
    }
    
    sqliteDb.close();
    
  } catch (error) {
    console.error('❌ Error syncing frames:', error.message);
    
    // If connection failed due to internal network, try external URL
    if (error.message.includes('ENOTFOUND') || error.message.includes('postgres.railway.internal')) {
      console.log('\n🔄 Retrying with external Railway database URL...');
      console.log('   Note: You may need to get the external DATABASE_URL from Railway dashboard.');
      console.log('   Run: railway variables --json | jq -r .DATABASE_URL');
    }
  } finally {
    await pgClient.end();
  }
}

// Run the sync
syncFramesFromRailway().catch(console.error);