/**
 * Linear Migration Command
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { runMigration } from '../../integrations/linear/migration.js';
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


export function registerLinearMigrateCommand(parent: Command) {
  parent
    .command('linear:migrate')
    .description('Migrate STA- tasks from LiftCL to new Linear workspace')
    .option('--source-key <key>', 'Source workspace Linear API key')
    .option('--target-key <key>', 'Target workspace Linear API key') 
    .option('--dry-run', 'Preview migration without making changes')
    .option('--delete-source', 'Delete tasks from source after successful migration')
    .option('--batch-size <n>', 'Number of tasks per batch', '3')
    .option('--delay <ms>', 'Delay between batches in milliseconds', '3000')
    .action(async (options) => {
      try {
        const sourceKey = options.sourceKey || process.env['LINEAR_API_KEY'];
        const targetKey = options.targetKey;

        if (!sourceKey) {
          console.error(chalk.red('❌ Source API key required. Use --source-key or set LINEAR_API_KEY'));
          return;
        }

        if (!targetKey) {
          console.error(chalk.red('❌ Target API key required. Use --target-key'));
          return;
        }

        console.log(chalk.blue('🚀 Starting Linear Migration'));
        console.log(chalk.gray('   This will migrate all STA- prefixed tasks'));
        if (options.deleteSource) {
          console.log(chalk.yellow('   ⚠️  Tasks will be DELETED from source after migration'));
        }
        console.log();

        await runMigration({
          sourceApiKey: sourceKey,
          targetApiKey: targetKey,
          taskPrefix: 'STA-',
          deleteFromSource: options.deleteSource,
          dryRun: options.dryRun,
          batchSize: parseInt(options.batchSize),
          delayMs: parseInt(options.delay)
        });

      } catch (error: unknown) {
        console.error(chalk.red('Migration failed:'), (error as Error).message);
        process.exit(1);
      }
    });
}