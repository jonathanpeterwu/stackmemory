/**
 * Storage management commands for StackMemory
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync } from 'fs';
import { RailwayOptimizedStorage } from '../../core/storage/railway-optimized-storage.js';
import { ConfigManager } from '../../core/config/config-manager.js';
import { formatBytes, formatDuration } from '../../utils/formatting.js';
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


export function createStorageCommand(): Command {
  const storage = new Command('storage').description(
    'Manage 3-tier storage system (Redis/Railway/GCS)'
  );

  storage
    .command('status')
    .description('Show storage tier statistics')
    .option('-v, --verbose', 'Show detailed statistics')
    .action(async (options) => {
      const spinner = ora('Loading storage statistics...').start();
      
      try {
        const dbPath = join(process.cwd(), '.stackmemory', 'context.db');
        if (!existsSync(dbPath)) {
          spinner.fail('StackMemory not initialized in this directory');
          process.exit(1);
        }
        
        const db = new Database(dbPath);
        const configManager = new ConfigManager();
        const storage = new RailwayOptimizedStorage(db, configManager);
        
        const stats = storage.getStorageStats();
        spinner.succeed('Storage statistics loaded');
        
        console.log(chalk.blue('\n📊 Storage Tier Distribution:'));
        console.log(chalk.gray('━'.repeat(50)));
        
        // Tier statistics
        for (const tier of stats.byTier) {
          const icon = tier.tier === 'hot' ? '🔥' : tier.tier === 'warm' ? '☁️' : '❄️';
          const color = tier.tier === 'hot' ? chalk.red : tier.tier === 'warm' ? chalk.yellow : chalk.cyan;
          
          console.log(`\n${icon} ${color(tier.tier.toUpperCase())} Tier:`);
          console.log(`  Traces: ${chalk.white(tier.count)}`);
          console.log(`  Original Size: ${chalk.white(formatBytes(tier.total_original || 0))}`);
          console.log(`  Compressed Size: ${chalk.white(formatBytes(tier.total_compressed || 0))}`);
          console.log(`  Compression Ratio: ${chalk.green((tier.avg_compression * 100).toFixed(1) + '%')}`);
          console.log(`  Avg Access Count: ${chalk.white(tier.avg_access?.toFixed(1) || '0')}`);
        }
        
        // Age distribution
        console.log(chalk.blue('\n📅 Age Distribution:'));
        console.log(chalk.gray('━'.repeat(50)));
        for (const age of stats.byAge) {
          const percent = (age.count / stats.totalTraces * 100).toFixed(1);
          const bar = '█'.repeat(Math.floor(percent / 2));
          console.log(`  ${age.age_group.padEnd(10)} ${bar} ${percent}% (${age.count})`);
        }
        
        // Summary
        console.log(chalk.blue('\n📈 Summary:'));
        console.log(chalk.gray('━'.repeat(50)));
        console.log(`  Total Traces: ${chalk.white(stats.totalTraces)}`);
        console.log(`  Total Size: ${chalk.white(formatBytes(stats.totalSize))}`);
        console.log(`  Compressed Size: ${chalk.white(formatBytes(stats.compressedSize))}`);
        
        const compressionRatio = ((1 - stats.compressedSize / stats.totalSize) * 100).toFixed(1);
        console.log(`  Overall Compression: ${chalk.green(compressionRatio + '%')}`);
        
        // Cost estimation
        const costEstimate = calculateStorageCost(stats);
        console.log(chalk.blue('\n💰 Estimated Monthly Cost:'));
        console.log(chalk.gray('━'.repeat(50)));
        console.log(`  Redis (Hot): ${chalk.green('$0.00')} (included with Railway)`);
        console.log(`  Railway Buckets (Warm): ${chalk.yellow(costEstimate.railway)}`);
        console.log(`  GCS Coldline (Cold): ${chalk.cyan(costEstimate.gcs)}`);
        console.log(`  Total: ${chalk.white(costEstimate.total)}`);
        
        if (options.verbose) {
          // Show recent migrations
          const recentMigrations = db.prepare(`
            SELECT trace_id, tier, migrated_at, score
            FROM storage_tiers
            WHERE migrated_at > ?
            ORDER BY migrated_at DESC
            LIMIT 10
          `).all(Date.now() - 24 * 60 * 60 * 1000) as any[];
          
          if (recentMigrations.length > 0) {
            console.log(chalk.blue('\n🔄 Recent Migrations (last 24h):'));
            console.log(chalk.gray('━'.repeat(50)));
            for (const m of recentMigrations) {
              const time = new Date(m.migrated_at).toLocaleTimeString();
              console.log(`  ${time} - ${m.trace_id.substring(0, 8)}... → ${m.tier} (score: ${m.score.toFixed(2)})`);
            }
          }
        }
        
        db.close();
        
      } catch (error: unknown) {
        spinner.fail('Failed to load storage statistics');
        console.error(error);
        process.exit(1);
      }
    });

  storage
    .command('migrate')
    .description('Migrate traces between storage tiers')
    .option('--dry-run', 'Show what would be migrated without doing it')
    .option('--force', 'Force migration regardless of age')
    .action(async (options) => {
      const spinner = ora('Checking for traces to migrate...').start();
      
      try {
        const dbPath = join(process.cwd(), '.stackmemory', 'context.db');
        const db = new Database(dbPath);
        const configManager = new ConfigManager();
        const storage = new RailwayOptimizedStorage(db, configManager);
        
        if (options.dryRun) {
          // Analyze what would be migrated
          const candidates = db.prepare(`
            SELECT trace_id, tier, created_at, score,
              (? - created_at) / 3600000 as age_hours
            FROM storage_tiers
            WHERE tier != 'cold'
            ORDER BY created_at ASC
          `).all(Date.now()) as any[];
          
          const toMigrate = {
            hotToWarm: candidates.filter((c: any) => 
              c.tier === 'hot' && c.age_hours > 24
            ),
            warmToCold: candidates.filter((c: any) => 
              c.tier === 'warm' && c.age_hours > 720
            ),
          };
          
          spinner.info('Dry run - no changes will be made');
          
          console.log(chalk.blue('\n🔄 Migration Plan:'));
          console.log(chalk.gray('━'.repeat(50)));
          
          if (toMigrate.hotToWarm.length > 0) {
            console.log(chalk.red(`\n🔥 → ☁️  Hot to Warm: ${toMigrate.hotToWarm.length} traces`));
            for (const t of toMigrate.hotToWarm.slice(0, 5)) {
              console.log(`  • ${t.trace_id.substring(0, 8)}... (${t.age_hours.toFixed(0)}h old, score: ${t.score.toFixed(2)})`);
            }
            if (toMigrate.hotToWarm.length > 5) {
              console.log(`  ... and ${toMigrate.hotToWarm.length - 5} more`);
            }
          }
          
          if (toMigrate.warmToCold.length > 0) {
            console.log(chalk.yellow(`\n☁️  → ❄️  Warm to Cold: ${toMigrate.warmToCold.length} traces`));
            for (const t of toMigrate.warmToCold.slice(0, 5)) {
              const ageDays = Math.floor(t.age_hours / 24);
              console.log(`  • ${t.trace_id.substring(0, 8)}... (${ageDays}d old, score: ${t.score.toFixed(2)})`);
            }
            if (toMigrate.warmToCold.length > 5) {
              console.log(`  ... and ${toMigrate.warmToCold.length - 5} more`);
            }
          }
          
          if (toMigrate.hotToWarm.length === 0 && toMigrate.warmToCold.length === 0) {
            console.log(chalk.green('✓ No traces need migration'));
          }
          
        } else {
          // Perform actual migration
          spinner.text = 'Migrating traces between tiers...';
          const results = await storage.migrateTiers();
          
          spinner.succeed('Migration completed');
          
          console.log(chalk.blue('\n✅ Migration Results:'));
          console.log(chalk.gray('━'.repeat(50)));
          console.log(`  Hot → Warm: ${chalk.yellow(results.hotToWarm)} traces`);
          console.log(`  Warm → Cold: ${chalk.cyan(results.warmToCold)} traces`);
          
          if (results.errors.length > 0) {
            console.log(chalk.red(`\n❌ Errors (${results.errors.length}):`));
            for (const error of results.errors.slice(0, 5)) {
              console.log(`  • ${error}`);
            }
          }
        }
        
        db.close();
        
      } catch (error: unknown) {
        spinner.fail('Migration failed');
        console.error(error);
        process.exit(1);
      }
    });

  storage
    .command('cleanup')
    .description('Clean up old traces from cold storage')
    .option('--days <number>', 'Remove traces older than N days', parseInt, 90)
    .option('--dry-run', 'Show what would be removed without doing it')
    .action(async (options) => {
      const spinner = ora('Analyzing storage for cleanup...').start();
      
      try {
        const dbPath = join(process.cwd(), '.stackmemory', 'context.db');
        const db = new Database(dbPath);
        const configManager = new ConfigManager();
        const storage = new RailwayOptimizedStorage(db, configManager);
        
        const cutoff = Date.now() - (options.days * 24 * 60 * 60 * 1000);
        
        if (options.dryRun) {
          const toRemove = db.prepare(`
            SELECT COUNT(*) as count, SUM(compressed_size) as size
            FROM storage_tiers
            WHERE tier = 'cold' AND created_at < ? AND access_count = 0
          `).get(cutoff) as any;
          
          spinner.info('Dry run - no traces will be removed');
          
          console.log(chalk.blue('\n🧹 Cleanup Analysis:'));
          console.log(chalk.gray('━'.repeat(50)));
          console.log(`  Traces to remove: ${chalk.red(toRemove.count || 0)}`);
          console.log(`  Space to free: ${chalk.yellow(formatBytes(toRemove.size || 0))}`);
          console.log(`  Criteria: > ${options.days} days old with 0 access`);
          
        } else {
          const removed = await storage.cleanup();
          spinner.succeed(`Cleanup completed - removed ${removed} traces`);
        }
        
        db.close();
        
      } catch (error: unknown) {
        spinner.fail('Cleanup failed');
        console.error(error);
        process.exit(1);
      }
    });

  storage
    .command('retrieve <traceId>')
    .description('Retrieve a trace from any storage tier')
    .action(async (traceId) => {
      const spinner = ora(`Retrieving trace ${traceId}...`).start();
      
      try {
        const dbPath = join(process.cwd(), '.stackmemory', 'context.db');
        const db = new Database(dbPath);
        const configManager = new ConfigManager();
        const storage = new RailwayOptimizedStorage(db, configManager);
        
        const trace = await storage.retrieveTrace(traceId);
        
        if (!trace) {
          spinner.fail(`Trace ${traceId} not found`);
          process.exit(1);
        }
        
        spinner.succeed('Trace retrieved');
        
        console.log(chalk.blue('\n📦 Trace Details:'));
        console.log(chalk.gray('━'.repeat(50)));
        console.log(`  ID: ${chalk.cyan(trace.id)}`);
        console.log(`  Type: ${chalk.yellow(trace.type)}`);
        console.log(`  Score: ${chalk.green(trace.score.toFixed(3))}`);
        console.log(`  Summary: ${trace.summary}`);
        console.log(`  Tools: ${trace.tools?.length || trace.toolSummary?.count || 0}`);
        
        const metadata = trace.metadata;
        if (metadata) {
          console.log(chalk.blue('\n📋 Metadata:'));
          console.log(`  Start: ${new Date(metadata.startTime).toLocaleString()}`);
          console.log(`  Duration: ${formatDuration(metadata.endTime - metadata.startTime)}`);
          console.log(`  Files: ${metadata.filesModified?.length || metadata.filesModified || 0}`);
          console.log(`  Errors: ${metadata.errorsEncountered?.length || metadata.errorsCount || 0}`);
        }
        
        // Show storage location
        const location = db.prepare(
          'SELECT tier, location, access_count FROM storage_tiers WHERE trace_id = ?'
        ).get(traceId) as any;
        
        if (location) {
          const tierIcon = location.tier === 'hot' ? '🔥' : 
                          location.tier === 'warm' ? '☁️' : '❄️';
          console.log(chalk.blue('\n💾 Storage:'));
          console.log(`  Tier: ${tierIcon} ${location.tier}`);
          console.log(`  Access Count: ${location.access_count}`);
        }
        
        db.close();
        
      } catch (error: unknown) {
        spinner.fail('Failed to retrieve trace');
        console.error(error);
        process.exit(1);
      }
    });

  storage
    .command('config')
    .description('Show storage configuration')
    .action(async () => {
      console.log(chalk.blue('\n⚙️  Storage Configuration:'));
      console.log(chalk.gray('━'.repeat(50)));
      
      console.log(chalk.red('\n🔥 Hot Tier (Redis):'));
      console.log(`  URL: ${process.env['REDIS_URL'] ? chalk.green('Configured') : chalk.yellow('Not configured')}`);
      console.log(`  TTL: 24 hours`);
      console.log(`  Max Memory: 100MB`);
      
      console.log(chalk.yellow('\n☁️  Warm Tier (Railway Buckets):'));
      console.log(`  Endpoint: ${process.env['RAILWAY_BUCKET_ENDPOINT'] || 'Not configured'}`);
      console.log(`  Bucket: ${process.env['RAILWAY_BUCKET_NAME'] || 'stackmemory-warm'}`);
      console.log(`  Access Key: ${process.env['RAILWAY_BUCKET_ACCESS_KEY'] ? chalk.green('Set') : chalk.yellow('Not set')}`);
      console.log(`  Retention: 30 days`);
      
      console.log(chalk.cyan('\n❄️  Cold Tier (GCS):'));
      console.log(`  Project: ${process.env['GCP_PROJECT_ID'] || 'Not configured'}`);
      console.log(`  Bucket: ${process.env['GCS_BUCKET'] || 'stackmemory-cold'}`);
      console.log(`  Key File: ${process.env['GCP_KEY_FILE'] ? chalk.green('Set') : chalk.yellow('Not set')}`);
      console.log(`  Storage Class: Coldline`);
      console.log(`  Retention: Infinite`);
      
      console.log(chalk.blue('\n📊 Migration Thresholds:'));
      console.log(`  Hot → Warm: After 24 hours`);
      console.log(`  Warm → Cold: After 30 days`);
      console.log(`  Low Score Migration: < 0.4 score`);
    });

  return storage;
}

/**
 * Calculate storage cost estimates
 */
function calculateStorageCost(stats: any): { railway: string; gcs: string; total: string } {
  // Find warm and cold tier sizes
  const warmTier = stats.byTier.find((t: any) => t.tier === 'warm');
  const coldTier = stats.byTier.find((t: any) => t.tier === 'cold');
  
  const warmGB = (warmTier?.total_compressed || 0) / (1024 * 1024 * 1024);
  const coldGB = (coldTier?.total_compressed || 0) / (1024 * 1024 * 1024);
  
  // Railway Buckets: ~$0.02/GB (estimate)
  const railwayCost = warmGB * 0.02;
  
  // GCS Coldline: $0.004/GB
  const gcsCost = coldGB * 0.004;
  
  const totalCost = railwayCost + gcsCost;
  
  return {
    railway: `$${railwayCost.toFixed(2)}`,
    gcs: `$${gcsCost.toFixed(2)}`,
    total: `$${totalCost.toFixed(2)}`,
  };
}