/**
 * Audit Command for StackMemory CLI
 * Measures total tokens injected into context before user's first message.
 */

import { Command } from 'commander';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Token counting - use Anthropic's tokenizer with fallback
let countTokens: (text: string) => number;
try {
  const tokenizer = await import('@anthropic-ai/tokenizer');
  countTokens = tokenizer.countTokens;
} catch {
  countTokens = (text: string) => Math.ceil(text.length / 3.5);
}

interface AuditEntry {
  source: string;
  tokens: number;
  percent: number;
}

function readFileSafe(filePath: string): string | null {
  try {
    if (existsSync(filePath)) {
      return readFileSync(filePath, 'utf-8');
    }
  } catch {
    // File not readable
  }
  return null;
}

export function createAuditCommand(): Command {
  const audit = new Command('audit')
    .description(
      'Measure context overhead (tokens injected before first message)'
    )
    .option('--json', 'Output as JSON', false)
    .action(async (options) => {
      const projectRoot = process.cwd();
      const home = homedir();
      const entries: AuditEntry[] = [];

      // 1. Global CLAUDE.md
      const globalClaudeMd = readFileSafe(join(home, '.claude', 'CLAUDE.md'));
      if (globalClaudeMd) {
        entries.push({
          source: '~/.claude/CLAUDE.md',
          tokens: countTokens(globalClaudeMd),
          percent: 0,
        });
      }

      // 2. Project CLAUDE.md
      const projectClaudeMd = readFileSafe(join(projectRoot, 'CLAUDE.md'));
      if (projectClaudeMd) {
        entries.push({
          source: './CLAUDE.md',
          tokens: countTokens(projectClaudeMd),
          percent: 0,
        });
      }

      // 3. Auto memory (MEMORY.md)
      // Derive the project memory path from project root
      const projectSlug = projectRoot.replace(/\//g, '-');
      const memoryPath = join(
        home,
        '.claude',
        'projects',
        projectSlug,
        'memory',
        'MEMORY.md'
      );
      const memoryMd = readFileSafe(memoryPath);
      if (memoryMd) {
        entries.push({
          source: 'auto-memory/MEMORY.md',
          tokens: countTokens(memoryMd),
          percent: 0,
        });
      }

      // 4. Handoff file
      const handoffPath = join(projectRoot, '.stackmemory', 'handoff.md');
      const handoffMd = readFileSafe(handoffPath);
      if (handoffMd) {
        entries.push({
          source: '.stackmemory/handoff.md',
          tokens: countTokens(handoffMd),
          percent: 0,
        });
      }

      // 5. MCP tool schemas
      try {
        const { MCPToolDefinitions } =
          await import('../../integrations/mcp/tool-definitions.js');
        const defs = new MCPToolDefinitions();
        const allTools = defs.getAllToolDefinitions();
        const schemasJson = JSON.stringify(allTools);
        entries.push({
          source: 'MCP tool schemas',
          tokens: countTokens(schemasJson),
          percent: 0,
        });
      } catch {
        // MCP not available
      }

      // 6. Active context frames (hot stack)
      try {
        const dbPath = join(projectRoot, '.stackmemory', 'context.db');
        if (existsSync(dbPath)) {
          const { default: Database } = await import('better-sqlite3');
          const { FrameManager } = await import('../../core/context/index.js');
          const db = new Database(dbPath);
          const fm = new FrameManager(db, 'cli-project');
          const hotStack = fm.getHotStackContext();
          if (hotStack) {
            entries.push({
              source: 'Active frames (hot stack)',
              tokens: countTokens(hotStack),
              percent: 0,
            });
          }
          db.close();
        }
      } catch {
        // DB not available
      }

      // Calculate totals and percentages
      const totalTokens = entries.reduce((sum, e) => sum + e.tokens, 0);
      for (const entry of entries) {
        entry.percent =
          totalTokens > 0
            ? Math.round((entry.tokens / totalTokens) * 1000) / 10
            : 0;
      }

      if (options.json) {
        console.log(JSON.stringify({ entries, totalTokens }, null, 2));
        return;
      }

      // Table output
      console.log('\nContext Overhead Audit');
      console.log('─'.repeat(60));
      console.log(
        `${'Source'.padEnd(32)} ${'Tokens'.padStart(8)} ${'%'.padStart(7)}`
      );
      console.log('─'.repeat(60));

      for (const entry of entries) {
        console.log(
          `${entry.source.padEnd(32)} ${String(entry.tokens).padStart(8)} ${(entry.percent + '%').padStart(7)}`
        );
      }

      console.log('─'.repeat(60));
      console.log(
        `${'TOTAL'.padEnd(32)} ${String(totalTokens).padStart(8)} ${'100%'.padStart(7)}`
      );
      console.log('');
    });

  return audit;
}
