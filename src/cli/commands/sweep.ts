/**
 * Sweep CLI Command
 * Manage Sweep Next-Edit prediction server
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { existsSync } from 'fs';
import { join } from 'path';
import {
  createServerManager,
  createPredictionClient,
  launchWrapper,
  SweepServerConfig,
  DEFAULT_SERVER_CONFIG,
} from '../../features/sweep/index.js';

const HOME = process.env['HOME'] || '/tmp';

export function createSweepCommand(): Command {
  const cmd = new Command('sweep')
    .description('Manage Sweep Next-Edit prediction server')
    .addHelpText(
      'after',
      `
Examples:
  stackmemory sweep start       Start the Sweep server
  stackmemory sweep stop        Stop the Sweep server
  stackmemory sweep status      Check server status
  stackmemory sweep predict     Run a prediction manually
  stackmemory sweep hook        Install/check Claude Code hook

The Sweep server uses the Sweep 1.5B model for next-edit predictions.
Predictions are triggered after file edits via Claude Code hooks.
`
    );

  // Start command
  cmd
    .command('start')
    .description('Start the Sweep prediction server')
    .option(
      '--port <number>',
      'Server port',
      String(DEFAULT_SERVER_CONFIG.port)
    )
    .option('--model <path>', 'Path to GGUF model file')
    .option(
      '--context <size>',
      'Context size',
      String(DEFAULT_SERVER_CONFIG.contextSize)
    )
    .option('--gpu-layers <n>', 'Number of GPU layers (0 for CPU only)', '0')
    .action(async (options) => {
      const spinner = ora('Starting Sweep server...').start();

      try {
        const config: Partial<SweepServerConfig> = {
          port: parseInt(options.port, 10),
          contextSize: parseInt(options.context, 10),
          gpuLayers: parseInt(options.gpuLayers, 10),
        };

        if (options.model) {
          config.modelPath = options.model;
        }

        const manager = createServerManager(config);
        const status = await manager.startServer();

        spinner.succeed(chalk.green('Sweep server started'));
        console.log(chalk.gray(`  PID: ${status.pid}`));
        console.log(chalk.gray(`  Port: ${status.port}`));
        console.log(chalk.gray(`  Model: ${status.modelPath}`));
      } catch (error) {
        spinner.fail(chalk.red('Failed to start Sweep server'));
        console.error(chalk.red((error as Error).message));
        process.exit(1);
      }
    });

  // Stop command
  cmd
    .command('stop')
    .description('Stop the Sweep prediction server')
    .action(async () => {
      const spinner = ora('Stopping Sweep server...').start();

      try {
        const manager = createServerManager();
        await manager.stopServer();
        spinner.succeed(chalk.green('Sweep server stopped'));
      } catch (error) {
        spinner.fail(chalk.red('Failed to stop Sweep server'));
        console.error(chalk.red((error as Error).message));
        process.exit(1);
      }
    });

  // Status command
  cmd
    .command('status')
    .description('Check Sweep server status')
    .action(async () => {
      try {
        const manager = createServerManager();
        const status = await manager.getStatus();

        if (status.running) {
          console.log(chalk.green('Sweep server is running'));
          console.log(chalk.gray(`  PID: ${status.pid}`));
          console.log(chalk.gray(`  Port: ${status.port}`));
          console.log(chalk.gray(`  Host: ${status.host}`));
          if (status.startedAt) {
            const uptime = Math.floor((Date.now() - status.startedAt) / 1000);
            console.log(chalk.gray(`  Uptime: ${formatUptime(uptime)}`));
          }
          if (status.modelPath) {
            console.log(chalk.gray(`  Model: ${status.modelPath}`));
          }
        } else {
          console.log(chalk.yellow('Sweep server is not running'));
          console.log(chalk.gray('  Start with: stackmemory sweep start'));
        }

        // Check model availability
        const defaultModelPath = join(
          HOME,
          '.stackmemory',
          'models',
          'sweep',
          'sweep-next-edit-1.5b.q8_0.v2.gguf'
        );
        if (!existsSync(defaultModelPath)) {
          console.log('');
          console.log(chalk.yellow('Model not found at default location'));
          console.log(
            chalk.gray(
              '  Download with:\n' +
                '  huggingface-cli download sweepai/sweep-next-edit-1.5B \\\n' +
                '    sweep-next-edit-1.5b.q8_0.v2.gguf \\\n' +
                '    --local-dir ~/.stackmemory/models/sweep'
            )
          );
        }
      } catch (error) {
        console.error(
          chalk.red('Error checking status:'),
          (error as Error).message
        );
        process.exit(1);
      }
    });

  // Predict command (for testing)
  cmd
    .command('predict')
    .description('Run a prediction manually (for testing)')
    .argument('<file>', 'File to predict edits for')
    .option(
      '--port <number>',
      'Server port',
      String(DEFAULT_SERVER_CONFIG.port)
    )
    .action(async (file, options) => {
      const spinner = ora('Running prediction...').start();

      try {
        const { readFileSync } = await import('fs');
        const content = readFileSync(file, 'utf-8');

        const client = createPredictionClient({
          port: parseInt(options.port, 10),
        });

        // Check server
        const healthy = await client.checkHealth();
        if (!healthy) {
          spinner.fail(chalk.red('Server not running'));
          console.log(chalk.gray('Start with: stackmemory sweep start'));
          process.exit(1);
        }

        const result = await client.predict({
          file_path: file,
          current_content: content,
          recent_diffs: [],
        });

        spinner.stop();

        if (result.success && result.predicted_content) {
          console.log(chalk.green('Prediction complete'));
          console.log(chalk.gray(`Latency: ${result.latency_ms}ms`));
          console.log(chalk.gray(`Tokens: ${result.tokens_generated}`));
          console.log('');
          console.log(chalk.cyan('Predicted content:'));
          console.log(result.predicted_content.slice(0, 500));
          if (result.predicted_content.length > 500) {
            console.log(chalk.gray('... (truncated)'));
          }
        } else if (result.success) {
          console.log(chalk.yellow('No changes predicted'));
        } else {
          console.log(chalk.red('Prediction failed:'), result.message);
        }
      } catch (error) {
        spinner.fail(chalk.red('Prediction failed'));
        console.error(chalk.red((error as Error).message));
        process.exit(1);
      }
    });

  // Hook command
  cmd
    .command('hook')
    .description('Check Claude Code hook status')
    .action(async () => {
      const hookPath = join(HOME, '.claude', 'hooks', 'post-edit-sweep.js');
      const templatePath = join(
        process.cwd(),
        'templates',
        'claude-hooks',
        'post-edit-sweep.js'
      );

      console.log(chalk.cyan('Sweep Hook Status'));
      console.log('');

      if (existsSync(hookPath)) {
        console.log(chalk.green('Hook installed:'), hookPath);
      } else {
        console.log(chalk.yellow('Hook not installed'));
        console.log(chalk.gray(`  Copy from: ${templatePath}`));
        console.log(chalk.gray(`  To: ${hookPath}`));
      }

      // Check settings.json
      const settingsPath = join(HOME, '.claude', 'settings.json');
      if (existsSync(settingsPath)) {
        try {
          const { readFileSync } = await import('fs');
          const settings = JSON.parse(readFileSync(settingsPath, 'utf-8'));
          const hasHook = JSON.stringify(settings).includes('post-edit-sweep');
          if (hasHook) {
            console.log(chalk.green('Hook registered in settings.json'));
          } else {
            console.log(chalk.yellow('Hook not registered in settings.json'));
            console.log(
              chalk.gray(
                '  Add to hooks.PostToolUse:\n' +
                  '  { "matcher": "Edit", "hooks": [{ "type": "command", "command": "node ~/.claude/hooks/post-edit-sweep.js" }] }'
              )
            );
          }
        } catch {
          console.log(chalk.yellow('Could not read settings.json'));
        }
      } else {
        console.log(chalk.yellow('settings.json not found'));
      }

      // Check state file
      const statePath = join(HOME, '.stackmemory', 'sweep-state.json');
      if (existsSync(statePath)) {
        try {
          const { readFileSync } = await import('fs');
          const state = JSON.parse(readFileSync(statePath, 'utf-8'));
          console.log(
            chalk.gray(
              `  Recent diffs tracked: ${state.recentDiffs?.length || 0}`
            )
          );
          if (state.lastPrediction) {
            const ago = Math.floor(
              (Date.now() - state.lastPrediction.timestamp) / 1000
            );
            console.log(
              chalk.gray(`  Last prediction: ${formatUptime(ago)} ago`)
            );
          }
        } catch {
          // Ignore
        }
      }
    });

  // Wrap command
  cmd
    .command('wrap')
    .description('Launch Claude Code with Sweep prediction status bar')
    .option('--claude-bin <path>', 'Path to claude binary')
    .allowUnknownOption(true)
    .action(async (options, command) => {
      try {
        const claudeArgs = command.args || [];
        await launchWrapper({
          claudeBin: options.claudeBin,
          claudeArgs,
        });
      } catch (error) {
        console.error(chalk.red((error as Error).message));
        process.exit(1);
      }
    });

  return cmd;
}

function formatUptime(seconds: number): string {
  if (seconds < 60) return `${seconds}s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const hours = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  return `${hours}h ${mins}m`;
}
