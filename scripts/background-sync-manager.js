#!/usr/bin/env node

/**
 * StackMemory Background Sync Manager
 * Handles all background synchronization tasks:
 * - Linear task sync
 * - Frame and context backup
 * - Cross-session sync
 * - Cloud backup (S3/GCS)
 * - Redis cache sync
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables from .env file (check .env first as per user preference)
dotenv.config({ 
  path: path.join(__dirname, '..', '.env'),
  override: true,
  silent: true
});

// Sync intervals (in milliseconds)
const SYNC_INTERVALS = {
  linear: 60 * 60 * 1000,        // 1 hour - Linear task sync
  context: 15 * 60 * 1000,        // 15 minutes - Context and frame sync
  backup: 4 * 60 * 60 * 1000,    // 4 hours - Cloud backup
  redis: 5 * 60 * 1000,           // 5 minutes - Redis cache sync
  crossSession: 10 * 60 * 1000,   // 10 minutes - Cross-session sync
};

class BackgroundSyncManager {
  constructor() {
    this.syncTasks = new Map();
    this.stats = {
      linear: { count: 0, lastSync: null, errors: 0 },
      context: { count: 0, lastSync: null, errors: 0 },
      backup: { count: 0, lastSync: null, errors: 0 },
      redis: { count: 0, lastSync: null, errors: 0 },
      crossSession: { count: 0, lastSync: null, errors: 0 }
    };
    this.logFile = path.join(__dirname, '..', '.stackmemory', 'sync-manager.log');
    this.isRunning = false;
  }

  log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    const logMessage = `[${timestamp}] [${level}] ${message}\n`;
    
    console.log(logMessage.trim());
    
    try {
      fs.appendFileSync(this.logFile, logMessage);
    } catch (error) {
      console.error('Failed to write to log file:', error.message);
    }
  }

  /**
   * Sync Linear tasks
   */
  async syncLinear() {
    if (!process.env.LINEAR_API_KEY) {
      this.log('Linear sync skipped - no API key', 'WARN');
      return;
    }

    this.log('Starting Linear sync...');
    try {
      const { stdout, stderr } = await execAsync(
        `node ${path.join(__dirname, 'sync-linear-graphql.js')}`
      );
      
      // Parse output for summary
      const addedMatch = stdout.match(/Added to local: (\d+)/);
      const added = addedMatch ? addedMatch[1] : '0';
      
      this.stats.linear.count++;
      this.stats.linear.lastSync = new Date();
      this.log(`Linear sync completed - added ${added} tasks`);
    } catch (error) {
      this.stats.linear.errors++;
      this.log(`Linear sync failed: ${error.message}`, 'ERROR');
    }
  }

  /**
   * Sync context and frames
   */
  async syncContext() {
    this.log('Starting context sync...');
    try {
      const homeDir = process.env.HOME;
      const stackMemoryDir = path.join(homeDir, '.stackmemory');
      
      // Get all session directories
      const sessionsDir = path.join(stackMemoryDir, 'sessions');
      const sharedContextDir = path.join(stackMemoryDir, 'shared-context');
      
      // Count items to sync
      let sessionCount = 0;
      let contextCount = 0;
      
      if (fs.existsSync(sessionsDir)) {
        sessionCount = fs.readdirSync(sessionsDir).length;
      }
      
      if (fs.existsSync(sharedContextDir)) {
        const projects = fs.readdirSync(path.join(sharedContextDir, 'projects')).filter(f => f.endsWith('.json'));
        contextCount = projects.length;
        
        // Consolidate shared contexts
        for (const projectFile of projects) {
          const projectPath = path.join(sharedContextDir, 'projects', projectFile);
          const data = JSON.parse(fs.readFileSync(projectPath, 'utf8'));
          
          // Remove old/stale entries (older than 30 days)
          const thirtyDaysAgo = Date.now() - (30 * 24 * 60 * 60 * 1000);
          if (data.contexts) {
            data.contexts = data.contexts.filter(c => 
              c.timestamp && c.timestamp > thirtyDaysAgo
            );
            fs.writeFileSync(projectPath, JSON.stringify(data, null, 2));
          }
        }
      }
      
      this.stats.context.count++;
      this.stats.context.lastSync = new Date();
      this.log(`Context sync completed - ${sessionCount} sessions, ${contextCount} shared contexts`);
    } catch (error) {
      this.stats.context.errors++;
      this.log(`Context sync failed: ${error.message}`, 'ERROR');
    }
  }

  /**
   * Backup to cloud storage (S3/GCS)
   */
  async syncBackup() {
    this.log('Starting cloud backup...');
    try {
      const homeDir = process.env.HOME;
      const stackMemoryDir = path.join(homeDir, '.stackmemory');
      const backupDir = path.join(__dirname, '..', 'backups');
      
      // Create backup directory
      if (!fs.existsSync(backupDir)) {
        fs.mkdirSync(backupDir, { recursive: true });
      }
      
      // Create timestamp for backup
      const timestamp = new Date().toISOString().replace(/:/g, '-').split('.')[0];
      const backupFile = path.join(backupDir, `stackmemory-backup-${timestamp}.tar.gz`);
      
      // Create tar archive of important data
      const { stdout, stderr } = await execAsync(
        `tar -czf ${backupFile} -C ${homeDir} .stackmemory/sessions .stackmemory/shared-context .stackmemory/projects.db 2>/dev/null || true`
      );
      
      const stats = fs.statSync(backupFile);
      const sizeMB = (stats.size / (1024 * 1024)).toFixed(2);
      
      // Upload to cloud if configured
      if (process.env.AWS_S3_BUCKET) {
        await execAsync(
          `aws s3 cp ${backupFile} s3://${process.env.AWS_S3_BUCKET}/stackmemory-backups/ --storage-class GLACIER_IR`
        );
        this.log(`Backup uploaded to S3: ${sizeMB}MB`);
      } else if (process.env.GCS_BUCKET) {
        await execAsync(
          `gsutil cp ${backupFile} gs://${process.env.GCS_BUCKET}/stackmemory-backups/`
        );
        this.log(`Backup uploaded to GCS: ${sizeMB}MB`);
      } else {
        this.log(`Local backup created: ${sizeMB}MB (no cloud storage configured)`);
      }
      
      // Clean up old local backups (keep last 5)
      const backups = fs.readdirSync(backupDir)
        .filter(f => f.startsWith('stackmemory-backup-'))
        .sort()
        .reverse();
      
      for (let i = 5; i < backups.length; i++) {
        fs.unlinkSync(path.join(backupDir, backups[i]));
      }
      
      this.stats.backup.count++;
      this.stats.backup.lastSync = new Date();
      this.log(`Backup completed - ${sizeMB}MB`);
    } catch (error) {
      this.stats.backup.errors++;
      this.log(`Backup failed: ${error.message}`, 'ERROR');
    }
  }

  /**
   * Sync with Redis cache
   */
  async syncRedis() {
    if (!process.env.REDIS_URL) {
      return; // Skip if Redis not configured
    }

    this.log('Starting Redis sync...');
    try {
      // Import Redis client dynamically
      const { default: Redis } = await import('ioredis');
      const redis = new Redis(process.env.REDIS_URL);
      
      // Sync recent frames to Redis for fast access
      const homeDir = process.env.HOME;
      const projectsDb = path.join(homeDir, '.stackmemory', 'projects.db');
      
      if (fs.existsSync(projectsDb)) {
        // Get recent frames from SQLite
        const { stdout } = await execAsync(
          `sqlite3 ${projectsDb} "SELECT frame_id, title, created_at FROM frames WHERE created_at > datetime('now', '-7 days') ORDER BY created_at DESC LIMIT 100"`
        );
        
        const frames = stdout.trim().split('\n').filter(Boolean);
        
        // Store in Redis with expiry
        for (const frame of frames) {
          const [id, title, created] = frame.split('|');
          await redis.setex(
            `frame:${id}`,
            7 * 24 * 60 * 60, // 7 days TTL
            JSON.stringify({ id, title, created })
          );
        }
        
        this.log(`Redis sync completed - ${frames.length} frames cached`);
      }
      
      await redis.quit();
      
      this.stats.redis.count++;
      this.stats.redis.lastSync = new Date();
    } catch (error) {
      this.stats.redis.errors++;
      this.log(`Redis sync failed: ${error.message}`, 'ERROR');
    }
  }

  /**
   * Sync across sessions
   */
  async syncCrossSession() {
    this.log('Starting cross-session sync...');
    try {
      const homeDir = process.env.HOME;
      const sharedContextDir = path.join(homeDir, '.stackmemory', 'shared-context');
      const projectsDir = path.join(sharedContextDir, 'projects');
      
      if (!fs.existsSync(projectsDir)) {
        fs.mkdirSync(projectsDir, { recursive: true });
      }
      
      // Get current project
      const projectName = path.basename(process.cwd());
      const projectFile = path.join(projectsDir, `${projectName}.json`);
      
      let projectData = { 
        name: projectName, 
        sessions: [],
        lastSync: null,
        contexts: []
      };
      
      if (fs.existsSync(projectFile)) {
        projectData = JSON.parse(fs.readFileSync(projectFile, 'utf8'));
      }
      
      // Update sync timestamp
      projectData.lastSync = new Date().toISOString();
      
      // Add current session info
      const sessionId = process.env.STACKMEMORY_SESSION_ID || 'unknown';
      const existingSession = projectData.sessions.find(s => s.id === sessionId);
      
      if (existingSession) {
        existingSession.lastActive = new Date().toISOString();
      } else {
        projectData.sessions.push({
          id: sessionId,
          startTime: new Date().toISOString(),
          lastActive: new Date().toISOString()
        });
      }
      
      // Keep only recent sessions (last 30 days)
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      projectData.sessions = projectData.sessions.filter(s => 
        new Date(s.lastActive) > thirtyDaysAgo
      );
      
      fs.writeFileSync(projectFile, JSON.stringify(projectData, null, 2));
      
      this.stats.crossSession.count++;
      this.stats.crossSession.lastSync = new Date();
      this.log(`Cross-session sync completed - ${projectData.sessions.length} active sessions`);
    } catch (error) {
      this.stats.crossSession.errors++;
      this.log(`Cross-session sync failed: ${error.message}`, 'ERROR');
    }
  }

  /**
   * Run all sync tasks
   */
  async runSync(taskName) {
    switch (taskName) {
      case 'linear':
        await this.syncLinear();
        break;
      case 'context':
        await this.syncContext();
        break;
      case 'backup':
        await this.syncBackup();
        break;
      case 'redis':
        await this.syncRedis();
        break;
      case 'crossSession':
        await this.syncCrossSession();
        break;
    }
  }

  /**
   * Start the sync manager
   */
  async start() {
    if (this.isRunning) {
      this.log('Sync manager already running', 'WARN');
      return;
    }

    this.isRunning = true;
    this.log('🚀 StackMemory Background Sync Manager starting...');
    this.log(`📅 Sync intervals:`);
    this.log(`  Linear: every ${SYNC_INTERVALS.linear / 60000} minutes`);
    this.log(`  Context: every ${SYNC_INTERVALS.context / 60000} minutes`);
    this.log(`  Backup: every ${SYNC_INTERVALS.backup / 3600000} hours`);
    this.log(`  Redis: every ${SYNC_INTERVALS.redis / 60000} minutes`);
    this.log(`  Cross-session: every ${SYNC_INTERVALS.crossSession / 60000} minutes`);
    
    // Run initial sync for all tasks
    await this.syncLinear();
    await this.syncContext();
    await this.syncCrossSession();
    
    // Schedule recurring syncs
    this.syncTasks.set('linear', setInterval(() => this.runSync('linear'), SYNC_INTERVALS.linear));
    this.syncTasks.set('context', setInterval(() => this.runSync('context'), SYNC_INTERVALS.context));
    this.syncTasks.set('backup', setInterval(() => this.runSync('backup'), SYNC_INTERVALS.backup));
    this.syncTasks.set('redis', setInterval(() => this.runSync('redis'), SYNC_INTERVALS.redis));
    this.syncTasks.set('crossSession', setInterval(() => this.runSync('crossSession'), SYNC_INTERVALS.crossSession));
    
    this.log('⏰ All sync tasks scheduled');
    
    // Handle graceful shutdown
    process.on('SIGINT', () => this.stop());
    process.on('SIGTERM', () => this.stop());
  }

  /**
   * Stop the sync manager
   */
  stop() {
    this.log('🛑 Stopping Background Sync Manager...');
    
    // Clear all intervals
    for (const [name, interval] of this.syncTasks) {
      clearInterval(interval);
    }
    this.syncTasks.clear();
    
    // Log final stats
    this.log('📊 Final statistics:');
    for (const [name, stats] of Object.entries(this.stats)) {
      if (stats.count > 0) {
        this.log(`  ${name}: ${stats.count} syncs, ${stats.errors} errors`);
      }
    }
    
    this.isRunning = false;
    this.log('👋 Sync manager stopped');
    process.exit(0);
  }

  /**
   * Get status
   */
  getStatus() {
    return {
      running: this.isRunning,
      stats: this.stats,
      tasks: Array.from(this.syncTasks.keys())
    };
  }
}

// Start the manager
const manager = new BackgroundSyncManager();
manager.start();