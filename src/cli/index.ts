#!/usr/bin/env node
/**
 * StackMemory CLI
 * Command-line interface for StackMemory operations
 */

// Set environment flag for CLI usage to skip async context bridge
process.env['STACKMEMORY_CLI'] = 'true';

// Load environment variables
import 'dotenv/config';

// Initialize tracing system early
import { initializeTracing, trace } from '../core/trace/index.js';
initializeTracing();

import { program } from 'commander';
import { logger } from '../core/monitoring/logger.js';
import { FrameManager } from '../core/context/index.js';
import { sessionManager, FrameQueryMode } from '../core/session/index.js';
import { sharedContextLayer } from '../core/context/shared-context-layer.js';
import { UpdateChecker } from '../core/utils/update-checker.js';
import { ProgressTracker } from '../core/monitoring/progress-tracker.js';
import { registerProjectCommands } from './commands/projects.js';
import { createSessionCommands } from './commands/session.js';
import { isFeatureEnabled, isLocalOnly } from '../core/config/feature-flags.js';
import { registerWorktreeCommands } from './commands/worktree.js';
import { registerOnboardingCommand } from './commands/onboard.js';
import { createTaskCommands } from './commands/tasks.js';
import { createSearchCommand } from './commands/search.js';
import { createLogCommand } from './commands/log.js';
import { createContextCommands } from './commands/context.js';
import { createConfigCommand } from './commands/config.js';
import {
  createCaptureCommand,
  createRestoreCommand,
  createAutoCaptureCommand,
} from './commands/handoff.js';
import {
  createDecisionCommand,
  createMemoryCommand,
} from './commands/decision.js';
import clearCommand from './commands/clear.js';
import serviceCommand from './commands/service.js';
import { registerLoginCommand } from './commands/login.js';
import { registerSignupCommand } from './commands/signup.js';
import { registerLogoutCommand, registerDbCommands } from './commands/db.js';
import { createHooksCommand } from './commands/hooks.js';
import { createDaemonCommand } from './commands/daemon.js';
import { createSweepCommand } from './commands/sweep.js';
import { createShellCommand } from './commands/shell.js';
import { createAPICommand } from './commands/api.js';
import { createCleanupProcessesCommand } from './commands/cleanup-processes.js';
import { createAutoBackgroundCommand } from './commands/auto-background.js';
import { createSettingsCommand } from './commands/settings.js';
import { createRetrievalCommands } from './commands/retrieval.js';
import { createDiscoveryCommands } from './commands/discovery.js';
import { createModelCommand } from './commands/model.js';
import { registerSetupCommands } from './commands/setup.js';
import { ProjectManager } from '../core/projects/project-manager.js';
import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { enableChromaDB } from '../core/config/storage-config.js';
import { spawn } from 'child_process';
import { homedir } from 'os';

// Read version from package.json
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pkg = require('../../package.json');
const VERSION = pkg.version;

// Check for updates on CLI startup
UpdateChecker.checkForUpdates(VERSION, true).catch(() => {
  // Silently ignore errors
});

