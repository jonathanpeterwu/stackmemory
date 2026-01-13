#!/usr/bin/env node
/**
 * Claude Skills CLI Commands
 * Integrates Claude skills into the stackmemory CLI
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import {
  ClaudeSkillsManager,
  type SkillContext,
} from '../../skills/claude-skills.js';
import { 
  UnifiedRLMOrchestrator, 
  initializeUnifiedOrchestrator 
} from '../../skills/unified-rlm-orchestrator.js';
import { DualStackManager } from '../../core/context/dual-stack-manager.js';
import { FrameHandoffManager } from '../../core/context/frame-handoff-manager.js';
import { FrameManager } from '../../core/context/frame-manager.js';
import { ContextRetriever } from '../../core/retrieval/context-retriever.js';
import { SQLiteAdapter } from '../../core/database/sqlite-adapter.js';
import { LinearTaskManager } from '../../features/tasks/linear-task-manager.js';
import { ConfigManager } from '../../core/config/config-manager.js';
import * as path from 'path';
import * as os from 'os';
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

async function initializeSkillContext(): Promise<{ 
  context: SkillContext;
  unifiedOrchestrator: UnifiedRLMOrchestrator;
}> {
  const config = ConfigManager.getInstance();
  const projectId = config.get('project.id') || 'default-project';
  const userId = config.get('user.id') || process.env['USER'] || 'default';

  const dbPath = path.join(
    os.homedir(),
    '.stackmemory',
    'data',
    projectId,
    'stackmemory.db'
  );

  const database = new SQLiteAdapter(projectId, { dbPath });
  await database.connect();

  const dualStackManager = new DualStackManager(database, projectId, userId);
  const handoffManager = new FrameHandoffManager(dualStackManager);
  const contextRetriever = new ContextRetriever(database);
  const frameManager = new FrameManager(database);
  const taskStore = new LinearTaskManager();

  const context: SkillContext = {
    projectId,
    userId,
    dualStackManager,
    handoffManager,
    contextRetriever,
    database,
  };
  
  // Initialize unified RLM orchestrator
  const unifiedOrchestrator = initializeUnifiedOrchestrator(
    frameManager,
    dualStackManager,
    contextRetriever,
    taskStore,
    context
  );

  return { context, unifiedOrchestrator };
}

export function createSkillsCommand(): Command {
  const skillsCmd = new Command('skills').description(
    'Execute Claude skills for enhanced workflow'
  );

  // Handoff skill command
  skillsCmd
    .command('handoff <targetUser> <message>')
    .description('Streamline frame handoffs between team members')
    .option(
      '-p, --priority <level>',
      'Set priority (low, medium, high, critical)',
      'medium'
    )
    .option('-f, --frames <frames...>', 'Specific frames to handoff')
    .option('--no-auto-detect', 'Disable auto-detection of frames')
    .action(async (targetUser, message, options) => {
      const spinner = ora('Initiating handoff...').start();

      try {
        const { context, unifiedOrchestrator } = await initializeSkillContext();

        // Use unified RLM orchestrator for RLM-first execution
        const result = await unifiedOrchestrator.executeSkill(
          'handoff',
          [targetUser, message],
          {
            priority: options.priority,
            frames: options.frames,
            autoDetect: options.autoDetect !== false,
          }
        );

        spinner.stop();

        if (result.success) {
          console.log(chalk.green('✓'), result.message);
          if (result.data) {
            console.log(chalk.cyan('\nHandoff Details:'));
            console.log(`  ID: ${result.data.handoffId}`);
            console.log(`  Frames: ${result.data.frameCount}`);
            console.log(`  Priority: ${result.data.priority}`);
            if (result.data.actionItems?.length > 0) {
              console.log(chalk.yellow('\n  Action Items:'));
              result.data.actionItems.forEach((item) => {
                console.log(`    • ${item}`);
              });
            }
          }
        } else {
          console.log(chalk.red('✗'), result.message);
        }

        await context.database.disconnect();
      } catch (error: unknown) {
        spinner.stop();
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Checkpoint skill commands
  const checkpointCmd = skillsCmd
    .command('checkpoint')
    .description('Create and manage recovery points');

  checkpointCmd
    .command('create <description>')
    .description('Create a new checkpoint')
    .option('--files <files...>', 'Include specific files in checkpoint')
    .option('--auto-detect-risky', 'Auto-detect risky operations')
    .action(async (description, options) => {
      const spinner = ora('Creating checkpoint...').start();

      try {
        const { context, unifiedOrchestrator } = await initializeSkillContext();

        const result = await unifiedOrchestrator.executeSkill(
          'checkpoint',
          ['create', description],
          {
            includeFiles: options.files,
            autoDetectRisky: options.autoDetectRisky,
          }
        );

        spinner.stop();

        if (result.success) {
          console.log(chalk.green('✓'), result.message);
          if (result.data) {
            console.log(chalk.cyan('\nCheckpoint Info:'));
            console.log(`  ID: ${result.data.checkpointId}`);
            console.log(`  Time: ${result.data.timestamp}`);
            console.log(`  Frames: ${result.data.frameCount}`);
          }
        } else {
          console.log(chalk.red('✗'), result.message);
        }

        await context.database.disconnect();
      } catch (error: unknown) {
        spinner.stop();
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  checkpointCmd
    .command('restore <checkpointId>')
    .description('Restore from a checkpoint')
    .action(async (checkpointId) => {
      const spinner = ora('Restoring checkpoint...').start();

      try {
        const { context, unifiedOrchestrator } = await initializeSkillContext();

        const result = await unifiedOrchestrator.executeSkill('checkpoint', [
          'restore',
          checkpointId,
        ]);

        spinner.stop();

        if (result.success) {
          console.log(chalk.green('✓'), result.message);
          if (result.data) {
            console.log(chalk.cyan('\nRestored:'));
            console.log(`  Frames: ${result.data.frameCount}`);
            console.log(`  Files: ${result.data.filesRestored}`);
          }
        } else {
          console.log(chalk.red('✗'), result.message);
        }

        await context.database.disconnect();
      } catch (error: unknown) {
        spinner.stop();
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  checkpointCmd
    .command('list')
    .description('List available checkpoints')
    .option('-l, --limit <number>', 'Limit number of results', '10')
    .option('-s, --since <date>', 'Show checkpoints since date')
    .action(async (options) => {
      const spinner = ora('Loading checkpoints...').start();

      try {
        const { context, unifiedOrchestrator } = await initializeSkillContext();

        const result = await unifiedOrchestrator.executeSkill(
          'checkpoint',
          ['list'],
          {
            limit: parseInt(options.limit),
            since: options.since ? new Date(options.since) : undefined,
          }
        );

        spinner.stop();

        if (result.success) {
          console.log(chalk.cyan('Available Checkpoints:\n'));
          if (result.data && result.data.length > 0) {
            result.data.forEach((cp: any) => {
              const riskIndicator = cp.risky ? chalk.yellow(' [RISKY]') : '';
              console.log(`${chalk.bold(cp.id)}${riskIndicator}`);
              console.log(`  ${cp.description}`);
              console.log(
                chalk.gray(`  ${cp.timestamp} (${cp.frameCount} frames)\n`)
              );
            });
          } else {
            console.log(chalk.gray('No checkpoints found'));
          }
        } else {
          console.log(chalk.red('✗'), result.message);
        }

        await context.database.disconnect();
      } catch (error: unknown) {
        spinner.stop();
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  checkpointCmd
    .command('diff <checkpoint1> <checkpoint2>')
    .description('Show differences between two checkpoints')
    .action(async (checkpoint1, checkpoint2) => {
      const spinner = ora('Comparing checkpoints...').start();

      try {
        const { context, unifiedOrchestrator } = await initializeSkillContext();

        const result = await unifiedOrchestrator.executeSkill('checkpoint', [
          'diff',
          checkpoint1,
          checkpoint2,
        ]);

        spinner.stop();

        if (result.success) {
          console.log(chalk.cyan('Checkpoint Diff:\n'));
          if (result.data) {
            console.log(`  Time difference: ${result.data.timeDiff}`);
            console.log(`  Frame difference: ${result.data.framesDiff}`);
            console.log(`  New frames: ${result.data.newFrames}`);
            console.log(`  Removed frames: ${result.data.removedFrames}`);
            console.log(`  Modified frames: ${result.data.modifiedFrames}`);
          }
        } else {
          console.log(chalk.red('✗'), result.message);
        }

        await context.database.disconnect();
      } catch (error: unknown) {
        spinner.stop();
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Context Archaeologist skill command
  skillsCmd
    .command('dig <query>')
    .description('Deep historical context retrieval')
    .option(
      '-d, --depth <depth>',
      'Search depth (e.g., 30days, 6months, all)',
      '30days'
    )
    .option('--patterns', 'Extract patterns from results')
    .option('--decisions', 'Extract key decisions')
    .option('--timeline', 'Generate activity timeline')
    .action(async (query, options) => {
      const spinner = ora('Digging through context...').start();

      try {
        const { context, unifiedOrchestrator } = await initializeSkillContext();

        const result = await unifiedOrchestrator.executeSkill('dig', [query], {
          depth: options.depth,
          patterns: options.patterns,
          decisions: options.decisions,
          timeline: options.timeline,
        });

        spinner.stop();

        if (result.success) {
          console.log(chalk.green('✓'), result.message);

          if (result.data) {
            console.log(
              chalk.cyan(
                `\nSearched ${result.data.timeRange.from} to ${result.data.timeRange.to}`
              )
            );

            if (result.data.summary) {
              console.log('\n' + result.data.summary);
            } else {
              // Display top results
              if (result.data.topResults?.length > 0) {
                console.log(chalk.cyan('\nTop Results:'));
                result.data.topResults.forEach((r: any) => {
                  console.log(
                    `  ${chalk.yellow(`[${r.score.toFixed(2)}]`)} ${r.summary}`
                  );
                });
              }

              // Display patterns if found
              if (result.data.patterns?.length > 0) {
                console.log(chalk.cyan('\nDetected Patterns:'));
                result.data.patterns.forEach((p: any) => {
                  console.log(`  ${p.name}: ${p.count} occurrences`);
                });
              }

              // Display decisions if found
              if (result.data.decisions?.length > 0) {
                console.log(chalk.cyan('\nKey Decisions:'));
                result.data.decisions.slice(0, 5).forEach((d: any) => {
                  console.log(
                    `  ${chalk.gray(new Date(d.timestamp).toLocaleDateString())}: ${d.decision}`
                  );
                });
              }

              // Display timeline if generated
              if (result.data.timeline?.length > 0) {
                console.log(chalk.cyan('\nActivity Timeline:'));
                result.data.timeline.slice(0, 5).forEach((t: any) => {
                  console.log(`  ${t.date}: ${t.itemCount} activities`);
                });
              }
            }
          }
        } else {
          console.log(chalk.red('✗'), result.message);
        }

        await context.database.disconnect();
      } catch (error: unknown) {
        spinner.stop();
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // RLM (Recursive Language Model) skill command
  skillsCmd
    .command('rlm <task>')
    .description('Execute complex tasks with recursive agent orchestration')
    .option('--max-parallel <number>', 'Maximum concurrent subagents', '5')
    .option('--max-recursion <number>', 'Maximum recursion depth', '4')
    .option('--max-tokens-per-agent <number>', 'Token budget per subagent', '30000')
    .option('--review-stages <number>', 'Number of review iterations', '3')
    .option('--quality-threshold <number>', 'Target quality score (0-1)', '0.85')
    .option('--test-mode <mode>', 'Test generation mode (unit/integration/e2e/all)', 'all')
    .option('--verbose', 'Show all recursive operations', false)
    .option('--share-context-realtime', 'Share discoveries between agents', true)
    .option('--retry-failed-agents', 'Retry on failure', true)
    .option('--timeout-per-agent <number>', 'Timeout in seconds', '300')
    .action(async (task, options) => {
      const spinner = ora('Initializing RLM orchestrator...').start();

      try {
        const { context, unifiedOrchestrator } = await initializeSkillContext();

        spinner.text = 'Decomposing task...';
        
        const result = await unifiedOrchestrator.executeSkill('rlm', [task], {
          maxParallel: parseInt(options.maxParallel),
          maxRecursionDepth: parseInt(options.maxRecursion),
          maxTokensPerAgent: parseInt(options.maxTokensPerAgent),
          reviewStages: parseInt(options.reviewStages),
          qualityThreshold: parseFloat(options.qualityThreshold),
          testGenerationMode: options.testMode,
          verboseLogging: options.verbose,
          shareContextRealtime: options.shareContextRealtime,
          retryFailedAgents: options.retryFailedAgents,
          timeoutPerAgent: parseInt(options.timeoutPerAgent) * 1000,
        });

        spinner.stop();

        if (result.success) {
          console.log(chalk.green('✓'), 'RLM execution completed');
          
          if (result.data) {
            console.log(chalk.cyan('\nExecution Summary:'));
            console.log(`  Total tokens: ${result.data.totalTokens}`);
            console.log(`  Estimated cost: $${result.data.totalCost.toFixed(2)}`);
            console.log(`  Duration: ${result.data.duration}ms`);
            console.log(`  Tests generated: ${result.data.testsGenerated}`);
            console.log(`  Issues found: ${result.data.issuesFound}`);
            console.log(`  Issues fixed: ${result.data.issuesFixed}`);
            
            if (result.data.improvements?.length > 0) {
              console.log(chalk.cyan('\nImprovements:'));
              result.data.improvements.forEach((imp: string) => {
                console.log(`  • ${imp}`);
              });
            }
          }
        } else {
          console.log(chalk.red('✗'), result.message);
        }

        await context.database.disconnect();
      } catch (error: unknown) {
        spinner.stop();
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Help command for skills
  skillsCmd
    .command('help [skill]')
    .description('Show help for a specific skill')
    .action(async (skill) => {
      if (skill) {
        // Show specific skill help
        switch (skill) {
          case 'lint':
            console.log(`
lint (RLM-Orchestrated)
Primary Agent: linting
Secondary Agents: improve

Comprehensive linting of code: Check syntax, types, formatting, security, performance, and dead code. Provide fixes.

This skill is executed through RLM orchestration for:
- Automatic task decomposition
- Parallel agent execution
- Multi-stage quality review
- Comprehensive result aggregation

Usage:
  stackmemory skills lint                  # Lint current directory
  stackmemory skills lint src/             # Lint specific directory
  stackmemory skills lint src/file.ts     # Lint specific file

Options:
  --fix                 Automatically fix issues where possible
  --format             Focus on formatting issues
  --security           Focus on security vulnerabilities
  --performance        Focus on performance issues
  --verbose            Show detailed output
`);
            break;
          default:
            console.log(`Unknown skill: ${skill}. Use "stackmemory skills help" to see all available skills.`);
        }
      } else {
        console.log(chalk.cyan('Available Claude Skills (RLM-Orchestrated):\n'));
        console.log(
          '  handoff    - Streamline frame handoffs between team members'
        );
        console.log('  checkpoint - Create and manage recovery points');
        console.log('  dig        - Deep historical context retrieval');
        console.log('  lint       - Comprehensive code linting and quality checks');
        console.log('  test       - Generate comprehensive test suites');
        console.log('  review     - Multi-stage code review and improvements');
        console.log('  refactor   - Refactor code for better architecture');
        console.log('  publish    - Prepare and execute releases');
        console.log('  rlm        - Direct recursive agent orchestration\n');
        console.log(chalk.yellow('\nAll skills now use RLM orchestration for intelligent task decomposition'));
        console.log(
          'Use "stackmemory skills help <skill>" for detailed help on each skill'
        );
      }
    });

  return skillsCmd;
}
