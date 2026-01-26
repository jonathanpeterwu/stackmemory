/**
 * Discovery CLI Commands
 * Discover relevant files based on current context
 */

import { Command } from 'commander';
import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync } from 'fs';
import chalk from 'chalk';
import { FrameManager } from '../../core/context/index.js';
import { LLMContextRetrieval } from '../../core/retrieval/index.js';
import { DiscoveryHandlers } from '../../integrations/mcp/handlers/discovery-handlers.js';

export function createDiscoveryCommands(): Command {
  const discovery = new Command('discovery')
    .alias('discover')
    .description('Discover relevant files based on current context');

  // Main discovery command
  discovery
    .command('files')
    .alias('f')
    .description('Discover files relevant to current context')
    .option('-q, --query <text>', 'Focus discovery on specific query')
    .option(
      '-d, --depth <level>',
      'Search depth: shallow, medium, deep',
      'medium'
    )
    .option('-m, --max <n>', 'Maximum files to return', '20')
    .option('-i, --include <patterns>', 'Include patterns (comma-separated)')
    .option('-e, --exclude <patterns>', 'Exclude patterns (comma-separated)')
    .action(async (options) => {
      const projectRoot = process.cwd();
      const dbPath = join(projectRoot, '.stackmemory', 'context.db');

      if (!existsSync(dbPath)) {
        console.log(
          chalk.red('StackMemory not initialized in this directory.')
        );
        console.log(chalk.gray('Run "stackmemory init" first.'));
        return;
      }

      const db = new Database(dbPath);

      try {
        let projectId = 'default';
        try {
          const row = db
            .prepare(`SELECT value FROM metadata WHERE key = 'project_id'`)
            .get() as any;
          if (row?.value) projectId = row.value;
        } catch {}

        const frameManager = new FrameManager(db, projectId, {
          skipContextBridge: true,
        });
        const contextRetrieval = new LLMContextRetrieval(
          db,
          frameManager,
          projectId
        );
        const handlers = new DiscoveryHandlers({
          frameManager,
          contextRetrieval,
          db,
          projectRoot,
        });

        console.log(chalk.blue('\nDiscovering relevant files...\n'));

        const result = await handlers.handleDiscover({
          query: options.query,
          depth: options.depth as 'shallow' | 'medium' | 'deep',
          maxFiles: parseInt(options.max),
          includePatterns: options.include?.split(','),
          excludePatterns: options.exclude?.split(','),
        });

        // Display results
        const metadata = result.metadata;

        console.log(chalk.cyan('Context Summary'));
        console.log(chalk.gray(metadata.contextSummary));
        console.log('');

        console.log(chalk.cyan('Keywords Extracted'));
        console.log(chalk.gray(metadata.keywords.slice(0, 15).join(', ')));
        console.log('');

        console.log(chalk.cyan('Relevant Files'));
        for (const file of metadata.files.slice(0, parseInt(options.max))) {
          const icon =
            file.relevance === 'high'
              ? chalk.green('[HIGH]')
              : file.relevance === 'medium'
                ? chalk.yellow('[MED]')
                : chalk.gray('[LOW]');
          console.log(`${icon} ${chalk.white(file.path)}`);
          console.log(chalk.gray(`      ${file.reason}`));
        }

        if (Object.keys(metadata.mdContext).length > 0) {
          console.log('');
          console.log(chalk.cyan('MD Files Parsed'));
          for (const mdFile of Object.keys(metadata.mdContext)) {
            console.log(chalk.gray(`  - ${mdFile}`));
          }
        }

        console.log('');
      } finally {
        db.close();
      }
    });

  // Related files command
  discovery
    .command('related')
    .alias('r')
    .description('Find files related to a specific file or concept')
    .option('-f, --file <path>', 'File to find related files for')
    .option('-c, --concept <text>', 'Concept to search for')
    .option('-m, --max <n>', 'Maximum files to return', '10')
    .action(async (options) => {
      if (!options.file && !options.concept) {
        console.log(chalk.red('Either --file or --concept is required'));
        return;
      }

      const projectRoot = process.cwd();
      const dbPath = join(projectRoot, '.stackmemory', 'context.db');

      if (!existsSync(dbPath)) {
        console.log(
          chalk.red('StackMemory not initialized in this directory.')
        );
        return;
      }

      const db = new Database(dbPath);

      try {
        let projectId = 'default';
        try {
          const row = db
            .prepare(`SELECT value FROM metadata WHERE key = 'project_id'`)
            .get() as any;
          if (row?.value) projectId = row.value;
        } catch {}

        const frameManager = new FrameManager(db, projectId, {
          skipContextBridge: true,
        });
        const contextRetrieval = new LLMContextRetrieval(
          db,
          frameManager,
          projectId
        );
        const handlers = new DiscoveryHandlers({
          frameManager,
          contextRetrieval,
          db,
          projectRoot,
        });

        const target = options.file || options.concept;
        console.log(chalk.blue(`\nFinding files related to: ${target}\n`));

        const result = await handlers.handleRelatedFiles({
          file: options.file,
          concept: options.concept,
          maxFiles: parseInt(options.max),
        });

        const files = result.metadata.relatedFiles;

        if (files.length === 0) {
          console.log(chalk.gray('No related files found.'));
          return;
        }

        for (const file of files) {
          const icon =
            file.relevance === 'high'
              ? chalk.green('[HIGH]')
              : chalk.yellow('[MED]');
          console.log(`${icon} ${chalk.white(file.path)}`);
          console.log(chalk.gray(`      ${file.reason}`));
        }

        console.log('');
      } finally {
        db.close();
      }
    });

  // Session summary command
  discovery
    .command('session')
    .alias('s')
    .description('Get current session summary')
    .option('--no-files', 'Exclude recent files')
    .option('--no-decisions', 'Exclude recent decisions')
    .action(async (options) => {
      const projectRoot = process.cwd();
      const dbPath = join(projectRoot, '.stackmemory', 'context.db');

      if (!existsSync(dbPath)) {
        console.log(
          chalk.red('StackMemory not initialized in this directory.')
        );
        return;
      }

      const db = new Database(dbPath);

      try {
        let projectId = 'default';
        try {
          const row = db
            .prepare(`SELECT value FROM metadata WHERE key = 'project_id'`)
            .get() as any;
          if (row?.value) projectId = row.value;
        } catch {}

        const frameManager = new FrameManager(db, projectId, {
          skipContextBridge: true,
        });
        const contextRetrieval = new LLMContextRetrieval(
          db,
          frameManager,
          projectId
        );
        const handlers = new DiscoveryHandlers({
          frameManager,
          contextRetrieval,
          db,
          projectRoot,
        });

        const result = await handlers.handleSessionSummary({
          includeFiles: options.files !== false,
          includeDecisions: options.decisions !== false,
        });

        const summary = result.metadata;

        console.log(chalk.blue('\nSession Summary\n'));

        console.log(`${chalk.cyan('Current Goal:')} ${summary.currentGoal}`);
        console.log(`${chalk.cyan('Active Frames:')} ${summary.activeFrames}`);
        console.log(`${chalk.cyan('Stack Depth:')} ${summary.stackDepth}`);

        if (summary.recentFiles?.length > 0) {
          console.log(chalk.cyan('\nRecent Files:'));
          for (const f of summary.recentFiles.slice(0, 10)) {
            console.log(chalk.gray(`  - ${f}`));
          }
        }

        if (summary.decisions?.length > 0) {
          console.log(chalk.cyan('\nRecent Decisions:'));
          for (const d of summary.decisions.slice(0, 5)) {
            console.log(
              chalk.gray(
                `  [${d.type}] ${d.text.slice(0, 60)}${d.text.length > 60 ? '...' : ''}`
              )
            );
          }
        }

        console.log('');
      } finally {
        db.close();
      }
    });

  // Quick context command (default)
  discovery
    .command('quick', { isDefault: true })
    .description('Quick discovery based on current context')
    .action(async () => {
      const projectRoot = process.cwd();
      const dbPath = join(projectRoot, '.stackmemory', 'context.db');

      if (!existsSync(dbPath)) {
        console.log(
          chalk.red('StackMemory not initialized in this directory.')
        );
        console.log(chalk.gray('Run "stackmemory init" first.'));
        return;
      }

      const db = new Database(dbPath);

      try {
        let projectId = 'default';
        try {
          const row = db
            .prepare(`SELECT value FROM metadata WHERE key = 'project_id'`)
            .get() as any;
          if (row?.value) projectId = row.value;
        } catch {}

        const frameManager = new FrameManager(db, projectId, {
          skipContextBridge: true,
        });
        const contextRetrieval = new LLMContextRetrieval(
          db,
          frameManager,
          projectId
        );
        const handlers = new DiscoveryHandlers({
          frameManager,
          contextRetrieval,
          db,
          projectRoot,
        });

        console.log(chalk.blue('\nQuick Discovery\n'));

        // Get session summary first
        const sessionResult = await handlers.handleSessionSummary({
          includeFiles: true,
          includeDecisions: true,
        });
        const session = sessionResult.metadata;

        console.log(`${chalk.cyan('Current:')} ${session.currentGoal}`);
        console.log(`${chalk.cyan('Stack:')} ${session.stackDepth} frames`);
        console.log('');

        // Quick file discovery
        const discoverResult = await handlers.handleDiscover({
          depth: 'shallow',
          maxFiles: 10,
        });
        const discovery = discoverResult.metadata;

        console.log(
          chalk.cyan('Keywords: ') +
            chalk.gray(discovery.keywords.slice(0, 8).join(', '))
        );
        console.log('');

        console.log(chalk.cyan('Top Relevant Files:'));
        for (const file of discovery.files.slice(0, 5)) {
          const icon =
            file.relevance === 'high' ? chalk.green('*') : chalk.yellow('-');
          console.log(`${icon} ${file.path}`);
        }

        if (session.decisions?.length > 0) {
          console.log('');
          console.log(chalk.cyan('Recent Decisions:'));
          for (const d of session.decisions.slice(0, 3)) {
            console.log(chalk.gray(`  [${d.type}] ${d.text.slice(0, 50)}...`));
          }
        }

        console.log('');
        console.log(
          chalk.gray('Use "stackmemory discovery files" for detailed discovery')
        );
      } finally {
        db.close();
      }
    });

  return discovery;
}