// Auto-start webhook and ngrok if notifications are enabled
async function startNotificationServices(): Promise<void> {
  // Skip in local-only mode
  if (isLocalOnly() || !isFeatureEnabled('whatsapp')) return;

  try {
    const { loadSMSConfig } = await import('../hooks/sms-notify.js');
    const config = loadSMSConfig();
    if (!config.enabled) return;

    const WEBHOOK_PORT = 3456;
    let webhookStarted = false;
    let ngrokStarted = false;

    // Check if webhook is already running
    const webhookRunning = await fetch(
      `http://localhost:${WEBHOOK_PORT}/health`
    )
      .then((r) => r.ok)
      .catch(() => false);

    if (!webhookRunning) {
      // Start webhook in background using the dist path
      const webhookPath = join(__dirname, '../hooks/sms-webhook.js');
      const webhookProcess = spawn('node', [webhookPath], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, SMS_WEBHOOK_PORT: String(WEBHOOK_PORT) },
      });
      webhookProcess.unref();
      webhookStarted = true;
    }

    // Check if ngrok is running
    const ngrokRunning = await fetch('http://localhost:4040/api/tunnels')
      .then((r) => r.ok)
      .catch(() => false);

    if (!ngrokRunning) {
      // Start ngrok in background
      const ngrokProcess = spawn('ngrok', ['http', String(WEBHOOK_PORT)], {
        detached: true,
        stdio: 'ignore',
      });
      ngrokProcess.unref();
      ngrokStarted = true;
    }

    // Save ngrok URL after startup
    if (webhookStarted || ngrokStarted) {
      setTimeout(async () => {
        try {
          const tunnels = await fetch('http://localhost:4040/api/tunnels').then(
            (r) =>
              r.json() as Promise<{ tunnels: Array<{ public_url: string }> }>
          );
          const publicUrl = tunnels?.tunnels?.[0]?.public_url;
          if (publicUrl) {
            const configDir = join(homedir(), '.stackmemory');
            const configPath = join(configDir, 'ngrok-url.txt');
            const { writeFileSync, mkdirSync, existsSync } = await import('fs');
            if (!existsSync(configDir)) {
              mkdirSync(configDir, { recursive: true });
            }
            writeFileSync(configPath, publicUrl);
            console.log(
              chalk.gray(`[notify] Webhook: ${publicUrl}/sms/incoming`)
            );
          }
        } catch {
          // Ignore errors
        }
      }, 4000);
    }
  } catch {
    // Silently ignore - notifications are optional
  }
}

startNotificationServices();

program
  .name('stackmemory')
  .description(
    'Lossless memory runtime for AI coding tools - organizes context as a call stack instead of linear chat logs, with team collaboration and infinite retention'
  )
  .version(VERSION);

program
  .command('init')
  .description(
    'Initialize StackMemory in current project (zero-config by default)'
  )
  .option('-i, --interactive', 'Interactive mode with configuration prompts')
  .option(
    '--chromadb',
    'Enable ChromaDB for semantic search (prompts for API key)'
  )
  .option('--daemon', 'Start the background daemon after initialization')
  .action(async (options) => {
    try {
      const projectRoot = process.cwd();
      const dbDir = join(projectRoot, '.stackmemory');

      // Check if already initialized
      const alreadyInit = existsSync(join(dbDir, 'context.db'));
      if (alreadyInit && !options.interactive) {
        console.log(chalk.yellow('StackMemory already initialized.'));
        console.log(chalk.gray('Run with --interactive to reconfigure.'));
        return;
      }

      if (!existsSync(dbDir)) {
        mkdirSync(dbDir, { recursive: true });
      }

      // Zero-config by default - just use SQLite, no questions
      if (options.chromadb) {
        await promptAndEnableChromaDB();
      } else if (options.interactive && process.stdin.isTTY) {
        // Only ask questions in interactive mode
        console.log(chalk.cyan('\nStorage Configuration'));
        console.log(
          chalk.gray('SQLite (default) is fast and requires no setup.')
        );
        console.log(
          chalk.gray('ChromaDB adds semantic search but requires an API key.\n')
        );

        const { enableChroma } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'enableChroma',
            message: 'Enable ChromaDB for semantic search?',
            default: false,
          },
        ]);

        if (enableChroma) {
          await promptAndEnableChromaDB();
        }
      }

      // Initialize SQLite database
      const dbPath = join(dbDir, 'context.db');
      const db = new Database(dbPath);
      new FrameManager(db, 'cli-project');

      logger.info('StackMemory initialized successfully', { projectRoot });
      console.log(chalk.green('\n[OK] StackMemory initialized'));
      console.log(chalk.gray(`    Project: ${projectRoot}`));
      console.log(chalk.gray(`    Storage: SQLite (local)`));

      db.close();

      // Install daemon service if requested
      if (options.daemon) {
        console.log(chalk.cyan('\nInstalling background service...'));
        try {
          const { installServiceSilent } =
            await import('./commands/service.js');
          const success = await installServiceSilent();
          if (success) {
            console.log(chalk.green('[OK] Guardian service installed'));
            console.log(chalk.gray('    Auto-starts on login'));
            console.log(
              chalk.gray('    Check status: stackmemory service status')
            );
          } else {
            console.log(chalk.yellow('[WARN] Could not install service'));
            console.log(chalk.gray('  Run: stackmemory service install'));
          }
        } catch {
          console.log(chalk.yellow('[WARN] Could not install service'));
          console.log(chalk.gray('  Run: stackmemory service install'));
        }
      }

      // Show next steps
      console.log(chalk.cyan('\nNext steps:'));
      console.log(
        chalk.white('  1. stackmemory setup-mcp') +
          chalk.gray('  # Configure Claude Code integration')
      );
      console.log(
        chalk.white('  2. stackmemory status') +
          chalk.gray('     # Check status')
      );
      console.log(
        chalk.white('  3. stackmemory doctor') +
          chalk.gray('     # Diagnose issues')
      );
    } catch (error: unknown) {
      logger.error('Failed to initialize StackMemory', error as Error);
      console.error(chalk.red('\n[ERROR] Initialization failed'));
      console.error(chalk.gray(`  Reason: ${(error as Error).message}`));
      console.error(
        chalk.gray(
          '  Fix: Ensure you have write permissions to the current directory'
        )
      );
      console.error(chalk.gray('  Run: stackmemory doctor'));
      process.exit(1);
    }
  });

