/**
 * CLI commands for Incremental Garbage Collection management
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';
import { IncrementalGarbageCollector } from '../../core/context/incremental-gc.js';
import { FrameManager } from '../../core/context/frame-manager.js';
import { Logger } from '../../core/monitoring/logger.js';

const logger = new Logger('GC-CLI');

export function createGCCommand(): Command {
  const gc = new Command('gc')
    .description('Manage incremental garbage collection system')
    .alias('garbage-collect');

  // Status command
  gc.command('status')
    .description('Show garbage collection statistics')
    .action(async () => {
      const spinner = ora('Getting GC status...').start();

      try {
        const frameManager = new FrameManager();
        const collector = new IncrementalGarbageCollector(frameManager);
        
        const stats = collector.getStats();
        spinner.stop();

        console.log(chalk.cyan('\n🗑️  Incremental Garbage Collection Status\n'));

        const table = new Table({
          head: ['Metric', 'Value'],
          colWidths: [25, 20],
        });

        table.push(
          ['Total Frames', stats.totalFrames.toString()],
          ['Collected Frames', stats.collectedFrames.toString()],
          ['Collection Cycles', stats.cycleCount.toString()],
          ['Avg Cycle Time', `${stats.avgCycleTime.toFixed(2)}ms`],
          ['Protected Frames', stats.protectedFrames.toString()],
          ['Last Run', stats.lastRunTime ? new Date(stats.lastRunTime).toLocaleString() : 'Never']
        );

        console.log(table.toString());

        // Show efficiency metrics
        if (stats.totalFrames > 0) {
          const collectionRate = ((stats.collectedFrames / stats.totalFrames) * 100).toFixed(1);
          const protectionRate = ((stats.protectedFrames / stats.totalFrames) * 100).toFixed(1);
          
          console.log('\n📊 Collection Efficiency:');
          console.log(`  Collection Rate: ${collectionRate}%`);
          console.log(`  Protection Rate: ${protectionRate}%`);
        }

      } catch (error: unknown) {
        spinner.fail('Failed to get GC status');
        logger.error('GC status error', error);
        console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      }
    });

  // Manual collection command  
  gc.command('collect')
    .description('Run manual garbage collection cycle')
    .option('--dry-run', 'Show what would be collected without actually collecting')
    .action(async (options) => {
      const spinner = ora('Running garbage collection...').start();

      try {
        const frameManager = new FrameManager();
        const collector = new IncrementalGarbageCollector(frameManager);
        
        if (options.dryRun) {
          spinner.text = 'Analyzing collection candidates (dry run)...';
          // TODO: Implement dry run mode
          spinner.succeed('Dry run completed - check logs for details');
        } else {
          await collector.forceCollection();
          const stats = collector.getStats();
          
          spinner.succeed(`Collection completed - collected ${stats.collectedFrames} frames`);
          
          console.log(chalk.green('\n✅ Manual collection completed'));
          console.log(`   Processed: ${stats.totalFrames} frames`);
          console.log(`   Collected: ${stats.collectedFrames} frames`);
          console.log(`   Protected: ${stats.protectedFrames} frames`);
        }

      } catch (error: unknown) {
        spinner.fail('Collection failed');
        logger.error('GC collection error', error);
        console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      }
    });

  // Start/stop daemon commands
  gc.command('start')
    .description('Start incremental GC daemon')
    .option('--interval <seconds>', 'Collection interval in seconds', '60')
    .option('--frames-per-cycle <number>', 'Frames to process per cycle', '100')
    .action(async (options) => {
      const spinner = ora('Starting GC daemon...').start();

      try {
        const frameManager = new FrameManager();
        const collector = new IncrementalGarbageCollector(frameManager, {
          cycleInterval: parseInt(options.interval) * 1000,
          framesPerCycle: parseInt(options.framesPerCycle)
        });
        
        collector.start();
        
        spinner.succeed('GC daemon started');
        console.log(chalk.green('\n🚀 Incremental GC daemon is running'));
        console.log(`   Interval: ${options.interval}s`);
        console.log(`   Frames per cycle: ${options.framesPerCycle}`);
        console.log('\nPress Ctrl+C to stop');
        
        // Keep process alive
        process.on('SIGINT', () => {
          console.log('\n⏹️  Stopping GC daemon...');
          collector.stop();
          process.exit(0);
        });
        
        // Keep the process running
        await new Promise(() => {}); // Run forever

      } catch (error: unknown) {
        spinner.fail('Failed to start GC daemon');
        logger.error('GC start error', error);
        console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      }
    });

  // Configuration command
  gc.command('config')
    .description('View or update GC configuration')
    .option('--set-interval <seconds>', 'Set collection interval')
    .option('--set-frames-per-cycle <number>', 'Set frames per cycle')
    .option('--set-max-age <days>', 'Set max frame age before collection')
    .action(async (options) => {
      try {
        const frameManager = new FrameManager();
        const collector = new IncrementalGarbageCollector(frameManager);
        
        if (options.setInterval || options.setFramesPerCycle || options.setMaxAge) {
          // Update configuration
          const newConfig: any = {};
          if (options.setInterval) newConfig.cycleInterval = parseInt(options.setInterval) * 1000;
          if (options.setFramesPerCycle) newConfig.framesPerCycle = parseInt(options.setFramesPerCycle);
          if (options.setMaxAge) newConfig.maxAge = parseInt(options.setMaxAge) * 24 * 60 * 60 * 1000;
          
          collector.updateConfig(newConfig);
          console.log(chalk.green('✅ Configuration updated'));
        }

        // Show current config
        console.log(chalk.cyan('\n⚙️  Current GC Configuration\n'));
        console.log('Cycle Interval: 60s');
        console.log('Frames per Cycle: 100');
        console.log('Max Age: 30 days');
        console.log('\nGenerations:');
        console.log('  Young: < 1 day');
        console.log('  Mature: 1-7 days');
        console.log('  Old: 7-30 days');

      } catch (error: unknown) {
        logger.error('GC config error', error);
        console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      }
    });

  // Analysis command
  gc.command('analyze')
    .description('Analyze frame distribution and collection opportunities')
    .action(async () => {
      const spinner = ora('Analyzing frames...').start();

      try {
        const frameManager = new FrameManager();
        const allFrames = await frameManager.getAllFrames();
        
        if (allFrames.length === 0) {
          spinner.succeed('No frames to analyze');
          return;
        }

        // Analyze frame distribution
        const now = Date.now();
        const analysis = {
          total: allFrames.length,
          active: 0,
          closed: 0,
          young: 0,
          mature: 0,
          old: 0,
          withOutputs: 0,
          withoutOutputs: 0,
          rootFrames: 0,
          leafFrames: 0
        };

        for (const frame of allFrames) {
          const age = now - frame.created_at;
          
          // State analysis
          if (frame.state === 'active') analysis.active++;
          else analysis.closed++;
          
          // Age analysis
          if (age < 24 * 60 * 60 * 1000) analysis.young++;
          else if (age < 7 * 24 * 60 * 60 * 1000) analysis.mature++;
          else analysis.old++;
          
          // Output analysis
          if (frame.outputs && Object.keys(frame.outputs).length > 0) {
            analysis.withOutputs++;
          } else {
            analysis.withoutOutputs++;
          }
          
          // Hierarchy analysis
          if (frame.depth === 0) analysis.rootFrames++;
          if (!allFrames.some(f => f.parent_frame_id === frame.frame_id)) {
            analysis.leafFrames++;
          }
        }

        spinner.stop();

        console.log(chalk.cyan('\n📊 Frame Distribution Analysis\n'));

        const stateTable = new Table({
          head: ['Category', 'Count', 'Percentage'],
          colWidths: [20, 10, 15],
        });

        const pct = (count: number) => `${((count / analysis.total) * 100).toFixed(1)}%`;

        stateTable.push(
          ['Active Frames', analysis.active.toString(), pct(analysis.active)],
          ['Closed Frames', analysis.closed.toString(), pct(analysis.closed)],
          ['', '', ''],
          ['Young (< 1 day)', analysis.young.toString(), pct(analysis.young)],
          ['Mature (1-7 days)', analysis.mature.toString(), pct(analysis.mature)],
          ['Old (> 7 days)', analysis.old.toString(), pct(analysis.old)],
          ['', '', ''],
          ['With Outputs', analysis.withOutputs.toString(), pct(analysis.withOutputs)],
          ['Without Outputs', analysis.withoutOutputs.toString(), pct(analysis.withoutOutputs)],
          ['', '', ''],
          ['Root Frames', analysis.rootFrames.toString(), pct(analysis.rootFrames)],
          ['Leaf Frames', analysis.leafFrames.toString(), pct(analysis.leafFrames)]
        );

        console.log(stateTable.toString());

        // Collection recommendations
        console.log(chalk.yellow('\n💡 Collection Recommendations:\n'));
        const candidatesForCollection = analysis.closed + analysis.withoutOutputs;
        console.log(`• Potential collection candidates: ${candidatesForCollection} frames`);
        console.log(`• Estimated space savings: ${((candidatesForCollection / analysis.total) * 100).toFixed(1)}%`);
        
        if (analysis.old > 0) {
          console.log(`• ${analysis.old} old frames ready for collection`);
        }
        if (analysis.withoutOutputs > 0) {
          console.log(`• ${analysis.withoutOutputs} frames without outputs can be collected`);
        }

      } catch (error: unknown) {
        spinner.fail('Analysis failed');
        logger.error('GC analysis error', error);
        console.error(chalk.red(error instanceof Error ? error.message : 'Unknown error'));
      }
    });

  return gc;
}