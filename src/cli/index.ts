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
import { FrameManager } from '../core/context/frame-manager.js';
import { sessionManager, FrameQueryMode } from '../core/session/index.js';
import { sharedContextLayer } from '../core/context/shared-context-layer.js';
import { UpdateChecker } from '../core/utils/update-checker.js';
import { ProgressTracker } from '../core/monitoring/progress-tracker.js';
import { registerProjectCommands } from './commands/projects.js';
import { registerLinearCommands } from './commands/linear.js';
import { createSessionCommands } from './commands/session.js';
import { registerWorktreeCommands } from './commands/worktree.js';
import { registerOnboardingCommand } from './commands/onboard.js';
import { createTaskCommands } from './commands/tasks.js';
import { createSearchCommand } from './commands/search.js';
import { createLogCommand } from './commands/log.js';
import { createContextCommands } from './commands/context.js';
import { createConfigCommand } from './commands/config.js';
import { createHandoffCommand } from './commands/handoff.js';
import { createStorageCommand } from './commands/storage.js';
import { createSkillsCommand } from './commands/skills.js';
import { createTestCommand } from './commands/test.js';
import clearCommand from './commands/clear.js';
import createWorkflowCommand from './commands/workflow.js';
import monitorCommand from './commands/monitor.js';
import qualityCommand from './commands/quality.js';
import { registerLoginCommand } from './commands/login.js';
import { registerLogoutCommand, registerDbCommands } from './commands/db.js';
import { ProjectManager } from '../core/projects/project-manager.js';
import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

const VERSION = '0.3.17';

// Check for updates on CLI startup
UpdateChecker.checkForUpdates(VERSION, true).catch(() => {
  // Silently ignore errors
});

program
  .name('stackmemory')
  .description(
    'Lossless memory runtime for AI coding tools - organizes context as a call stack instead of linear chat logs, with team collaboration and infinite retention'
  )
  .version(VERSION);

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
    } catch (error: unknown) {
      logger.error('Failed to initialize StackMemory', error as Error);
      console.error('❌ Initialization failed:', (error as Error).message);
      process.exit(1);
    }
  });

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
registerLoginCommand(program);
registerLogoutCommand(program);
registerDbCommands(program);
registerProjectCommands(program);
registerWorktreeCommands(program);

// Register Linear integration commands
registerLinearCommands(program);

// Register session management commands
program.addCommand(createSessionCommands());

// Register enhanced CLI commands
program.addCommand(createTaskCommands());
program.addCommand(createSearchCommand());
program.addCommand(createLogCommand());
program.addCommand(createContextCommands());
program.addCommand(createConfigCommand());
program.addCommand(createHandoffCommand());
program.addCommand(createStorageCommand());
program.addCommand(createSkillsCommand());
program.addCommand(createTestCommand());
program.addCommand(clearCommand);
program.addCommand(createWorkflowCommand());
program.addCommand(monitorCommand);
program.addCommand(qualityCommand);

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
  const manager = ProjectManager.getInstance();
  manager.detectProject().catch(() => {
    // Silently fail if not in a project directory
  });
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
