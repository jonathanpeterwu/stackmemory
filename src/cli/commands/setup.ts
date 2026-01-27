/**
 * Setup commands for StackMemory onboarding
 * - setup-mcp: Auto-configure Claude Code MCP integration
 * - doctor: Diagnose common issues
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { execSync } from 'child_process';

// Claude config paths
const CLAUDE_DIR = join(homedir(), '.claude');
const CLAUDE_CONFIG_FILE = join(CLAUDE_DIR, 'config.json');
const MCP_CONFIG_FILE = join(CLAUDE_DIR, 'stackmemory-mcp.json');
const HOOKS_JSON = join(CLAUDE_DIR, 'hooks.json');

interface DiagnosticResult {
  name: string;
  status: 'ok' | 'warn' | 'error';
  message: string;
  fix?: string;
}

/**
 * Create setup-mcp command
 */
export function createSetupMCPCommand(): Command {
  return new Command('setup-mcp')
    .description('Auto-configure Claude Code MCP integration')
    .option('--dry-run', 'Show what would be configured without making changes')
    .option('--reset', 'Reset MCP configuration to defaults')
    .action(async (options) => {
      console.log(chalk.cyan('\nStackMemory MCP Setup\n'));

      if (options.dryRun) {
        console.log(chalk.yellow('[DRY RUN] No changes will be made.\n'));
      }

      // Step 1: Ensure Claude directory exists
      if (!existsSync(CLAUDE_DIR)) {
        if (options.dryRun) {
          console.log(chalk.gray(`Would create: ${CLAUDE_DIR}`));
        } else {
          mkdirSync(CLAUDE_DIR, { recursive: true });
          console.log(chalk.green('[OK]') + ' Created ~/.claude directory');
        }
      }

      // Step 2: Create MCP server configuration
      const mcpConfig = {
        mcpServers: {
          stackmemory: {
            command: 'stackmemory',
            args: ['mcp-server'],
            env: {
              NODE_ENV: 'production',
            },
          },
        },
      };

      if (options.dryRun) {
        console.log(
          chalk.gray(`Would write MCP config to: ${MCP_CONFIG_FILE}`)
        );
        console.log(chalk.gray(JSON.stringify(mcpConfig, null, 2)));
      } else {
        writeFileSync(MCP_CONFIG_FILE, JSON.stringify(mcpConfig, null, 2));
        console.log(chalk.green('[OK]') + ' Created MCP server configuration');
      }

      // Step 3: Update Claude config.json to reference MCP config
      let claudeConfig: Record<string, unknown> = {};
      if (existsSync(CLAUDE_CONFIG_FILE)) {
        try {
          claudeConfig = JSON.parse(readFileSync(CLAUDE_CONFIG_FILE, 'utf8'));
        } catch {
          console.log(
            chalk.yellow('[WARN]') +
              ' Could not parse existing config.json, creating new'
          );
        }
      }

      // Ensure mcp.configFiles array includes our config
      if (!claudeConfig.mcp) {
        claudeConfig.mcp = {};
      }
      const mcp = claudeConfig.mcp as Record<string, unknown>;
      if (!mcp.configFiles) {
        mcp.configFiles = [];
      }
      const configFiles = mcp.configFiles as string[];
      if (!configFiles.includes(MCP_CONFIG_FILE)) {
        configFiles.push(MCP_CONFIG_FILE);
      }

      if (options.dryRun) {
        console.log(chalk.gray(`Would update: ${CLAUDE_CONFIG_FILE}`));
      } else {
        writeFileSync(
          CLAUDE_CONFIG_FILE,
          JSON.stringify(claudeConfig, null, 2)
        );
        console.log(chalk.green('[OK]') + ' Updated Claude config.json');
      }

      // Step 4: Validate configuration
      console.log(chalk.cyan('\nValidating configuration...'));

      // Check stackmemory command is available
      try {
        execSync('stackmemory --version', { stdio: 'pipe' });
        console.log(chalk.green('[OK]') + ' stackmemory CLI is installed');
      } catch {
        console.log(chalk.yellow('[WARN]') + ' stackmemory CLI not in PATH');
        console.log(chalk.gray('  You may need to restart your terminal'));
      }

      // Check Claude Code is available
      try {
        execSync('claude --version', { stdio: 'pipe' });
        console.log(chalk.green('[OK]') + ' Claude Code is installed');
      } catch {
        console.log(chalk.yellow('[WARN]') + ' Claude Code not found');
        console.log(chalk.gray('  Install from: https://claude.ai/code'));
      }

      // Final instructions
      if (!options.dryRun) {
        console.log(chalk.green('\nMCP setup complete!'));
        console.log(chalk.cyan('\nNext steps:'));
        console.log(chalk.white('  1. Restart Claude Code'));
        console.log(
          chalk.white(
            '  2. The StackMemory MCP tools will be available automatically'
          )
        );
        console.log(
          chalk.gray(
            '\nTo verify: Run "stackmemory doctor" to check all integrations'
          )
        );
      }
    });
}