/**
 * Prompt user for ChromaDB configuration and enable it
 */
async function promptAndEnableChromaDB(): Promise<void> {
  const answers = await inquirer.prompt([
    {
      type: 'password',
      name: 'apiKey',
      message: 'Enter your ChromaDB API key:',
      validate: (input: string) => {
        if (!input || input.trim().length === 0) {
          return 'API key is required for ChromaDB';
        }
        return true;
      },
    },
    {
      type: 'input',
      name: 'apiUrl',
      message: 'ChromaDB API URL (press Enter for default):',
      default: 'https://api.trychroma.com',
    },
  ]);

  enableChromaDB({
    apiKey: answers.apiKey,
    apiUrl: answers.apiUrl,
  });

  console.log(chalk.green('[OK] ChromaDB enabled for semantic search.'));
  console.log(
    chalk.gray('API key saved to ~/.stackmemory/storage-config.json')
  );
}

program
  .command('status')
  .description('Show current StackMemory status')
  .option('--all', 'Show all active frames across sessions')
  .option('--project', 'Show all active frames in current project')
  .option('--session <id>', 'Show frames for specific session')
  .action(async (options) => {
    return trace.command('stackmemory-status', options, async () => {
      try {
        const projectRoot = process.cwd();
        const dbPath = join(projectRoot, '.stackmemory', 'context.db');

        if (!existsSync(dbPath)) {
          console.log(
            '❌ StackMemory not initialized. Run "stackmemory init" first.'
          );
          return;
        }

        // Check for updates and display if available
        await UpdateChecker.checkForUpdates(VERSION);

        // Initialize session manager and shared context
        await sessionManager.initialize();
        await sharedContextLayer.initialize();

        const session = await sessionManager.getOrCreateSession({
          projectPath: projectRoot,
          sessionId: options.session,
        });

        // Auto-discover shared context on startup
        const contextDiscovery = await sharedContextLayer.autoDiscoverContext();

        // Show context hints if available
        if (
          contextDiscovery.hasSharedContext &&
          contextDiscovery.sessionCount > 1
        ) {
          console.log(`\n💡 Shared Context Available:`);
          console.log(
            `   ${contextDiscovery.sessionCount} sessions with shared context`
          );

          if (contextDiscovery.recentPatterns.length > 0) {
            console.log(`   Recent patterns:`);
            contextDiscovery.recentPatterns.slice(0, 3).forEach((p) => {
              console.log(
                `     • ${p.type}: ${p.pattern.slice(0, 50)} (${p.frequency}x)`
              );
            });
          }

          if (contextDiscovery.lastDecisions.length > 0) {
            console.log(
              `   Last decision: ${contextDiscovery.lastDecisions[0].decision.slice(0, 60)}`
            );
          }
        }

        const db = new Database(dbPath);
        const frameManager = new FrameManager(db, session.projectId);

        // Set query mode based on options
        if (options.all) {
          frameManager.setQueryMode(FrameQueryMode.ALL_ACTIVE);
        } else if (options.project) {
          frameManager.setQueryMode(FrameQueryMode.PROJECT_ACTIVE);
        }

        const activeFrames = frameManager.getActiveFramePath();
        const stackDepth = frameManager.getStackDepth();

        // Always get total counts across all sessions
        const totalStats = db
          .prepare(
            `
        SELECT 
          COUNT(*) as total_frames,
          SUM(CASE WHEN state = 'active' THEN 1 ELSE 0 END) as active_frames,
          SUM(CASE WHEN state = 'closed' THEN 1 ELSE 0 END) as closed_frames,
          COUNT(DISTINCT run_id) as total_sessions
        FROM frames
        WHERE project_id = ?
      `
          )
          .get(session.projectId) as {
          total_frames: number;
          active_frames: number;
          closed_frames: number;
          total_sessions: number;
        };

        const contextCount = db
          .prepare(
            `
        SELECT COUNT(*) as count FROM contexts
      `
          )
          .get() as { count: number };

        const eventCount = db
          .prepare(
            `
        SELECT COUNT(*) as count FROM events e
        JOIN frames f ON e.frame_id = f.frame_id
        WHERE f.project_id = ?
      `
          )
          .get(session.projectId) as { count: number };

        console.log('📊 StackMemory Status:');
        console.log(
          `   Session: ${session.sessionId.slice(0, 8)} (${session.state}, ${Math.round((Date.now() - session.startedAt) / 1000 / 60)}min old)`
        );
        console.log(`   Project: ${session.projectId}`);
        if (session.branch) {
          console.log(`   Branch: ${session.branch}`);
        }

        // Show total database statistics
        console.log(`\n   Database Statistics (this project):`);
        console.log(
          `     Frames: ${totalStats.total_frames || 0} (${totalStats.active_frames || 0} active, ${totalStats.closed_frames || 0} closed)`
        );
        console.log(`     Events: ${eventCount.count || 0}`);
        console.log(`     Sessions: ${totalStats.total_sessions || 0}`);
        console.log(
          `     Cached contexts: ${contextCount.count || 0} (global)`
        );

        // Show recent activity
        const recentFrames = db
          .prepare(
            `
        SELECT name, type, state, datetime(created_at, 'unixepoch') as created
        FROM frames
        WHERE project_id = ?
        ORDER BY created_at DESC
        LIMIT 3
      `
          )
          .all(session.projectId) as Array<{
          name: string;
          type: string;
          state: string;
          created: string;
        }>;

        if (recentFrames.length > 0) {
          console.log(`\n   Recent Activity:`);
          recentFrames.forEach((f) => {
            const stateIcon = f.state === 'active' ? '🟢' : '⚫';
            console.log(
              `     ${stateIcon} ${f.name} [${f.type}] - ${f.created}`
            );
          });
        }

        console.log(`\n   Current Session:`);
        console.log(`     Stack depth: ${stackDepth}`);
        console.log(`     Active frames: ${activeFrames.length}`);

        if (activeFrames.length > 0) {
          activeFrames.forEach((frame, i) => {
            const indent = '     ' + '  '.repeat(frame.depth || i);
            const prefix = i === 0 ? '└─' : '  └─';
            console.log(`${indent}${prefix} ${frame.name} [${frame.type}]`);
          });
        }

        // Show other sessions if in default mode
        if (!options.all && !options.project) {
          const otherSessions = await sessionManager.listSessions({
            projectId: session.projectId,
            state: 'active',
          });

          const otherActive = otherSessions.filter(
            (s) => s.sessionId !== session.sessionId
          );
          if (otherActive.length > 0) {
            console.log(`\n   Other Active Sessions (same project):`);
            otherActive.forEach((s) => {
              const age = Math.round(
                (Date.now() - s.lastActiveAt) / 1000 / 60 / 60
              );
              console.log(
                `     - ${s.sessionId.slice(0, 8)}: ${s.branch || 'main'}, ${age}h old`
              );
            });
            console.log(`\n   Tip: Use --all to see frames across sessions`);
          }
        }

        db.close();
      } catch (error: unknown) {
        logger.error('Failed to get status', error as Error);
        console.error('❌ Status check failed:', (error as Error).message);
        process.exit(1);
      }
    });
  });

