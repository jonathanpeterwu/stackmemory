#!/usr/bin/env node
/**
 * StackMemory CLI
 * Command-line interface for StackMemory operations
 */

import { program } from 'commander';
import { logger } from './logger.js';
import { FrameManager } from './frame-manager.js';
import Database from 'better-sqlite3';
import { join, resolve } from 'path';
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
      const frameManager = new FrameManager(db, 'cli-project');
      
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
        console.log('❌ StackMemory not initialized. Run "stackmemory init" first.');
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

program.parse();