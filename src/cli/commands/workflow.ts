/**
 * Workflow command for StackMemory
 * Manages workflow templates and execution
 */

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import Database from 'better-sqlite3';
import { existsSync } from 'fs';
import { FrameManager } from '../../core/context/index.js';
import { workflowTemplates } from '../../core/frame/workflow-templates.js';
import { sessionManager } from '../../core/session/session-manager.js';
import { getEnv, getOptionalEnv } from '../../utils/env.js';

export function createWorkflowCommand(): Command {
  const cmd = new Command('workflow')
    .description('Manage structured workflow templates')
    .option('-l, --list', 'List available workflow templates')
    .option('-s, --start <template>', 'Start a new workflow from template')
    .option('--status', 'Show status of active workflow')
    .action(async (options) => {
      try {
        const projectRoot = process.cwd();
        const dbPath = path.join(projectRoot, '.stackmemory', 'context.db');

        // Check if StackMemory is initialized
        if (!existsSync(dbPath)) {
          console.error(chalk.red('✗ StackMemory not initialized'));
          console.log(chalk.yellow('Run: stackmemory init'));
          if (process.env['NODE_ENV'] !== 'test') {
            process.exit(1);
          }
          return;
        }

        if (options.list) {
          await listWorkflows();
        } else if (options.start) {
          await startWorkflow(options.start, dbPath);
        } else if (options.status) {
          await showWorkflowStatus(dbPath);
        } else {
          // Default: list workflows
          await listWorkflows();
        }
      } catch (error: unknown) {
        console.error(chalk.red('Error: ' + (error as Error).message));
        if (process.env['NODE_ENV'] !== 'test') {
          process.exit(1);
        }
      }
    });

  return cmd;
}

async function listWorkflows(): Promise<void> {
  console.log(chalk.bold('\n📋 Available Workflows'));
  console.log('─'.repeat(40));

  Object.entries(workflowTemplates).forEach(([key, template]) => {
    console.log(chalk.cyan(`\n${key}:`));
    console.log(`  ${template.description}`);
    console.log(chalk.gray(`  Phases: ${template.phases.length}`));

    // Show first few phases
    template.phases.slice(0, 3).forEach((phase) => {
      console.log(`    • ${phase.name}`);
    });
    if (template.phases.length > 3) {
      console.log(`    ... and ${template.phases.length - 3} more`);
    }
  });

  console.log(
    chalk.gray('\nStart a workflow: stackmemory workflow --start <name>')
  );
}

async function startWorkflow(
  workflowName: string,
  dbPath: string
): Promise<void> {
  const template =
    workflowTemplates[workflowName as keyof typeof workflowTemplates];

  if (!template) {
    console.error(chalk.red(`Unknown workflow: ${workflowName}`));
    console.log(chalk.yellow('Use --list to see available workflows'));
    if (process.env['NODE_ENV'] !== 'test') {
      process.exit(1);
    }
    return;
  }

  const db = new Database(dbPath);

  try {
    // Initialize session
    await sessionManager.initialize();
    const session = await sessionManager.getOrCreateSession({
      projectPath: process.cwd(),
    });

    const frameManager = new FrameManager(db, session.projectId);

    // Create root frame for workflow
    const workflowId = await frameManager.createFrame({
      type: 'workflow',
      name: `${template.name} Workflow`,
      metadata: {
        workflow: workflowName,
        phases: template.phases.map((p: any) => p.name),
        currentPhase: 0,
        startTime: Date.now(),
      },
    });

    console.log(chalk.green(`✓ Started ${workflowName} workflow`));
    console.log(chalk.cyan(`Workflow ID: ${workflowId}`));
    console.log('\nPhases:');

    template.phases.forEach((phase, index) => {
      const marker = index === 0 ? '→' : ' ';
      console.log(`${marker} ${index + 1}. ${phase.name}`);
    });

    console.log(chalk.gray('\nTrack progress: stackmemory workflow --status'));
  } finally {
    db.close();
  }
}

async function showWorkflowStatus(dbPath: string): Promise<void> {
  const db = new Database(dbPath);

  try {
    // Get active workflow frames
    const workflows = db
      .prepare(
        `
      SELECT * FROM frames 
      WHERE type = 'workflow' 
      AND state = 'active'
      ORDER BY created_at DESC
    `
      )
      .all() as any[];

    if (workflows.length === 0) {
      console.log(chalk.yellow('No active workflows'));
      return;
    }

    console.log(chalk.bold('\n🔄 Active Workflows'));
    console.log('─'.repeat(40));

    workflows.forEach((workflow) => {
      const metadata = workflow.metadata ? JSON.parse(workflow.metadata) : {};
      const elapsed = Date.now() - workflow.created_at;
      const minutes = Math.floor(elapsed / 60000);

      console.log(chalk.cyan(`\n${workflow.name}`));
      console.log(`  ID: ${workflow.frame_id}`);
      console.log(`  Duration: ${minutes} minutes`);

      if (metadata.phases) {
        const current = metadata.currentPhase || 0;
        console.log(`  Phase: ${current + 1}/${metadata.phases.length}`);
        console.log(`  Current: ${metadata.phases[current]}`);
      }
    });
  } finally {
    db.close();
  }
}

export default createWorkflowCommand;
