/**
 * Retrieval CLI Commands
 * View and manage LLM-driven context retrieval settings and audit logs
 */

import { Command } from 'commander';
import Database from 'better-sqlite3';
import { join } from 'path';
import { existsSync } from 'fs';
import chalk from 'chalk';
import { RetrievalAuditStore } from '../../core/retrieval/retrieval-audit.js';

export function createRetrievalCommands(): Command {
  const retrieval = new Command('retrieval')
    .alias('ret')
    .description('Manage LLM-driven context retrieval');

  // Audit subcommand
  retrieval
    .command('audit')
    .description('View retrieval audit log')
    .option('-l, --limit <n>', 'Number of entries to show', '10')
    .option('-q, --query <text>', 'Filter by query text')
    .option('-v, --verbose', 'Show full details')
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
        // Get project ID
        let projectId = 'default';
        try {
          const row = db
            .prepare(`SELECT value FROM metadata WHERE key = 'project_id'`)
            .get() as any;
          if (row?.value) projectId = row.value;
        } catch {
          // Use default
        }

        const auditStore = new RetrievalAuditStore(db, projectId);

        let entries;
        if (options.query) {
          entries = auditStore.searchByQuery(
            options.query,
            parseInt(options.limit)
          );
          console.log(
            chalk.blue(
              `\nRetrieval audit entries matching "${options.query}":\n`
            )
          );
        } else {
          entries = auditStore.getRecent(parseInt(options.limit));
          console.log(chalk.blue('\nRecent retrieval audit entries:\n'));
        }

        if (entries.length === 0) {
          console.log(chalk.gray('No audit entries found.'));
          console.log(
            chalk.gray(
              '\nRetrieval audit records decisions made by the LLM-driven'
            )
          );
          console.log(
            chalk.gray(
              'context retrieval system. Run some queries to generate entries.'
            )
          );
          return;
        }

        for (const entry of entries) {
          const date = new Date(entry.timestamp).toLocaleString();
          const providerIcon =
            entry.provider === 'anthropic'
              ? chalk.green('LLM')
              : entry.provider === 'cached'
                ? chalk.yellow('CACHE')
                : chalk.gray('HEUR');

          console.log(
            `${chalk.cyan(entry.id.slice(0, 8))} ${chalk.gray(date)} [${providerIcon}]`
          );
          console.log(
            `  Query: ${chalk.white(entry.query.slice(0, 60))}${entry.query.length > 60 ? '...' : ''}`
          );
          console.log(
            `  Confidence: ${formatConfidence(entry.confidenceScore)} | ` +
              `Tokens: ${entry.tokensUsed}/${entry.tokenBudget} | ` +
              `Time: ${entry.analysisTimeMs}ms | ` +
              `Complexity: ${entry.queryComplexity}`
          );

          if (options.verbose) {
            console.log(
              `  Frames: ${entry.framesRetrieved.join(', ') || 'none'}`
            );
            console.log(
              `  Reasoning: ${chalk.gray(entry.reasoning.slice(0, 200))}${entry.reasoning.length > 200 ? '...' : ''}`
            );
          }

          console.log('');
        }
      } finally {
        db.close();
      }
    });

  // Stats subcommand
  retrieval
    .command('stats')
    .description('Show retrieval statistics')
    .action(async () => {
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
        } catch {
          // Use default
        }

        const auditStore = new RetrievalAuditStore(db, projectId);
        const stats = auditStore.getStats();

        console.log(chalk.blue('\nRetrieval Statistics\n'));

        console.log(`Total retrievals: ${chalk.white(stats.totalRetrievals)}`);
        console.log(
          `Average confidence: ${formatConfidence(stats.avgConfidence)}`
        );
        console.log(
          `Average tokens used: ${chalk.white(Math.round(stats.avgTokensUsed))}`
        );
        console.log(
          `Average analysis time: ${chalk.white(Math.round(stats.avgAnalysisTime))}ms`
        );

        console.log('\nProvider breakdown:');
        for (const [provider, count] of Object.entries(
          stats.providerBreakdown
        )) {
          const pct =
            stats.totalRetrievals > 0
              ? ((count / stats.totalRetrievals) * 100).toFixed(1)
              : '0';
          const icon =
            provider === 'anthropic'
              ? chalk.green('LLM')
              : provider === 'cached'
                ? chalk.yellow('CACHE')
                : chalk.gray('HEUR');
          console.log(`  ${icon}: ${count} (${pct}%)`);
        }

        console.log('');
      } finally {
        db.close();
      }
    });

  // Reasoning subcommand - show detailed reasoning for a specific entry
  retrieval
    .command('reasoning <id>')
    .description('Show detailed reasoning for a retrieval decision')
    .action(async (id) => {
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
        } catch {
          // Use default
        }

        const auditStore = new RetrievalAuditStore(db, projectId);

        // Try to find entry by partial ID
        const entries = auditStore.getRecent(100);
        const entry = entries.find((e) => e.id.startsWith(id));

        if (!entry) {
          console.log(
            chalk.red(`No audit entry found with ID starting with "${id}"`)
          );
          return;
        }

        console.log(chalk.blue('\nRetrieval Decision Details\n'));

        console.log(`ID: ${chalk.white(entry.id)}`);
        console.log(
          `Time: ${chalk.white(new Date(entry.timestamp).toLocaleString())}`
        );
        console.log(`Provider: ${chalk.white(entry.provider)}`);
        console.log(`Query: ${chalk.white(entry.query)}`);
        console.log(`Complexity: ${chalk.white(entry.queryComplexity)}`);
        console.log(`Confidence: ${formatConfidence(entry.confidenceScore)}`);
        console.log(
          `Tokens: ${chalk.white(`${entry.tokensUsed}/${entry.tokenBudget}`)}`
        );
        console.log(
          `Analysis Time: ${chalk.white(`${entry.analysisTimeMs}ms`)}`
        );

        console.log(chalk.blue('\nReasoning:'));
        console.log(entry.reasoning);

        console.log(chalk.blue('\nFrames Retrieved:'));
        if (entry.framesRetrieved.length === 0) {
          console.log(chalk.gray('  (none)'));
        } else {
          for (const frameId of entry.framesRetrieved) {
            console.log(`  - ${frameId}`);
          }
        }

        console.log('');
      } finally {
        db.close();
      }
    });

  // Cleanup subcommand
  retrieval
    .command('cleanup')
    .description('Remove old audit entries')
    .option('-d, --days <n>', 'Keep entries from last N days', '7')
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
        } catch {
          // Use default
        }

        const auditStore = new RetrievalAuditStore(db, projectId);
        const days = parseInt(options.days);
        const maxAgeMs = days * 24 * 60 * 60 * 1000;
        const deleted = auditStore.cleanup(maxAgeMs);

        console.log(
          chalk.green(
            `Cleaned up ${deleted} old audit entries (older than ${days} days)`
          )
        );
      } finally {
        db.close();
      }
    });

  // Status subcommand - show current retrieval configuration
  retrieval
    .command('status')
    .description('Show current retrieval system status')
    .action(async () => {
      const hasApiKey = !!process.env['ANTHROPIC_API_KEY'];
      const model = process.env['ANTHROPIC_MODEL'] || 'claude-3-haiku-20240307';

      console.log(chalk.blue('\nRetrieval System Status\n'));

      if (hasApiKey) {
        console.log(`LLM Provider: ${chalk.green('Anthropic (active)')}`);
        console.log(`Model: ${chalk.white(model)}`);
      } else {
        console.log(
          `LLM Provider: ${chalk.yellow('Heuristic fallback (no API key)')}`
        );
        console.log(
          chalk.gray('Set ANTHROPIC_API_KEY to enable LLM-driven retrieval')
        );
      }

      console.log(`Default Token Budget: ${chalk.white('8000')}`);
      console.log(`Confidence Threshold: ${chalk.white('0.6')}`);
      console.log(`Cache TTL: ${chalk.white('5 minutes')}`);

      console.log('');
    });

  return retrieval;
}

function formatConfidence(score: number): string {
  if (score >= 0.8) return chalk.green(`${(score * 100).toFixed(0)}%`);
  if (score >= 0.6) return chalk.yellow(`${(score * 100).toFixed(0)}%`);
  return chalk.red(`${(score * 100).toFixed(0)}%`);
}
