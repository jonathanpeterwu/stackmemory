#!/usr/bin/env node

/**
 * Claude startup hook
 * Loads recent context from ChromaDB and sets up periodic saves
 */

import { ChromaDBContextSaver } from './chromadb-save-hook.js';
import { PeriodicContextSaver } from './periodic-save.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';
import chalk from 'chalk';

const execAsync = promisify(exec);

class StartupContextLoader {
  constructor() {
    this.saver = new ChromaDBContextSaver();
    this.periodicSaver = new PeriodicContextSaver();
  }

  async loadRecentWork(hours = 24) {
    console.log(chalk.cyan('🔄 Loading recent context from ChromaDB...'));
    
    const contexts = await this.saver.loadRecentContext(hours);
    
    if (!contexts || contexts.length === 0) {
      console.log(chalk.yellow('No recent context found'));
      return;
    }

    // Group contexts by type
    const grouped = {};
    contexts.forEach(ctx => {
      if (!grouped[ctx.type]) {
        grouped[ctx.type] = [];
      }
      grouped[ctx.type].push(ctx);
    });

    console.log(chalk.green(`\n✅ Loaded ${contexts.length} context entries:`));
    
    // Display summary
    Object.entries(grouped).forEach(([type, items]) => {
      console.log(`  ${type}: ${items.length} entries`);
      
      // Show last entry of each type
      const last = items[items.length - 1];
      if (last.content) {
        const preview = last.content.substring(0, 100).replace(/\n/g, ' ');
        console.log(`    └─ ${preview}${last.content.length > 100 ? '...' : ''}`);
      }
    });

    // Check for incomplete tasks
    const taskCompletions = grouped['task_complete'] || [];
    const periodicSaves = grouped['periodic_save'] || [];
    
    if (periodicSaves.length > 0) {
      const lastSave = periodicSaves[periodicSaves.length - 1];
      if (lastSave.metadata && lastSave.metadata.uncommittedChanges > 0) {
        console.log(chalk.yellow(`\n⚠️  ${lastSave.metadata.uncommittedChanges} uncommitted changes from last session`));
      }
    }

    return contexts;
  }

  async setupPeriodicSave() {
    console.log(chalk.cyan('\n⏰ Setting up periodic context saves (every 15 minutes)'));
    
    // Create a simple scheduler
    setInterval(async () => {
      try {
        await this.periodicSaver.save();
      } catch (error) {
        console.error('Periodic save failed:', error.message);
      }
    }, 15 * 60 * 1000); // 15 minutes

    // Do an initial save
    await this.periodicSaver.save();
  }

  async checkLinearTasks() {
    try {
      // Check for active STA tasks
      const { stdout } = await execAsync('node scripts/get-active-tasks.js 2>/dev/null', { 
        cwd: path.resolve(process.env.HOME, 'Dev/stackmemory') 
      });
      
      if (stdout && stdout.includes('STA-')) {
        const tasks = stdout.match(/STA-\d+/g) || [];
        if (tasks.length > 0) {
          console.log(chalk.cyan(`\n📋 Active Linear tasks: ${tasks.join(', ')}`));
        }
      }
    } catch {
      // Script doesn't exist or failed
    }
  }

  async showProjectStatus() {
    try {
      const { stdout: branch } = await execAsync('git branch --show-current');
      const { stdout: status } = await execAsync('git status --short');
      
      console.log(chalk.cyan('\n📁 Project Status:'));
      console.log(`  Branch: ${branch.trim()}`);
      
      const changes = status.split('\n').filter(l => l.trim());
      if (changes.length > 0) {
        console.log(`  Changes: ${changes.length} files`);
        changes.slice(0, 5).forEach(change => {
          console.log(`    ${change}`);
        });
        if (changes.length > 5) {
          console.log(`    ... and ${changes.length - 5} more`);
        }
      } else {
        console.log('  Working tree clean');
      }
    } catch {
      // Not a git repo
    }
  }

  async run() {
    console.log(chalk.bold.cyan('\n🚀 Claude Startup - Loading Context\n'));
    
    // Load recent context
    await this.loadRecentWork();
    
    // Show project status
    await this.showProjectStatus();
    
    // Check Linear tasks
    await this.checkLinearTasks();
    
    // Setup periodic saves
    await this.setupPeriodicSave();
    
    console.log(chalk.green('\n✨ Ready to work!\n'));
  }
}

// Main execution
async function main() {
  const loader = new StartupContextLoader();
  await loader.run();
}

// Export for use in other scripts
export { StartupContextLoader };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}