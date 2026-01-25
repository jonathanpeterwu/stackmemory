/**
 * Hooks CLI Command
 * Manage StackMemory hook daemon and configuration
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import { spawn } from 'child_process';
import {
  loadConfig,
  saveConfig,
  initConfig,
  getConfigPath,
} from '../../hooks/config.js';
import {
  startDaemon,
  stopDaemon,
  getDaemonStatus,
} from '../../hooks/daemon.js';

export function createHooksCommand(): Command {
  const cmd = new Command('hooks')
    .description(
      'Manage StackMemory hook daemon for suggestions and automation'
    )
    .addHelpText(
      'after',
      `
Examples:
  stackmemory hooks init       Initialize hook configuration
  stackmemory hooks start      Start the hook daemon
  stackmemory hooks stop       Stop the hook daemon
  stackmemory hooks status     Check daemon status
  stackmemory hooks logs       View recent hook logs
  stackmemory hooks config     Show current configuration

The hook daemon watches for file changes and provides:
  - Sweep AI predictions for next edits
  - Context tracking across sessions
  - Custom automation hooks
`
    );

  cmd
    .command('init')
    .description('Initialize hook configuration')
    .action(() => {
      const configPath = getConfigPath();

      if (existsSync(configPath)) {
        console.log(chalk.yellow('Config already exists at:'), configPath);
        console.log(chalk.gray('Use --force to overwrite'));
        return;
      }

      initConfig();
      console.log(chalk.green('Hook configuration initialized'));
      console.log(chalk.gray(`Config: ${configPath}`));
      console.log('');
      console.log(chalk.bold('Next steps:'));
      console.log('  stackmemory hooks start    Start the daemon');
      console.log('  stackmemory hooks config   View configuration');
    });

  cmd
    .command('start')
    .description('Start the hook daemon')
    .option('--foreground', 'Run in foreground (for debugging)')
    .action(async (options) => {
      const status = getDaemonStatus();

      if (status.running) {
        console.log(
          chalk.yellow('Daemon already running'),
          chalk.gray(`(pid: ${status.pid})`)
        );
        return;
      }

      const spinner = ora('Starting hook daemon...').start();

      try {
        await startDaemon({ foreground: options.foreground });

        if (!options.foreground) {
          await new Promise((r) => setTimeout(r, 500));
          const newStatus = getDaemonStatus();

          if (newStatus.running) {
            spinner.succeed(chalk.green('Hook daemon started'));
            console.log(chalk.gray(`PID: ${newStatus.pid}`));
          } else {
            spinner.fail(chalk.red('Failed to start daemon'));
            console.log(chalk.gray('Check logs: stackmemory hooks logs'));
          }
        }
      } catch (error) {
        spinner.fail(chalk.red('Failed to start daemon'));
        console.log(chalk.gray((error as Error).message));
      }
    });

  cmd
    .command('stop')
    .description('Stop the hook daemon')
    .action(() => {
      const status = getDaemonStatus();

      if (!status.running) {
        console.log(chalk.yellow('Daemon not running'));
        return;
      }

      stopDaemon();
      console.log(chalk.green('Hook daemon stopped'));
    });

  cmd
    .command('restart')
    .description('Restart the hook daemon')
    .action(async () => {
      const status = getDaemonStatus();

      if (status.running) {
        stopDaemon();
        await new Promise((r) => setTimeout(r, 500));
      }

      await startDaemon();
      await new Promise((r) => setTimeout(r, 500));

      const newStatus = getDaemonStatus();
      if (newStatus.running) {
        console.log(
          chalk.green('Hook daemon restarted'),
          chalk.gray(`(pid: ${newStatus.pid})`)
        );
      } else {
        console.log(chalk.red('Failed to restart daemon'));
      }
    });

  cmd
    .command('status')
    .description('Check hook daemon status')
    .action(() => {
      const status = getDaemonStatus();
      const config = loadConfig();

      console.log(chalk.bold('\nStackMemory Hook Daemon Status\n'));

      console.log(
        `Daemon: ${status.running ? chalk.green('Running') : chalk.yellow('Stopped')}`
      );

      if (status.running) {
        console.log(chalk.gray(`  PID: ${status.pid}`));
        if (status.uptime) {
          const uptime = Math.round(status.uptime / 1000);
          const mins = Math.floor(uptime / 60);
          const secs = uptime % 60;
          console.log(chalk.gray(`  Uptime: ${mins}m ${secs}s`));
        }
        if (status.eventsProcessed) {
          console.log(
            chalk.gray(`  Events processed: ${status.eventsProcessed}`)
          );
        }
      }

      console.log('');
      console.log(chalk.bold('Configuration:'));
      console.log(
        `  File watch: ${config.file_watch.enabled ? chalk.green('Enabled') : chalk.yellow('Disabled')}`
      );
      console.log(
        `  Extensions: ${chalk.gray(config.file_watch.extensions.join(', '))}`
      );

      console.log('');
      console.log(chalk.bold('Active hooks:'));
      for (const [event, hookConfig] of Object.entries(config.hooks)) {
        if (hookConfig?.enabled) {
          console.log(
            `  ${event}: ${chalk.green(hookConfig.handler)} -> ${hookConfig.output}`
          );
        }
      }

      if (!status.running) {
        console.log('');
        console.log(chalk.bold('To start: stackmemory hooks start'));
      }
    });

  cmd
    .command('logs')
    .description('View hook daemon logs')
    .option('-n, --lines <number>', 'Number of lines to show', '50')
    .option('-f, --follow', 'Follow log output')
    .action((options) => {
      const config = loadConfig();
      const logFile = config.daemon.log_file;

      if (!existsSync(logFile)) {
        console.log(chalk.yellow('No log file found'));
        console.log(
          chalk.gray('Start the daemon first: stackmemory hooks start')
        );
        return;
      }

      if (options.follow) {
        const tail = spawn('tail', ['-f', logFile], { stdio: 'inherit' });
        tail.on('error', () => {
          console.log(chalk.red('Could not follow logs'));
        });
        return;
      }

      const content = readFileSync(logFile, 'utf-8');
      const lines = content.trim().split('\n');
      const count = parseInt(options.lines, 10);
      const recent = lines.slice(-count);

      console.log(chalk.bold(`\nRecent logs (${recent.length} lines):\n`));
      for (const line of recent) {
        try {
          if (line.includes('[ERROR]')) {
            console.log(chalk.red(line));
          } else if (line.includes('[WARN]')) {
            console.log(chalk.yellow(line));
          } else if (line.includes('[DEBUG]')) {
            console.log(chalk.gray(line));
          } else {
            console.log(line);
          }
        } catch {
          console.log(line);
        }
      }
    });

  cmd
    .command('config')
    .description('Show or edit hook configuration')
    .option('--edit', 'Open config in editor')
    .option('--reset', 'Reset to default configuration')
    .action((options) => {
      const configPath = getConfigPath();

      if (options.reset) {
        if (existsSync(configPath)) {
          unlinkSync(configPath);
        }
        initConfig();
        console.log(chalk.green('Configuration reset to defaults'));
        return;
      }

      if (options.edit) {
        const editor = process.env.EDITOR || 'vim';
        spawn(editor, [configPath], { stdio: 'inherit' });
        return;
      }

      const config = loadConfig();

      console.log(chalk.bold('\nHook Configuration\n'));
      console.log(chalk.gray(`File: ${configPath}`));
      console.log('');
      console.log(chalk.bold('Daemon:'));
      console.log(`  Enabled: ${config.daemon.enabled}`);
      console.log(`  Log level: ${config.daemon.log_level}`);
      console.log(`  PID file: ${chalk.gray(config.daemon.pid_file)}`);
      console.log(`  Log file: ${chalk.gray(config.daemon.log_file)}`);

      console.log('');
      console.log(chalk.bold('File Watch:'));
      console.log(`  Enabled: ${config.file_watch.enabled}`);
      console.log(`  Paths: ${config.file_watch.paths.join(', ')}`);
      console.log(`  Extensions: ${config.file_watch.extensions.join(', ')}`);
      console.log(`  Ignore: ${config.file_watch.ignore.join(', ')}`);

      console.log('');
      console.log(chalk.bold('Hooks:'));
      for (const [event, hookConfig] of Object.entries(config.hooks)) {
        console.log(`  ${event}:`);
        console.log(`    Enabled: ${hookConfig?.enabled}`);
        console.log(`    Handler: ${hookConfig?.handler}`);
        console.log(`    Output: ${hookConfig?.output}`);
        if (hookConfig?.debounce_ms) {
          console.log(`    Debounce: ${hookConfig.debounce_ms}ms`);
        }
        if (hookConfig?.cooldown_ms) {
          console.log(`    Cooldown: ${hookConfig.cooldown_ms}ms`);
        }
      }
    });

  cmd
    .command('add <handler>')
    .description('Add a hook handler')
    .option('-e, --event <type>', 'Event type to hook', 'file_change')
    .option(
      '-o, --output <type>',
      'Output type (overlay|notification|log)',
      'log'
    )
    .action((handler, options) => {
      const config = loadConfig();
      const event = options.event as keyof typeof config.hooks;

      config.hooks[event] = {
        enabled: true,
        handler,
        output: options.output,
        debounce_ms: 2000,
        cooldown_ms: 10000,
      };

      saveConfig(config);
      console.log(chalk.green(`Added ${handler} hook for ${event} events`));
      console.log(
        chalk.gray('Restart daemon to apply: stackmemory hooks restart')
      );
    });

  cmd
    .command('remove <event>')
    .description('Remove a hook by event type')
    .action((event) => {
      const config = loadConfig();

      if (!config.hooks[event as keyof typeof config.hooks]) {
        console.log(chalk.yellow(`No hook found for ${event}`));
        return;
      }

      delete config.hooks[event as keyof typeof config.hooks];
      saveConfig(config);
      console.log(chalk.green(`Removed hook for ${event}`));
      console.log(
        chalk.gray('Restart daemon to apply: stackmemory hooks restart')
      );
    });

  cmd.action(() => {
    const status = getDaemonStatus();

    console.log(chalk.bold('\nStackMemory Hooks\n'));
    console.log(
      `Daemon: ${status.running ? chalk.green('Running') : chalk.yellow('Stopped')}`
    );

    if (!status.running) {
      console.log('');
      console.log(chalk.bold('Quick start:'));
      console.log('  stackmemory hooks init     Initialize configuration');
      console.log('  stackmemory hooks start    Start the daemon');
    } else {
      console.log('');
      console.log(chalk.bold('Commands:'));
      console.log('  stackmemory hooks status   View detailed status');
      console.log('  stackmemory hooks logs     View daemon logs');
      console.log('  stackmemory hooks stop     Stop the daemon');
    }
  });

  return cmd;
}

export default createHooksCommand();
