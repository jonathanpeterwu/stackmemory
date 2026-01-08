/**
 * Simple Linear task list command using memory cache
 */

import chalk from 'chalk';
import { Command } from 'commander';
import { LinearRestClient } from '../../integrations/linear/rest-client.js';
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


export function registerLinearListCommand(parent: Command) {
  parent
    .command('linear:list')
    .alias('linear:ls')
    .description('List Linear tasks (fast, memory-cached)')
    .option('--limit <n>', 'Number of tasks to show', '20')
    .option('--status <status>', 'Filter by status (backlog, started, completed, etc.)')
    .option('--my', 'Show only tasks assigned to me')
    .option('--cache', 'Show cache stats only')
    .option('--refresh', 'Force refresh cache')
    .option('--count', 'Show count by status only')
    .action(async (options) => {
      try {
        const apiKey = process.env['LINEAR_API_KEY'];
        if (!apiKey) {
          console.log(chalk.yellow('⚠ Set LINEAR_API_KEY environment variable'));
          return;
        }

        const restClient = new LinearRestClient(apiKey);

        // Show cache stats if requested
        if (options.cache) {
          const stats = restClient.getCacheStats();
          console.log(chalk.cyan('📊 Cache Stats:'));
          console.log(`  Size: ${stats.size} tasks`);
          console.log(`  Age: ${Math.round(stats.age / 1000)}s`);
          console.log(`  Fresh: ${stats.fresh ? 'yes' : 'no'}`);
          console.log(`  Last sync: ${new Date(stats.lastSync).toLocaleString()}`);
          return;
        }

        // Show counts only
        if (options.count) {
          const counts = await restClient.getTaskCounts();
          console.log(chalk.cyan('📊 Task Counts:'));
          Object.entries(counts)
            .sort(([,a], [,b]) => b - a)
            .forEach(([status, count]) => {
              console.log(`  ${status}: ${count}`);
            });
          
          const cacheStats = restClient.getCacheStats();
          console.log(chalk.gray(`\nCache: ${cacheStats.size} tasks, age: ${Math.round(cacheStats.age / 1000)}s`));
          return;
        }

        let tasks;
        if (options.my) {
          tasks = await restClient.getMyTasks();
        } else if (options.status) {
          tasks = await restClient.getTasksByStatus(options.status);
        } else {
          tasks = await restClient.getAllTasks(options.refresh);
        }

        if (!tasks || tasks.length === 0) {
          console.log(chalk.gray('No tasks found'));
          return;
        }

        // Limit results
        const limit = parseInt(options.limit);
        const displayTasks = tasks.slice(0, limit);

        console.log(chalk.cyan(`\n📋 Linear Tasks (${displayTasks.length}/${tasks.length}):`));
        
        displayTasks.forEach((task) => {
          const priority = task.priority ? `P${task.priority}` : '';
          const assignee = task.assignee ? ` @${task.assignee.name}` : '';
          const statusColor = task.state.type === 'completed' ? chalk.green : 
                            task.state.type === 'started' ? chalk.yellow : chalk.gray;
          
          console.log(`${chalk.blue(task.identifier)} ${task.title}`);
          console.log(chalk.gray(`  ${statusColor(task.state.name)} ${priority}${assignee}`));
        });

        const cacheStats = restClient.getCacheStats();
        console.log(chalk.gray(`\n${displayTasks.length} shown, ${tasks.length} total • Cache: ${Math.round(cacheStats.age / 1000)}s old`));
      } catch (error: unknown) {
        console.error(
          chalk.red('Failed to list tasks:'),
          (error as Error).message
        );
      }
    });
}