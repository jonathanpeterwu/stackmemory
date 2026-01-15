#!/usr/bin/env node
/**
 * Minimal Railway Server - Absolute minimum for testing
 */

import http from 'http';

const PORT = process.env.PORT || 3000;

const server = http.createServer(async (req, res) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.url}`);

  if (req.url === '/health' || req.url === '/api/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        status: 'healthy',
        timestamp: new Date().toISOString(),
        port: PORT,
        env: process.env.NODE_ENV || 'development',
      })
    );
  } else if (req.url === '/test-db') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    
    // Test database connections
    const testResults = { postgresql: {}, redis: {} };
    
    // Test PostgreSQL
    if (process.env.DATABASE_URL) {
      try {
        const { Client } = (await import('pg')).default;
        const pgClient = new Client({ connectionString: process.env.DATABASE_URL });
        await pgClient.connect();
        
        const result = await pgClient.query('SELECT NOW() as time, version() as version');
        testResults.postgresql = {
          status: 'connected',
          time: result.rows[0].time,
          version: result.rows[0].version.split(' ')[0]
        };
        
        await pgClient.end();
      } catch (error) {
        testResults.postgresql = { status: 'error', message: error.message };
      }
    } else {
      testResults.postgresql = { status: 'not_configured' };
    }
    
    // Test Redis
    const redisUrl = process.env.REDIS_URL || 
      (process.env.REDISHOST ? `redis://${process.env.REDISHOST}:${process.env.REDISPORT || 6379}` : null);
    
    if (redisUrl) {
      try {
        const { createClient } = await import('redis');
        const redisClient = createClient({ url: redisUrl });
        await redisClient.connect();
        
        await redisClient.ping();
        const info = await redisClient.info('server');
        const version = info.match(/redis_version:(.+)/)?.[1];
        
        testResults.redis = {
          status: 'connected',
          version: version,
          url: redisUrl.replace(/:\/\/[^@]+@/, '://***:***@') // Hide credentials
        };
        
        await redisClient.disconnect();
      } catch (error) {
        testResults.redis = { status: 'error', message: error.message };
      }
    } else {
      testResults.redis = { status: 'not_configured' };
    }
    
    res.end(JSON.stringify(testResults, null, 2));
  } else if (req.url === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(
      JSON.stringify({
        message: 'StackMemory Minimal Server Running',
        version: '1.0.0',
        endpoints: ['/health', '/api/health', '/test-db']
      })
    );
  } else {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not found' }));
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`
=================================
Minimal Server Started
Port: ${PORT}
Time: ${new Date().toISOString()}
=================================
  `);
});

// Keep alive
process.on('SIGTERM', () => {
  console.log('SIGTERM received');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('SIGINT received');
  server.close(() => process.exit(0));
});
