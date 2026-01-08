/**
 * CLI commands for Infinite Storage System management
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import { InfiniteStorageSystem, StorageConfig } from '../../core/storage/infinite-storage.js';
import { FrameManager } from '../../core/context/frame-manager.js';
import { Logger } from '../../core/monitoring/logger.js';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
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


const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables
dotenv.config({ 
  path: path.join(__dirname, '../../../.env'),
  override: true,
  silent: true
});

const logger = new Logger('InfiniteStorage-CLI');

export function createInfiniteStorageCommand(): Command {
  const storage = new Command('infinite-storage')
    .description('Manage infinite storage system with tiered storage')
    .alias('storage');

  // Initialize storage system
  storage
    .command('init')
    .description('Initialize infinite storage system')
    .option('--redis-url <url>', 'Redis connection URL')
    .option('--timeseries-url <url>', 'TimeSeries DB connection URL')
    .option('--s3-bucket <bucket>', 'S3 bucket name')
    .option('--s3-region <region>', 'S3 region', 'us-east-1')
    .action(async (options) => {
      const spinner = ora('Initializing infinite storage...').start();

      try {
        const config: StorageConfig = {
          redis: {
            url: options.redisUrl || process.env['REDIS_URL'] || 'redis://localhost:6379',
            ttlSeconds: 3600,
            maxMemoryMB: parseInt(process.env['REDIS_MAX_MEMORY_MB'] || '512'),
          },
          timeseries: {
            connectionString: options.timeseriesUrl || process.env['TIMESERIES_URL'] || '',
            retentionDays: 30,
          },
          s3: {
            bucket: options.s3Bucket || process.env['S3_BUCKET'] || '',
            region: options.s3Region || process.env['AWS_REGION'] || 'us-east-1',
            accessKeyId: process.env['AWS_ACCESS_KEY_ID'],
            secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'],
          },
          tiers: [],
        };

        const storage = new InfiniteStorageSystem(config);
        await storage.initialize();

        spinner.succeed('Infinite storage initialized');
        
        console.log(chalk.green('\n✅ Storage Tiers Configured:'));
        console.log('  Hot (Redis): < 1 hour, 5ms latency');
        console.log('  Warm (TimeSeries): 1h - 7 days, 50ms latency');
        console.log('  Cold (S3): 7 - 30 days, 100ms latency');
        console.log('  Archive (Glacier): > 30 days, 1h latency');
        
        // Save config to env
        const envPath = path.join(__dirname, '../../../.env');
        const updates: string[] = [];
        
        if (!process.env['REDIS_URL'] && options.redisUrl) {
          updates.push(`REDIS_URL=${options.redisUrl}`);
        }
        if (!process.env['TIMESERIES_URL'] && options.timeseriesUrl) {
          updates.push(`TIMESERIES_URL=${options.timeseriesUrl}`);
        }
        if (!process.env['S3_BUCKET'] && options.s3Bucket) {
          updates.push(`S3_BUCKET=${options.s3Bucket}`);
        }
        
        if (updates.length > 0) {
          const fs = await import('fs');
          fs.appendFileSync(envPath, '\n# Infinite Storage Configuration\n' + updates.join('\n') + '\n');
        }
      } catch (error: unknown) {
        spinner.fail('Failed to initialize storage');
        logger.error('Initialization error', error);
        console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      }
    });

  // Store frames
  storage
    .command('store')
    .description('Store current frames in infinite storage')
    .option('--project <name>', 'Project name')
    .option('--user <id>', 'User ID')
    .action(async (options) => {
      const spinner = ora('Storing frames...').start();

      try {
        const config = getStorageConfig();
        const storage = new InfiniteStorageSystem(config);
        await storage.initialize();

        const frameManager = new FrameManager();
        const frames = frameManager.getAllFrames();
        const userId = options.user || process.env['USER'] || 'default';

        for (const frame of frames) {
          await storage.storeFrame(frame, userId);
        }

        spinner.succeed(`Stored ${frames.length} frames`);
      } catch (error: unknown) {
        spinner.fail('Failed to store frames');
        logger.error('Store error', error);
        console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      }
    });

  // Retrieve frame
  storage
    .command('retrieve <frameId>')
    .description('Retrieve a frame from storage')
    .option('--user <id>', 'User ID')
    .action(async (frameId, options) => {
      const spinner = ora('Retrieving frame...').start();

      try {
        const config = getStorageConfig();
        const storage = new InfiniteStorageSystem(config);
        await storage.initialize();

        const userId = options.user || process.env['USER'] || 'default';
        const frame = await storage.retrieveFrame(frameId, userId);

        spinner.stop();

        if (frame) {
          console.log(chalk.green('\n✅ Frame Retrieved:'));
          console.log(JSON.stringify(frame, null, 2));
        } else {
          console.log(chalk.yellow('Frame not found'));
        }
      } catch (error: unknown) {
        spinner.fail('Failed to retrieve frame');
        logger.error('Retrieve error', error);
        console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      }
    });

  // Show metrics
  storage
    .command('metrics')
    .description('Show storage system metrics')
    .action(async () => {
      const spinner = ora('Fetching metrics...').start();

      try {
        const config = getStorageConfig();
        const storage = new InfiniteStorageSystem(config);
        await storage.initialize();

        const metrics = await storage.getMetrics();

        spinner.stop();

        console.log(chalk.cyan('\n📊 Infinite Storage Metrics\n'));
        
        const table = new Table({
          head: ['Metric', 'Value'],
          colWidths: [30, 40],
        });

        table.push(
          ['Total Objects', metrics.totalObjects.toString()],
          ['Storage Size', formatBytes(metrics.storageBytes)],
          ['Avg Latency', `${metrics.avgLatencyMs.toFixed(2)}ms`],
          ['P50 Latency', `${metrics.p50LatencyMs}ms`],
          ['P99 Latency', `${metrics.p99LatencyMs}ms`],
        );

        console.log(table.toString());

        if (Object.keys(metrics.tierDistribution).length > 0) {
          console.log('\nTier Distribution:');
          for (const [tier, count] of Object.entries(metrics.tierDistribution)) {
            const percentage = ((count / metrics.totalObjects) * 100).toFixed(1);
            console.log(`  ${tier}: ${count} objects (${percentage}%)`);
          }
        }

        // Check if meeting STA-287 targets
        console.log(chalk.cyan('\n🎯 STA-287 Performance Targets:'));
        const p50Target = metrics.p50LatencyMs <= 50;
        const p99Target = metrics.p99LatencyMs <= 500;
        
        console.log(`  P50 ≤ 50ms: ${p50Target ? chalk.green('✅ PASS') : chalk.red('❌ FAIL')} (${metrics.p50LatencyMs}ms)`);
        console.log(`  P99 ≤ 500ms: ${p99Target ? chalk.green('✅ PASS') : chalk.red('❌ FAIL')} (${metrics.p99LatencyMs}ms)`);
      } catch (error: unknown) {
        spinner.fail('Failed to get metrics');
        logger.error('Metrics error', error);
        console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      }
    });

  // Migrate data
  storage
    .command('migrate')
    .description('Manually trigger tier migration')
    .action(async () => {
      const spinner = ora('Running migration...').start();

      try {
        const config = getStorageConfig();
        const storage = new InfiniteStorageSystem(config);
        await storage.initialize();

        // Trigger migration (this would normally run automatically)
        // @ts-ignore - accessing private method for manual trigger
        await storage.migrateAgedData();

        spinner.succeed('Migration completed');
      } catch (error: unknown) {
        spinner.fail('Migration failed');
        logger.error('Migration error', error);
        console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      }
    });

  // Status command
  storage
    .command('status')
    .description('Check storage system status')
    .action(async () => {
      const spinner = ora('Checking status...').start();

      try {
        const config = getStorageConfig();
        
        spinner.stop();
        
        console.log(chalk.cyan('\n📦 Storage System Status\n'));
        
        // Check Redis
        if (config.redis?.url) {
          try {
            const { createClient } = await import('redis');
            const client = createClient({ url: config.redis.url });
            await client.connect();
            await client.ping();
            await client.quit();
            console.log('Redis (Hot Tier): ' + chalk.green('✅ Connected'));
          } catch {
            console.log('Redis (Hot Tier): ' + chalk.red('❌ Not connected'));
          }
        } else {
          console.log('Redis (Hot Tier): ' + chalk.yellow('⚠️ Not configured'));
        }

        // Check TimeSeries DB
        if (config.timeseries?.connectionString) {
          try {
            const { Pool } = await import('pg');
            const pool = new Pool({ connectionString: config.timeseries.connectionString });
            await pool.query('SELECT 1');
            await pool.end();
            console.log('TimeSeries DB (Warm Tier): ' + chalk.green('✅ Connected'));
          } catch {
            console.log('TimeSeries DB (Warm Tier): ' + chalk.red('❌ Not connected'));
          }
        } else {
          console.log('TimeSeries DB (Warm Tier): ' + chalk.yellow('⚠️ Not configured'));
        }

        // Check S3
        if (config.s3?.bucket) {
          console.log(`S3 (Cold/Archive Tier): ${chalk.green('✅')} Bucket: ${config.s3.bucket}`);
        } else {
          console.log('S3 (Cold/Archive Tier): ' + chalk.yellow('⚠️ Not configured'));
        }

        console.log('\n' + chalk.gray('Configure missing tiers with: stackmemory infinite-storage init'));
      } catch (error: unknown) {
        spinner.fail('Failed to check status');
        logger.error('Status error', error);
        console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      }
    });

  return storage;
}

function getStorageConfig(): StorageConfig {
  return {
    redis: {
      url: process.env['REDIS_URL'] || 'redis://localhost:6379',
      ttlSeconds: parseInt(process.env['REDIS_TTL'] || '3600'),
      maxMemoryMB: parseInt(process.env['REDIS_MAX_MEMORY_MB'] || '512'),
    },
    timeseries: {
      connectionString: process.env['TIMESERIES_URL'] || '',
      retentionDays: parseInt(process.env['TIMESERIES_RETENTION_DAYS'] || '30'),
    },
    s3: {
      bucket: process.env['S3_BUCKET'] || '',
      region: process.env['AWS_REGION'] || 'us-east-1',
      accessKeyId: process.env['AWS_ACCESS_KEY_ID'],
      secretAccessKey: process.env['AWS_SECRET_ACCESS_KEY'],
    },
    tiers: [],
  };
}

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}