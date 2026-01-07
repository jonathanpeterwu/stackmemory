#!/usr/bin/env node

/**
 * Periodic ChromaDB context save
 * Runs every 15 minutes to save work progress
 */

import { ChromaDBContextSaver, TRIGGER_EVENTS } from './chromadb-save-hook.js';
import { exec } from 'child_process';
import { promisify } from 'util';
import fs from 'fs';
import path from 'path';

const execAsync = promisify(exec);

class PeriodicContextSaver {
  constructor() {
    // Dynamic interval: 1 minute if Claude session is active, 5 minutes otherwise
    this.activeInterval = 60 * 1000; // 1 minute for active sessions
    this.idleInterval = 5 * 60 * 1000; // 5 minutes when idle
    this.lastSaveFile = path.join(process.env.HOME, '.stackmemory', '.last-chromadb-save');
    this.claudeActivityFile = path.join(process.env.HOME, '.stackmemory', '.claude-activity');
  }

  async shouldSave() {
    try {
      if (!fs.existsSync(this.lastSaveFile)) {
        return true;
      }
      
      const lastSave = fs.readFileSync(this.lastSaveFile, 'utf-8');
      const lastSaveTime = new Date(lastSave).getTime();
      const now = Date.now();
      
      // Check if Claude is active
      const interval = this.isClaudeActive() ? this.activeInterval : this.idleInterval;
      
      return (now - lastSaveTime) >= interval;
    } catch {
      return true;
    }
  }

  isClaudeActive() {
    try {
      if (!fs.existsSync(this.claudeActivityFile)) {
        return false;
      }
      
      const lastActivity = fs.readFileSync(this.claudeActivityFile, 'utf-8');
      const lastActivityTime = new Date(lastActivity).getTime();
      const now = Date.now();
      
      // Consider Claude active if there was activity in the last 10 minutes
      return (now - lastActivityTime) < (10 * 60 * 1000);
    } catch {
      return false;
    }
  }

  markClaudeActivity() {
    try {
      const dir = path.dirname(this.claudeActivityFile);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(this.claudeActivityFile, new Date().toISOString());
    } catch {
      // Silent fail
    }
  }

  async updateLastSave() {
    const dir = path.dirname(this.lastSaveFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.lastSaveFile, new Date().toISOString());
  }

  async getActiveFiles() {
    try {
      // Get recently modified files
      const { stdout } = await execAsync(
        'find . -type f -name "*.ts" -o -name "*.js" -o -name "*.tsx" -o -name "*.jsx" | xargs ls -t | head -10',
        { cwd: process.cwd() }
      );
      
      return stdout.split('\n').filter(f => f).map(f => f.replace('./', ''));
    } catch {
      return [];
    }
  }

  async getCurrentWork() {
    const work = {
      activeFiles: await this.getActiveFiles(),
      gitStatus: '',
      currentBranch: '',
      uncommittedChanges: 0,
    };

    try {
      // Get git status
      const { stdout: status } = await execAsync('git status --short');
      work.gitStatus = status;
      work.uncommittedChanges = status.split('\n').filter(l => l.trim()).length;

      // Get current branch
      const { stdout: branch } = await execAsync('git branch --show-current');
      work.currentBranch = branch.trim();
    } catch {
      // Not a git repo or git error
    }

    return work;
  }

  async save() {
    // Mark Claude activity if this is being called from a hook
    if (process.env.CLAUDE_SESSION_ID) {
      this.markClaudeActivity();
    }

    if (!(await this.shouldSave())) {
      const interval = this.isClaudeActive() ? '1m' : '5m';
      console.log(`Skipping save - too recent (next in ${interval})`);
      return;
    }

    const saver = new ChromaDBContextSaver();
    const work = await this.getCurrentWork();
    const isActive = this.isClaudeActive();

    await saver.saveContext(TRIGGER_EVENTS.PERIODIC_SAVE, {
      interval: isActive ? '1m' : '5m',
      activeFiles: work.activeFiles,
      branch: work.currentBranch,
      uncommittedChanges: work.uncommittedChanges,
      claude_active: isActive,
      summary: `Working on ${work.activeFiles.length} files, ${work.uncommittedChanges} uncommitted changes`,
    });

    await this.updateLastSave();
    const intervalText = isActive ? '1 minute (active session)' : '5 minutes (idle)';
    console.log(`✅ Periodic context saved at ${new Date().toISOString()} (next in ${intervalText})`);
  }
}

// Main execution
async function main() {
  const saver = new PeriodicContextSaver();
  await saver.save();
}

// Export for use in other scripts
export { PeriodicContextSaver };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}