#!/usr/bin/env node
/**
 * Enhanced Railway Server with Redis and PostgreSQL
 */

import express from 'express';
import cors from 'cors';
import { createClient } from 'redis';
import pg from 'pg';
import { getRailwayConfig } from './config.js';

const { Client } = pg;

async function startServer() {
  const config = getRailwayConfig();
  
  console.log('🚀 Starting StackMemory Railway Server (Enhanced)');
  console.log(`📍 Environment: ${config.environment}`);
  console.log(`🔌 Port: ${config.port}`);
  
  const app = express();
  
  // Middleware
  app.use(cors({
    origin: config.corsOrigins,
    credentials: true
  }));
  app.use(express.json());
  
  // Health check endpoint - Railway uses this
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'healthy',
      service: 'stackmemory',
      timestamp: new Date().toISOString()
    });
  });
  
  // Root endpoint
  app.get('/', (req, res) => {
    res.json({
      name: 'StackMemory API',
      version: '0.3.17',
      status: 'running',
      endpoints: ['/health', '/api/health', '/api/status', '/api/frames']
    });
  });
  
  // Enhanced health check with service status
  app.get('/api/health', async (req, res) => {
    const checks: any = {
      server: 'ok',
      timestamp: new Date().toISOString()
    };
    
    // Test PostgreSQL
    if (config.databaseUrl) {
      try {
        const pgClient = new Client({ connectionString: config.databaseUrl });
        await pgClient.connect();
        await pgClient.query('SELECT 1');
        await pgClient.end();
        checks.postgres = 'connected';
      } catch (error: any) {
        checks.postgres = 'error';
        checks.postgresError = error.message.substring(0, 100);
      }
    }
    
    // Test Redis
    if (config.redisUrl) {
      try {
        const redisClient = createClient({ url: config.redisUrl });
        await redisClient.connect();
        await redisClient.ping();
        await redisClient.disconnect();
        checks.redis = 'connected';
      } catch (error: any) {
        checks.redis = 'error';
        checks.redisError = error.message.substring(0, 100);
      }
    }
    
    const healthy = checks.postgres === 'connected' || checks.redis === 'connected';
    res.status(healthy ? 200 : 503).json(checks);
  });
  
  // Status endpoint with detailed info
  app.get('/api/status', async (req, res) => {
    const status: any = {
      service: 'stackmemory',
      version: '0.3.17',
      environment: config.environment,
      storage: {}
    };
    
    // PostgreSQL status
    if (config.databaseUrl) {
      try {
        const pgClient = new Client({ connectionString: config.databaseUrl });
        await pgClient.connect();
        
        // Initialize frames table if needed
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
            created_at TIMESTAMP DEFAULT NOW()
          )
        `);
        
        const frameCount = await pgClient.query('SELECT COUNT(*) FROM frames');
        status.storage.postgres = {
          connected: true,
          frames: parseInt(frameCount.rows[0].count)
        };
        
        await pgClient.end();
      } catch (error: any) {
        status.storage.postgres = {
          connected: false,
          error: error.message.substring(0, 100)
        };
      }
    }
    
    // Redis status
    if (config.redisUrl) {
      try {
        const redisClient = createClient({ url: config.redisUrl });
        await redisClient.connect();
        
        const keys = await redisClient.keys('*');
        status.storage.redis = {
          connected: true,
          keys: keys.length
        };
        
        await redisClient.disconnect();
      } catch (error: any) {
        status.storage.redis = {
          connected: false,
          error: error.message.substring(0, 100)
        };
      }
    }
    
    res.json(status);
  });
  
  // Frames endpoint
  app.get('/api/frames', async (req, res) => {
    if (!config.databaseUrl) {
      return res.status(503).json({ error: 'Database not configured' });
    }
    
    try {
      const pgClient = new Client({ connectionString: config.databaseUrl });
      await pgClient.connect();
      
      const result = await pgClient.query(
        'SELECT * FROM frames ORDER BY created_at DESC LIMIT 10'
      );
      
      await pgClient.end();
      res.json({
        count: result.rows.length,
        frames: result.rows
      });
    } catch (error: any) {
      res.status(500).json({
        error: 'Database error',
        message: error.message
      });
    }
  });
  
  // Start server
  app.listen(config.port, '0.0.0.0', () => {
    console.log(`✅ Server running on port ${config.port}`);
    console.log(`📊 Database: ${config.databaseUrl ? 'configured' : 'not configured'}`);
    console.log(`💾 Redis: ${config.redisUrl ? 'configured' : 'not configured'}`);
  });
}

startServer().catch(error => {
  console.error('Failed to start server:', error);
  process.exit(1);
});