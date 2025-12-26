#!/usr/bin/env node
/**
 * StackMemory CLI
 * Command-line interface for StackMemory operations
 */

import { program } from 'commander';
import { logger } from '../core/logger.js';
import { FrameManager } from '../core/frame-manager.js';
// import { PebblesTaskStore } from '../pebbles/pebbles-task-store.js';
// TODO: Temporarily disabled due to TypeScript issues in integration files
// import { LinearAuthManager, LinearOAuthSetup } from '../integrations/linear-auth.js';
// import { LinearSyncEngine, DEFAULT_SYNC_CONFIG } from '../integrations/linear-sync.js';
import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

program
  .name('stackmemory')
  .description('Lossless memory runtime for AI coding tools')
  .version('0.1.0');

program
  .command('init')
  .description('Initialize StackMemory in current project')
  .action(async () => {
    try {
      const projectRoot = process.cwd();
      const dbDir = join(projectRoot, '.stackmemory');

      if (!existsSync(dbDir)) {
        mkdirSync(dbDir, { recursive: true });
      }

      const dbPath = join(dbDir, 'context.db');
      const db = new Database(dbPath);
      new FrameManager(db, 'cli-project');

      logger.info('StackMemory initialized successfully', { projectRoot });
      console.log('✅ StackMemory initialized in', projectRoot);

      db.close();
    } catch (error) {
      logger.error('Failed to initialize StackMemory', error as Error);
      console.error('❌ Initialization failed:', (error as Error).message);
      process.exit(1);
    }
  });

program
  .command('status')
  .description('Show current StackMemory status')
  .action(async () => {
    try {
      const projectRoot = process.cwd();
      const dbPath = join(projectRoot, '.stackmemory', 'context.db');

      if (!existsSync(dbPath)) {
        console.log(
          '❌ StackMemory not initialized. Run "stackmemory init" first.'
        );
        return;
      }

      const db = new Database(dbPath);
      const frameManager = new FrameManager(db, 'cli-project');

      const activeFrames = frameManager.getActiveFramePath();
      const stackDepth = frameManager.getStackDepth();

      console.log('📊 StackMemory Status:');
      console.log(`   Stack depth: ${stackDepth}`);
      console.log(`   Active frames: ${activeFrames.length}`);

      if (activeFrames.length > 0) {
        console.log('\\n📚 Active Frames:');
        activeFrames.forEach((frame, i) => {
          const indent = '  '.repeat(i);
          console.log(`${indent}${i + 1}. ${frame.name} (${frame.type})`);
        });
      }

      db.close();
    } catch (error) {
      logger.error('Failed to get status', error as Error);
      console.error('❌ Status check failed:', (error as Error).message);
      process.exit(1);
    }
  });

