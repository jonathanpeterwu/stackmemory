/**
 * Ralph Wiggum Loop Commands
 * CLI interface for Ralph-StackMemory integration
 */

import { Command } from 'commander';
import { logger } from '../../core/monitoring/logger.js';
import { RalphLoop } from '../../../scripts/ralph-loop-implementation.js';
import { stackMemoryContextLoader } from '../../integrations/ralph/context/stackmemory-context-loader.js';
import { patternLearner } from '../../integrations/ralph/learning/pattern-learner.js';
import { multiLoopOrchestrator } from '../../integrations/ralph/orchestration/multi-loop-orchestrator.js';
import { swarmCoordinator } from '../../integrations/ralph/swarm/swarm-coordinator.js';
import { ralphDebugger } from '../../integrations/ralph/visualization/ralph-debugger.js';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { trace } from '../../core/trace/index.js';

export function createRalphCommand(): Command {
  const ralph = new Command('ralph').description(
    'Ralph Wiggum Loop integration with StackMemory'
  );

  // Initialize a new Ralph loop
  ralph
    .command('init')
    .description('Initialize a new Ralph Wiggum loop')
    .argument('<task>', 'Task description')
    .option(
      '-c, --criteria <criteria>',
      'Completion criteria (comma separated)'
    )
    .option('--max-iterations <n>', 'Maximum iterations', '50')
    .option('--use-context', 'Load relevant context from StackMemory')
    .option(
      '--learn-from-similar',
      'Apply patterns from similar completed tasks'
    )
    .action(async (task, options) => {
      return trace.command('ralph-init', { task, ...options }, async () => {
        try {
          console.log('🎭 Initializing Ralph Wiggum loop...');

          // Use basic Ralph loop for now (StackMemory integration requires DB setup)
          const loop = new RalphLoop({
            baseDir: '.ralph',
            maxIterations: parseInt(options.maxIterations),
            verbose: true,
          });

          // Parse criteria
          const criteria = options.criteria
            ? options.criteria
                .split(',')
                .map((c: string) => `- ${c.trim()}`)
                .join('\n')
            : '- All tests pass\n- Code works correctly\n- No lint errors';

          // Load StackMemory context if requested
          let enhancedTask = task;

          if (options.useContext || options.learnFromSimilar) {
            try {
              await stackMemoryContextLoader.initialize();

              const contextResponse =
                await stackMemoryContextLoader.loadInitialContext({
                  task,
                  usePatterns: true,
                  useSimilarTasks: options.learnFromSimilar,
                  maxTokens: 3000,
                });

              if (contextResponse.context) {
                enhancedTask = `${task}\n\n${contextResponse.context}`;
                console.log(
                  `📚 Loaded context from ${contextResponse.sources.length} sources`
                );
                console.log(
                  `🎯 Context tokens: ${contextResponse.metadata.totalTokens}`
                );
              }
            } catch (error: unknown) {
              console.log(
                `⚠️  Context loading failed: ${(error as Error).message}`
              );
              console.log('Proceeding without context...');
            }
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
            console.error(
              '❌ No Ralph loop found. Run "stackmemory ralph init" first.'
            );
            return;
          }

          console.log('🎭 Starting Ralph Wiggum loop...');

          const loop = new RalphLoop({
            baseDir: '.ralph',
            verbose: options.verbose,
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
          const iteration = parseInt(
            readFileSync('.ralph/iteration.txt', 'utf8') || '0'
          );
          const isComplete = existsSync('.ralph/work-complete.txt');
          const feedback = existsSync('.ralph/feedback.txt')
            ? readFileSync('.ralph/feedback.txt', 'utf8')
            : '';

          console.log('🎭 Ralph Loop Status:');
          console.log(`   Task: ${task.substring(0, 80)}...`);
          console.log(`   Iteration: ${iteration}`);
          console.log(
            `   Status: ${isComplete ? '✅ COMPLETE' : '🔄 IN PROGRESS'}`
          );

          if (feedback) {
            console.log(`   Last feedback: ${feedback.substring(0, 100)}...`);
          }

          if (options.detailed && existsSync('.ralph/progress.jsonl')) {
            console.log('\n📊 Iteration History:');
            const progressLines = readFileSync('.ralph/progress.jsonl', 'utf8')
              .split('\n')
              .filter(Boolean)
              .map((line) => JSON.parse(line));

            progressLines.forEach((p: any) => {
              const progress = p as {
                iteration: number;
                validation?: { testsPass: boolean };
                changes: number;
                errors: number;
              };
              const status = progress.validation?.testsPass ? '✅' : '❌';
              console.log(
                `     ${progress.iteration}: ${status} ${progress.changes} changes, ${progress.errors} errors`
              );
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
              const tree = execSync('find .ralph -type f | head -20', {
                encoding: 'utf8',
              });
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

  // Swarm coordination commands
  ralph
    .command('swarm')
    .description('Launch a swarm of specialized agents')
    .argument('<project>', 'Project description')
    .option(
      '--agents <agents>',
      'Comma-separated list of agent roles (architect,developer,tester,etc)',
      'developer,tester'
    )
    .option('--max-agents <n>', 'Maximum number of agents', '5')
    .action(async (project, options) => {
      return trace.command('ralph-swarm', { project, ...options }, async () => {
        try {
          console.log('🦾 Launching Ralph swarm...');

          await swarmCoordinator.initialize();

          const agentRoles = options.agents
            .split(',')
            .map((r: string) => r.trim());
          const agentSpecs = agentRoles.map((role: string) => ({
            role: role as any,
            conflictResolution: 'defer_to_expertise',
            collaborationPreferences: [],
          }));

          const swarmId = await swarmCoordinator.launchSwarm(
            project,
            agentSpecs
          );

          console.log(`✅ Swarm launched with ID: ${swarmId}`);
          console.log(`👥 ${agentSpecs.length} agents working on: ${project}`);
          console.log('\nNext steps:');
          console.log(
            '  stackmemory ralph swarm-status <swarmId>  # Check progress'
          );
          console.log(
            '  stackmemory ralph swarm-stop <swarmId>    # Stop swarm'
          );
        } catch (error: unknown) {
          logger.error('Swarm launch failed', error as Error);
          console.error('❌ Swarm launch failed:', (error as Error).message);
        }
      });
    });

  // Swarm status command
  ralph
    .command('swarm-status')
    .description('Check status of all active swarms or a specific swarm')
    .argument('[swarmId]', 'Optional specific swarm ID to check')
    .option('--detailed', 'Show detailed agent information')
    .action(async (swarmId, options) => {
      return trace.command(
        'ralph-swarm-status',
        { swarmId, ...options },
        async () => {
          try {
            await swarmCoordinator.initialize();

            if (swarmId) {
              // Show status for specific swarm
              const status = swarmCoordinator.getSwarmStatus(swarmId);
              if (!status) {
                console.log(`❌ Swarm ${swarmId} not found`);
                return;
              }

              console.log(`🦾 Swarm Status: ${swarmId}`);
              console.log(`   Status: ${status.state}`);
              console.log(`   Agents: ${status.activeAgents} active`);
              console.log(
                `   Started: ${new Date(status.startTime).toLocaleString()}`
              );

              if (options.detailed && status.agents) {
                console.log('\n👥 Agent Details:');
                status.agents.forEach((agent: any) => {
                  console.log(
                    `   - ${agent.role}: ${agent.status} (${agent.task})`
                  );
                });
              }
            } else {
              // Show all active swarms
              const activeSwarms = swarmCoordinator.getAllActiveSwarms();

              if (activeSwarms.length === 0) {
                console.log('📊 No active swarms');
                return;
              }

              console.log(`📊 Active Swarms: ${activeSwarms.length}`);
              activeSwarms.forEach((swarm: any) => {
                console.log(`\n🆔 ${swarm.id}`);
                console.log(
                  `   Description: ${swarm.description?.substring(0, 60)}...`
                );
                console.log(`   Agents: ${swarm.agentCount}`);
                console.log(`   Status: ${swarm.status}`);
                console.log(
                  `   Running for: ${Math.round((Date.now() - swarm.startTime) / 1000)}s`
                );
              });

              console.log('\nCommands:');
              console.log(
                '  stackmemory ralph swarm-status <id>  # Check specific swarm'
              );
              console.log(
                '  stackmemory ralph swarm-killall      # Stop all swarms'
              );
            }
          } catch (error: unknown) {
            logger.error('Failed to get swarm status', error as Error);
            console.error('❌ Status check failed:', (error as Error).message);
          }
        }
      );
    });

  // Oracle/Worker pattern command
  ralph
    .command('oracle-worker')
    .description(
      'Launch Oracle/Worker pattern swarm for cost-effective execution'
    )
    .argument('<project>', 'Project description for Oracle planning')
    .option(
      '--oracle <model>',
      'Oracle model (default: claude-3-opus)',
      'claude-3-opus-20240229'
    )
    .option(
      '--workers <models>',
      'Comma-separated worker models',
      'claude-3-haiku-20240307'
    )
    .option('--budget <amount>', 'Cost budget in USD', '10.0')
    .option('--max-workers <count>', 'Maximum worker agents', '5')
    .option('--hints <hints>', 'Comma-separated planning hints')
    .action(async (project: string, options: any) => {
      return trace.command(
        'ralph-oracle-worker',
        { project, ...options },
        async () => {
          try {
            console.log('🧠 Launching Oracle/Worker swarm...');
            console.log(`📋 Project: ${project}`);
            console.log(`💰 Budget: $${options.budget}`);

            // Import Oracle/Worker pattern
            const { OracleWorkerCoordinator, defaultModelConfigs } =
              await import('../../../integrations/ralph/patterns/oracle-worker-pattern.js');

            // Parse worker models
            const workerModels = options.workers
              .split(',')
              .map((model: string) => {
                const found = defaultModelConfigs.worker.find((w: any) =>
                  w.model.includes(model.trim())
                );
                return found || defaultModelConfigs.worker[0];
              });

            // Configure Oracle/Worker coordinator
            const coordinator = new OracleWorkerCoordinator({
              oracle: defaultModelConfigs.oracle[0],
              workers: workerModels,
              reviewers: defaultModelConfigs.reviewer,
              maxWorkers: parseInt(options.maxWorkers),
              coordinationInterval: 30000,
              costBudget: parseFloat(options.budget),
            });

            await coordinator.initialize();

            // Parse hints if provided
            const hints = options.hints
              ? options.hints.split(',').map((h: string) => h.trim())
              : undefined;

            // Launch Oracle/Worker swarm
            const swarmId = await coordinator.launchOracleWorkerSwarm(
              project,
              hints
            );

            console.log(`✅ Oracle/Worker swarm launched: ${swarmId}`);
            console.log('\n📊 Pattern Benefits:');
            console.log('  • Oracle handles strategic planning & review');
            console.log('  • Workers execute parallelizable tasks');
            console.log('  • Cost-optimized model selection');
            console.log('  • Scalable multi-agent coordination');

            console.log('\nNext steps:');
            console.log(
              `  stackmemory ralph swarm-status ${swarmId}  # Check progress`
            );
            console.log(
              `  stackmemory ralph swarm-stop ${swarmId}    # Stop swarm`
            );
          } catch (error: any) {
            logger.error('Oracle/Worker swarm failed', error);
            console.error(`❌ Oracle/Worker failed: ${error.message}`);
            throw error;
          }
        }
      );
    });

  // Claude Code Agent integration command
  ralph
    .command('claude-swarm')
    .description('Launch swarm using Claude Code specialized agents')
    .argument('<project>', 'Project description for Claude Code agents')
    .option(
      '--oracle <agent>',
      'Oracle agent (default: staff-architect)',
      'staff-architect'
    )
    .option(
      '--workers <agents>',
      'Comma-separated worker agents',
      'general-purpose,code-reviewer'
    )
    .option(
      '--reviewers <agents>',
      'Comma-separated reviewer agents',
      'code-reviewer'
    )
    .option('--budget <amount>', 'Cost budget in USD', '10.0')
    .option(
      '--complexity <level>',
      'Project complexity (low|medium|high|very_high)',
      'medium'
    )
    .option('--list-agents', 'List available Claude Code agents')
    .action(async (project: string, options: any) => {
      return trace.command(
        'ralph-claude-swarm',
        { project, ...options },
        async () => {
          try {
            // Import Claude Code bridge
            const { ClaudeCodeAgentBridge, CLAUDE_CODE_AGENTS } =
              await import('../../integrations/claude-code/agent-bridge.js');

            // Handle list agents option
            if (options.listAgents) {
              console.log('\n🤖 Available Claude Code Agents:\n');

              const oracles = Object.values(CLAUDE_CODE_AGENTS).filter(
                (a) => a.type === 'oracle'
              );
              const workers = Object.values(CLAUDE_CODE_AGENTS).filter(
                (a) => a.type === 'worker'
              );
              const reviewers = Object.values(CLAUDE_CODE_AGENTS).filter(
                (a) => a.type === 'reviewer'
              );

              console.log('🧠 ORACLE AGENTS (Strategic Planning):');
              oracles.forEach((agent) => {
                console.log(`  ${agent.name}: ${agent.description}`);
                console.log(
                  `    Capabilities: ${agent.capabilities.slice(0, 3).join(', ')}...`
                );
              });

              console.log('\n⚡ WORKER AGENTS (Task Execution):');
              workers.forEach((agent) => {
                console.log(`  ${agent.name}: ${agent.description}`);
                console.log(
                  `    Capabilities: ${agent.capabilities.slice(0, 3).join(', ')}...`
                );
              });

              console.log('\n🔍 REVIEWER AGENTS (Quality Assurance):');
              reviewers.forEach((agent) => {
                console.log(`  ${agent.name}: ${agent.description}`);
                console.log(
                  `    Capabilities: ${agent.capabilities.slice(0, 3).join(', ')}...`
                );
              });

              console.log('\nUsage Examples:');
              console.log(
                '  stackmemory ralph claude-swarm "Build REST API" --oracle staff-architect --workers general-purpose,debugger'
              );
              console.log(
                '  stackmemory ralph claude-swarm "Add user auth" --complexity high --workers general-purpose,qa-workflow-validator'
              );
              return;
            }

            console.log('🧠 Launching Claude Code Agent Swarm...');
            console.log(`📋 Project: ${project}`);
            console.log(`🎯 Oracle: ${options.oracle}`);
            console.log(`⚡ Workers: ${options.workers}`);
            console.log(`🔍 Reviewers: ${options.reviewers}`);
            console.log(`💰 Budget: $${options.budget}`);
            console.log(`📊 Complexity: ${options.complexity}`);

            // Initialize Claude Code bridge
            const bridge = new ClaudeCodeAgentBridge();
            await bridge.initialize();

            // Parse agent lists
            const workerAgents = options.workers
              .split(',')
              .map((s: string) => s.trim());
            const reviewerAgents = options.reviewers
              .split(',')
              .map((s: string) => s.trim());

            // Launch Claude Code swarm
            const swarmId = await bridge.launchClaudeCodeSwarm(project, {
              oracleAgent: options.oracle,
              workerAgents,
              reviewerAgents,
              budget: parseFloat(options.budget),
              complexity: options.complexity as any,
            });

            console.log(`✅ Claude Code swarm launched: ${swarmId}`);
            console.log('\n📊 Claude Code Benefits:');
            console.log('  • Specialized agents with proven capabilities');
            console.log('  • Seamless integration with Claude Code tools');
            console.log('  • Optimal agent selection for each task type');
            console.log('  • Built-in quality assurance and review processes');

            console.log('\nActive Agents:');
            console.log(`  🧠 Oracle: ${options.oracle} (strategic planning)`);
            workerAgents.forEach((agent: string) => {
              const agentConfig = CLAUDE_CODE_AGENTS[agent];
              console.log(
                `  ⚡ Worker: ${agent} (${agentConfig?.specializations.join(', ') || 'execution'})`
              );
            });
            reviewerAgents.forEach((agent: string) => {
              const agentConfig = CLAUDE_CODE_AGENTS[agent];
              console.log(
                `  🔍 Reviewer: ${agent} (${agentConfig?.specializations.join(', ') || 'review'})`
              );
            });

            console.log('\nNext steps:');
            console.log(
              `  stackmemory ralph swarm-status ${swarmId}     # Check progress`
            );
            console.log(
              `  stackmemory ralph swarm-stop ${swarmId}       # Stop swarm`
            );
            console.log(
              '  stackmemory ralph claude-swarm --list-agents  # See all available agents'
            );
          } catch (error: any) {
            logger.error('Claude Code swarm failed', error);
            console.error(`❌ Claude Code swarm failed: ${error.message}`);
            throw error;
          }
        }
      );
    });

  // Swarm killall command
  ralph
    .command('swarm-killall')
    .description('Stop all active swarms and cleanup resources')
    .option('--force', 'Force kill without saving state')
    .action(async (options) => {
      return trace.command('ralph-swarm-killall', options, async () => {
        try {
          await swarmCoordinator.initialize();

          const activeSwarms = swarmCoordinator.getAllActiveSwarms();

          if (activeSwarms.length === 0) {
            console.log('📊 No active swarms to stop');
            return;
          }

          console.log(`🛑 Stopping ${activeSwarms.length} active swarm(s)...`);

          let stoppedCount = 0;
          let failedCount = 0;

          for (const swarm of activeSwarms) {
            try {
              console.log(`   Stopping ${swarm.id}...`);

              if (options.force) {
                await swarmCoordinator.forceStopSwarm(swarm.id);
              } else {
                await swarmCoordinator.stopSwarm(swarm.id);
              }

              stoppedCount++;
              console.log(`   ✅ Stopped ${swarm.id}`);
            } catch (error: unknown) {
              failedCount++;
              console.error(
                `   ❌ Failed to stop ${swarm.id}: ${(error as Error).message}`
              );
            }
          }

          // Cleanup git branches if any
          try {
            const { execSync } = await import('child_process');
            const branches = execSync('git branch | grep "swarm/"', {
              encoding: 'utf8',
            })
              .split('\n')
              .filter(Boolean)
              .map((b) => b.trim());

            if (branches.length > 0) {
              console.log(
                `\n🔀 Cleaning up ${branches.length} swarm branches...`
              );
              for (const branch of branches) {
                try {
                  execSync(`git branch -D ${branch}`, { stdio: 'ignore' });
                  console.log(`   Deleted ${branch}`);
                } catch {
                  // Ignore branch deletion errors
                }
              }
            }
          } catch {
            // No swarm branches to clean
          }

          console.log(`\n📊 Summary:`);
          console.log(`   ✅ Stopped: ${stoppedCount} swarms`);
          if (failedCount > 0) {
            console.log(`   ❌ Failed: ${failedCount} swarms`);
          }

          // Final cleanup
          await swarmCoordinator.cleanup();
          console.log('🧹 Cleanup completed');
        } catch (error: unknown) {
          logger.error('Swarm killall failed', error as Error);
          console.error('❌ Killall failed:', (error as Error).message);
        }
      });
    });

  // Multi-loop orchestration for complex tasks
  ralph
    .command('orchestrate')
    .description('Orchestrate multiple Ralph loops for complex tasks')
    .argument('<description>', 'Complex task description')
    .option('--criteria <criteria>', 'Success criteria (comma separated)')
    .option('--max-loops <n>', 'Maximum parallel loops', '3')
    .option('--sequential', 'Force sequential execution')
    .action(async (description, options) => {
      return trace.command(
        'ralph-orchestrate',
        { description, ...options },
        async () => {
          try {
            console.log('🎭 Orchestrating complex task...');

            await multiLoopOrchestrator.initialize();

            const criteria = options.criteria
              ? options.criteria.split(',').map((c: string) => c.trim())
              : [
                  'Task completed successfully',
                  'All components working',
                  'Tests pass',
                ];

            const result = await multiLoopOrchestrator.orchestrateComplexTask(
              description,
              criteria,
              {
                maxLoops: parseInt(options.maxLoops),
                forceSequential: options.sequential,
              }
            );

            console.log('✅ Orchestration completed!');
            console.log(
              `📊 Results: ${result.completedLoops.length} successful, ${result.failedLoops.length} failed`
            );
            console.log(
              `⏱️  Total duration: ${Math.round(result.totalDuration / 1000)}s`
            );

            if (result.insights.length > 0) {
              console.log('\n💡 Insights:');
              result.insights.forEach((insight) =>
                console.log(`   • ${insight}`)
              );
            }
          } catch (error: unknown) {
            logger.error('Orchestration failed', error as Error);
            console.error('❌ Orchestration failed:', (error as Error).message);
          }
        }
      );
    });

  // Pattern learning command
  ralph
    .command('learn')
    .description('Learn patterns from completed loops')
    .option('--task-type <type>', 'Learn patterns for specific task type')
    .action(async (options) => {
      return trace.command('ralph-learn', options, async () => {
        try {
          console.log('🧠 Learning patterns from completed loops...');

          await patternLearner.initialize();

          const patterns = options.taskType
            ? await patternLearner.learnForTaskType(options.taskType)
            : await patternLearner.learnFromCompletedLoops();

          console.log(`✅ Learned ${patterns.length} patterns`);

          if (patterns.length > 0) {
            console.log('\n📊 Top patterns:');
            patterns.slice(0, 5).forEach((pattern) => {
              console.log(
                `   • ${pattern.pattern} (${Math.round(pattern.confidence * 100)}% confidence)`
              );
            });
          }
        } catch (error: unknown) {
          logger.error('Pattern learning failed', error as Error);
          console.error(
            '❌ Pattern learning failed:',
            (error as Error).message
          );
        }
      });
    });

  // Enhanced debug command with visualization
  ralph
    .command('debug-enhanced')
    .description('Advanced debugging with visualization')
    .option('--loop-id <id>', 'Specific loop to debug')
    .option('--generate-report', 'Generate comprehensive debug report')
    .option('--timeline', 'Generate timeline visualization')
    .action(async (options) => {
      return trace.command('ralph-debug-enhanced', options, async () => {
        try {
          if (!existsSync('.ralph') && !options.loopId) {
            console.log(
              '❌ No Ralph loop found. Run a loop first or specify --loop-id'
            );
            return;
          }

          console.log('🔍 Starting enhanced debugging...');

          await ralphDebugger.initialize();

          const loopId = options.loopId || 'current';
          await ralphDebugger.startDebugSession(loopId, '.ralph');
<<<<<<< HEAD
          
=======

>>>>>>> swarm/developer-implement-core-feature
          if (options.generateReport) {
            const report = await ralphDebugger.generateDebugReport(loopId);
            console.log(`📋 Debug report generated: ${report.exportPath}`);
          }

          if (options.timeline) {
            const timelinePath =
              await ralphDebugger.generateLoopTimeline(loopId);
            console.log(`📊 Timeline visualization: ${timelinePath}`);
          }

          console.log('🔍 Debug analysis complete');
        } catch (error: unknown) {
          logger.error('Enhanced debugging failed', error as Error);
          console.error('❌ Debug failed:', (error as Error).message);
        }
      });
    });

<<<<<<< HEAD
  // Swarm testing and validation command
  ralph
    .command('swarm-test')
    .description('Comprehensive testing and validation for swarm functionality')
    .option('--quick', 'Run quick validation tests only')
    .option('--stress', 'Run stress tests with multiple parallel swarms')
    .option('--error-injection', 'Test error handling with deliberate failures')
    .option('--cleanup-test', 'Test cleanup mechanisms')
    .option('--git-test', 'Test git workflow integration')
    .option('--report', 'Generate detailed test report')
    .action(async (options) => {
      return trace.command('ralph-swarm-test', options, async () => {
        try {
          console.log('🧪 Starting swarm testing and validation...');
          
          await swarmCoordinator.initialize();
          
          const testResults: any[] = [];
          let passedTests = 0;
          let totalTests = 0;

          // Quick validation tests
          if (options.quick || !options.stress) {
            console.log('\n⚡ Running quick validation tests...');
            
            // Test 1: Basic swarm initialization
            totalTests++;
            try {
              await swarmCoordinator.launchSwarm(
                'Test: Basic functionality validation',
                [{ role: 'developer' as any }]
              );
              
              // Immediately cleanup
              await swarmCoordinator.forceCleanup();
              
              console.log('  ✅ Basic swarm initialization');
              passedTests++;
              testResults.push({ test: 'basic_init', status: 'passed', duration: 0 });
            } catch (error) {
              console.log('  ❌ Basic swarm initialization failed:', (error as Error).message);
              testResults.push({ test: 'basic_init', status: 'failed', error: (error as Error).message });
            }

            // Test 2: Resource usage monitoring
            totalTests++;
            try {
              const usage = swarmCoordinator.getResourceUsage();
              console.log(`  ✅ Resource monitoring: ${usage.activeAgents} agents, ${usage.memoryEstimate}MB`);
              passedTests++;
              testResults.push({ test: 'resource_monitoring', status: 'passed', data: usage });
            } catch (error) {
              console.log('  ❌ Resource monitoring failed:', (error as Error).message);
              testResults.push({ test: 'resource_monitoring', status: 'failed', error: (error as Error).message });
            }
          }

          // Stress tests
          if (options.stress) {
            console.log('\n🔥 Running stress tests...');
            
            totalTests++;
            try {
              const stressPromises = [];
              for (let i = 0; i < 3; i++) {
                stressPromises.push(
                  swarmCoordinator.launchSwarm(
                    `Stress test swarm ${i}`,
                    [{ role: 'developer' as any }, { role: 'tester' as any }]
                  )
                );
              }
              
              await Promise.all(stressPromises);
              await swarmCoordinator.forceCleanup();
              
              console.log('  ✅ Parallel swarm stress test');
              passedTests++;
              testResults.push({ test: 'stress_parallel', status: 'passed' });
            } catch (error) {
              console.log('  ❌ Stress test failed:', (error as Error).message);
              testResults.push({ test: 'stress_parallel', status: 'failed', error: (error as Error).message });
            }
          }

          // Error injection tests
          if (options.errorInjection) {
            console.log('\n💥 Testing error handling...');
            
            totalTests++;
            try {
              // Test with invalid agent configuration
              try {
                await swarmCoordinator.launchSwarm(
                  'Error test: Invalid agents',
                  [] // Empty agents array
                );
              } catch {
                console.log('  ✅ Properly handled empty agents array');
                passedTests++;
                testResults.push({ test: 'error_handling', status: 'passed' });
              }
            } catch (error) {
              console.log('  ❌ Error handling test failed:', (error as Error).message);
              testResults.push({ test: 'error_handling', status: 'failed', error: (error as Error).message });
            }
          }

          // Cleanup tests
          if (options.cleanupTest) {
            console.log('\n🧹 Testing cleanup mechanisms...');
            
            totalTests++;
            try {
              // Create a swarm and test cleanup
              await swarmCoordinator.launchSwarm(
                'Cleanup test swarm',
                [{ role: 'developer' as any }]
              );
              
              // Force cleanup
              await swarmCoordinator.forceCleanup();
              
              // Check if resources were cleaned
              const usage = swarmCoordinator.getResourceUsage();
              if (usage.activeAgents === 0) {
                console.log('  ✅ Cleanup mechanism works correctly');
                passedTests++;
                testResults.push({ test: 'cleanup', status: 'passed' });
              } else {
                throw new Error(`Cleanup failed: ${usage.activeAgents} agents still active`);
              }
            } catch (error) {
              console.log('  ❌ Cleanup test failed:', (error as Error).message);
              testResults.push({ test: 'cleanup', status: 'failed', error: (error as Error).message });
            }
          }

          // Git workflow tests
          if (options.gitTest) {
            console.log('\n🔀 Testing git workflow integration...');
            
            totalTests++;
            try {
              // Test git workflow status
              const gitStatus = swarmCoordinator['gitWorkflowManager'].getGitStatus();
              console.log(`  ✅ Git workflow status: ${gitStatus.enabled ? 'enabled' : 'disabled'}`);
              passedTests++;
              testResults.push({ test: 'git_workflow', status: 'passed', data: gitStatus });
            } catch (error) {
              console.log('  ❌ Git workflow test failed:', (error as Error).message);
              testResults.push({ test: 'git_workflow', status: 'failed', error: (error as Error).message });
            }
          }

          // Display results
          console.log('\n📊 Test Results Summary:');
          console.log(`   Total tests: ${totalTests}`);
          console.log(`   Passed: ${passedTests} ✅`);
          console.log(`   Failed: ${totalTests - passedTests} ❌`);
          console.log(`   Success rate: ${Math.round((passedTests / totalTests) * 100)}%`);

          // Generate report
          if (options.report) {
            const reportPath = '.swarm/test-report.json';
            const fs = await import('fs');
            const reportData = {
              timestamp: new Date().toISOString(),
              summary: {
                totalTests,
                passedTests,
                failedTests: totalTests - passedTests,
                successRate: (passedTests / totalTests) * 100
              },
              testResults,
              systemInfo: {
                nodeVersion: process.version,
                platform: process.platform,
                arch: process.arch
              }
            };
            
            fs.writeFileSync(reportPath, JSON.stringify(reportData, null, 2));
            console.log(`📋 Detailed report saved to: ${reportPath}`);
          }

          if (passedTests === totalTests) {
            console.log('\n🎉 All tests passed! Swarm functionality is working correctly.');
          } else {
            console.log('\n⚠️  Some tests failed. Check the errors above for details.');
            process.exit(1);
          }
          
        } catch (error: unknown) {
          logger.error('Swarm testing failed', error as Error);
          console.error('❌ Test suite failed:', (error as Error).message);
          process.exit(1);
        }
      });
=======
  // TUI command for real-time monitoring
  ralph
    .command('tui')
    .description('Launch TUI monitor for active swarms')
    .option('--swarm-id <id>', 'Monitor specific swarm ID')
    .option('--simple', 'Use simple text mode instead of full TUI')
    .option('--force-tui', 'Force full TUI even with compatibility issues')
    .action(async (options) => {
      try {
        // Detect terminal compatibility
        const isGhostty =
          process.env.TERM_PROGRAM === 'ghostty' ||
          process.env.TERM?.includes('ghostty');
        const isBasicTerm =
          process.env.TERM === 'dumb' || process.env.TERM === 'unknown';
        const hasCompatibilityIssues = isGhostty || isBasicTerm;

        // Default behavior: use simple mode for problematic terminals unless forced
        const useSimpleMode =
          options.simple || (hasCompatibilityIssues && !options.forceTui);

        if (useSimpleMode) {
          console.log('🦾 Starting Simple Swarm Monitor (Text Mode)');
          if (hasCompatibilityIssues && !options.simple) {
            console.log(
              `⚠️  Detected ${isGhostty ? 'Ghostty' : 'basic'} terminal - using text mode for compatibility`
            );
            console.log(
              '   Use --force-tui to override, or --simple to explicitly use text mode'
            );
          }

          const { SimpleSwarmMonitor } =
            await import('../../features/tui/simple-monitor.js');
          const monitor = new SimpleSwarmMonitor();
          monitor.start();
        } else {
          console.log('🦾 Starting Full TUI Monitor');
          const { SwarmTUI } =
            await import('../../features/tui/swarm-monitor.js');

          const tui = new SwarmTUI();

          // Initialize with optional swarm ID
          await tui.initialize(undefined, options.swarmId);
          tui.start();
        }
      } catch (error: unknown) {
        logger.error('TUI launch failed', error as Error);
        console.error('❌ TUI failed:', (error as Error).message);
        console.log('💡 Try: stackmemory ralph tui --simple');
        process.exit(1);
      }
>>>>>>> swarm/developer-implement-core-feature
    });

  return ralph;
}

export default createRalphCommand;
