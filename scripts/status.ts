#!/usr/bin/env tsx
/**
 * Check StackMemory status and statistics
 */

import Database from 'better-sqlite3';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';

interface CountResult {
  count: number;
}

interface ContextRow {
  type: string;
  preview: string;
  importance: number;
  access_count: number;
}

interface FrameRow {
  name: string;
  type: string;
  started: string;
}

interface AttentionRow {
  query_preview: string;
  count: number;
}

const projectRoot = process.cwd();
const stackDir = join(projectRoot, '.stackmemory');
const dbPath = join(stackDir, 'context.db');
const configPath = join(stackDir, 'config.json');

// Check if .stackmemory directory exists
console.log(chalk.blue.bold('\n[StackMemory Status]\n'));

if (!existsSync(stackDir)) {
  console.log(chalk.red('[X] .stackmemory directory not found'));
  console.log(chalk.gray('    Run: stackmemory init'));
  process.exit(1);
}
console.log(chalk.green('[OK] .stackmemory directory exists'));

// Show config.json contents
if (existsSync(configPath)) {
  try {
    const config = JSON.parse(readFileSync(configPath, 'utf-8'));
    console.log(chalk.green('[OK] config.json found'));
    console.log(chalk.gray(`    version: ${config.version || 'unknown'}`));
    console.log(chalk.gray(`    project: ${config.project || 'unknown'}`));
    console.log(
      chalk.gray(`    initialized: ${config.initialized || 'unknown'}`)
    );
  } catch {
    console.log(chalk.yellow('[!] config.json exists but failed to parse'));
  }
} else {
  console.log(chalk.yellow('[!] config.json not found'));
}

// Check database
if (!existsSync(dbPath)) {
  console.log(chalk.red('[X] context.db not found'));
  process.exit(1);
}
console.log(chalk.green('[OK] context.db exists'));

const db = new Database(dbPath, { readonly: true });

// Get statistics
const stats = {
  contexts: db
    .prepare('SELECT COUNT(*) as count FROM contexts')
    .get() as CountResult,
  frames: db
    .prepare('SELECT COUNT(*) as count FROM frames')
    .get() as CountResult,
  attention: db
    .prepare('SELECT COUNT(*) as count FROM attention_log')
    .get() as CountResult,
};

console.log(chalk.cyan('\n[Database Stats]'));
console.log(`    Contexts: ${stats.contexts.count}`);
console.log(`    Frames: ${stats.frames.count}`);
console.log(`    Attention logs: ${stats.attention.count}`);

// Get top contexts by importance
if (stats.contexts.count > 0) {
  console.log(chalk.cyan('\n[Top Contexts by Importance]'));

  const topContexts = db
    .prepare(
      `
    SELECT type, substr(content, 1, 60) as preview, importance, access_count
    FROM contexts
    ORDER BY importance DESC, access_count DESC
    LIMIT 5
  `
    )
    .all() as ContextRow[];

  topContexts.forEach((ctx, i) => {
    const importance = '*'.repeat(Math.round(ctx.importance * 5));
    console.log(
      chalk.white(`  ${i + 1}.`) +
        ` [${ctx.type}] ` +
        chalk.gray(`(${ctx.access_count} uses)`) +
        ` ${importance}`
    );
    console.log(chalk.gray(`     ${ctx.preview}...`));
  });
}

// Get active frames (using correct schema: name, type, state)
const activeFrames = db
  .prepare(
    `
  SELECT name, type, datetime(created_at, 'unixepoch') as started
  FROM frames
  WHERE state = 'active'
  ORDER BY created_at DESC
  LIMIT 3
`
  )
  .all() as FrameRow[];

if (activeFrames.length > 0) {
  console.log(chalk.cyan('\n[Active Frames]'));
  activeFrames.forEach((frame) => {
    console.log(chalk.green('  *') + ` ${frame.name} (${frame.type})`);
    console.log(chalk.gray(`    Started: ${frame.started}`));
  });
}

// Get recent attention patterns
const recentAttention = db
  .prepare(
    `
  SELECT
    substr(query, 1, 50) as query_preview,
    COUNT(*) as count
  FROM attention_log
  WHERE timestamp > unixepoch() - 86400
  GROUP BY query_preview
  ORDER BY count DESC
  LIMIT 3
`
  )
  .all() as AttentionRow[];

if (recentAttention.length > 0) {
  console.log(chalk.cyan('\n[Recent Query Patterns]'));
  recentAttention.forEach((pattern) => {
    console.log(
      chalk.yellow('  ?') + ` "${pattern.query_preview}..." (${pattern.count}x)`
    );
  });
}

// Show context decay
const oldContexts = db
  .prepare(
    `
  SELECT COUNT(*) as count
  FROM contexts
  WHERE last_accessed < unixepoch() - 86400 * 7
`
  )
  .get() as CountResult;

if (oldContexts.count > 0) {
  console.log(
    chalk.yellow(
      `\n[!] ${oldContexts.count} contexts haven't been accessed in 7+ days`
    )
  );
}

// Check MCP configuration
console.log(chalk.cyan('\n[MCP Configuration]'));
const mcpConfigPaths = [
  join(
    process.env.HOME || '',
    'Library/Application Support/Claude/claude_desktop_config.json'
  ),
  join(process.env.HOME || '', '.config/claude/claude_desktop_config.json'),
];

let mcpFound = false;
for (const mcpPath of mcpConfigPaths) {
  if (existsSync(mcpPath)) {
    try {
      const mcpConfig = JSON.parse(readFileSync(mcpPath, 'utf-8'));
      const hasStackMemory =
        mcpConfig.mcpServers?.stackmemory ||
        mcpConfig.mcpServers?.['stackmemory-mcp'];
      if (hasStackMemory) {
        console.log(chalk.green('  [OK] MCP server configured'));
        mcpFound = true;
      } else {
        console.log(
          chalk.yellow('  [!] MCP config exists but stackmemory not configured')
        );
      }
    } catch {
      console.log(chalk.yellow(`  [!] Failed to parse ${mcpPath}`));
    }
    break;
  }
}
if (!mcpFound) {
  console.log(chalk.gray('  [--] No MCP configuration found'));
}

console.log(
  chalk.gray('\nTip: Run "npm run analyze" for detailed attention analysis\n')
);

db.close();
