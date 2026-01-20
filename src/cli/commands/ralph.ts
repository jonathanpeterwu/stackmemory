/**
 * Ralph Wiggum Loop Commands
 * CLI interface for Ralph-StackMemory integration
 */

import { Command } from 'commander';
import { logger } from '../../core/monitoring/logger.js';
import { RalphLoop } from '../../../scripts/ralph-loop-implementation.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { trace } from '../../core/trace/index.js';

export function createRalphCommand(): Command {
  const ralph = new Command('ralph')
    .description('Ralph Wiggum Loop integration with StackMemory');

  // Initialize a new Ralph loop
  ralph
    .command('init')
    .description('Initialize a new Ralph Wiggum loop')
    .argument('<task>', 'Task description')
    .option('-c, --criteria <criteria>', 'Completion criteria (comma separated)')
    .option('--max-iterations <n>', 'Maximum iterations', '50')
    .option('--use-context', 'Load relevant context from StackMemory')
    .option('--learn-from-similar', 'Apply patterns from similar completed tasks')
    .action(async (task, options) => {
      return trace.command('ralph-init', { task, ...options }, async () => {
        try {
          console.log('🎭 Initializing Ralph Wiggum loop...');
          
          // Use basic Ralph loop for now (StackMemory integration requires DB setup)
          const loop = new RalphLoop({
            baseDir: '.ralph',
            maxIterations: parseInt(options.maxIterations),
            verbose: true
          });

          // Parse criteria
          const criteria = options.criteria 
            ? options.criteria.split(',').map((c: string) => `- ${c.trim()}`).join('\n')
            : '- All tests pass\n- Code works correctly\n- No lint errors';

          // TODO: Add StackMemory context loading when available
          let enhancedTask = task;
          if (options.useContext) {
            console.log('📚 Context loading feature coming soon...');
          }
          if (options.learnFromSimilar) {
            console.log('🧠 Pattern learning feature coming soon...');
          }

          await loop.initialize(enhancedTask, criteria);
          
          console.log('✅ Ralph loop initialized!');
          console.log(`📋 Task: ${task}`);
          console.log(`🎯 Max iterations: ${options.maxIterations}`);
          console.log(`📁 Loop directory: .ralph/`);
          console.log('\nNext steps:');
          console.log('  stackmemory ralph run     # Start the loop');
          console.log('  stackmemory ralph status  # Check status');

        } catch (error: unknown) {
          logger.error('Failed to initialize Ralph loop', error as Error);
          console.error('❌ Initialization failed:', (error as Error).message);
          process.exit(1);
        }
      });
    });

  // Run the Ralph loop
  ralph
    .command('run')
    .description('Run the Ralph Wiggum loop')
    .option('--verbose', 'Verbose output')
    .option('--pause-on-error', 'Pause on validation errors')
    .action(async (options) => {
      return trace.command('ralph-run', options, async () => {
        try {
          if (!existsSync('.ralph')) {
            console.error('❌ No Ralph loop found. Run "stackmemory ralph init" first.');
            return;
          }

          console.log('🎭 Starting Ralph Wiggum loop...');
          
          const loop = new RalphLoop({
            baseDir: '.ralph',
            verbose: options.verbose
          });

          await loop.run();
          
        } catch (error: unknown) {
          logger.error('Failed to run Ralph loop', error as Error);
          console.error('❌ Loop execution failed:', (error as Error).message);
          process.exit(1);
        }
      });
    });

  // Show loop status
  ralph
    .command('status')
    .description('Show current Ralph loop status')
    .option('--detailed', 'Show detailed iteration history')
    .action(async (options) => {
      return trace.command('ralph-status', options, async () => {
        try {
          if (!existsSync('.ralph')) {
            console.log('❌ No Ralph loop found in current directory');
            return;
          }

          // Get basic status from files
          
          // Read status from files
          const task = readFileSync('.ralph/task.md', 'utf8');
          const iteration = parseInt(readFileSync('.ralph/iteration.txt', 'utf8') || '0');
          const isComplete = existsSync('.ralph/work-complete.txt');
          const feedback = existsSync('.ralph/feedback.txt') ? readFileSync('.ralph/feedback.txt', 'utf8') : '';
          
          console.log('🎭 Ralph Loop Status:');
          console.log(`   Task: ${task.substring(0, 80)}...`);
          console.log(`   Iteration: ${iteration}`);
          console.log(`   Status: ${isComplete ? '✅ COMPLETE' : '🔄 IN PROGRESS'}`);
          
          if (feedback) {
            console.log(`   Last feedback: ${feedback.substring(0, 100)}...`);
          }

          if (options.detailed && existsSync('.ralph/progress.jsonl')) {
            console.log('\n📊 Iteration History:');
            const progressLines = readFileSync('.ralph/progress.jsonl', 'utf8')
              .split('\n')
              .filter(Boolean)
              .map(line => JSON.parse(line));
            
            progressLines.forEach((p: any) => {
              const progress = p as { iteration: number; validation?: { testsPass: boolean }; changes: number; errors: number };
              const status = progress.validation?.testsPass ? '✅' : '❌';
              console.log(`     ${progress.iteration}: ${status} ${progress.changes} changes, ${progress.errors} errors`);
            });
          }

          // TODO: Show StackMemory integration status when available

        } catch (error: unknown) {
          logger.error('Failed to get Ralph status', error as Error);
          console.error('❌ Status check failed:', (error as Error).message);
        }
      });
    });

  // Resume a crashed or paused loop
  ralph
    .command('resume')
    .description('Resume a crashed or paused Ralph loop')
    .option('--from-stackmemory', 'Restore from StackMemory backup')
    .action(async (options) => {
      return trace.command('ralph-resume', options, async () => {
        try {
          console.log('🔄 Resuming Ralph loop...');
          
          const loop = new RalphLoop({ baseDir: '.ralph', verbose: true });
          
          if (options.fromStackmemory) {
            console.log('📚 StackMemory restore feature coming soon...');
          }

          await loop.run(); // Resume by continuing the loop
          
        } catch (error: unknown) {
          logger.error('Failed to resume Ralph loop', error as Error);
          console.error('❌ Resume failed:', (error as Error).message);
          process.exit(1);
        }
      });
    });

  // Stop the current loop
  ralph
    .command('stop')
    .description('Stop the current Ralph loop')
    .option('--save-progress', 'Save current progress to StackMemory')
    .action(async (options) => {
      return trace.command('ralph-stop', options, async () => {
        try {
          if (!existsSync('.ralph')) {
            console.log('❌ No active Ralph loop found');
            return;
          }

          console.log('🛑 Stopping Ralph loop...');
          
          if (options.saveProgress) {
            console.log('💾 StackMemory progress save feature coming soon...');
          }

          // Create stop signal file
          writeFileSync('.ralph/stop-signal.txt', new Date().toISOString());
          console.log('✅ Stop signal sent');
          
        } catch (error: unknown) {
          logger.error('Failed to stop Ralph loop', error as Error);
          console.error('❌ Stop failed:', (error as Error).message);
        }
      });
    });

  // Clean up loop artifacts
  ralph
    .command('clean')
    .description('Clean up Ralph loop artifacts')
    .option('--keep-history', 'Keep iteration history')
    .action(async (options) => {
      return trace.command('ralph-clean', options, async () => {
        try {
          // Clean up Ralph directory
          if (!options.keepHistory && existsSync('.ralph/history')) {
            const { execSync } = await import('child_process');
            execSync('rm -rf .ralph/history');
          }
          
          // Remove working files but keep task definition
          if (existsSync('.ralph/work-complete.txt')) {
            const fs = await import('fs');
            fs.unlinkSync('.ralph/work-complete.txt');
          }
          
          console.log('🧹 Ralph loop artifacts cleaned');
          
        } catch (error: unknown) {
          logger.error('Failed to clean Ralph artifacts', error as Error);
          console.error('❌ Cleanup failed:', (error as Error).message);
        }
      });
    });

  // Debug and diagnostics
  ralph
    .command('debug')
    .description('Debug Ralph loop state and diagnostics')
    .option('--reconcile', 'Force state reconciliation')
    .option('--validate-context', 'Validate context budget')
    .action(async (options) => {
      return trace.command('ralph-debug', options, async () => {
        try {
          console.log('🔍 Ralph Loop Debug Information:');
          
          if (options.reconcile) {
            console.log('🔧 State reconciliation feature coming soon...');
          }

          if (options.validateContext) {
            console.log('📊 Context validation feature coming soon...');
          }

          // Show file structure
          if (existsSync('.ralph')) {
            console.log('\n📁 Ralph directory structure:');
            const { execSync } = await import('child_process');
            try {
              const tree = execSync('find .ralph -type f | head -20', { encoding: 'utf8' });
              console.log(tree);
            } catch {
              console.log('   (Unable to show directory tree)');
            }
          }
          
        } catch (error: unknown) {
          logger.error('Ralph debug failed', error as Error);
          console.error('❌ Debug failed:', (error as Error).message);
        }
      });
    });

  return ralph;
}

export default createRalphCommand;