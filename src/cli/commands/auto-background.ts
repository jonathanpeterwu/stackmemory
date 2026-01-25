/**
 * CLI command for managing auto-background settings
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { join } from 'path';
import {
  loadConfig,
  saveConfig,
  AutoBackgroundConfig,
} from '../../hooks/auto-background.js';

// __dirname provided by esbuild banner

export function createAutoBackgroundCommand(): Command {
  const cmd = new Command('auto-bg')
    .description('Manage auto-background settings for long-running commands')
    .addHelpText(
      'after',
      `
Examples:
  stackmemory auto-bg show              Show current configuration
  stackmemory auto-bg enable            Enable auto-backgrounding
  stackmemory auto-bg disable           Disable auto-backgrounding
  stackmemory auto-bg add "npm publish" Add command to always-background list
  stackmemory auto-bg remove "npm test" Remove command from list
  stackmemory auto-bg timeout 10000     Set timeout to 10 seconds
  stackmemory auto-bg install           Install Claude Code hook
`
    );

  cmd
    .command('show')
    .description('Show current auto-background configuration')
    .action(() => {
      const config = loadConfig();
      console.log(chalk.blue('Auto-Background Configuration:'));
      console.log();
      console.log(
        `  ${chalk.gray('Enabled:')} ${config.enabled ? chalk.green('yes') : chalk.red('no')}`
      );
      console.log(`  ${chalk.gray('Timeout:')} ${config.timeoutMs}ms`);
      console.log(
        `  ${chalk.gray('Verbose:')} ${config.verbose ? 'yes' : 'no'}`
      );
      console.log();
      console.log(chalk.blue('Always Background:'));
      config.alwaysBackground.forEach((p) => console.log(`  - ${p}`));
      console.log();
      console.log(chalk.blue('Never Background:'));
      config.neverBackground.forEach((p) => console.log(`  - ${p}`));
    });

  cmd
    .command('enable')
    .description('Enable auto-backgrounding')
    .action(() => {
      const config = loadConfig();
      config.enabled = true;
      saveConfig(config);
      console.log(chalk.green('Auto-background enabled'));
    });

  cmd
    .command('disable')
    .description('Disable auto-backgrounding')
    .action(() => {
      const config = loadConfig();
      config.enabled = false;
      saveConfig(config);
      console.log(chalk.yellow('Auto-background disabled'));
    });

  cmd
    .command('add <pattern>')
    .description('Add command pattern to always-background list')
    .action((pattern: string) => {
      const config = loadConfig();
      if (!config.alwaysBackground.includes(pattern)) {
        config.alwaysBackground.push(pattern);
        saveConfig(config);
        console.log(chalk.green(`Added: ${pattern}`));
      } else {
        console.log(chalk.yellow(`Already in list: ${pattern}`));
      }
    });

  cmd
    .command('remove <pattern>')
    .description('Remove command pattern from always-background list')
    .action((pattern: string) => {
      const config = loadConfig();
      const idx = config.alwaysBackground.indexOf(pattern);
      if (idx !== -1) {
        config.alwaysBackground.splice(idx, 1);
        saveConfig(config);
        console.log(chalk.green(`Removed: ${pattern}`));
      } else {
        console.log(chalk.yellow(`Not in list: ${pattern}`));
      }
    });

  cmd
    .command('timeout <ms>')
    .description('Set timeout threshold in milliseconds')
    .action((ms: string) => {
      const config = loadConfig();
      const timeout = parseInt(ms, 10);
      if (isNaN(timeout) || timeout < 0) {
        console.log(chalk.red('Invalid timeout value'));
        return;
      }
      config.timeoutMs = timeout;
      saveConfig(config);
      console.log(chalk.green(`Timeout set to ${timeout}ms`));
    });

  cmd
    .command('verbose [on|off]')
    .description('Enable/disable verbose logging')
    .action((value?: string) => {
      const config = loadConfig();
      if (value === undefined) {
        config.verbose = !config.verbose;
      } else {
        config.verbose = value === 'on' || value === 'true';
      }
      saveConfig(config);
      console.log(
        chalk.green(
          `Verbose logging ${config.verbose ? 'enabled' : 'disabled'}`
        )
      );
    });

  cmd
    .command('reset')
    .description('Reset configuration to defaults')
    .action(() => {
      const defaultConfig: AutoBackgroundConfig = {
        enabled: true,
        timeoutMs: 5000,
        alwaysBackground: [
          'npm install',
          'npm ci',
          'yarn install',
          'pnpm install',
          'bun install',
          'npm run build',
          'yarn build',
          'pnpm build',
          'cargo build',
          'go build',
          'make',
          'npm test',
          'npm run test',
          'yarn test',
          'pytest',
          'jest',
          'vitest',
          'cargo test',
          'docker build',
          'docker-compose up',
          'docker compose up',
          'git clone',
          'git fetch --all',
          'npx tsc',
          'tsc --noEmit',
          'eslint .',
          'npm run lint',
        ],
        neverBackground: [
          'vim',
          'nvim',
          'nano',
          'less',
          'more',
          'top',
          'htop',
          'echo',
          'cat',
          'ls',
          'pwd',
          'cd',
          'which',
          'git status',
          'git diff',
          'git log',
        ],
        verbose: false,
      };
      saveConfig(defaultConfig);
      console.log(chalk.green('Configuration reset to defaults'));
    });

  cmd
    .command('install')
    .description('Install Claude Code hook for auto-backgrounding')
    .action(() => {
      try {
        // Find the install script
        const scriptPath = join(
          __dirname,
          '../../../scripts/install-auto-background-hook.sh'
        );
        execSync(`bash "${scriptPath}"`, { stdio: 'inherit' });
      } catch {
        console.error(chalk.red('Failed to install hook'));
        console.log(
          chalk.gray(
            'Run manually: bash scripts/install-auto-background-hook.sh'
          )
        );
      }
    });

  return cmd;
}
