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
import { Logger } from '../../core/monitoring/logger.js';
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
  silent: true
});

const logger = new Logger('ChromaDB-CLI');

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
          apiKey: options.apiKey || process.env.CHROMADB_API_KEY || '',
          tenant: options.tenant || process.env.CHROMADB_TENANT || '',
          database: options.database || process.env.CHROMADB_DATABASE || 'stackmemory',
        };

        const userId = options.userId || process.env.USER || 'default';
        const teamId = options.teamId || process.env.CHROMADB_TEAM_ID;

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
          fs.appendFileSync(envPath, '\n# ChromaDB Configuration\n' + updates.join('\n') + '\n');
        }

        spinner.succeed('ChromaDB initialized successfully');
        
        console.log(chalk.green('\n✅ Configuration:'));
        console.log(`  Tenant: ${config.tenant}`);
        console.log(`  Database: ${config.database}`);
        console.log(`  User ID: ${userId}`);
        if (teamId) {
          console.log(`  Team ID: ${teamId}`);
        }
      } catch (error) {
        spinner.fail('Failed to initialize ChromaDB');
        logger.error('Initialization error', error);
        console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      }
    });

  // Store current context
  chromadb
    .command('store')
    .description('Store current context in ChromaDB')
    .option('--type <type>', 'Context type (frame/decision/observation)', 'frame')
    .option('--content <content>', 'Content to store')
    .option('--project <name>', 'Project name')
    .action(async (options) => {
      const spinner = ora('Storing context...').start();

      try {
        const config = {
          apiKey: process.env.CHROMADB_API_KEY || '',
          tenant: process.env.CHROMADB_TENANT || '',
          database: process.env.CHROMADB_DATABASE || 'stackmemory',
        };

        const userId = process.env.USER || 'default';
        const teamId = process.env.CHROMADB_TEAM_ID;

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
          const content = options.content || `${options.type} at ${new Date().toISOString()}`;
          const metadata: any = {
            project_name: options.project || path.basename(process.cwd()),
          };
          
          // Only add session_id if it exists
          if (process.env.STACKMEMORY_SESSION_ID) {
            metadata.session_id = process.env.STACKMEMORY_SESSION_ID;
          }
          
          await adapter.storeContext(
            options.type as 'decision' | 'observation',
            content,
            metadata
          );
          
          spinner.succeed(`Stored ${options.type}`);
        }
      } catch (error) {
        spinner.fail('Failed to store context');
        logger.error('Store error', error);
        console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
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
          apiKey: process.env.CHROMADB_API_KEY || '',
          tenant: process.env.CHROMADB_TENANT || '',
          database: process.env.CHROMADB_DATABASE || 'stackmemory',
        };

        const userId = process.env.USER || 'default';
        const teamId = process.env.CHROMADB_TEAM_ID;

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
          const content = result.content.substring(0, 100) + 
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
      } catch (error) {
        spinner.fail('Failed to query contexts');
        logger.error('Query error', error);
        console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
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
          apiKey: process.env.CHROMADB_API_KEY || '',
          tenant: process.env.CHROMADB_TENANT || '',
          database: process.env.CHROMADB_DATABASE || 'stackmemory',
        };

        const userId = process.env.USER || 'default';
        const teamId = process.env.CHROMADB_TEAM_ID;

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
          const content = result.content.substring(0, 100) + 
                          (result.content.length > 100 ? '...' : '');
          
          table.push([
            time,
            result.metadata.type || 'unknown',
            result.metadata.project_name || 'default',
            content,
          ]);
        }

        console.log(table.toString());
        console.log(chalk.green(`\n✅ Found ${results.length} recent contexts`));
      } catch (error) {
        spinner.fail('Failed to get recent contexts');
        logger.error('Recent error', error);
        console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
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
          apiKey: process.env.CHROMADB_API_KEY || '',
          tenant: process.env.CHROMADB_TENANT || '',
          database: process.env.CHROMADB_DATABASE || 'stackmemory',
        };

        const userId = process.env.USER || 'default';
        const teamId = process.env.CHROMADB_TEAM_ID;

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
      } catch (error) {
        spinner.fail('Failed to get statistics');
        logger.error('Stats error', error);
        console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
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
          apiKey: process.env.CHROMADB_API_KEY || '',
          tenant: process.env.CHROMADB_TENANT || '',
          database: process.env.CHROMADB_DATABASE || 'stackmemory',
        };

        const userId = process.env.USER || 'default';
        const teamId = process.env.CHROMADB_TEAM_ID;

        const adapter = new ChromaDBAdapter(config, userId, teamId);
        await adapter.initialize();

        const deleted = await adapter.deleteOldContexts(parseInt(options.days));

        spinner.succeed(`Deleted ${deleted} old contexts`);
      } catch (error) {
        spinner.fail('Failed to clean contexts');
        logger.error('Clean error', error);
        console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      }
    });

  return chromadb;
}