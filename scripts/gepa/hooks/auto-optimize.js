#!/usr/bin/env node
/**
 * GEPA Auto-Optimizer
 *
 * Watches CLAUDE.md for changes and automatically runs optimization.
 * Shows before/after comparison with metrics.
 *
 * Usage:
 *   node auto-optimize.js watch [path]     # Watch and auto-optimize
 *   node auto-optimize.js compare [a] [b]  # Compare two versions
 *   node auto-optimize.js report           # Show optimization report
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync, spawn } from 'child_process';
import crypto from 'crypto';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const GEPA_DIR = path.join(__dirname, '..');
const GENERATIONS_DIR = path.join(GEPA_DIR, 'generations');
const RESULTS_DIR = path.join(GEPA_DIR, 'results');

// ANSI colors
const c = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  bgGreen: '\x1b[42m',
  bgRed: '\x1b[41m',
  bgYellow: '\x1b[43m',
};

/**
 * Calculate content hash for change detection
 */
function hashContent(content) {
  return crypto.createHash('md5').update(content).digest('hex').slice(0, 8);
}

/**
 * Analyze markdown structure
 */
function analyzeMarkdown(content) {
  const lines = content.split('\n');

  return {
    totalLines: lines.length,
    totalChars: content.length,
    estimatedTokens: Math.ceil(content.length / 4),

    // Structure
    h1Count: (content.match(/^# /gm) || []).length,
    h2Count: (content.match(/^## /gm) || []).length,
    h3Count: (content.match(/^### /gm) || []).length,

    // Content types
    codeBlocks: (content.match(/```/g) || []).length / 2,
    bulletPoints: (content.match(/^[-*] /gm) || []).length,
    numberedLists: (content.match(/^\d+\. /gm) || []).length,

    // Keywords (instruction density)
    mustCount: (content.match(/\bMUST\b/gi) || []).length,
    neverCount: (content.match(/\bNEVER\b/gi) || []).length,
    alwaysCount: (content.match(/\bALWAYS\b/gi) || []).length,
    importantCount: (content.match(/\bIMPORTANT\b/gi) || []).length,

    // Sections
    sections: [...content.matchAll(/^##+ (.+)$/gm)].map((m) => m[1]),
  };
}

/**
 * Format comparison table
 */
function formatComparison(before, after, label = 'Metric') {
  const metrics = [
    ['Lines', before.totalLines, after.totalLines],
    ['Characters', before.totalChars, after.totalChars],
    ['Est. Tokens', before.estimatedTokens, after.estimatedTokens],
    ['H2 Sections', before.h2Count, after.h2Count],
    ['Code Blocks', before.codeBlocks, after.codeBlocks],
    ['Bullet Points', before.bulletPoints, after.bulletPoints],
    ['MUST rules', before.mustCount, after.mustCount],
    ['NEVER rules', before.neverCount, after.neverCount],
    ['ALWAYS rules', before.alwaysCount, after.alwaysCount],
  ];

  console.log(
    `\n${c.bold}${c.cyan}╔════════════════════════════════════════════════════════════╗${c.reset}`
  );
  console.log(
    `${c.bold}${c.cyan}║${c.reset}  ${c.bold}BEFORE / AFTER COMPARISON${c.reset}                                  ${c.cyan}║${c.reset}`
  );
  console.log(
    `${c.cyan}╠════════════════════════════════════════════════════════════╣${c.reset}`
  );
  console.log(
    `${c.cyan}║${c.reset}  ${c.dim}Metric${c.reset}              ${c.dim}Before${c.reset}      ${c.dim}After${c.reset}       ${c.dim}Change${c.reset}      ${c.cyan}║${c.reset}`
  );
  console.log(
    `${c.cyan}╠════════════════════════════════════════════════════════════╣${c.reset}`
  );

  metrics.forEach(([name, b, a]) => {
    const diff = a - b;
    const pct = b > 0 ? ((diff / b) * 100).toFixed(0) : '∞';
    const sign = diff > 0 ? '+' : '';
    const color = diff > 0 ? c.green : diff < 0 ? c.red : c.dim;

    const nameStr = name.padEnd(18);
    const beforeStr = String(b).padStart(8);
    const afterStr = String(a).padStart(8);
    const changeStr = `${sign}${diff} (${sign}${pct}%)`.padStart(12);

    console.log(
      `${c.cyan}║${c.reset}  ${nameStr}  ${beforeStr}  ${c.bold}${afterStr}${c.reset}  ${color}${changeStr}${c.reset}  ${c.cyan}║${c.reset}`
    );
  });

  console.log(
    `${c.cyan}╚════════════════════════════════════════════════════════════╝${c.reset}`
  );
}

/**
 * Show section diff
 */
function showSectionDiff(before, after) {
  const beforeSections = new Set(before.sections);
  const afterSections = new Set(after.sections);

  const added = after.sections.filter((s) => !beforeSections.has(s));
  const removed = before.sections.filter((s) => !afterSections.has(s));
  const kept = before.sections.filter((s) => afterSections.has(s));

  if (added.length || removed.length) {
    console.log(`\n${c.bold}Section Changes:${c.reset}`);

    if (removed.length) {
      console.log(`${c.red}  Removed:${c.reset}`);
      removed.forEach((s) => console.log(`${c.red}    - ${s}${c.reset}`));
    }

    if (added.length) {
      console.log(`${c.green}  Added:${c.reset}`);
      added.forEach((s) => console.log(`${c.green}    + ${s}${c.reset}`));
    }
  }
}

/**
 * Show inline diff (simplified)
 */
function showInlineDiff(beforeContent, afterContent) {
  const beforeLines = beforeContent.split('\n');
  const afterLines = afterContent.split('\n');

  console.log(`\n${c.bold}Key Changes (first 20 diffs):${c.reset}`);
  console.log(c.dim + '─'.repeat(60) + c.reset);

  let diffCount = 0;
  const maxDiffs = 20;

  // Simple line-by-line diff
  const maxLen = Math.max(beforeLines.length, afterLines.length);

  for (let i = 0; i < maxLen && diffCount < maxDiffs; i++) {
    const b = beforeLines[i] || '';
    const a = afterLines[i] || '';

    if (b !== a) {
      if (b && !a) {
        console.log(
          `${c.red}- L${i + 1}: ${b.slice(0, 70)}${b.length > 70 ? '...' : ''}${c.reset}`
        );
      } else if (!b && a) {
        console.log(
          `${c.green}+ L${i + 1}: ${a.slice(0, 70)}${a.length > 70 ? '...' : ''}${c.reset}`
        );
      } else if (b.trim() !== a.trim()) {
        console.log(`${c.yellow}~ L${i + 1}:${c.reset}`);
        console.log(
          `${c.red}  - ${b.slice(0, 60)}${b.length > 60 ? '...' : ''}${c.reset}`
        );
        console.log(
          `${c.green}  + ${a.slice(0, 60)}${a.length > 60 ? '...' : ''}${c.reset}`
        );
      }
      diffCount++;
    }
  }

  if (diffCount >= maxDiffs) {
    console.log(`${c.dim}  ... and more changes${c.reset}`);
  }
}

/**
 * Compare two versions
 */
function compare(pathA, pathB) {
  const contentA = fs.readFileSync(pathA, 'utf8');
  const contentB = fs.readFileSync(pathB, 'utf8');

  const analysisA = analyzeMarkdown(contentA);
  const analysisB = analyzeMarkdown(contentB);

  console.log(`\n${c.bold}${c.magenta}GEPA Comparison Report${c.reset}`);
  console.log(`${c.dim}Before: ${pathA}${c.reset}`);
  console.log(`${c.dim}After:  ${pathB}${c.reset}`);

  formatComparison(analysisA, analysisB);
  showSectionDiff(analysisA, analysisB);
  showInlineDiff(contentA, contentB);

  // Score summary
  const tokenChange = analysisB.estimatedTokens - analysisA.estimatedTokens;
  const ruleChange =
    analysisB.mustCount +
    analysisB.neverCount +
    analysisB.alwaysCount -
    (analysisA.mustCount + analysisA.neverCount + analysisA.alwaysCount);

  console.log(`\n${c.bold}Summary:${c.reset}`);
  console.log(
    `  Token budget: ${tokenChange >= 0 ? c.yellow + '+' : c.green}${tokenChange}${c.reset} tokens`
  );
  console.log(
    `  Rule density: ${ruleChange >= 0 ? c.green + '+' : c.red}${ruleChange}${c.reset} explicit rules`
  );
}

/**
 * Watch for changes and auto-optimize
 */
async function watch(targetPath) {
  const claudeMdPath = targetPath || path.join(process.cwd(), 'CLAUDE.md');

  if (!fs.existsSync(claudeMdPath)) {
    console.error(`${c.red}Error: ${claudeMdPath} not found${c.reset}`);
    process.exit(1);
  }

  let lastHash = hashContent(fs.readFileSync(claudeMdPath, 'utf8'));
  let isOptimizing = false;
  let optimizeQueue = false;

  console.log(`${c.bold}${c.cyan}GEPA Auto-Optimizer${c.reset}`);
  console.log(`${c.dim}Watching: ${claudeMdPath}${c.reset}`);
  console.log(`${c.dim}Press Ctrl+C to stop${c.reset}\n`);

  // Initial analysis
  const initial = analyzeMarkdown(fs.readFileSync(claudeMdPath, 'utf8'));
  console.log(`${c.bold}Current state:${c.reset}`);
  console.log(
    `  ${initial.totalLines} lines, ~${initial.estimatedTokens} tokens`
  );
  console.log(
    `  ${initial.h2Count} sections, ${initial.mustCount + initial.neverCount + initial.alwaysCount} explicit rules\n`
  );

  // Watch loop
  const checkInterval = setInterval(async () => {
    try {
      const content = fs.readFileSync(claudeMdPath, 'utf8');
      const currentHash = hashContent(content);

      if (currentHash !== lastHash) {
        console.log(
          `\n${c.yellow}⚡ Change detected!${c.reset} (${new Date().toLocaleTimeString()})`
        );

        // Save before state
        const beforePath = path.join(GEPA_DIR, '.before-optimize.md');
        const statePath = path.join(GEPA_DIR, 'state.json');

        if (fs.existsSync(statePath)) {
          const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
          const currentBest = path.join(
            GENERATIONS_DIR,
            `gen-${String(state.currentGeneration).padStart(3, '0')}`,
            `${state.bestVariant}.md`
          );
          if (fs.existsSync(currentBest)) {
            fs.copyFileSync(currentBest, beforePath);
          }
        }

        lastHash = currentHash;

        if (isOptimizing) {
          optimizeQueue = true;
          console.log(
            `${c.dim}  Optimization in progress, queued for next run${c.reset}`
          );
          return;
        }

        isOptimizing = true;

        // Run quick optimization (1 generation)
        console.log(`${c.cyan}  Running GEPA optimization...${c.reset}`);

        try {
          // Re-init with new content
          execSync(
            `node ${path.join(GEPA_DIR, 'optimize.js')} init ${claudeMdPath}`,
            {
              stdio: 'pipe',
            }
          );

          // Quick mutate + score
          execSync(`node ${path.join(GEPA_DIR, 'optimize.js')} mutate`, {
            stdio: 'pipe',
          });

          execSync(`node ${path.join(GEPA_DIR, 'optimize.js')} score`, {
            stdio: 'pipe',
          });

          // Show comparison
          const afterPath = path.join(GENERATIONS_DIR, 'current');
          if (fs.existsSync(beforePath) && fs.existsSync(afterPath)) {
            const resolvedAfter = fs.realpathSync(afterPath);
            compare(beforePath, resolvedAfter);
          }

          // Load state for summary
          const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));
          console.log(`\n${c.green}✓ Optimization complete${c.reset}`);
          console.log(
            `  Best variant: ${c.bold}${state.bestVariant}${c.reset}`
          );
          console.log(
            `  Score: ${c.bold}${(state.bestScore * 100).toFixed(1)}%${c.reset}`
          );
          console.log(
            `\n${c.dim}  To apply: cp ${path.join(GENERATIONS_DIR, 'current')} ${claudeMdPath}${c.reset}`
          );
        } catch (e) {
          console.error(
            `${c.red}  Optimization failed: ${e.message}${c.reset}`
          );
        }

        isOptimizing = false;

        // Process queue
        if (optimizeQueue) {
          optimizeQueue = false;
          lastHash = ''; // Force re-check
        }
      }
    } catch (e) {
      // File might be temporarily unavailable during write
    }
  }, 2000); // Check every 2 seconds

  // Handle shutdown
  process.on('SIGINT', () => {
    clearInterval(checkInterval);
    console.log(`\n${c.dim}Watcher stopped${c.reset}`);
    process.exit(0);
  });
}

/**
 * Generate optimization report
 */
function report() {
  const statePath = path.join(GEPA_DIR, 'state.json');

  if (!fs.existsSync(statePath)) {
    console.error(`${c.red}No GEPA state found. Run 'init' first.${c.reset}`);
    return;
  }

  const state = JSON.parse(fs.readFileSync(statePath, 'utf8'));

  console.log(
    `\n${c.bold}${c.magenta}═══════════════════════════════════════════════════════════${c.reset}`
  );
  console.log(
    `${c.bold}${c.magenta}                    GEPA OPTIMIZATION REPORT                ${c.reset}`
  );
  console.log(
    `${c.bold}${c.magenta}═══════════════════════════════════════════════════════════${c.reset}\n`
  );

  console.log(`${c.bold}Current State:${c.reset}`);
  console.log(`  Generation:    ${c.cyan}${state.currentGeneration}${c.reset}`);
  console.log(`  Best Variant:  ${c.green}${state.bestVariant}${c.reset}`);
  console.log(
    `  Best Score:    ${c.bold}${(state.bestScore * 100).toFixed(1)}%${c.reset}`
  );
  console.log(`  Target File:   ${c.dim}${state.targetPath}${c.reset}`);

  // History summary
  if (state.history && state.history.length > 0) {
    console.log(`\n${c.bold}Evolution History:${c.reset}`);

    const scoreHistory = state.history
      .filter((h) => h.action === 'select' && h.scores)
      .map((h) => ({
        gen: h.generation,
        best: h.best,
        score: h.scores.find((s) => s.variant === h.best)?.score || 0,
      }));

    if (scoreHistory.length > 0) {
      // ASCII chart
      const maxScore = Math.max(...scoreHistory.map((h) => h.score));
      const chartWidth = 40;

      scoreHistory.forEach((h) => {
        const barLen = Math.round((h.score / maxScore) * chartWidth);
        const bar = '█'.repeat(barLen) + '░'.repeat(chartWidth - barLen);
        const pct = (h.score * 100).toFixed(0).padStart(3);
        console.log(
          `  Gen ${String(h.gen).padStart(2)}: ${c.green}${bar}${c.reset} ${pct}% (${h.best})`
        );
      });

      // Improvement
      if (scoreHistory.length > 1) {
        const first = scoreHistory[0].score;
        const last = scoreHistory[scoreHistory.length - 1].score;
        const improvement = (((last - first) / first) * 100).toFixed(1);
        console.log(
          `\n  ${c.bold}Total improvement: ${improvement >= 0 ? c.green + '+' : c.red}${improvement}%${c.reset}`
        );
      }
    }
  }

  // Show before/after if available
  const beforePath = path.join(GEPA_DIR, '.before-optimize.md');
  const currentPath = path.join(GENERATIONS_DIR, 'current');

  if (fs.existsSync(beforePath) && fs.existsSync(currentPath)) {
    console.log(`\n${c.bold}Latest Optimization:${c.reset}`);
    compare(beforePath, fs.realpathSync(currentPath));
  }

  console.log(
    `\n${c.dim}Run 'node auto-optimize.js watch' to auto-optimize on changes${c.reset}\n`
  );
}

// CLI
const command = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];

switch (command) {
  case 'watch':
    watch(arg1);
    break;
  case 'compare':
    if (!arg1 || !arg2) {
      console.error('Usage: compare <before.md> <after.md>');
      process.exit(1);
    }
    compare(arg1, arg2);
    break;
  case 'report':
    report();
    break;
  default:
    console.log(`
${c.bold}GEPA Auto-Optimizer${c.reset}

Usage:
  node auto-optimize.js watch [path]     Watch CLAUDE.md and auto-optimize
  node auto-optimize.js compare <a> <b>  Compare two versions
  node auto-optimize.js report           Show optimization report

Examples:
  node auto-optimize.js watch ./CLAUDE.md
  node auto-optimize.js compare gen-000/baseline.md gen-001/variant-a.md
  node auto-optimize.js report
`);
}

export { compare, analyzeMarkdown, watch, report };
