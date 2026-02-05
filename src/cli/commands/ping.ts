/**
 * Ping command for StackMemory CLI
 * Simple health check that prints "pong"
 */

import { Command } from 'commander';

export function createPingCommand(): Command {
  return new Command('ping')
    .description('Health check command (prints "pong" with timestamp)')
    .action(() => {
      console.log(`pong ${new Date().toISOString()}`);
    });
}
