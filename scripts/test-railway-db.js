#!/usr/bin/env node
import 'dotenv/config';
import pg from 'pg';
import { createClient } from 'redis';

const { Client } = pg;

// Railway PostgreSQL URL from environment
const DATABASE_URL = process.env.DATABASE_URL || 
  'postgresql://postgres:YTSFXqPzFhghOcefgwPvJyWOBTYHbYxd@postgres.railway.internal:5432/railway';

async function testPostgreSQL() {
  console.log('🐘 Testing PostgreSQL Connection...\n');
  
  const pgClient = new Client({
    connectionString: DATABASE_URL
  });
  
  try {
    console.log('📡 Connecting to PostgreSQL...');
    await pgClient.connect();
    console.log('✅ Connected to PostgreSQL!\n');
    
    // Test basic query
    const timeResult = await pgClient.query('SELECT NOW() as current_time');
    console.log('⏰ Database time:', timeResult.rows[0].current_time);
    
    // Create frames table if it doesn't exist
    console.log('\n📊 Creating frames table...');
    await pgClient.query(`
      CREATE TABLE IF NOT EXISTS frames (
        frame_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        parent_frame_id TEXT,
        depth INTEGER DEFAULT 0,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        state TEXT DEFAULT 'active',
        inputs JSONB DEFAULT '{}',
        outputs JSONB DEFAULT '{}',
        digest_text TEXT,
        digest_json JSONB DEFAULT '{}',
        created_at TIMESTAMP DEFAULT NOW(),
        closed_at TIMESTAMP
      );
      
      CREATE INDEX IF NOT EXISTS idx_frames_project ON frames(project_id);
      CREATE INDEX IF NOT EXISTS idx_frames_state ON frames(state);
      CREATE INDEX IF NOT EXISTS idx_frames_created ON frames(created_at);
    `);
    console.log('✅ Frames table ready!\n');
    
    // Check existing frames
    const countResult = await pgClient.query('SELECT COUNT(*) as count FROM frames');
    console.log('📈 Existing frames:', countResult.rows[0].count);
    
    // Insert a test frame
    const testFrameId = `test-frame-${Date.now()}`;
    console.log('\n🔧 Inserting test frame...');
    await pgClient.query(`
      INSERT INTO frames (
        frame_id, run_id, project_id, type, name, state,
        inputs, outputs, digest_text
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9
      )
    `, [
      testFrameId,
      'test-run-001',
      'stackmemory-test',
      'test',
      'Database Connection Test',
      'active',
      JSON.stringify({ test: true, timestamp: new Date().toISOString() }),
      JSON.stringify({ success: true }),
      'Test frame for Railway PostgreSQL connection'
    ]);
    console.log('✅ Test frame inserted:', testFrameId);
    
    // Retrieve the test frame
    console.log('\n🔍 Retrieving test frame...');
    const frameResult = await pgClient.query(
      'SELECT * FROM frames WHERE frame_id = $1',
      [testFrameId]
    );
    
    if (frameResult.rows.length > 0) {
      const frame = frameResult.rows[0];
      console.log('✅ Frame retrieved successfully!');
      console.log('   - Name:', frame.name);
      console.log('   - Type:', frame.type);
      console.log('   - State:', frame.state);
      console.log('   - Created:', frame.created_at);
    }
    
    // Get recent frames
    console.log('\n📋 Recent frames:');
    const recentFrames = await pgClient.query(`
      SELECT frame_id, name, type, state, created_at 
      FROM frames 
      ORDER BY created_at DESC 
      LIMIT 5
    `);
    
    if (recentFrames.rows.length > 0) {
      recentFrames.rows.forEach((frame, index) => {
        console.log(`   ${index + 1}. ${frame.name} (${frame.type}) - ${frame.state}`);
      });
    } else {
      console.log('   No frames found');
    }
    
    // Check table information
    console.log('\n📊 Database tables:');
    const tables = await pgClient.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name
    `);
    
    tables.rows.forEach(row => {
      console.log(`   - ${row.table_name}`);
    });
    
  } catch (error) {
    console.error('❌ PostgreSQL Error:', error.message);
    if (error.message.includes('ENOTFOUND')) {
      console.log('\n💡 Note: postgres.railway.internal only works from within Railway');
      console.log('   For local testing, you need the external DATABASE_URL');
    }
  } finally {
    await pgClient.end();
    console.log('\n🔌 PostgreSQL connection closed');
  }
}

async function testRedis() {
  console.log('\n\n🔴 Testing Redis Connection...\n');
  
  // Try to build Redis URL from environment
  const REDIS_URL = process.env.REDIS_URL || 
    process.env.REDISHOST ? `redis://${process.env.REDISHOST}:${process.env.REDISPORT || 6379}` : null;
  
  if (!REDIS_URL) {
    console.log('⚠️  No Redis configuration found in environment');
    console.log('   Add REDIS_URL or REDISHOST to Railway variables');
    return;
  }
  
  const redisClient = createClient({ url: REDIS_URL });
  
  try {
    console.log('📡 Connecting to Redis...');
    await redisClient.connect();
    console.log('✅ Connected to Redis!\n');
    
    // Test basic operations
    console.log('🔧 Testing Redis operations...');
    
    // Set a test key
    const testKey = `test:connection:${Date.now()}`;
    await redisClient.set(testKey, JSON.stringify({
      test: true,
      timestamp: new Date().toISOString(),
      message: 'Railway Redis connection test'
    }), { EX: 60 }); // Expire after 60 seconds
    console.log('✅ Set test key:', testKey);
    
    // Get the test key
    const value = await redisClient.get(testKey);
    const parsed = JSON.parse(value);
    console.log('✅ Retrieved value:', parsed);
    
    // Test Redis info
    const info = await redisClient.info('server');
    const version = info.match(/redis_version:(.+)/)?.[1];
    console.log('\n📊 Redis Server Info:');
    console.log('   - Version:', version);
    
    // Check memory usage
    const memoryInfo = await redisClient.info('memory');
    const usedMemory = memoryInfo.match(/used_memory_human:(.+)/)?.[1];
    console.log('   - Memory used:', usedMemory);
    
    // List all keys (be careful in production!)
    const keys = await redisClient.keys('*');
    console.log('   - Total keys:', keys.length);
    
    if (keys.length > 0 && keys.length <= 10) {
      console.log('   - Keys:', keys);
    }
    
  } catch (error) {
    console.error('❌ Redis Error:', error.message);
    if (error.message.includes('ENOTFOUND')) {
      console.log('\n💡 Note: Redis host not found');
      console.log('   Make sure Redis variables are configured in Railway');
    }
  } finally {
    await redisClient.disconnect();
    console.log('\n🔌 Redis connection closed');
  }
}

// Run tests
async function runTests() {
  console.log('🚀 Railway Database Connection Tests\n');
  console.log('=' .repeat(50));
  
  await testPostgreSQL();
  await testRedis();
  
  console.log('\n' + '=' .repeat(50));
  console.log('✅ Tests complete!\n');
}

runTests().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});