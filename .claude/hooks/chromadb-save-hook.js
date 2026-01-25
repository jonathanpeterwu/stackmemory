#!/usr/bin/env node

/**
 * ChromaDB Context Save Hook for Claude
 * Triggers on various events to preserve context automatically
 *
 * Note: This hook only activates if ChromaDB is enabled in storage config.
 * Run "stackmemory init --chromadb" to enable ChromaDB support.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { exec } from 'child_process';
import { promisify } from 'util';
import dotenv from 'dotenv';

const execAsync = promisify(exec);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Load environment variables from .env file
const projectRoot = path.resolve(__dirname, '../..');
dotenv.config({ path: path.join(projectRoot, '.env') });

// Hook trigger events
const TRIGGER_EVENTS = {
  TASK_COMPLETE: 'task_complete',
  CODE_CHANGE: 'code_change',
  GIT_COMMIT: 'git_commit',
  TEST_RUN: 'test_run',
  BUILD_COMPLETE: 'build_complete',
  ERROR_RESOLVED: 'error_resolved',
  DECISION_MADE: 'decision_made',
  PERIODIC_SAVE: 'periodic_save',
  SESSION_END: 'session_end',
};

class ChromaDBContextSaver {
  constructor() {
    this.apiKey = process.env.CHROMADB_API_KEY;
    this.apiUrl = process.env.CHROMADB_API_URL || 'http://localhost:8000';
    this.userId = process.env.USER || 'default';
    this.sessionId = process.env.CLAUDE_SESSION_ID || this.generateSessionId();
    this.projectRoot = path.resolve(__dirname, '../..');
  }

  generateSessionId() {
    return `claude_${Date.now()}_${Math.random().toString(36).substring(7)}`;
  }

  async saveContext(event, data = {}) {
    if (!this.apiKey) {
      console.log('ChromaDB not configured, skipping context save');
      return;
    }

    try {
      const adapter = new ChromaDBAdapter({
        apiKey: this.apiKey,
        apiUrl: this.apiUrl,
        collectionName: 'claude_context',
        userId: this.userId,
        teamId: process.env.TEAM_ID,
      });

      await adapter.initialize();

      // Prepare context based on event type
      const context = await this.prepareContext(event, data);

      // Save to ChromaDB
      const result = await adapter.store(context);

      console.log(`✅ Context saved: ${event} at ${new Date().toISOString()}`);

      // Log to file for debugging
      const logFile = path.join(
        process.env.HOME,
        '.stackmemory',
        'logs',
        'chromadb-saves.log'
      );
      fs.appendFileSync(
        logFile,
        `[${new Date().toISOString()}] ${event}: ${JSON.stringify(result)}\n`
      );

      return result;
    } catch (error) {
      console.error('Failed to save context:', error.message);
      return null;
    }
  }

  async prepareContext(event, data) {
    const context = {
      id: `${this.sessionId}_${Date.now()}`,
      type: event,
      timestamp: new Date().toISOString(),
      session_id: this.sessionId,
      user_id: this.userId,
      project: path.basename(this.projectRoot),
      metadata: {},
    };

    switch (event) {
      case TRIGGER_EVENTS.TASK_COMPLETE:
        context.content = `Task completed: ${data.task || 'Unknown task'}`;
        context.metadata = {
          task_id: data.taskId || '',
          duration: data.duration || 0,
          files_changed: JSON.stringify(data.filesChanged || []),
        };
        break;

      case TRIGGER_EVENTS.CODE_CHANGE:
        // Get git diff for context
        const { stdout: diff } = await execAsync('git diff --cached --stat', {
          cwd: this.projectRoot,
        });
        context.content = `Code changes:\n${diff}`;
        context.metadata = {
          files: JSON.stringify(data.files || []),
          lines_added: data.linesAdded || 0,
          lines_removed: data.linesRemoved || 0,
        };
        break;

      case TRIGGER_EVENTS.GIT_COMMIT:
        const { stdout: lastCommit } = await execAsync('git log -1 --oneline', {
          cwd: this.projectRoot,
        });
        context.content = `Git commit: ${lastCommit}`;
        context.metadata = {
          commit_hash: data.commitHash || '',
          branch: data.branch || '',
          message: data.message || '',
        };
        break;

      case TRIGGER_EVENTS.TEST_RUN:
        context.content = `Test run: ${data.passed ? 'PASSED' : 'FAILED'}`;
        context.metadata = {
          total_tests: data.total || 0,
          passed: data.passed || 0,
          failed: data.failed || 0,
          coverage: data.coverage || 0,
        };
        break;

      case TRIGGER_EVENTS.BUILD_COMPLETE:
        context.content = `Build ${data.success ? 'succeeded' : 'failed'}`;
        context.metadata = {
          build_time: data.duration || 0,
          warnings: data.warnings || 0,
          errors: data.errors || 0,
        };
        break;

      case TRIGGER_EVENTS.ERROR_RESOLVED:
        context.content = `Resolved error: ${data.error}`;
        context.metadata = {
          error_type: data.errorType || '',
          solution: data.solution || '',
          files_fixed: JSON.stringify(data.files || []),
        };
        break;

      case TRIGGER_EVENTS.DECISION_MADE:
        context.content = `Decision: ${data.decision}`;
        context.metadata = {
          category: data.category || '',
          alternatives: JSON.stringify(data.alternatives || []),
          reasoning: data.reasoning || '',
        };
        break;

      case TRIGGER_EVENTS.PERIODIC_SAVE:
        // Get current work context
        const { stdout: status } = await execAsync('git status --short', {
          cwd: this.projectRoot,
        });
        context.content = `Periodic checkpoint:\n${status || 'No changes'}`;
        context.metadata = {
          interval: data.interval || '15m',
          active_files: JSON.stringify(data.activeFiles || []),
        };
        break;

      case TRIGGER_EVENTS.SESSION_END:
        context.content = `Session ended: ${data.summary || 'No summary'}`;
        context.metadata = {
          duration: data.duration || 0,
          tasks_completed: data.tasksCompleted || 0,
          next_steps: data.nextSteps || '',
        };
        break;

      default:
        context.content = JSON.stringify(data);
    }

    return context;
  }

  async loadRecentContext(hours = 24) {
    if (!this.apiKey) {
      console.log('ChromaDB not configured');
      return [];
    }

    try {
      const adapter = new ChromaDBAdapter({
        apiKey: this.apiKey,
        apiUrl: this.apiUrl,
        collectionName: 'claude_context',
        userId: this.userId,
        teamId: process.env.TEAM_ID,
      });

      await adapter.initialize();

      const since = new Date(Date.now() - hours * 60 * 60 * 1000);
      const results = await adapter.search({
        query: `project:${path.basename(this.projectRoot)}`,
        limit: 50,
        filter: {
          timestamp: { $gte: since.toISOString() },
        },
      });

      return results;
    } catch (error) {
      console.error('Failed to load context:', error.message);
      return [];
    }
  }
}

// Main execution
async function main() {
  const saver = new ChromaDBContextSaver();

  // Parse input from Claude if provided
  let input = {};
  try {
    const stdinBuffer = fs.readFileSync(0, 'utf-8');
    if (stdinBuffer) {
      input = JSON.parse(stdinBuffer);
    }
  } catch {
    // No input or invalid JSON
  }

  // Determine event type from input
  const event = input.event || TRIGGER_EVENTS.PERIODIC_SAVE;
  const data = input.data || {};

  // Save context
  await saver.saveContext(event, data);
}

// Export for use in other scripts
export { ChromaDBContextSaver, TRIGGER_EVENTS };

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