program
  .command('update-check')
  .description('Check for StackMemory updates')
  .action(async () => {
    try {
      console.log('🔍 Checking for updates...');
      await UpdateChecker.forceCheck(VERSION);
    } catch (error: unknown) {
      logger.error('Update check failed', error as Error);
      console.error('❌ Update check failed:', (error as Error).message);
      process.exit(1);
    }
  });

program
  .command('progress')
  .description('Show current progress and recent changes')
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

      const progress = new ProgressTracker(projectRoot);
      console.log(progress.getSummary());
    } catch (error: unknown) {
      logger.error('Failed to show progress', error as Error);
      console.error('❌ Failed to show progress:', (error as Error).message);
      process.exit(1);
    }
  });

program
  .command('mcp-server')
  .description('Start StackMemory MCP server for Claude Desktop')
  .option('-p, --project <path>', 'Project root directory', process.cwd())
  .action(async (options) => {
    try {
      const { runMCPServer } = await import('../integrations/mcp/server.js');

      // Set project root
      process.env['PROJECT_ROOT'] = options.project;

      console.log('🚀 Starting StackMemory MCP Server...');
      console.log(`   Project: ${options.project}`);
      console.log(`   Version: ${VERSION}`);

      // Check for updates silently
      UpdateChecker.checkForUpdates(VERSION, true).catch(() => {});

      // Start the MCP server
      await runMCPServer();
    } catch (error: unknown) {
      logger.error('Failed to start MCP server', error as Error);
      console.error('❌ MCP server failed:', (error as Error).message);
      process.exit(1);
    }
  });

