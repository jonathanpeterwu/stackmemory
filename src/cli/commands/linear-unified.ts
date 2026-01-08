/**
 * Unified Linear CLI Commands
 * Consolidates all Linear operations into a single, coherent interface
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { UnifiedLinearSync, UnifiedSyncConfig, SyncStats, DEFAULT_UNIFIED_CONFIG } from '../../integrations/linear/unified-sync.js';
import { LinearAuthManager } from '../../integrations/linear/auth.js';
import { LinearClient } from '../../integrations/linear/client.js';
import { PebblesTaskStore } from '../../features/tasks/pebbles-task-store.js';
import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, readFileSync } from 'fs';
import { logger } from '../../core/monitoring/logger.js';
import Table from 'cli-table3';
import ora from 'ora';

export function registerUnifiedLinearCommands(parent: Command) {
  const linear = parent
    .command('linear')
    .description('Unified Linear integration with duplicate detection and task planning');

  // Main sync command with all features
  linear
    .command('sync')
    .description('Intelligent sync with Linear (duplicate detection, bidirectional, task planning)')
    .option('-d, --direction <dir>', 'Sync direction: bidirectional, to_linear, from_linear', 'bidirectional')
    .option('-t, --team <id>', 'Linear team ID')
    .option('--no-duplicates', 'Disable duplicate detection')
    .option('--merge-strategy <strategy>', 'Duplicate handling: merge_content, skip, create_anyway', 'merge_content')
    .option('--conflict <resolution>', 'Conflict resolution: newest_wins, linear_wins, local_wins', 'newest_wins')
    .option('--task-plan', 'Enable task planning integration')
    .option('--dry-run', 'Preview changes without syncing')
    .option('--daemon', 'Run as background daemon')
    .option('-i, --interval <minutes>', 'Auto-sync interval', '15')
    .option('--verbose', 'Show detailed sync progress')
    .action(async (options) => {
      const spinner = ora('Initializing Linear sync...').start();
      
      try {
        const projectRoot = process.cwd();
        const dbPath = join(projectRoot, '.stackmemory', 'context.db');

        if (!existsSync(dbPath)) {
          spinner.fail('StackMemory not initialized');
          console.log(chalk.yellow('Run "stackmemory init" first'));
          return;
        }

        // Initialize components
        const db = new Database(dbPath);
        const taskStore = new PebblesTaskStore(projectRoot, db);
        const authManager = new LinearAuthManager(projectRoot);

        // Build config from options
        const config: Partial<UnifiedSyncConfig> = {
          direction: options.direction,
          defaultTeamId: options.team,
          duplicateDetection: options.duplicates !== false,
          mergeStrategy: options.mergeStrategy,
          conflictResolution: options.conflict,
          taskPlanningEnabled: options.taskPlan || false,
        };

        // Create unified sync instance
        const unifiedSync = new UnifiedLinearSync(taskStore, authManager, projectRoot, config);

        // Listen to events for progress
        if (options.verbose) {
          unifiedSync.on('sync:started', ({ config }) => {
            spinner.text = `Syncing (${config.direction})...`;
          });
        }

        // Initialize
        spinner.text = 'Authenticating with Linear...';
        await unifiedSync.initialize();

        if (options.dryRun) {
          spinner.info('Dry run mode - no changes will be made');
          // TODO: Implement dry run preview
          return;
        }

        if (options.daemon) {
          // Daemon mode
          spinner.succeed('Starting sync daemon');
          console.log(chalk.cyan(`Sync interval: ${options.interval} minutes`));
          console.log(chalk.gray('Press Ctrl+C to stop\n'));

          // Initial sync
          const stats = await unifiedSync.sync();
          displaySyncStats(stats);

          // Schedule periodic syncs
          const interval = setInterval(async () => {
            console.log(chalk.yellow(`\n[${new Date().toLocaleTimeString()}] Running scheduled sync...`));
            try {
              const stats = await unifiedSync.sync();
              displaySyncStats(stats);
            } catch (error: unknown) {
              console.error(chalk.red('Sync failed:'), (error as Error).message);
            }
          }, parseInt(options.interval) * 60 * 1000);

          // Handle graceful shutdown
          process.on('SIGINT', () => {
            console.log(chalk.yellow('\nStopping sync daemon...'));
            clearInterval(interval);
            db.close();
            process.exit(0);
          });

          // Keep process alive
          process.stdin.resume();
        } else {
          // Single sync
          spinner.text = 'Syncing tasks...';
          const stats = await unifiedSync.sync();
          
          spinner.succeed('Sync completed');
          displaySyncStats(stats);

          // Show task plan if enabled
          if (options.taskPlan) {
            displayTaskPlan(projectRoot);
          }

          db.close();
        }
      } catch (error: unknown) {
        spinner.fail('Sync failed');
        console.error(chalk.red('Error:'), (error as Error).message);
        if (options.verbose) {
          console.error(error);
        }
        process.exit(1);
      }
    });

  // Quick status command
  linear
    .command('status')
    .description('Show Linear connection status and sync statistics')
    .action(async () => {
      try {
        const authManager = new LinearAuthManager(process.cwd());
        const hasAuth = authManager.isConfigured();

        if (!hasAuth && !process.env.LINEAR_API_KEY) {
          console.log(chalk.yellow('⚠ Not connected to Linear'));
          console.log('Run "stackmemory linear auth" to connect');
          return;
        }

        console.log(chalk.green('✓ Linear connection configured'));

        // Show last sync stats if available
        const statsFile = join(process.cwd(), '.stackmemory', 'sync-stats.json');
        if (existsSync(statsFile)) {
          const stats = JSON.parse(readFileSync(statsFile, 'utf8'));
          console.log(chalk.cyan('\nLast sync:'));
          console.log(`  Time: ${new Date(stats.timestamp).toLocaleString()}`);
          console.log(`  Duration: ${stats.duration}ms`);
          console.log(`  To Linear: ${stats.toLinear.created} created, ${stats.toLinear.updated} updated`);
          console.log(`  From Linear: ${stats.fromLinear.created} created, ${stats.fromLinear.updated} updated`);
          
          if (stats.toLinear.duplicatesMerged > 0) {
            console.log(chalk.green(`  Duplicates prevented: ${stats.toLinear.duplicatesMerged}`));
          }
        }

        // Show task plan status
        const planFile = join(process.cwd(), '.stackmemory', 'task-plan.md');
        if (existsSync(planFile)) {
          console.log(chalk.cyan('\n✓ Task planning enabled'));
          const reportFile = join(process.cwd(), '.stackmemory', 'task-report.md');
          if (existsSync(reportFile)) {
            console.log(`  Report: ${reportFile}`);
          }
        }
      } catch (error: unknown) {
        console.error(chalk.red('Status check failed:'), (error as Error).message);
      }
    });

  // Task planning command
  linear
    .command('plan')
    .description('View and manage task planning')
    .option('--generate', 'Generate task plan from current tasks')
    .option('--report', 'Show task report')
    .action(async (options) => {
      try {
        const projectRoot = process.cwd();
        
        if (options.generate) {
          console.log(chalk.yellow('Generating task plan...'));
          // Run sync with task planning enabled
          const dbPath = join(projectRoot, '.stackmemory', 'context.db');
          const db = new Database(dbPath);
          const taskStore = new PebblesTaskStore(projectRoot, db);
          const authManager = new LinearAuthManager(projectRoot);
          
          const unifiedSync = new UnifiedLinearSync(taskStore, authManager, projectRoot, {
            taskPlanningEnabled: true,
            autoCreateTaskPlan: true,
          });
          
          await unifiedSync.initialize();
          await unifiedSync.sync();
          
          console.log(chalk.green('✓ Task plan generated'));
          db.close();
        }
        
        displayTaskPlan(projectRoot, options.report);
      } catch (error: unknown) {
        console.error(chalk.red('Plan generation failed:'), (error as Error).message);
      }
    });

  // Duplicate detection command
  linear
    .command('duplicates')
    .description('Check for and manage duplicate Linear issues')
    .option('--check <title>', 'Check if a title would create a duplicate')
    .option('--merge', 'Merge detected duplicates')
    .option('--list', 'List potential duplicates')
    .action(async (options) => {
      try {
        const authManager = new LinearAuthManager(process.cwd());
        const token = await authManager.getValidToken();
        
        if (!token) {
          console.log(chalk.red('Not authenticated with Linear'));
          return;
        }

        const client = new LinearClient({
          apiKey: token,
          useBearer: authManager.isOAuth(),
        });

        if (options.check) {
          // Import dynamically to avoid circular dependency
          const { LinearDuplicateDetector } = await import('../../integrations/linear/sync-enhanced.js');
          const detector = new LinearDuplicateDetector(client);
          
          console.log(chalk.yellow(`Checking for duplicates of: "${options.check}"`));
          const result = await detector.checkForDuplicate(options.check);
          
          if (result.isDuplicate && result.existingIssue) {
            console.log(chalk.red('⚠ Duplicate detected!'));
            console.log(`  Issue: ${result.existingIssue.identifier} - ${result.existingIssue.title}`);
            console.log(`  Similarity: ${Math.round((result.similarity || 0) * 100)}%`);
            console.log(`  URL: ${result.existingIssue.url}`);
          } else {
            console.log(chalk.green('✓ No duplicates found'));
          }
        } else if (options.list) {
          console.log(chalk.yellow('Scanning for potential duplicates...'));
          // TODO: Implement duplicate scanning
          console.log('Feature coming soon');
        } else {
          console.log('Specify --check, --merge, or --list');
        }
      } catch (error: unknown) {
        console.error(chalk.red('Duplicate check failed:'), (error as Error).message);
      }
    });

  // Auth command (simplified)
  linear
    .command('auth')
    .description('Authenticate with Linear')
    .option('--api-key <key>', 'Use API key')
    .option('--oauth', 'Use OAuth flow')
    .action(async (options) => {
      try {
        const authManager = new LinearAuthManager(process.cwd());

        if (options.apiKey) {
          // Simple API key setup
          process.env.LINEAR_API_KEY = options.apiKey;
          console.log(chalk.green('✓ API key configured'));
          
          // Test connection
          const client = new LinearClient({ apiKey: options.apiKey });
          const user = await client.getViewer();
          console.log(chalk.cyan(`Connected as: ${user.name} (${user.email})`));
        } else {
          console.log(chalk.cyan('Linear Authentication'));
          console.log('\nOption 1: API Key (Recommended for automation)');
          console.log('  1. Go to: https://linear.app/settings/api');
          console.log('  2. Create a personal API key');
          console.log('  3. Run: stackmemory linear auth --api-key YOUR_KEY');
          console.log('\nOption 2: OAuth (For user-facing apps)');
          console.log('  Configure OAuth app and use linear-oauth-server');
        }
      } catch (error: unknown) {
        console.error(chalk.red('Authentication failed:'), (error as Error).message);
      }
    });
}

/**
 * Display sync statistics
 */