// TODO: Linear Integration Commands (temporarily disabled due to TypeScript strict mode)
// Linear integration will be available after resolving type issues
/*
const linearCommand = program
  .command('linear')
  .description('Linear API integration commands');

linearCommand
  .command('setup')
  .description('Setup Linear OAuth integration')
  .action(async () => {
    try {
      const projectRoot = process.cwd();
      const linearSetup = new LinearOAuthSetup(projectRoot);
      
      const { authUrl, instructions } = await linearSetup.setupInteractive();
      
      console.log('🔗 Linear OAuth Setup\n');
      
      instructions.forEach(instruction => {
        console.log(instruction);
      });
      
      if (authUrl) {
        console.log('\n📋 Next step: Complete authorization and run:');
        console.log('stackmemory linear authorize <auth-code>');
      }
      
    } catch (error) {
      logger.error('Linear setup failed', error as Error);
      console.error('❌ Setup failed:', (error as Error).message);
      process.exit(1);
    }
  });

linearCommand
  .command('authorize')
  .description('Complete Linear OAuth authorization')
  .argument('<code>', 'Authorization code from Linear')
  .action(async (authCode: string) => {
    try {
      const projectRoot = process.cwd();
      const linearSetup = new LinearOAuthSetup(projectRoot);
      
      const success = await linearSetup.completeAuth(authCode);
      
      if (success) {
        console.log('✅ Linear integration authorized successfully!');
        console.log('🧪 Testing connection...');
        
        const connectionOk = await linearSetup.testConnection();
        if (connectionOk) {
          console.log('✅ Linear connection test passed!');
          console.log('\n🚀 You can now use:');
          console.log('- stackmemory linear sync');
          console.log('- stackmemory linear status');
        } else {
          console.log('⚠️ Linear connection test failed. Check your configuration.');
        }
      } else {
        console.error('❌ Authorization failed. Please try again.');
        process.exit(1);
      }
      
    } catch (error) {
      logger.error('Linear authorization failed', error as Error);
      console.error('❌ Authorization failed:', (error as Error).message);
      process.exit(1);
    }
  });

linearCommand
  .command('status')
  .description('Show Linear integration status')
  .action(async () => {
    try {
      const projectRoot = process.cwd();
      const authManager = new LinearAuthManager(projectRoot);
      
      const isConfigured = authManager.isConfigured();
      
      console.log('📊 Linear Integration Status:');
      console.log(`   Configured: ${isConfigured ? '✅' : '❌'}`);
      
      if (isConfigured) {
        const config = authManager.loadConfig();
        const tokens = authManager.loadTokens();
        
        console.log(`   Client ID: ${config?.clientId ? config.clientId.substring(0, 8) + '...' : 'Not set'}`);
        console.log(`   Tokens: ${tokens ? '✅ Valid' : '❌ Missing'}`);
        
        if (tokens) {
          const expiresIn = Math.floor((tokens.expiresAt - Date.now()) / 1000 / 60);
          console.log(`   Token expires: ${expiresIn > 0 ? `${expiresIn} minutes` : 'Expired'}`);
        }
        
        // Test connection
        console.log('\n🧪 Testing connection...');
        const linearSetup = new LinearOAuthSetup(projectRoot);
        const connectionOk = await linearSetup.testConnection();
        console.log(`   Connection: ${connectionOk ? '✅ OK' : '❌ Failed'}`);
      } else {
        console.log('\n💡 Run "stackmemory linear setup" to get started');
      }
      
    } catch (error) {
      logger.error('Linear status check failed', error as Error);
      console.error('❌ Status check failed:', (error as Error).message);
      process.exit(1);
    }
  });

linearCommand
  .command('sync')
  .description('Sync tasks with Linear')
  .option('-d, --direction <direction>', 'Sync direction: bidirectional, to_linear, from_linear', 'bidirectional')
  .action(async (options) => {
    try {
      const projectRoot = process.cwd();
      const dbPath = join(projectRoot, '.stackmemory', 'context.db');
      
      if (!existsSync(dbPath)) {
        console.log('❌ StackMemory not initialized. Run "stackmemory init" first.');
        return;
      }
      
      const authManager = new LinearAuthManager(projectRoot);
      
      if (!authManager.isConfigured()) {
        console.log('❌ Linear not configured. Run "stackmemory linear setup" first.');
        return;
      }
      
      const db = new Database(dbPath);
      const taskStore = new PebblesTaskStore(projectRoot, db);
      
      const syncConfig = {
        ...DEFAULT_SYNC_CONFIG,
        enabled: true,
        direction: options.direction,
      };
      
      const linearSync = new LinearSyncEngine(taskStore, authManager, syncConfig);
      
      console.log(`🔄 Starting ${options.direction} sync with Linear...`);
      
      const result = await linearSync.sync();
      
      if (result.success) {
        console.log('✅ Sync completed successfully!');
        console.log(`   To Linear: ${result.synced.toLinear} created`);
        console.log(`   From Linear: ${result.synced.fromLinear} created`);
        console.log(`   Updated: ${result.synced.updated}`);
        
        if (result.conflicts.length > 0) {
          console.log(`\n⚠️ Conflicts detected: ${result.conflicts.length}`);
          result.conflicts.forEach(conflict => {
            console.log(`   - ${conflict.taskId}: ${conflict.reason}`);
          });
        }
      } else {
        console.log('❌ Sync failed');
        if (result.errors.length > 0) {
          result.errors.forEach(error => {
            console.log(`   Error: ${error}`);
          });
        }
      }
      
      db.close();
      
    } catch (error) {
      logger.error('Linear sync failed', error as Error);
      console.error('❌ Sync failed:', (error as Error).message);
      process.exit(1);
    }
  });
*/

program.parse();
