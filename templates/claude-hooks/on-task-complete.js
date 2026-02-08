#!/usr/bin/env node

/**
 * On-task-complete hook for StackMemory
 * Triggers when a task is marked as done in Claude Code.
 *
 * Actions:
 * 1. Auto-updates PROMPT_PLAN.md checkboxes (fuzzy match on task keywords)
 * 2. Syncs Linear tasks (if STA-* identifier present)
 * 3. Logs to ~/.stackmemory/logs/hook-errors.log on failure (non-blocking)
 */

const fs = require('fs');
const path = require('path');

async function onTaskComplete() {
  try {
    const input = JSON.parse(fs.readFileSync(0, 'utf-8'));

    // Sync Linear if STA task
    if (input.task && input.task.includes('STA-')) {
      try {
        const syncScript = path.join(
          process.cwd(),
          'scripts',
          'sync-linear-graphql.js'
        );
        if (fs.existsSync(syncScript)) {
          const { execSync } = require('child_process');
          execSync(`node "${syncScript}"`, {
            stdio: 'ignore',
            timeout: 10000,
          });
        }
      } catch (_e) {
        // Non-blocking
      }
    }

    // Auto-update PROMPT_PLAN checkboxes if spec exists
    const promptPlanPath = path.join(
      process.cwd(),
      'docs',
      'specs',
      'PROMPT_PLAN.md'
    );
    if (fs.existsSync(promptPlanPath) && input.task) {
      try {
        const content = fs.readFileSync(promptPlanPath, 'utf-8');
        const taskWords = input.task.split(/\s+/).filter((w) => w.length > 3);
        const lines = content.split('\n');
        let updated = false;
        for (let i = 0; i < lines.length; i++) {
          if (
            lines[i].includes('- [ ]') &&
            taskWords.some((w) =>
              lines[i].toLowerCase().includes(w.toLowerCase())
            )
          ) {
            lines[i] = lines[i].replace('- [ ]', '- [x]');
            updated = true;
            break;
          }
        }
        if (updated) {
          fs.writeFileSync(promptPlanPath, lines.join('\n'));
        }
      } catch (_e) {
        // Silently fail
      }
    }
  } catch (error) {
    const logDir = path.join(
      process.env.HOME || '/tmp',
      '.stackmemory',
      'logs'
    );
    try {
      fs.mkdirSync(logDir, { recursive: true });
      fs.appendFileSync(
        path.join(logDir, 'hook-errors.log'),
        `[${new Date().toISOString()}] on-task-complete: ${error.message}\n`
      );
    } catch (_e) {
      // Last resort: silent
    }
  }
}

onTaskComplete();