// Add test context command
program
  .command('context:test')
  .description('Test context persistence by creating sample frames')
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

      // Create test frames
      console.log('📝 Creating test context frames...');

      const rootFrame = frameManager.createFrame({
        type: 'task',
        name: 'Test Session',
        inputs: { test: true, timestamp: new Date().toISOString() },
      });

      const taskFrame = frameManager.createFrame({
        type: 'subtask',
        name: 'Sample Task',
        inputs: { description: 'Testing context persistence' },
        parentFrameId: rootFrame,
      });

      const commandFrame = frameManager.createFrame({
        type: 'tool_scope',
        name: 'test-command',
        inputs: { args: ['--test'] },
        parentFrameId: taskFrame,
      });

      // Add some events
      frameManager.addEvent(
        'observation',
        {
          message: 'Test event recorded',
        },
        commandFrame
      );

      console.log('✅ Test frames created!');
      console.log(`📊 Stack depth: ${frameManager.getStackDepth()}`);
      console.log(
        `🔄 Active frames: ${frameManager.getActiveFramePath().length}`
      );

      // Close one frame to test state changes
      frameManager.closeFrame(commandFrame);
      console.log(
        `📊 After closing command frame: depth = ${frameManager.getStackDepth()}`
      );

      db.close();
    } catch (error: unknown) {
      logger.error('Test context failed', error as Error);
      console.error('❌ Test failed:', (error as Error).message);
      process.exit(1);
    }
  });

