#!/usr/bin/env node
/**
 * Dashboard Command - Display monitoring dashboard in terminal
 */

import chalk from 'chalk';
import Table from 'cli-table3';
import { SessionManager } from '../../core/session/session-manager.js';
import { FrameManager } from '../../core/context/index.js';
import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync } from 'fs';

export const dashboardCommand = {
  command: 'dashboard',
  describe: 'Display monitoring dashboard in terminal',
  builder: (yargs: any) => {
    return yargs
      .option('watch', {
        alias: 'w',
        type: 'boolean',
        description: 'Auto-refresh dashboard',
        default: false,
      })
      .option('interval', {
        alias: 'i',
        type: 'number',
        description: 'Refresh interval in seconds',
        default: 5,
      });
  },
  handler: async (argv: any) => {
    const projectRoot = process.cwd();
    const dbPath = join(projectRoot, '.stackmemory', 'context.db');

    if (!existsSync(dbPath)) {
      console.log(
        '❌ StackMemory not initialized. Run "stackmemory init" first.'
      );
      return;
    }

    const displayDashboard = async () => {
      console.clear();

      // Header
      console.log(
        chalk.cyan.bold(
          '═══════════════════════════════════════════════════════'
        )
      );
      console.log(
        chalk.cyan.bold(
          '         🚀 StackMemory Monitoring Dashboard          '
        )
      );
      console.log(
        chalk.cyan.bold(
          '═══════════════════════════════════════════════════════'
        )
      );
      console.log();

      const sessionManager = new SessionManager({ enableMonitoring: false });
      await sessionManager.initialize();

      const db = new Database(dbPath);

      // Get sessions
      const sessions = await sessionManager.listSessions({
        state: 'active',
        limit: 5,
      });

      // Sessions Table
      const sessionsTable = new Table({
        head: [
          chalk.white('Session ID'),
          chalk.white('Status'),
          chalk.white('Branch'),
          chalk.white('Duration'),
          chalk.white('Last Active'),
        ],
        style: { head: [], border: [] },
      });

      sessions.forEach((session) => {
        const duration = Math.round(
          (Date.now() - session.startedAt) / 1000 / 60
        );
        const lastActive = Math.round(
          (Date.now() - session.lastActiveAt) / 1000 / 60
        );
        const status =
          session.state === 'active'
            ? chalk.green('● Active')
            : session.state === 'completed'
              ? chalk.gray('● Completed')
              : chalk.yellow('● Idle');

        sessionsTable.push([
          session.sessionId.substring(0, 8),
          status,
          session.branch || 'main',
          `${duration}m`,
          `${lastActive}m ago`,
        ]);
      });

      console.log(chalk.yellow.bold('📊 Active Sessions'));
      console.log(sessionsTable.toString());
      console.log();

      // Frame Statistics
      const frameStats = db
        .prepare(
          `
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN state = 'active' THEN 1 ELSE 0 END) as active,
          COUNT(DISTINCT run_id) as sessions
        FROM frames
      `
        )
        .get() as any;

      const statsTable = new Table({
        head: [chalk.white('Metric'), chalk.white('Value')],
        style: { head: [], border: [] },
      });

      statsTable.push(
        ['Total Frames', frameStats.total || 0],
        ['Active Frames', chalk.green(frameStats.active || 0)],
        ['Total Sessions', frameStats.sessions || 0]
      );

      console.log(chalk.yellow.bold('📈 Frame Statistics'));
      console.log(statsTable.toString());
      console.log();

      // Recent Activity
      const recentActivity = db
        .prepare(
          `
        SELECT 
          name,
          type,
          state,
          datetime(created_at, 'unixepoch') as created
        FROM frames
        ORDER BY created_at DESC
        LIMIT 5
      `
        )
        .all() as any[];

      if (recentActivity.length > 0) {
        const activityTable = new Table({
          head: [
            chalk.white('Frame'),
            chalk.white('Type'),
            chalk.white('Status'),
            chalk.white('Created'),
          ],
          style: { head: [], border: [] },
        });

        recentActivity.forEach((frame) => {
          const status =
            frame.state === 'active'
              ? chalk.green('Active')
              : chalk.gray('Closed');

          activityTable.push([
            frame.name.substring(0, 30),
            frame.type,
            status,
            frame.created,
          ]);
        });

        console.log(chalk.yellow.bold('🕐 Recent Activity'));
        console.log(activityTable.toString());
        console.log();
      }

      // Memory Usage
      const contextUsage = await estimateContextUsage(db);
      const usageBar = createProgressBar(contextUsage, 100);

      console.log(chalk.yellow.bold('💾 Context Usage'));
      console.log(`${usageBar} ${contextUsage}%`);
      console.log();

      db.close();

      // Footer
      if (argv.watch) {
        console.log(
          chalk.gray(
            `Auto-refreshing every ${argv.interval} seconds. Press Ctrl+C to exit.`
          )
        );
      } else {
        console.log(chalk.gray('Run with --watch to auto-refresh'));
      }
    };

    try {
      await displayDashboard();

      if (argv.watch) {
        const interval = setInterval(async () => {
          await displayDashboard();
        }, argv.interval * 1000);

        process.on('SIGINT', () => {
          clearInterval(interval);
          console.clear();
          console.log(chalk.green('✅ Dashboard closed'));
          process.exit(0);
        });
      }
    } catch (error: unknown) {
      console.error(chalk.red('❌ Dashboard error:'), (error as Error).message);
      process.exit(1);
    }
  },
};

function createProgressBar(value: number, max: number): string {
  const percentage = Math.min(100, Math.round((value / max) * 100));
  const filled = Math.round(percentage / 5);
  const empty = 20 - filled;

  let color = chalk.green;
  if (percentage > 80) color = chalk.red;
  else if (percentage > 60) color = chalk.yellow;

  return color('█'.repeat(filled)) + chalk.gray('░'.repeat(empty));
}

async function estimateContextUsage(db: Database): Promise<number> {
  const result = db
    .prepare(
      `
    SELECT 
      COUNT(*) as frame_count,
      SUM(LENGTH(inputs)) as input_size,
      SUM(LENGTH(outputs)) as output_size
    FROM frames
    WHERE state = 'active'
  `
    )
    .get() as any;

  // Rough estimate: assume average token is 4 bytes
  const totalBytes = (result.input_size || 0) + (result.output_size || 0);
  const estimatedTokens = totalBytes / 4;
  const maxTokens = 128000; // Claude's context window

  return Math.round((estimatedTokens / maxTokens) * 100);
}
