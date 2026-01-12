/**
 * ChromaDB CLI Commands for StackMemory
 *
 * Provides commands to interact with ChromaDB vector storage
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import { ChromaDBAdapter } from '../../core/storage/chromadb-adapter.js';
import { FrameManager } from '../../core/context/frame-manager.js';
import { logger } from '../../core/monitoring/logger.js';
import { RepoIngestionSkill } from '../../skills/repo-ingestion-skill.js';
import Table from 'cli-table3';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables
dotenv.config({
  path: path.join(__dirname, '../../../.env'),
  override: true,
});



export function createChromaDBCommand(): Command {
  const chromadb = new Command('chromadb')
    .description('Manage ChromaDB vector storage for context')
    .alias('chroma');

  // Initialize ChromaDB
  chromadb
    .command('init')
    .description('Initialize ChromaDB connection')
    .option('--api-key <key>', 'ChromaDB API key')
    .option('--tenant <tenant>', 'ChromaDB tenant ID')
    .option('--database <database>', 'ChromaDB database name')
    .option('--user-id <id>', 'User ID for segmentation')
    .option('--team-id <id>', 'Team ID for segmentation')
    .action(async (options) => {
      const spinner = ora('Initializing ChromaDB...').start();

      try {
        // Get config from options or environment
        const config = {
          apiKey: options.apiKey || process.env['CHROMADB_API_KEY'] || '',
          tenant: options.tenant || process.env['CHROMADB_TENANT'] || '',
          database:
            options.database ||
            process.env['CHROMADB_DATABASE'] ||
            'stackmemory',
        };

        const userId = options.userId || process.env['USER'] || 'default';
        const teamId = options.teamId || process.env['CHROMADB_TEAM_ID'];

        if (!config.apiKey || !config.tenant) {
          spinner.fail('Missing ChromaDB credentials');
          console.log(chalk.yellow('\nPlease provide:'));
          console.log('  --api-key <key>    ChromaDB API key');
          console.log('  --tenant <tenant>  ChromaDB tenant ID');
          console.log('\nOr set environment variables:');
          console.log('  CHROMADB_API_KEY');
          console.log('  CHROMADB_TENANT');
          return;
        }

        // Initialize adapter
        const adapter = new ChromaDBAdapter(config, userId, teamId);
        await adapter.initialize();

        // Save config to .env if not present
        const envPath = path.join(__dirname, '../../../.env');
        let envContent = '';

        if (fs.existsSync(envPath)) {
          envContent = fs.readFileSync(envPath, 'utf8');
        }

        const updates: string[] = [];
        if (!envContent.includes('CHROMADB_API_KEY')) {
          updates.push(`CHROMADB_API_KEY=${config.apiKey}`);
        }
        if (!envContent.includes('CHROMADB_TENANT')) {
          updates.push(`CHROMADB_TENANT=${config.tenant}`);
        }
        if (!envContent.includes('CHROMADB_DATABASE')) {
          updates.push(`CHROMADB_DATABASE=${config.database}`);
        }

        if (updates.length > 0) {
          fs.appendFileSync(
            envPath,
            '\n# ChromaDB Configuration\n' + updates.join('\n') + '\n'
          );
        }

        spinner.succeed('ChromaDB initialized successfully');

        console.log(chalk.green('\n✅ Configuration:'));
        console.log(`  Tenant: ${config.tenant}`);
        console.log(`  Database: ${config.database}`);
        console.log(`  User ID: ${userId}`);
        if (teamId) {
          console.log(`  Team ID: ${teamId}`);
        }
      } catch (error: unknown) {
        spinner.fail('Failed to initialize ChromaDB');
        logger.error('Initialization error', error);
        console.error(
          chalk.red(error instanceof Error ? error.message : 'Unknown error')
        );
      }
    });

  // Store current context
  chromadb
    .command('store')
    .description('Store current context in ChromaDB')
    .option(
      '--type <type>',
      'Context type (frame/decision/observation)',
      'frame'
    )
    .option('--content <content>', 'Content to store')
    .option('--project <name>', 'Project name')
    .action(async (options) => {
      const spinner = ora('Storing context...').start();

      try {
        const config = {
          apiKey: process.env['CHROMADB_API_KEY'] || '',
          tenant: process.env['CHROMADB_TENANT'] || '',
          database: process.env['CHROMADB_DATABASE'] || 'stackmemory',
        };

        const userId = process.env['USER'] || 'default';
        const teamId = process.env['CHROMADB_TEAM_ID'];

        const adapter = new ChromaDBAdapter(config, userId, teamId);
        await adapter.initialize();

        if (options.type === 'frame') {
          // Store current frames
          const frameManager = new FrameManager();
          const frames = frameManager.getAllFrames();

          for (const frame of frames) {
            await adapter.storeFrame(frame);
          }

          spinner.succeed(`Stored ${frames.length} frames`);
        } else {
          // Store decision or observation
          const content =
            options.content || `${options.type} at ${new Date().toISOString()}`;
          const metadata: any = {
            project_name: options.project || path.basename(process.cwd()),
          };

          // Only add session_id if it exists
          if (process.env['STACKMEMORY_SESSION_ID']) {
            metadata.session_id = process.env['STACKMEMORY_SESSION_ID'];
          }

          await adapter.storeContext(
            options.type as 'decision' | 'observation',
            content,
            metadata
          );

          spinner.succeed(`Stored ${options.type}`);
        }
      } catch (error: unknown) {
        spinner.fail('Failed to store context');
        logger.error('Store error', error);
        console.error(
          chalk.red(error instanceof Error ? error.message : 'Unknown error')
        );
      }
    });

  // Query contexts
  chromadb
    .command('query <search>')
    .description('Query contexts from ChromaDB')
    .option('--limit <n>', 'Number of results', '10')
    .option('--type <type>', 'Filter by type')
    .option('--project <name>', 'Filter by project')
    .action(async (search, options) => {
      const spinner = ora('Searching...').start();

      try {
        const config = {
          apiKey: process.env['CHROMADB_API_KEY'] || '',
          tenant: process.env['CHROMADB_TENANT'] || '',
          database: process.env['CHROMADB_DATABASE'] || 'stackmemory',
        };

        const userId = process.env['USER'] || 'default';
        const teamId = process.env['CHROMADB_TEAM_ID'];

        const adapter = new ChromaDBAdapter(config, userId, teamId);
        await adapter.initialize();

        const filters: any = {};
        if (options.type) {
          filters.type = [options.type];
        }
        if (options.project) {
          filters.projectName = options.project;
        }

        const results = await adapter.queryContexts(
          search,
          parseInt(options.limit),
          filters
        );

        spinner.stop();

        if (results.length === 0) {
          console.log(chalk.yellow('No results found'));
          return;
        }

        // Display results
        const table = new Table({
          head: ['Type', 'Project', 'Content', 'Distance'],
          colWidths: [15, 20, 50, 10],
          wordWrap: true,
        });

        for (const result of results) {
          const content =
            result.content.substring(0, 100) +
            (result.content.length > 100 ? '...' : '');

          table.push([
            result.metadata.type || 'unknown',
            result.metadata.project_name || 'default',
            content,
            result.distance.toFixed(3),
          ]);
        }

        console.log(table.toString());
        console.log(chalk.green(`\n✅ Found ${results.length} results`));
      } catch (error: unknown) {
        spinner.fail('Failed to query contexts');
        logger.error('Query error', error);
        console.error(
          chalk.red(error instanceof Error ? error.message : 'Unknown error')
        );
      }
    });

  // Get recent contexts
  chromadb
    .command('recent')
    .description('Get recent contexts')
    .option('--limit <n>', 'Number of results', '20')
    .option('--type <type>', 'Filter by type')
    .action(async (options) => {
      const spinner = ora('Fetching recent contexts...').start();

      try {
        const config = {
          apiKey: process.env['CHROMADB_API_KEY'] || '',
          tenant: process.env['CHROMADB_TENANT'] || '',
          database: process.env['CHROMADB_DATABASE'] || 'stackmemory',
        };

        const userId = process.env['USER'] || 'default';
        const teamId = process.env['CHROMADB_TEAM_ID'];

        const adapter = new ChromaDBAdapter(config, userId, teamId);
        await adapter.initialize();

        const results = await adapter.getRecentContexts(
          parseInt(options.limit),
          options.type
        );

        spinner.stop();

        if (results.length === 0) {
          console.log(chalk.yellow('No recent contexts found'));
          return;
        }

        // Display results
        const table = new Table({
          head: ['Time', 'Type', 'Project', 'Content'],
          colWidths: [20, 12, 20, 48],
          wordWrap: true,
        });

        for (const result of results) {
          const time = new Date(result.metadata.timestamp).toLocaleString();
          const content =
            result.content.substring(0, 100) +
            (result.content.length > 100 ? '...' : '');

          table.push([
            time,
            result.metadata.type || 'unknown',
            result.metadata.project_name || 'default',
            content,
          ]);
        }

        console.log(table.toString());
        console.log(
          chalk.green(`\n✅ Found ${results.length} recent contexts`)
        );
      } catch (error: unknown) {
        spinner.fail('Failed to get recent contexts');
        logger.error('Recent error', error);
        console.error(
          chalk.red(error instanceof Error ? error.message : 'Unknown error')
        );
      }
    });

  // Get statistics
  chromadb
    .command('stats')
    .description('Get ChromaDB storage statistics')
    .action(async () => {
      const spinner = ora('Fetching statistics...').start();

      try {
        const config = {
          apiKey: process.env['CHROMADB_API_KEY'] || '',
          tenant: process.env['CHROMADB_TENANT'] || '',
          database: process.env['CHROMADB_DATABASE'] || 'stackmemory',
        };

        const userId = process.env['USER'] || 'default';
        const teamId = process.env['CHROMADB_TEAM_ID'];

        const adapter = new ChromaDBAdapter(config, userId, teamId);
        await adapter.initialize();

        const stats = await adapter.getStats();

        spinner.stop();

        console.log(chalk.cyan('\n📊 ChromaDB Statistics\n'));
        console.log(`Total Documents: ${chalk.bold(stats.totalDocuments)}`);
        console.log(`User Documents: ${chalk.bold(stats.userDocuments)}`);

        if (stats.teamDocuments !== undefined) {
          console.log(`Team Documents: ${chalk.bold(stats.teamDocuments)}`);
        }

        console.log('\nDocuments by Type:');
        for (const [type, count] of Object.entries(stats.documentsByType)) {
          console.log(`  ${type}: ${count}`);
        }
      } catch (error: unknown) {
        spinner.fail('Failed to get statistics');
        logger.error('Stats error', error);
        console.error(
          chalk.red(error instanceof Error ? error.message : 'Unknown error')
        );
      }
    });

  // Clean old contexts
  chromadb
    .command('clean')
    .description('Clean old contexts')
    .option('--days <n>', 'Delete contexts older than N days', '30')
    .action(async (options) => {
      const spinner = ora('Cleaning old contexts...').start();

      try {
        const config = {
          apiKey: process.env['CHROMADB_API_KEY'] || '',
          tenant: process.env['CHROMADB_TENANT'] || '',
          database: process.env['CHROMADB_DATABASE'] || 'stackmemory',
        };

        const userId = process.env['USER'] || 'default';
        const teamId = process.env['CHROMADB_TEAM_ID'];

        const adapter = new ChromaDBAdapter(config, userId, teamId);
        await adapter.initialize();

        const deleted = await adapter.deleteOldContexts(parseInt(options.days));

        spinner.succeed(`Deleted ${deleted} old contexts`);
      } catch (error: unknown) {
        spinner.fail('Failed to clean contexts');
        logger.error('Clean error', error);
        console.error(
          chalk.red(error instanceof Error ? error.message : 'Unknown error')
        );
      }
    });

  // Ingest repository
  chromadb
    .command('ingest <name>')
    .description('Ingest a repository into ChromaDB for code search')
    .option('--path <path>', 'Repository path (default: current directory)')
    .option('--incremental', 'Only process changed files')
    .option('--include-tests', 'Include test files')
    .option('--include-docs', 'Include documentation files')
    .option('--force-update', 'Force re-indexing of all files')
    .option('--max-file-size <bytes>', 'Maximum file size to process')
    .option('--chunk-size <lines>', 'Lines per chunk')
    .action(async (name, options) => {
      const spinner = ora('Ingesting repository...').start();

      try {
        const config = {
          apiKey: process.env['CHROMADB_API_KEY'] || '',
          tenant: process.env['CHROMADB_TENANT'] || '',
          database: process.env['CHROMADB_DATABASE'] || 'stackmemory',
          collectionName: 'stackmemory_repos',
        };

        if (!config.apiKey || !config.tenant) {
          spinner.fail('ChromaDB not configured');
          console.log(chalk.yellow('\nPlease run: stackmemory chromadb init'));
          return;
        }

        const userId = process.env['USER'] || 'default';
        const teamId = process.env['CHROMADB_TEAM_ID'];

        const skill = new RepoIngestionSkill(config, userId, teamId);
        await skill.initialize();

        const repoPath = options.path || process.cwd();
        const result = await skill.ingestRepository(repoPath, name, {
          incremental: options.incremental,
          forceUpdate: options.forceUpdate,
          includeTests: options.includeTests,
          includeDocs: options.includeDocs,
          maxFileSize: options.maxFileSize
            ? parseInt(options.maxFileSize)
            : undefined,
          chunkSize: options.chunkSize
            ? parseInt(options.chunkSize)
            : undefined,
        });

        if (result.success) {
          spinner.succeed(result.message);
          if (result.stats) {
            console.log(chalk.green('\n📊 Ingestion Statistics:'));
            console.log(`  Files processed: ${result.stats.filesProcessed}`);
            console.log(`  Chunks created: ${result.stats.chunksCreated}`);
            console.log(
              `  Total size: ${(result.stats.totalSize / 1024 / 1024).toFixed(2)} MB`
            );
            console.log(
              `  Time elapsed: ${(result.stats.timeElapsed / 1000).toFixed(2)} seconds`
            );
          }
        } else {
          spinner.fail(result.message);
        }
      } catch (error: unknown) {
        spinner.fail('Failed to ingest repository');
        logger.error('Ingestion error', error);
        console.error(
          chalk.red(error instanceof Error ? error.message : 'Unknown error')
        );
      }
    });

  // Update repository
  chromadb
    .command('update <name>')
    .description('Update an existing repository in ChromaDB')
    .option('--path <path>', 'Repository path (default: current directory)')
    .option('--force-update', 'Force re-indexing of all files')
    .action(async (name, options) => {
      const spinner = ora('Updating repository...').start();

      try {
        const config = {
          apiKey: process.env['CHROMADB_API_KEY'] || '',
          tenant: process.env['CHROMADB_TENANT'] || '',
          database: process.env['CHROMADB_DATABASE'] || 'stackmemory',
          collectionName: 'stackmemory_repos',
        };

        if (!config.apiKey || !config.tenant) {
          spinner.fail('ChromaDB not configured');
          console.log(chalk.yellow('\nPlease run: stackmemory chromadb init'));
          return;
        }

        const userId = process.env['USER'] || 'default';
        const teamId = process.env['CHROMADB_TEAM_ID'];

        const skill = new RepoIngestionSkill(config, userId, teamId);
        await skill.initialize();

        const repoPath = options.path || process.cwd();
        const result = await skill.updateRepository(repoPath, name, {
          forceUpdate: options.forceUpdate,
        });

        if (result.success) {
          spinner.succeed(result.message);
          if (result.stats) {
            console.log(chalk.green('\n📊 Update Statistics:'));
            console.log(`  Files updated: ${result.stats.filesUpdated}`);
            console.log(`  Files added: ${result.stats.filesAdded}`);
            console.log(`  Files removed: ${result.stats.filesRemoved}`);
            console.log(
              `  Time elapsed: ${(result.stats.timeElapsed / 1000).toFixed(2)} seconds`
            );
          }
        } else {
          spinner.fail(result.message);
        }
      } catch (error: unknown) {
        spinner.fail('Failed to update repository');
        logger.error('Update error', error);
        console.error(
          chalk.red(error instanceof Error ? error.message : 'Unknown error')
        );
      }
    });

  // Search code
  chromadb
    .command('search-code <query>')
    .description('Search code in ingested repositories')
    .option('--repo <name>', 'Filter by repository name')
    .option('--language <lang>', 'Filter by programming language')
    .option('--limit <n>', 'Maximum results', '20')
    .action(async (query, options) => {
      const spinner = ora('Searching code...').start();

      try {
        const config = {
          apiKey: process.env['CHROMADB_API_KEY'] || '',
          tenant: process.env['CHROMADB_TENANT'] || '',
          database: process.env['CHROMADB_DATABASE'] || 'stackmemory',
          collectionName: 'stackmemory_repos',
        };

        if (!config.apiKey || !config.tenant) {
          spinner.fail('ChromaDB not configured');
          console.log(chalk.yellow('\nPlease run: stackmemory chromadb init'));
          return;
        }

        const userId = process.env['USER'] || 'default';
        const teamId = process.env['CHROMADB_TEAM_ID'];

        const skill = new RepoIngestionSkill(config, userId, teamId);
        await skill.initialize();

        const results = await skill.searchCode(query, {
          repoName: options.repo,
          language: options.language,
          limit: parseInt(options.limit),
        });

        spinner.stop();

        if (results.length === 0) {
          console.log(chalk.yellow('No results found'));
          return;
        }

        console.log(chalk.cyan(`\n🔍 Found ${results.length} code matches:\n`));

        for (const result of results) {
          console.log(chalk.green(`📁 ${result.repoName}/${result.filePath}`));
          console.log(
            chalk.gray(
              `   Lines ${result.startLine}-${result.endLine} | Score: ${result.score.toFixed(3)}`
            )
          );

          // Show snippet
          const lines = result.content.split('\n').slice(0, 3);
          lines.forEach((line) => {
            console.log(
              chalk.dim(
                `   ${line.slice(0, 80)}${line.length > 80 ? '...' : ''}`
              )
            );
          });
          console.log();
        }
      } catch (error: unknown) {
        spinner.fail('Failed to search code');
        logger.error('Search error', error);
        console.error(
          chalk.red(error instanceof Error ? error.message : 'Unknown error')
        );
      }
    });

  // Repository stats
  chromadb
    .command('repo-stats [name]')
    .description('Get statistics for ingested repositories')
    .action(async (name) => {
      const spinner = ora('Fetching repository statistics...').start();

      try {
        const config = {
          apiKey: process.env['CHROMADB_API_KEY'] || '',
          tenant: process.env['CHROMADB_TENANT'] || '',
          database: process.env['CHROMADB_DATABASE'] || 'stackmemory',
          collectionName: 'stackmemory_repos',
        };

        if (!config.apiKey || !config.tenant) {
          spinner.fail('ChromaDB not configured');
          console.log(chalk.yellow('\nPlease run: stackmemory chromadb init'));
          return;
        }

        const userId = process.env['USER'] || 'default';
        const teamId = process.env['CHROMADB_TEAM_ID'];

        const skill = new RepoIngestionSkill(config, userId, teamId);
        await skill.initialize();

        const stats = await skill.getRepoStats(name);

        spinner.stop();

        console.log(chalk.cyan('\n📊 Repository Statistics\n'));
        console.log(`Total repositories: ${chalk.bold(stats.totalRepos)}`);
        console.log(`Total files: ${chalk.bold(stats.totalFiles)}`);
        console.log(`Total chunks: ${chalk.bold(stats.totalChunks)}`);

        if (Object.keys(stats.languages).length > 0) {
          console.log('\nLanguages:');
          for (const [lang, count] of Object.entries(stats.languages)) {
            console.log(`  ${lang}: ${count}`);
          }
        }

        if (Object.keys(stats.frameworks).length > 0) {
          console.log('\nFrameworks:');
          for (const [framework, count] of Object.entries(stats.frameworks)) {
            console.log(`  ${framework}: ${count}`);
          }
        }
      } catch (error: unknown) {
        spinner.fail('Failed to get repository statistics');
        logger.error('Stats error', error);
        console.error(
          chalk.red(error instanceof Error ? error.message : 'Unknown error')
        );
      }
    });

  return chromadb;
}
