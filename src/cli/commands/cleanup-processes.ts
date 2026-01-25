/**
 * CLI Command for Process Cleanup
 */

import { Command } from 'commander';
import {
  cleanupStaleProcesses,
  findStaleProcesses,
  getStackmemoryProcesses,
} from '../../utils/process-cleanup.js';

export function createCleanupProcessesCommand(): Command {
  const cmd = new Command('cleanup-processes');
  cmd.description('Clean up stale stackmemory processes');

  cmd
    .option('--max-age <hours>', 'Max process age in hours (default: 24)', '24')
    .option('--dry-run', 'Show what would be killed without actually killing')
    .option('--all', 'Show all stackmemory processes (not just stale)')
    .option('--force', 'Kill without checking log activity')
    .action((options) => {
      const maxAgeHours = parseInt(options.maxAge, 10);

      if (options.all) {
        // Just list all processes
        const processes = getStackmemoryProcesses();

        if (processes.length === 0) {
          console.log('No stackmemory processes running');
          return;
        }

        console.log(`Found ${processes.length} stackmemory process(es):\n`);
        for (const proc of processes) {
          const age =
            proc.ageHours < 1
              ? `${Math.round(proc.ageHours * 60)}m`
              : `${Math.round(proc.ageHours)}h`;
          console.log(`  PID ${proc.pid} (${age} old)`);
          console.log(`    ${proc.command}`);
        }
        return;
      }

      // Find and optionally kill stale processes
      const staleProcesses = options.force
        ? getStackmemoryProcesses().filter((p) => p.ageHours >= maxAgeHours)
        : findStaleProcesses(maxAgeHours);

      if (staleProcesses.length === 0) {
        console.log(`No stale processes older than ${maxAgeHours}h found`);
        return;
      }

      console.log(
        `Found ${staleProcesses.length} stale process(es) older than ${maxAgeHours}h:\n`
      );

      for (const proc of staleProcesses) {
        const age = `${Math.round(proc.ageHours)}h`;
        console.log(`  PID ${proc.pid} (${age} old)`);
        console.log(`    ${proc.command}`);
        if (proc.lastLogActivity) {
          console.log(`    Last log: ${proc.lastLogActivity.toISOString()}`);
        }
      }

      if (options.dryRun) {
        console.log('\n[DRY RUN] No processes killed');
        return;
      }

      console.log('\nKilling stale processes...');
      const result = cleanupStaleProcesses({ maxAgeHours, dryRun: false });

      console.log(`\nKilled: ${result.killed.length}`);
      if (result.errors.length > 0) {
        console.log(`Errors: ${result.errors.length}`);
        for (const err of result.errors) {
          console.log(`  PID ${err.pid}: ${err.error}`);
        }
      }
    });

  return cmd;
}
