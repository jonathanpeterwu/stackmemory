#!/usr/bin/env node

/**
 * Linear Auto-Sync Script
 * Automatically syncs tasks from Linear to local store
 * Can be run via cron job or scheduled task
 */

import { PebblesTaskStore } from '../dist/features/tasks/pebbles-task-store.js';
import { LinearSyncEngine } from '../dist/integrations/linear/sync.js';
import { LinearAuthManager } from '../dist/integrations/linear/auth.js';
import { logger } from '../dist/core/monitoring/logger.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import Database from 'better-sqlite3';

const SYNC_STATE_FILE = '.stackmemory/linear-sync-state.json';
const DEFAULT_SYNC_CONFIG = {
  enabled: true,
  direction: 'from_linear', // Only pull from Linear, don't push local changes
  autoSync: false,
  conflictResolution: 'linear_wins', // Linear is source of truth
  maxBatchSize: 50,
  rateLimitDelay: 500,
};

class LinearAutoSync {
  constructor() {
    this.projectRoot = process.cwd();
    this.lastSyncTime = this.loadLastSyncTime();
  }

  /**
   * Load last sync time from state file
   */
  loadLastSyncTime() {
    const stateFile = join(this.projectRoot, SYNC_STATE_FILE);
    if (existsSync(stateFile)) {
      try {
        const state = JSON.parse(readFileSync(stateFile, 'utf8'));
        return state.lastSyncTime || null;
      } catch (error) {
        console.error('Failed to load sync state:', error.message);
      }
    }
    return null;
  }

  /**
   * Save last sync time to state file
   */
  saveLastSyncTime(timestamp) {
    const stateFile = join(this.projectRoot, SYNC_STATE_FILE);
    const state = {
      lastSyncTime: timestamp,
      lastSyncDate: new Date(timestamp).toISOString(),
    };

    try {
      writeFileSync(stateFile, JSON.stringify(state, null, 2));
    } catch (error) {
      console.error('Failed to save sync state:', error.message);
    }
  }

  /**
   * Run the sync process
   */
  async sync() {
    console.log('🔄 Starting Linear auto-sync...');
    console.log(
      `Last sync: ${this.lastSyncTime ? new Date(this.lastSyncTime).toLocaleString() : 'Never'}`
    );

    // Check for API key
    if (!process.env.LINEAR_API_KEY) {
      console.error('❌ LINEAR_API_KEY environment variable not set');
      console.log('Set it with: export LINEAR_API_KEY="your-api-key"');
      process.exit(1);
    }

    try {
      // Check if StackMemory is initialized
      const dbPath = join(this.projectRoot, '.stackmemory', 'context.db');
      if (!existsSync(dbPath)) {
        console.error(
          '❌ StackMemory not initialized. Run "stackmemory init" first.'
        );
        process.exit(1);
      }

      // Initialize components
      const db = new Database(dbPath);
      const taskStore = new PebblesTaskStore(this.projectRoot, db);
      const authManager = new LinearAuthManager(this.projectRoot);
      const syncEngine = new LinearSyncEngine(
        taskStore,
        authManager,
        DEFAULT_SYNC_CONFIG,
        this.projectRoot
      );

      // Run sync
      const startTime = Date.now();
      const result = await syncEngine.sync();
      const duration = ((Date.now() - startTime) / 1000).toFixed(2);

      // Display results
      if (result.success) {
        console.log(`✅ Sync completed in ${duration}s`);
        console.log(`   From Linear: ${result.synced.fromLinear} created`);
        console.log(`   Updated: ${result.synced.updated} tasks`);

        if (result.conflicts.length > 0) {
          console.log(`\n⚠️  Conflicts (${result.conflicts.length}):`);
          result.conflicts.forEach((c) => {
            console.log(`   - Task ${c.taskId}: ${c.reason}`);
          });
        }

        // Save sync time
        this.saveLastSyncTime(Date.now());
      } else {
        console.error('❌ Sync failed');
        result.errors.forEach((error) => {
          console.error(`   - ${error}`);
        });
        process.exit(1);
      }

      // Show task summary
      await this.showTaskSummary(taskStore);
    } catch (error) {
      console.error('❌ Sync error:', error.message);
      if (error.stack && process.env.DEBUG) {
        console.error(error.stack);
      }
      process.exit(1);
    }
  }

