#!/usr/bin/env node
/**
 * Simplified Railway Server - Works without external dependencies
 */

import express from 'express';
import cors from 'cors';

const app = express();
const port = process.env.PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Root endpoint
app.get('/', (req, res) => {
  res.json({
    name: 'StackMemory Railway Server (Simplified)',
    version: '1.0.0',
    status: 'running',
    endpoints: {
      'GET /': 'This documentation',
      'GET /health': 'Health check',
      'GET /api/test': 'Test endpoint',
    },
  });
});

// Health check
app.get('/health', (req, res) => {
  res.json({
    status: 'healthy',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'development',
    port: port,
  });
});

// Basic API endpoint
app.get('/api/test', (req, res) => {
  res.json({
    message: 'StackMemory Railway Server is running!',
    timestamp: new Date().toISOString(),
  });
});

// Error handling
app.use((err, req, res, _next) => {
  console.error('Error:', err);
  res.status(500).json({
    error: 'Internal server error',
    message: err.message,
  });
});

// Start server
app.listen(port, '0.0.0.0', () => {
  console.log(`
🚂 StackMemory Simple Server Started
=====================================
Environment: ${process.env.NODE_ENV || 'development'}
Port: ${port}
Health: http://localhost:${port}/health
=====================================
  `);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down gracefully...');
  process.exit(0);
});

process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down...');
  process.exit(0);
});
