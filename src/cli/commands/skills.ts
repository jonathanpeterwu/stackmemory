#!/usr/bin/env node
/**
 * Claude Skills CLI Commands
 * Integrates Claude skills into the stackmemory CLI
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { ClaudeSkillsManager, type SkillContext } from '../../skills/claude-skills.js';
import { DualStackManager } from '../../core/context/dual-stack-manager.js';
import { FrameHandoffManager } from '../../core/context/frame-handoff-manager.js';
import { ContextRetriever } from '../../core/retrieval/context-retriever.js';
import { SQLiteAdapter } from '../../core/database/sqlite-adapter.js';
import { ConfigManager } from '../../core/config/config-manager.js';
import * as path from 'path';
import * as os from 'os';

async function initializeSkillContext(): Promise<SkillContext> {
  const config = ConfigManager.getInstance();
  const projectId = config.get('project.id');
  const userId = config.get('user.id') || process.env.USER || 'default';
  
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

  return {
    projectId,
    userId,
    dualStackManager,
    handoffManager,
    contextRetriever,
    database,
  };
}

export function createSkillsCommand(): Command {
  const skillsCmd = new Command('skills')
    .description('Execute Claude skills for enhanced workflow');

  // Handoff skill command
  skillsCmd
    .command('handoff <targetUser> <message>')
    .description('Streamline frame handoffs between team members')
    .option('-p, --priority <level>', 'Set priority (low, medium, high, critical)', 'medium')
    .option('-f, --frames <frames...>', 'Specific frames to handoff')
    .option('--no-auto-detect', 'Disable auto-detection of frames')
    .action(async (targetUser, message, options) => {
      const spinner = ora('Initiating handoff...').start();
      
      try {
        const context = await initializeSkillContext();
        const skillsManager = new ClaudeSkillsManager(context);
        
        const result = await skillsManager.executeSkill('handoff', [targetUser, message], {
          priority: options.priority,
          frames: options.frames,
          autoDetect: options.autoDetect !== false,
        });

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
              result.data.actionItems.forEach(item => {
                console.log(`    • ${item}`);
              });
            }
          }
        } else {
          console.log(chalk.red('✗'), result.message);
        }

        await context.database.disconnect();
      } catch (error) {
        spinner.stop();
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Checkpoint skill commands
  const checkpointCmd = skillsCmd.command('checkpoint')
    .description('Create and manage recovery points');

  checkpointCmd
    .command('create <description>')
    .description('Create a new checkpoint')
    .option('--files <files...>', 'Include specific files in checkpoint')
    .option('--auto-detect-risky', 'Auto-detect risky operations')
    .action(async (description, options) => {
      const spinner = ora('Creating checkpoint...').start();
      
      try {
        const context = await initializeSkillContext();
        const skillsManager = new ClaudeSkillsManager(context);
        
        const result = await skillsManager.executeSkill('checkpoint', ['create', description], {
          includeFiles: options.files,
          autoDetectRisky: options.autoDetectRisky,
        });

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
      } catch (error) {
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
        const context = await initializeSkillContext();
        const skillsManager = new ClaudeSkillsManager(context);
        
        const result = await skillsManager.executeSkill('checkpoint', ['restore', checkpointId]);

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
      } catch (error) {
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
        const context = await initializeSkillContext();
        const skillsManager = new ClaudeSkillsManager(context);
        
        const result = await skillsManager.executeSkill('checkpoint', ['list'], {
          limit: parseInt(options.limit),
          since: options.since ? new Date(options.since) : undefined,
        });

        spinner.stop();

        if (result.success) {
          console.log(chalk.cyan('Available Checkpoints:\n'));
          if (result.data && result.data.length > 0) {
            result.data.forEach((cp: any) => {
              const riskIndicator = cp.risky ? chalk.yellow(' [RISKY]') : '';
              console.log(`${chalk.bold(cp.id)}${riskIndicator}`);
              console.log(`  ${cp.description}`);
              console.log(chalk.gray(`  ${cp.timestamp} (${cp.frameCount} frames)\n`));
            });
          } else {
            console.log(chalk.gray('No checkpoints found'));
          }
        } else {
          console.log(chalk.red('✗'), result.message);
        }

        await context.database.disconnect();
      } catch (error) {
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
        const context = await initializeSkillContext();
        const skillsManager = new ClaudeSkillsManager(context);
        
        const result = await skillsManager.executeSkill('checkpoint', ['diff', checkpoint1, checkpoint2]);

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
      } catch (error) {
        spinner.stop();
        console.error(chalk.red('Error:'), error.message);
        process.exit(1);
      }
    });

  // Context Archaeologist skill command
  skillsCmd
    .command('dig <query>')
    .description('Deep historical context retrieval')
    .option('-d, --depth <depth>', 'Search depth (e.g., 30days, 6months, all)', '30days')
    .option('--patterns', 'Extract patterns from results')
    .option('--decisions', 'Extract key decisions')
    .option('--timeline', 'Generate activity timeline')
    .action(async (query, options) => {
      const spinner = ora('Digging through context...').start();
      
      try {
        const context = await initializeSkillContext();
        const skillsManager = new ClaudeSkillsManager(context);
        
        const result = await skillsManager.executeSkill('dig', [query], {
          depth: options.depth,
          patterns: options.patterns,
          decisions: options.decisions,
          timeline: options.timeline,
        });

        spinner.stop();

        if (result.success) {
          console.log(chalk.green('✓'), result.message);
          
          if (result.data) {
            console.log(chalk.cyan(`\nSearched ${result.data.timeRange.from} to ${result.data.timeRange.to}`));
            
            if (result.data.summary) {
              console.log('\n' + result.data.summary);
            } else {
              // Display top results
              if (result.data.topResults?.length > 0) {
                console.log(chalk.cyan('\nTop Results:'));
                result.data.topResults.forEach((r: any) => {
                  console.log(`  ${chalk.yellow(`[${r.score.toFixed(2)}]`)} ${r.summary}`);
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
                  console.log(`  ${chalk.gray(new Date(d.timestamp).toLocaleDateString())}: ${d.decision}`);
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
      } catch (error) {
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
      const context = await initializeSkillContext();
      const skillsManager = new ClaudeSkillsManager(context);
      
      if (skill) {
        console.log(skillsManager.getSkillHelp(skill));
      } else {
        console.log(chalk.cyan('Available Claude Skills:\n'));
        console.log('  handoff    - Streamline frame handoffs between team members');
        console.log('  checkpoint - Create and manage recovery points');
        console.log('  dig        - Deep historical context retrieval\n');
        console.log('Use "stackmemory skills help <skill>" for detailed help on each skill');
      }
      
      await context.database.disconnect();
    });

  return skillsCmd;
}