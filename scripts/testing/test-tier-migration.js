#!/usr/bin/env node
import 'dotenv/config';
import Database from 'better-sqlite3';
import { RailwayOptimizedStorage } from './dist/core/storage/railway-optimized-storage.js';
import { ConfigManager } from './dist/core/config/config-manager.js';
import { v4 as uuidv4 } from 'uuid';

async function testTierMigration() {
  const db = new Database('.stackmemory/context.db');
  const configManager = new ConfigManager();
  
  // Create storage with shorter tier durations for testing
  const storage = new RailwayOptimizedStorage(db, configManager, {
    tiers: {
      hotHours: 0.001, // Very short for testing (3.6 seconds)
      warmDays: 0.0001, // Very short for testing (8.64 seconds)
      compressionScore: 0.5
    }
  });
  
  // Create a test trace
  const traceId = `test_${uuidv4()}`;
  const testTrace = {
    id: traceId,
    type: 'test',
    score: 0.7,
    summary: 'Test trace for tier migration',
    metadata: {
      startTime: Date.now() - 1000, // 1 second ago
      endTime: Date.now(),
      filesModified: ['test.js'],
      errorsEncountered: [],
      decisionsRecorded: [],
      causalChain: []
    },
    tools: [
      { tool: 'test', input: 'test input', output: 'test output' }
    ],
    compressed: false
  };
  
  console.log('📝 Creating test trace:', testTrace.id);
  
  // First, insert the trace into the traces table to satisfy foreign key
  db.prepare(`
    INSERT INTO traces (id, type, score, summary, start_time, end_time, 
                       files_modified, errors_encountered, decisions_recorded, 
                       causal_chain, compressed_data, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    traceId,
    'test',
    0.7,
    'Test trace for tier migration',
    testTrace.metadata.startTime,
    testTrace.metadata.endTime,
    JSON.stringify(testTrace.metadata.filesModified),
    JSON.stringify(testTrace.metadata.errorsEncountered),
    JSON.stringify(testTrace.metadata.decisionsRecorded),
    testTrace.metadata.causalChain.length,
    JSON.stringify(testTrace),
    Date.now()
  );
  
  // Store the trace in storage tiers
  const tier = await storage.storeTrace(testTrace);
  console.log(`✅ Stored in ${tier} tier`);
  
  // Check storage location
  const location = db.prepare('SELECT * FROM storage_tiers WHERE trace_id = ?').get(testTrace.id);
  console.log('📍 Initial location:', location);
  
  // Wait a moment for the trace to age
  console.log('⏳ Waiting 5 seconds for trace to age...');
  await new Promise(resolve => setTimeout(resolve, 5000));
  
  // Trigger migration
  console.log('🔄 Triggering migration...');
  const results = await storage.migrateTiers();
  console.log('Migration results:', results);
  
  // Check new location
  const newLocation = db.prepare('SELECT * FROM storage_tiers WHERE trace_id = ?').get(testTrace.id);
  console.log('📍 New location:', newLocation);
  
  // Try to retrieve the trace
  console.log('🔍 Retrieving trace after migration...');
  const retrieved = await storage.retrieveTrace(testTrace.id);
  console.log('✅ Retrieved:', retrieved ? 'Success' : 'Failed');
  
  if (retrieved) {
    console.log('  ID matches:', retrieved.id === testTrace.id);
    console.log('  Summary matches:', retrieved.summary === testTrace.summary);
  }
  
  db.close();
  console.log('✨ Test complete!');
}

testTierMigration().catch(console.error);