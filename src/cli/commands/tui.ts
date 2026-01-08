#!/usr/bin/env node
/**
 * TUI Command - Launch interactive monitoring dashboard
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import chalk from 'chalk';
// Type-safe environment variable access
function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Environment variable ${key} is required`);
  }
  return value;
}

function getOptionalEnv(key: string): string | undefined {
  return process.env[key];
}


const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

export const tuiCommand = {
  command: 'tui',
  describe: 'Launch interactive TUI monitoring dashboard',
  builder: (yargs: any) => {
    return yargs
      .option('server', {
        alias: 's',
        type: 'boolean',
        description: 'Start WebSocket server for real-time updates',
        default: false
      })
      .option('ws-url', {
        alias: 'w',
        type: 'string',
        description: 'WebSocket server URL',
        default: 'ws://localhost:8080'
      })
      .option('refresh', {
        alias: 'r',
        type: 'number',
        description: 'Auto-refresh interval in milliseconds',
        default: 2000
      });
  },
  handler: async (argv: any) => {
    console.log(chalk.cyan('🚀 Launching StackMemory TUI Dashboard...'));
    
    // Set environment variables
    process.env['STACKMEMORY_WS_URL'] = argv.wsUrl;
    
    // Get script path
    const scriptPath = join(__dirname, '../../../scripts/start-tui.sh');
    
    // Prepare arguments
    const args = [];
    if (argv.server) {
      args.push('--with-server');
    }
    
    // Launch TUI
    const tui = spawn('bash', [scriptPath, ...args], {
      stdio: 'inherit',
      env: {
        ...process.env,
        STACKMEMORY_WS_URL: argv.wsUrl
      }
    });
    
    tui.on('error', (error) => {
      console.error(chalk.red('Failed to launch TUI:'), error);
      process.exit(1);
    });
    
    tui.on('exit', (code) => {
      if (code !== 0) {
        console.error(chalk.red(`TUI exited with code ${code}`));
        process.exit(code || 1);
      }
    });
  }
};

// Direct execution support
if (require.main === module) {
  tuiCommand.handler({
    server: process.argv.includes('--server'),
    wsUrl: process.env['STACKMEMORY_WS_URL'] || 'ws://localhost:8080',
    refresh: 2000
  });
}