function displaySyncStats(stats: SyncStats): void {
  const table = new Table({
    head: ['Direction', 'Created', 'Updated', 'Merged', 'Skipped'],
    style: { head: ['cyan'] },
  });

  table.push(
    ['→ Linear', stats.toLinear.created, stats.toLinear.updated, stats.toLinear.duplicatesMerged, stats.toLinear.skipped],
    ['← Linear', stats.fromLinear.created, stats.fromLinear.updated, '-', stats.fromLinear.skipped]
  );

  console.log('\n' + table.toString());

  if (stats.conflicts.length > 0) {
    console.log(chalk.yellow(`\n⚠ Conflicts: ${stats.conflicts.length}`));
    stats.conflicts.slice(0, 5).forEach((c) => {
      console.log(`  - ${c.reason}`);
    });
  }

  if (stats.errors.length > 0) {
    console.log(chalk.red(`\n❌ Errors: ${stats.errors.length}`));
    stats.errors.slice(0, 5).forEach((e: string) => {
      console.log(`  - ${e.substring(0, 100)}`);
    });
  }

  console.log(chalk.gray(`\nCompleted in ${stats.duration}ms`));
}

/**
 * Display task plan
 */
function displayTaskPlan(projectRoot: string, showReport = false): void {
  const reportFile = join(projectRoot, '.stackmemory', 'task-report.md');
  const planFile = join(projectRoot, '.stackmemory', 'task-plan.json');

  if (showReport && existsSync(reportFile)) {
    const report = readFileSync(reportFile, 'utf8');
    console.log('\n' + report);
  } else if (existsSync(planFile)) {
    const plan = JSON.parse(readFileSync(planFile, 'utf8'));
    
    console.log(chalk.cyan('\n📋 Task Plan Overview'));
    console.log(`Last updated: ${new Date(plan.lastUpdated).toLocaleString()}\n`);

    plan.phases.forEach((phase) => {
      console.log(chalk.yellow(`${phase.name} (${phase.tasks.length})`));
      console.log(chalk.gray(`  ${phase.description}`));
      
      if (phase.tasks.length > 0) {
        phase.tasks.slice(0, 5).forEach((task) => {
          const status = task.linearId ? '🔗' : '  ';
          console.log(`  ${status} ${task.title}`);
        });
        
        if (phase.tasks.length > 5) {
          console.log(chalk.gray(`     ...and ${phase.tasks.length - 5} more`));
        }
      }
      console.log();
    });
  } else {
    console.log(chalk.yellow('No task plan found. Run sync with --task-plan to generate.'));
  }
}