/**
 * Create doctor command for diagnostics
 */
export function createDoctorCommand(): Command {
  return new Command('doctor')
    .description('Diagnose StackMemory configuration and common issues')
    .option('--fix', 'Attempt to automatically fix issues')
    .action(async (options) => {
      console.log(chalk.cyan('\nStackMemory Doctor\n'));
      console.log(chalk.gray('Checking configuration and dependencies...\n'));

      const results: DiagnosticResult[] = [];

      // 1. Check project initialization
      const projectDir = join(process.cwd(), '.stackmemory');
      const dbPath = join(projectDir, 'context.db');
      if (existsSync(dbPath)) {
        results.push({
          name: 'Project Initialization',
          status: 'ok',
          message: 'StackMemory is initialized in this project',
        });
      } else if (existsSync(projectDir)) {
        results.push({
          name: 'Project Initialization',
          status: 'warn',
          message: '.stackmemory directory exists but database not found',
          fix: 'Run: stackmemory init',
        });
      } else {
        results.push({
          name: 'Project Initialization',
          status: 'error',
          message: 'StackMemory not initialized in this project',
          fix: 'Run: stackmemory init',
        });
      }

      // 2. Check database integrity
      if (existsSync(dbPath)) {
        try {
          const Database = (await import('better-sqlite3')).default;
          const db = new Database(dbPath, { readonly: true });
          const tables = db
            .prepare("SELECT name FROM sqlite_master WHERE type='table'")
            .all() as { name: string }[];
          db.close();

          const hasFrames = tables.some((t) => t.name === 'frames');
          if (hasFrames) {
            results.push({
              name: 'Database Integrity',
              status: 'ok',
              message: `Database has ${tables.length} tables`,
            });
          } else {
            results.push({
              name: 'Database Integrity',
              status: 'warn',
              message: 'Database exists but missing expected tables',
              fix: 'Run: stackmemory init --interactive',
            });
          }
        } catch (error) {
          results.push({
            name: 'Database Integrity',
            status: 'error',
            message: `Database error: ${(error as Error).message}`,
            fix: 'Remove .stackmemory/context.db and run: stackmemory init',
          });
        }
      }

      // 3. Check MCP configuration
      if (existsSync(MCP_CONFIG_FILE)) {
        try {
          const config = JSON.parse(readFileSync(MCP_CONFIG_FILE, 'utf8'));
          if (config.mcpServers?.stackmemory) {
            results.push({
              name: 'MCP Configuration',
              status: 'ok',
              message: 'MCP server configured',
            });
          } else {
            results.push({
              name: 'MCP Configuration',
              status: 'warn',
              message:
                'MCP config file exists but stackmemory server not configured',
              fix: 'Run: stackmemory setup-mcp',
            });
          }
        } catch {
          results.push({
            name: 'MCP Configuration',
            status: 'error',
            message: 'Invalid MCP configuration file',
            fix: 'Run: stackmemory setup-mcp --reset',
          });
        }
      } else {
        results.push({
          name: 'MCP Configuration',
          status: 'warn',
          message: 'MCP not configured for Claude Code',
          fix: 'Run: stackmemory setup-mcp',
        });
      }

      // 4. Check Claude hooks
      if (existsSync(HOOKS_JSON)) {
        try {
          const hooks = JSON.parse(readFileSync(HOOKS_JSON, 'utf8'));
          const hasTraceHook = !!hooks['tool-use-approval'];
          if (hasTraceHook) {
            results.push({
              name: 'Claude Hooks',
              status: 'ok',
              message: 'Tool tracing hook installed',
            });
          } else {
            results.push({
              name: 'Claude Hooks',
              status: 'warn',
              message: 'Hooks file exists but tracing not configured',
              fix: 'Run: stackmemory hooks install',
            });
          }
        } catch {
          results.push({
            name: 'Claude Hooks',
            status: 'warn',
            message: 'Could not read hooks.json',
          });
        }
      } else {
        results.push({
          name: 'Claude Hooks',
          status: 'warn',
          message: 'Claude hooks not installed (optional)',
          fix: 'Run: stackmemory hooks install',
        });
      }

      // 5. Check environment variables
      const envChecks = [
        { key: 'LINEAR_API_KEY', name: 'Linear API Key', optional: true },
        { key: 'TWILIO_ACCOUNT_SID', name: 'Twilio Account', optional: true },
      ];

      for (const check of envChecks) {
        const value = process.env[check.key];
        if (value) {
          results.push({
            name: check.name,
            status: 'ok',
            message: 'Environment variable set',
          });
        } else if (!check.optional) {
          results.push({
            name: check.name,
            status: 'error',
            message: 'Required environment variable not set',
            fix: `Set ${check.key} in your .env file`,
          });
        }
        // Skip optional env vars that aren't set
      }

      // 6. Check file permissions
      const homeStackmemory = join(homedir(), '.stackmemory');
      if (existsSync(homeStackmemory)) {
        try {
          const testFile = join(homeStackmemory, '.write-test');
          writeFileSync(testFile, 'test');
          const { unlinkSync } = await import('fs');
          unlinkSync(testFile);
          results.push({
            name: 'File Permissions',
            status: 'ok',
            message: '~/.stackmemory is writable',
          });
        } catch {
          results.push({
            name: 'File Permissions',
            status: 'error',
            message: '~/.stackmemory is not writable',
            fix: 'Run: chmod 700 ~/.stackmemory',
          });
        }
      }

      // Display results
      let hasErrors = false;
      let hasWarnings = false;

      for (const result of results) {
        const icon =
          result.status === 'ok'
            ? chalk.green('[OK]')
            : result.status === 'warn'
              ? chalk.yellow('[WARN]')
              : chalk.red('[ERROR]');

        console.log(`${icon} ${result.name}`);
        console.log(chalk.gray(`    ${result.message}`));

        if (result.fix) {
          console.log(chalk.cyan(`    Fix: ${result.fix}`));

          if (options.fix && result.status !== 'ok') {
            // Auto-fix logic for specific issues
            if (result.fix.includes('stackmemory setup-mcp')) {
              console.log(chalk.gray('    Attempting auto-fix...'));
              try {
                execSync('stackmemory setup-mcp', { stdio: 'inherit' });
              } catch {
                console.log(chalk.red('    Auto-fix failed'));
              }
            }
          }
        }

        if (result.status === 'error') hasErrors = true;
        if (result.status === 'warn') hasWarnings = true;
      }

      // Summary
      console.log('');
      if (hasErrors) {
        console.log(
          chalk.red('Some issues need attention. Run suggested fixes above.')
        );
        process.exit(1);
      } else if (hasWarnings) {
        console.log(
          chalk.yellow(
            'StackMemory is working but some optional features are not configured.'
          )
        );
      } else {
        console.log(
          chalk.green('All checks passed! StackMemory is properly configured.')
        );
      }
    });
}

/**
 * Register setup commands
 */
export function registerSetupCommands(program: Command): void {
  program.addCommand(createSetupMCPCommand());
  program.addCommand(createDoctorCommand());
}
