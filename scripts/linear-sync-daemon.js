#!/usr/bin/env node

/**
 * Linear Sync Daemon - Runs hourly sync between Linear and local tasks
 * Checks .env first for API keys, then falls back to environment variables
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { spawn } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables from .env file first (as per user preference)
dotenv.config({ 
  path: path.join(__dirname, '..', '.env'),
  override: false // Don't override existing env vars
});

const SYNC_INTERVAL = 60 * 60 * 1000; // 1 hour in milliseconds
const LOG_FILE = path.join(__dirname, '..', '.stackmemory', 'linear-sync.log');

class LinearSyncDaemon {
  constructor() {
    this.isRunning = false;
    this.syncCount = 0;
    this.lastSyncTime = null;
    this.intervalId = null;
  }

  log(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] ${message}\n`;
    
    console.log(logMessage.trim());
    
    // Append to log file
    try {
      fs.appendFileSync(LOG_FILE, logMessage);
    } catch (error) {
      console.error('Failed to write to log file:', error.message);
    }
  }

  async runSync() {
    if (this.isRunning) {
      this.log('⏭️  Sync already in progress, skipping...');
      return;
    }

    this.isRunning = true;
    this.syncCount++;
    
    this.log(`🔄 Starting Linear sync #${this.syncCount}...`);
    
    return new Promise((resolve) => {
      const syncScript = path.join(__dirname, 'sync-linear-graphql.js');
      
      // Run the sync script as a child process
      const syncProcess = spawn('node', [syncScript], {
        env: process.env,
        stdio: ['ignore', 'pipe', 'pipe']
      });
      
      let output = '';
      let errorOutput = '';
      
      syncProcess.stdout.on('data', (data) => {
        output += data.toString();
      });
      
      syncProcess.stderr.on('data', (data) => {
        errorOutput += data.toString();
      });
      
      syncProcess.on('close', (code) => {
        this.isRunning = false;
        this.lastSyncTime = new Date();
        
        if (code === 0) {
          // Parse output for summary
          const lines = output.split('\n');
          const summaryLine = lines.find(l => l.includes('Added to local:'));
          const addedCount = summaryLine ? summaryLine.match(/\d+/)?.[0] : '0';
          
          this.log(`✅ Sync #${this.syncCount} completed successfully. Added ${addedCount} tasks.`);
        } else {
          this.log(`❌ Sync #${this.syncCount} failed with code ${code}`);
          if (errorOutput) {
            this.log(`Error output: ${errorOutput.substring(0, 500)}`);
          }
        }
        
        resolve();
      });
      
      syncProcess.on('error', (error) => {
        this.isRunning = false;
        this.log(`❌ Failed to start sync process: ${error.message}`);
        resolve();
      });
    });
  }

  async start() {
    // Check for API key
    if (!process.env.LINEAR_API_KEY) {
      this.log('❌ LINEAR_API_KEY not found in .env or environment variables');
      this.log('Please add LINEAR_API_KEY to your .env file or export it');
      process.exit(1);
    }
    
    this.log('🚀 Linear Sync Daemon starting...');
    this.log(`📅 Sync interval: Every hour`);
    this.log(`🔑 API Key: Found (${process.env.LINEAR_API_KEY.substring(0, 10)}...)`);
    
    // Run initial sync
    await this.runSync();
    
    // Schedule hourly syncs
    this.intervalId = setInterval(() => {
      this.runSync();
    }, SYNC_INTERVAL);
    
    this.log('⏰ Hourly sync scheduled. Daemon running in background...');
    
    // Handle graceful shutdown
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  stop() {
    this.log('🛑 Stopping Linear Sync Daemon...');
    
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    
    this.log(`📊 Final stats: ${this.syncCount} syncs completed`);
    this.log('👋 Daemon stopped');
    process.exit(0);
  }
}

// Start the daemon
const daemon = new LinearSyncDaemon();
daemon.start();