  /**
   * Show summary of local tasks
   */
  async showTaskSummary(taskStore) {
    const tasks = taskStore.getActiveTasks();

    // Count by status
    const byStatus = {};
    const byPriority = {};
    const linearTasks = [];

    tasks.forEach((task) => {
      byStatus[task.status] = (byStatus[task.status] || 0) + 1;
      byPriority[task.priority] = (byPriority[task.priority] || 0) + 1;

      if (task.title.match(/\[ENG-\d+\]/) || task.title.match(/\[STA-\d+\]/)) {
        linearTasks.push(task);
      }
    });

    console.log('\n📊 Local Task Summary:');
    console.log(`   Total tasks: ${tasks.length}`);
    console.log(`   Linear tasks: ${linearTasks.length}`);
    console.log(`   Local-only tasks: ${tasks.length - linearTasks.length}`);

    console.log('\n   By Status:');
    Object.entries(byStatus).forEach(([status, count]) => {
      console.log(`   - ${status}: ${count}`);
    });

    console.log('\n   By Priority:');
    Object.entries(byPriority).forEach(([priority, count]) => {
      console.log(`   - ${priority}: ${count}`);
    });

    // Show recent Linear tasks
    if (linearTasks.length > 0) {
      console.log('\n   Recent Linear tasks:');
      linearTasks.slice(-5).forEach((task) => {
        const identifier = task.title.match(/\[(\w+-\d+)\]/)?.[1] || '';
        const title = task.title.replace(/\[\w+-\d+\]\s*/, '').substring(0, 50);
        console.log(`   - ${identifier}: ${title}...`);
      });
    }
  }

  /**
   * Run in watch mode - sync every N minutes
   */
  async watch(intervalMinutes = 5) {
    console.log(
      `👀 Running in watch mode (syncing every ${intervalMinutes} minutes)`
    );

    // Initial sync
    await this.sync();

    // Schedule periodic syncs
    setInterval(
      async () => {
        console.log(
          `\n⏰ Running scheduled sync at ${new Date().toLocaleString()}`
        );
        await this.sync();
      },
      intervalMinutes * 60 * 1000
    );

    console.log('\nPress Ctrl+C to stop watching');
  }
}

// CLI execution
async function main() {
  const autoSync = new LinearAutoSync();
  const args = process.argv.slice(2);

  if (args.includes('--watch') || args.includes('-w')) {
    // Watch mode
    const intervalIndex = args.findIndex(
      (a) => a === '--interval' || a === '-i'
    );
    const interval = intervalIndex >= 0 ? parseInt(args[intervalIndex + 1]) : 5;
    await autoSync.watch(interval);
  } else if (args.includes('--help') || args.includes('-h')) {
    // Help
    console.log(`
Linear Auto-Sync Script
-----------------------

Usage:
  npm run linear:sync                    Run one-time sync
  npm run linear:sync -- --watch         Watch mode (sync every 5 minutes)
  npm run linear:sync -- --watch -i 10   Watch mode with custom interval

Options:
  --watch, -w           Run in watch mode
  --interval, -i <min>  Sync interval in minutes (default: 5)
  --help, -h           Show this help

Environment:
  LINEAR_API_KEY       Required - your Linear API key

Example cron job (every 15 minutes):
  */15 * * * * cd /path/to/project && LINEAR_API_KEY=xxx npm run linear:sync
    `);
  } else {
    // One-time sync
    await autoSync.sync();
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

export { LinearAutoSync };
