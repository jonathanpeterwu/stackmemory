/**
 * Stats Command for StackMemory CLI
 * Shows edit telemetry statistics
 */

import { Command } from 'commander';
import { existsSync } from 'fs';
import { join } from 'path';

interface TelemetryRow {
  tool_name: string;
  total: number;
  successes: number;
  failures: number;
}

interface TopFailRow {
  file_path: string;
  fail_count: number;
}

interface ErrorTypeRow {
  error_type: string;
  count: number;
}

interface TrendRow {
  day: string;
  total: number;
  failures: number;
}

export function createStatsCommand(): Command {
  const stats = new Command('stats')
    .description('Show telemetry statistics')
    .argument('[category]', 'Category to show (edits)', 'edits')
    .option('-d, --days <n>', 'Number of days to show trend', '7')
    .option('--json', 'Output as JSON', false)
    .action(async (category, options) => {
      if (category !== 'edits') {
        console.log(`Unknown stats category: ${category}`);
        console.log('Available: edits');
        return;
      }

      const projectRoot = process.cwd();
      const dbPath = join(projectRoot, '.stackmemory', 'context.db');

      if (!existsSync(dbPath)) {
        console.log('No data. Run "stackmemory init" first.');
        return;
      }

      const { default: Database } = await import('better-sqlite3');
      const db = new Database(dbPath);

      // Check if table exists
      const tableExists = db
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='edit_telemetry'"
        )
        .get();

      if (!tableExists) {
        db.close();
        console.log('No edit telemetry data yet.');
        console.log('Edit telemetry is collected via the PostToolUse hook.');
        return;
      }

      const days = parseInt(options.days, 10) || 7;
      const cutoff = Math.floor(Date.now() / 1000) - days * 86400;

      // Success rate by tool
      const byTool = db
        .prepare(
          `SELECT
            tool_name,
            COUNT(*) as total,
            SUM(CASE WHEN success = 1 THEN 1 ELSE 0 END) as successes,
            SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures
          FROM edit_telemetry
          WHERE timestamp >= ?
          GROUP BY tool_name
          ORDER BY total DESC`
        )
        .all(cutoff) as TelemetryRow[];

      // Top failure files
      const topFails = db
        .prepare(
          `SELECT file_path, COUNT(*) as fail_count
          FROM edit_telemetry
          WHERE success = 0 AND timestamp >= ? AND file_path IS NOT NULL
          GROUP BY file_path
          ORDER BY fail_count DESC
          LIMIT 10`
        )
        .all(cutoff) as TopFailRow[];

      // Error type distribution
      const errorTypes = db
        .prepare(
          `SELECT error_type, COUNT(*) as count
          FROM edit_telemetry
          WHERE success = 0 AND timestamp >= ? AND error_type IS NOT NULL
          GROUP BY error_type
          ORDER BY count DESC`
        )
        .all(cutoff) as ErrorTypeRow[];

      // Trend (per day)
      const trend = db
        .prepare(
          `SELECT
            date(timestamp, 'unixepoch') as day,
            COUNT(*) as total,
            SUM(CASE WHEN success = 0 THEN 1 ELSE 0 END) as failures
          FROM edit_telemetry
          WHERE timestamp >= ?
          GROUP BY day
          ORDER BY day DESC`
        )
        .all(cutoff) as TrendRow[];

      db.close();

      if (options.json) {
        console.log(
          JSON.stringify({ byTool, topFails, errorTypes, trend }, null, 2)
        );
        return;
      }

      // Human-readable output
      console.log(`\nEdit Telemetry (last ${days} days)`);
      console.log('─'.repeat(50));

      if (byTool.length === 0) {
        console.log('No edit telemetry data in this period.');
        return;
      }

      console.log('\nSuccess Rate by Tool:');
      for (const row of byTool) {
        const rate =
          row.total > 0 ? Math.round((row.successes / row.total) * 100) : 0;
        console.log(
          `  ${row.tool_name.padEnd(20)} ${rate}% (${row.successes}/${row.total})`
        );
      }

      if (topFails.length > 0) {
        console.log('\nTop Failure Files:');
        for (const row of topFails) {
          console.log(`  ${row.file_path} (${row.fail_count}x)`);
        }
      }

      if (errorTypes.length > 0) {
        console.log('\nError Types:');
        for (const row of errorTypes) {
          console.log(`  ${row.error_type.padEnd(30)} ${row.count}x`);
        }
      }

      if (trend.length > 0) {
        console.log('\nDaily Trend:');
        for (const row of trend) {
          const failRate =
            row.total > 0 ? Math.round((row.failures / row.total) * 100) : 0;
          console.log(
            `  ${row.day}  ${row.total} edits, ${row.failures} failures (${failRate}%)`
          );
        }
      }

      console.log('');
    });

  return stats;
}