// Register project management commands
// Register command modules
registerOnboardingCommand(program);
registerSignupCommand(program);
registerLoginCommand(program);
registerLogoutCommand(program);
registerDbCommands(program);
registerProjectCommands(program);
registerWorktreeCommands(program);

// Register Linear integration commands (lazy-loaded, optional)
if (isFeatureEnabled('linear')) {
  import('./commands/linear.js')
    .then(({ registerLinearCommands }) => registerLinearCommands(program))
    .catch(() => {
      // Linear integration not available - silently skip
    });
}

// Register session management commands
program.addCommand(createSessionCommands());

// Register enhanced CLI commands
program.addCommand(createTaskCommands());
program.addCommand(createSearchCommand());
program.addCommand(createLogCommand());
program.addCommand(createContextCommands());
program.addCommand(createConfigCommand());
program.addCommand(createCaptureCommand());
program.addCommand(createRestoreCommand());
program.addCommand(createAutoCaptureCommand());
program.addCommand(createDecisionCommand());
program.addCommand(createMemoryCommand());
program.addCommand(clearCommand);
program.addCommand(serviceCommand);
program.addCommand(createHooksCommand());

// Register skills commands (optional, lazy-loaded)
if (isFeatureEnabled('skills')) {
  import('./commands/skills.js')
    .then(({ createSkillsCommand }) =>
      program.addCommand(createSkillsCommand())
    )
    .catch(() => {
      // Skills integration not available - silently skip
    });
}

// Register ralph commands (feature-flagged, lazy-loaded)
// Default ON for development, OFF for npm package users
if (isFeatureEnabled('ralph')) {
  import('./commands/ralph.js')
    .then(({ default: createRalphCommand }) =>
      program.addCommand(createRalphCommand())
    )
    .catch(() => {
      // Ralph integration not available - silently skip
    });
}
program.addCommand(createDaemonCommand());
program.addCommand(createSweepCommand());
program.addCommand(createShellCommand());
program.addCommand(createAPICommand());
program.addCommand(createCleanupProcessesCommand());
program.addCommand(createAutoBackgroundCommand());
program.addCommand(createSettingsCommand());

// Register WhatsApp/SMS commands (lazy-loaded, optional)
if (isFeatureEnabled('whatsapp')) {
  import('./commands/sms-notify.js')
    .then(({ createSMSNotifyCommand }) =>
      program.addCommand(createSMSNotifyCommand())
    )
    .catch(() => {
      // WhatsApp integration not available - silently skip
    });
}
program.addCommand(createRetrievalCommands());
program.addCommand(createDiscoveryCommands());
program.addCommand(createModelCommand());

// Register setup and diagnostic commands
registerSetupCommands(program);

// Register dashboard command
program
  .command('dashboard')
  .description('Display monitoring dashboard in terminal')
  .option('-w, --watch', 'Auto-refresh dashboard')
  .option('-i, --interval <seconds>', 'Refresh interval in seconds', '5')
  .action(async (options) => {
    const { dashboardCommand } = await import('./commands/dashboard.js');
    await dashboardCommand.handler(options);
  });

// Auto-detect current project on startup
if (process.argv.length > 2) {
  try {
    const manager = ProjectManager.getInstance();
    manager.detectProject().catch(() => {
      // Silently fail if not in a project directory
    });
  } catch {
    // Silently fail if database initialization fails (e.g., native module version mismatch)
  }
}

// Only parse when running as main module (not when imported for testing)
const isMainModule =
  import.meta.url === `file://${process.argv[1]}` ||
  process.argv[1]?.endsWith('/stackmemory') ||
  process.argv[1]?.endsWith('index.ts') ||
  process.argv[1]?.includes('tsx');

if (isMainModule) {
  program.parse();
}

export { program };
