/**
 * Linear Task Creation Command
 */

import { Command } from 'commander';
import chalk from 'chalk';
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

export function registerLinearCreateCommand(parent: Command) {
  parent
    .command('linear:create')
    .description('Create a new Linear task in the correct project')
    .option('--api-key <key>', 'Linear API key for target workspace')
    .option('--title <title>', 'Task title (required)')
    .option('--description <desc>', 'Task description')
    .option(
      '--priority <level>',
      'Priority: urgent(1), high(2), medium(3), low(4)',
      '3'
    )
    .option(
      '--state <state>',
      'Initial state: backlog, todo, started',
      'backlog'
    )
    .action(async (options) => {
      try {
        const apiKey = options.apiKey || process.env['LINEAR_NEW_API_KEY'];

        if (!apiKey) {
          console.error(
            chalk.red(
              '❌ API key required. Use --api-key or set LINEAR_NEW_API_KEY'
            )
          );
          return;
        }

        if (!options.title) {
          console.error(
            chalk.red('❌ Task title required. Use --title "Your task title"')
          );
          return;
        }

        const client = new LinearRestClient(apiKey);

        console.log(chalk.yellow('🔄 Creating new Linear task...'));

        // Get team info
        const team = await client.getTeam();
        console.log(chalk.cyan(`🎯 Target team: ${team.name} (${team.key})`));

        // Create the task
        const createQuery = `
          mutation CreateIssue($input: IssueCreateInput!) {
            issueCreate(input: $input) {
              success
              issue {
                id
                identifier
                title
                description
                state {
                  id
                  name
                  type
                }
                priority
                url
                createdAt
              }
            }
          }
        `;

        const taskInput = {
          title: options.title,
          description: options.description || '',
          teamId: team.id,
          priority: parseInt(options.priority),
        };

        const response = await client.makeRequest<{
          data: {
            issueCreate: {
              success: boolean;
              issue: any;
            };
          };
        }>(createQuery, { input: taskInput });

        if (!response.data?.issueCreate?.success) {
          throw new Error('Failed to create task in Linear');
        }

        const task = response.data.issueCreate.issue;

        console.log(chalk.green('\n✅ Task created successfully!'));
        console.log(chalk.blue(`📋 ${task.identifier}: ${task.title}`));
        console.log(chalk.gray(`   State: ${task.state.name}`));
        console.log(chalk.gray(`   Priority: ${task.priority}`));
        console.log(chalk.gray(`   URL: ${task.url}`));

        if (options.description) {
          console.log(chalk.gray(`   Description: ${options.description}`));
        }
      } catch (error: unknown) {
        console.error(
          chalk.red('❌ Task creation failed:'),
          (error as Error).message
        );
      }
    });

  parent
    .command('linear:quick')
    .description('Quick task creation with prompts')
    .option('--api-key <key>', 'Linear API key for target workspace')
    .action(async (options) => {
      try {
        const apiKey = options.apiKey || process.env['LINEAR_NEW_API_KEY'];

        if (!apiKey) {
          console.error(
            chalk.red(
              '❌ API key required. Use --api-key or set LINEAR_NEW_API_KEY'
            )
          );
          return;
        }

        const readline = await import('readline');
        const rl = readline.createInterface({
          input: process.stdin,
          output: process.stdout,
        });

        const question = (prompt: string): Promise<string> => {
          return new Promise((resolve) => {
            rl.question(prompt, resolve);
          });
        };

        console.log(chalk.blue('📝 Quick Linear Task Creation'));
        console.log(chalk.gray('Press Ctrl+C to cancel at any time\n'));

        const title = await question(chalk.yellow('Task title: '));
        if (!title.trim()) {
          console.log(chalk.red('❌ Title is required'));
          rl.close();
          return;
        }

        const description = await question(
          chalk.yellow('Description (optional): ')
        );
        const priorityInput = await question(
          chalk.yellow('Priority (1=urgent, 2=high, 3=medium, 4=low) [3]: ')
        );
        const priority = priorityInput.trim() || '3';

        rl.close();

        console.log(chalk.yellow('\n🔄 Creating task...'));

        const client = new LinearRestClient(apiKey);
        const team = await client.getTeam();

        const createQuery = `
          mutation CreateIssue($input: IssueCreateInput!) {
            issueCreate(input: $input) {
              success
              issue {
                id
                identifier
                title
                state { name }
                priority
                url
              }
            }
          }
        `;

        const taskInput = {
          title: title.trim(),
          description: description.trim() || undefined,
          teamId: team.id,
          priority: parseInt(priority),
        };

        const response = await client.makeRequest<{
          data: {
            issueCreate: {
              success: boolean;
              issue: any;
            };
          };
        }>(createQuery, { input: taskInput });

        if (!response.data?.issueCreate?.success) {
          throw new Error('Failed to create task in Linear');
        }

        const task = response.data.issueCreate.issue;

        console.log(chalk.green('\n✅ Task created successfully!'));
        console.log(chalk.blue(`📋 ${task.identifier}: ${task.title}`));
        console.log(chalk.gray(`   URL: ${task.url}`));
      } catch (error: unknown) {
        console.error(
          chalk.red('❌ Task creation failed:'),
          (error as Error).message
        );
      }
    });
}
