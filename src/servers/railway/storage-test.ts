#!/usr/bin/env node
/**
 * Enhanced Railway Server with Full Storage Testing
 * Tests PostgreSQL, Redis, and Railway Buckets (3-tier system)
 */

import express from 'express';
import cors from 'cors';
import { createClient } from 'redis';
import pg from 'pg';
import { S3Client, PutObjectCommand, GetObjectCommand, ListObjectsCommand } from '@aws-sdk/client-s3';

const { Client } = pg;

interface StorageTestResult {
  postgresql: any;
  redis: any;
  buckets: any;
  summary: any;
}

async function startServer() {
  const config = {
    port: parseInt(process.env.PORT || '3000'),
    databaseUrl: process.env.DATABASE_URL,
    redisUrl: process.env.REDIS_URL || 
      (process.env.REDISHOST ? `redis://${process.env.REDISHOST}:${process.env.REDISPORT || 6379}` : null),
    corsOrigins: process.env.CORS_ORIGINS?.split(',') || ['*']
  };
  
  console.log('🚀 Starting StackMemory Storage Test Server');
  console.log(`📍 Port: ${config.port}`);
  console.log(`💾 PostgreSQL: ${config.databaseUrl ? 'configured' : 'not configured'}`);
  console.log(`🔴 Redis: ${config.redisUrl ? 'configured' : 'not configured'}`);
  
  const app = express();
  
  // Middleware
  app.use(cors({ origin: config.corsOrigins }));
  app.use(express.json());
  
  // Health endpoint
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'healthy',
      service: 'stackmemory-storage-test',
      timestamp: new Date().toISOString()
    });
  });
  
  app.get('/api/health', (req, res) => {
    res.json({ 
      status: 'healthy',
      service: 'stackmemory-storage-test',
      timestamp: new Date().toISOString()
    });
  });
  
  // Root endpoint
  app.get('/', (req, res) => {
    res.json({
      name: 'StackMemory Core API',
      version: '0.3.17',
      description: 'Core API with Redis, PostgreSQL, and Railway Buckets',
      endpoints: [
        '/health',
        '/api/health',
        '/api/login',
        '/api/status',
        '/test-storage',
        '/create-frame',
        '/list-frames',
        '/api/frames'
      ],
      storage_tiers: {
        hot: 'Redis (< 24 hours)',
        warm: 'Railway Buckets (1-30 days)', 
        cold: 'PostgreSQL (30+ days)'
      }
    });
  });
  
  // Auto-login endpoint for seamless API access
  app.post('/api/login', async (req, res) => {
    try {
      const { username, api_key } = req.body;
      
      // Simple API key validation (in production, use proper JWT/OAuth)
      const validApiKey = process.env.API_KEY_SECRET || 'development-secret';
      
      if (api_key === validApiKey) {
        // Store session in Redis if available
        const sessionId = `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const sessionData = {
          username: username || 'api_user',
          created_at: new Date().toISOString(),
          api_key_hash: 'valid',
          permissions: ['read', 'write', 'admin']
        };
        
        if (config.redisUrl) {
          const redisClient = createClient({ url: config.redisUrl });
          await redisClient.connect();
          await redisClient.setEx(`session:${sessionId}`, 3600, JSON.stringify(sessionData)); // 1 hour
          await redisClient.disconnect();
        }
        
        res.json({
          success: true,
          session_id: sessionId,
          message: 'Automatically logged into StackMemory Core API',
          access: {
            redis: config.redisUrl ? 'available' : 'not_configured',
            postgresql: config.databaseUrl ? 'available' : 'not_configured',
            buckets: 'configurable'
          }
        });
      } else {
        res.status(401).json({
          success: false,
          message: 'Invalid API key'
        });
      }
    } catch (error: any) {
      res.status(500).json({
        success: false,
        message: 'Login failed',
        error: error.message
      });
    }
  });
  
  // Core API status endpoint
  app.get('/api/status', async (req, res) => {
    const status: any = {
      service: 'stackmemory-core-api',
      version: '0.3.17',
      environment: process.env.NODE_ENV || 'production',
      timestamp: new Date().toISOString(),
      storage: {
        tiers: {}
      }
    };
    
    // Check Redis (Hot Tier)
    if (config.redisUrl) {
      try {
        const redisClient = createClient({ url: config.redisUrl });
        await redisClient.connect();
        
        const info = await redisClient.info('memory');
        const keys = await redisClient.keys('*');
        const usedMemory = info.match(/used_memory_human:(.+)/)?.[1];
        
        status.storage.tiers.hot_redis = {
          status: 'connected',
          memory_used: usedMemory?.trim(),
          keys: keys.length,
          ttl_policy: 'auto-expire'
        };
        
        await redisClient.disconnect();
      } catch (error: any) {
        status.storage.tiers.hot_redis = { status: 'error', message: error.message };
      }
    } else {
      status.storage.tiers.hot_redis = { status: 'not_configured' };
    }
    
    // Check PostgreSQL (Cold Tier)
    if (config.databaseUrl) {
      try {
        const pgClient = new Client({ connectionString: config.databaseUrl });
        await pgClient.connect();
        
        const result = await pgClient.query('SELECT COUNT(*) as frames FROM frames WHERE created_at > NOW() - INTERVAL \'24 hours\'');
        const totalFrames = await pgClient.query('SELECT COUNT(*) as total FROM frames');
        
        status.storage.tiers.cold_postgresql = {
          status: 'connected',
          recent_frames: parseInt(result.rows[0].frames),
          total_frames: parseInt(totalFrames.rows[0].total)
        };
        
        await pgClient.end();
      } catch (error: any) {
        status.storage.tiers.cold_postgresql = { status: 'error', message: error.message };
      }
    }
    
    res.json(status);
  });
  
  // Comprehensive storage test endpoint
  app.get('/test-storage', async (req, res) => {
    const results: StorageTestResult = {
      postgresql: {},
      redis: {},
      buckets: {},
      summary: {}
    };
    
    try {
      // Test PostgreSQL
      if (config.databaseUrl) {
        console.log('🐘 Testing PostgreSQL...');
        try {
          const pgClient = new Client({ connectionString: config.databaseUrl });
          await pgClient.connect();
          
          // Basic connectivity
          const timeResult = await pgClient.query('SELECT NOW() as time, version() as version');
          
          // Create frames table
          await pgClient.query(`
            CREATE TABLE IF NOT EXISTS frames (
              frame_id TEXT PRIMARY KEY,
              run_id TEXT NOT NULL,
              project_id TEXT NOT NULL,
              type TEXT NOT NULL,
              name TEXT NOT NULL,
              state TEXT DEFAULT 'active',
              inputs JSONB DEFAULT '{}',
              outputs JSONB DEFAULT '{}',
              created_at TIMESTAMP DEFAULT NOW()
            )
          `);
          
          // Test insert/select
          const testId = `pg-test-${Date.now()}`;
          await pgClient.query(
            'INSERT INTO frames (frame_id, run_id, project_id, type, name) VALUES ($1, $2, $3, $4, $5)',
            [testId, 'test-run', 'storage-test', 'test', 'PostgreSQL Test Frame']
          );
          
          const frameResult = await pgClient.query('SELECT COUNT(*) as count FROM frames');
          
          results.postgresql = {
            status: 'connected',
            server_time: timeResult.rows[0].time,
            version: timeResult.rows[0].version.split(' ')[0],
            total_frames: parseInt(frameResult.rows[0].count),
            test_frame_id: testId
          };
          
          await pgClient.end();
        } catch (error: any) {
          results.postgresql = { status: 'error', message: error.message };
        }
      } else {
        results.postgresql = { status: 'not_configured' };
      }
      
      // Test Redis
      if (config.redisUrl) {
        console.log('🔴 Testing Redis...');
        try {
          const redisClient = createClient({ url: config.redisUrl });
          await redisClient.connect();
          
          // Test basic operations
          const testKey = `redis-test:${Date.now()}`;
          const testData = {
            timestamp: new Date().toISOString(),
            test: 'Redis connectivity test',
            frame_count: 1
          };
          
          await redisClient.setEx(testKey, 300, JSON.stringify(testData)); // 5 min expiry
          const retrieved = await redisClient.get(testKey);
          
          // Get server info
          const info = await redisClient.info('server');
          const memory = await redisClient.info('memory');
          const version = info.match(/redis_version:(.+)/)?.[1];
          const usedMemory = memory.match(/used_memory_human:(.+)/)?.[1];
          
          // Count keys
          const keys = await redisClient.keys('*');
          
          results.redis = {
            status: 'connected',
            version: version,
            memory_used: usedMemory?.trim(),
            total_keys: keys.length,
            test_key: testKey,
            test_data_retrieved: retrieved ? JSON.parse(retrieved) : null
          };
          
          await redisClient.disconnect();
        } catch (error: any) {
          results.redis = { status: 'error', message: error.message };
        }
      } else {
        results.redis = { status: 'not_configured' };
      }
      
      // Test Railway Buckets (S3-compatible)
      console.log('🪣 Testing Railway Buckets...');
      const bucketConfig = {
        endpoint: process.env.RAILWAY_BUCKET_ENDPOINT,
        accessKeyId: process.env.RAILWAY_BUCKET_ACCESS_KEY,
        secretAccessKey: process.env.RAILWAY_BUCKET_SECRET_KEY,
        bucket: process.env.RAILWAY_BUCKET_NAME || 'stackmemory-warm'
      };
      
      if (bucketConfig.endpoint && bucketConfig.accessKeyId && bucketConfig.secretAccessKey) {
        try {
          const s3Client = new S3Client({
            endpoint: bucketConfig.endpoint,
            region: 'us-east-1',
            credentials: {
              accessKeyId: bucketConfig.accessKeyId,
              secretAccessKey: bucketConfig.secretAccessKey
            }
          });
          
          // Test write
          const testKey = `storage-test/frame-${Date.now()}.json`;
          const testFrame = {
            frame_id: `bucket-test-${Date.now()}`,
            type: 'test',
            name: 'Railway Bucket Test',
            created_at: new Date().toISOString(),
            data: 'This is a test frame stored in Railway Buckets'
          };
          
          await s3Client.send(new PutObjectCommand({
            Bucket: bucketConfig.bucket,
            Key: testKey,
            Body: JSON.stringify(testFrame),
            ContentType: 'application/json'
          }));
          
          // Test read
          const getResult = await s3Client.send(new GetObjectCommand({
            Bucket: bucketConfig.bucket,
            Key: testKey
          }));
          
          // List objects
          const listResult = await s3Client.send(new ListObjectsCommand({
            Bucket: bucketConfig.bucket,
            MaxKeys: 10
          }));
          
          results.buckets = {
            status: 'connected',
            endpoint: bucketConfig.endpoint,
            bucket: bucketConfig.bucket,
            test_key: testKey,
            object_count: listResult.Contents?.length || 0,
            test_frame: testFrame
          };
        } catch (error: any) {
          results.buckets = { status: 'error', message: error.message };
        }
      } else {
        results.buckets = { 
          status: 'not_configured',
          missing: Object.entries(bucketConfig)
            .filter(([key, value]) => !value)
            .map(([key]) => key)
        };
      }
      
      // Summary
      results.summary = {
        timestamp: new Date().toISOString(),
        tiers: {
          hot: results.redis.status === 'connected' ? 'available' : 'unavailable',
          warm: results.buckets.status === 'connected' ? 'available' : 'unavailable',
          cold: results.postgresql.status === 'connected' ? 'available' : 'unavailable'
        },
        ready_for_production: 
          results.postgresql.status === 'connected' && 
          results.redis.status === 'connected'
      };
      
      res.json(results);
      
    } catch (error: any) {
      console.error('Storage test error:', error);
      res.status(500).json({
        error: 'Storage test failed',
        message: error.message,
        partial_results: results
      });
    }
  });
  
  // Create a test frame across all tiers
  app.post('/create-frame', async (req, res) => {
    const frameData = {
      frame_id: `frame-${Date.now()}`,
      run_id: req.body.run_id || 'test-run',
      project_id: req.body.project_id || 'storage-test',
      type: req.body.type || 'test',
      name: req.body.name || 'Multi-tier Test Frame',
      inputs: req.body.inputs || {},
      outputs: req.body.outputs || { status: 'created' },
      created_at: new Date().toISOString()
    };
    
    const results: any = { frame: frameData, storage: {} };
    
    try {
      // Store in PostgreSQL (cold tier)
      if (config.databaseUrl) {
        const pgClient = new Client({ connectionString: config.databaseUrl });
        await pgClient.connect();
        await pgClient.query(
          'INSERT INTO frames (frame_id, run_id, project_id, type, name, inputs, outputs) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [frameData.frame_id, frameData.run_id, frameData.project_id, frameData.type, frameData.name, frameData.inputs, frameData.outputs]
        );
        await pgClient.end();
        results.storage.postgresql = 'stored';
      }
      
      // Store in Redis (hot tier)
      if (config.redisUrl) {
        const redisClient = createClient({ url: config.redisUrl });
        await redisClient.connect();
        await redisClient.setEx(`frame:${frameData.frame_id}`, 3600, JSON.stringify(frameData));
        await redisClient.disconnect();
        results.storage.redis = 'stored';
      }
      
      res.json(results);
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to create frame',
        message: error.message,
        partial_results: results
      });
    }
  });
  
  // Core API frames endpoint
  app.get('/api/frames', async (req, res) => {
    try {
      const limit = parseInt(req.query.limit as string) || 10;
      const source = req.query.source as string || 'all'; // 'redis', 'postgresql', 'all'
      
      const results: any = { 
        frames: [],
        sources_checked: [],
        total_count: 0
      };
      
      // From Redis (hot tier) - most recent
      if ((source === 'all' || source === 'redis') && config.redisUrl) {
        try {
          const redisClient = createClient({ url: config.redisUrl });
          await redisClient.connect();
          const redisKeys = await redisClient.keys('frame:*');
          const redisFrames = [];
          for (const key of redisKeys.slice(0, limit)) {
            const data = await redisClient.get(key);
            if (data) {
              const frame = JSON.parse(data);
              frame.source = 'redis';
              frame.tier = 'hot';
              redisFrames.push(frame);
            }
          }
          await redisClient.disconnect();
          results.frames.push(...redisFrames);
          results.sources_checked.push('redis');
        } catch (error: any) {
          results.redis_error = error.message;
        }
      }
      
      // From PostgreSQL (cold tier) - persistent storage
      if ((source === 'all' || source === 'postgresql') && config.databaseUrl) {
        try {
          const pgClient = new Client({ connectionString: config.databaseUrl });
          await pgClient.connect();
          const pgFrames = await pgClient.query(
            'SELECT *, \'postgresql\' as source, \'cold\' as tier FROM frames ORDER BY created_at DESC LIMIT $1',
            [limit]
          );
          await pgClient.end();
          results.frames.push(...pgFrames.rows);
          results.sources_checked.push('postgresql');
          results.total_count = pgFrames.rowCount;
        } catch (error: any) {
          results.postgresql_error = error.message;
        }
      }
      
      // Sort by created_at if multiple sources
      if (results.frames.length > 1) {
        results.frames.sort((a: any, b: any) => 
          new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
        );
      }
      
      res.json({
        count: results.frames.length,
        frames: results.frames.slice(0, limit),
        metadata: {
          sources_checked: results.sources_checked,
          total_in_postgresql: results.total_count,
          tier_explanation: {
            hot: 'Redis - Recent frames (< 24 hours)',
            cold: 'PostgreSQL - All frames (persistent storage)'
          }
        }
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to fetch frames',
        message: error.message
      });
    }
  });

  // List recent frames (legacy endpoint)
  app.get('/list-frames', async (req, res) => {
    const results: any = { sources: {} };
    
    try {
      // From PostgreSQL
      if (config.databaseUrl) {
        const pgClient = new Client({ connectionString: config.databaseUrl });
        await pgClient.connect();
        const pgFrames = await pgClient.query('SELECT * FROM frames ORDER BY created_at DESC LIMIT 5');
        await pgClient.end();
        results.sources.postgresql = pgFrames.rows;
      }
      
      // From Redis
      if (config.redisUrl) {
        const redisClient = createClient({ url: config.redisUrl });
        await redisClient.connect();
        const redisKeys = await redisClient.keys('frame:*');
        const redisFrames = [];
        for (const key of redisKeys.slice(0, 5)) {
          const data = await redisClient.get(key);
          if (data) redisFrames.push(JSON.parse(data));
        }
        await redisClient.disconnect();
        results.sources.redis = redisFrames;
      }
      
      res.json(results);
    } catch (error: any) {
      res.status(500).json({
        error: 'Failed to list frames',
        message: error.message
      });
    }
  });
  
  // Start server
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`✅ Storage Test Server running on port ${config.port}`);
    console.log('\n📊 Available endpoints:');
    console.log('   - GET  /test-storage  (comprehensive storage test)');
    console.log('   - POST /create-frame  (create test frame)');
    console.log('   - GET  /list-frames   (list recent frames)');
  });
}

startServer().catch(error => {
  console.error('Failed to start storage test server:', error);
  process.exit(1);
});