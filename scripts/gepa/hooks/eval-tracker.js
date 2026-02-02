#!/usr/bin/env node
/**
 * GEPA Eval Tracker Hook
 *
 * Captures agent behavior during sessions for evaluation.
 * Install in ~/.claude/settings.json under hooks.
 */

import fs from 'fs';
import path from 'path';

const GEPA_DIR =
  process.env.GEPA_DIR || path.join(process.env.HOME, '.claude', 'gepa');
const RESULTS_DIR = path.join(GEPA_DIR, 'results');
const SESSIONS_DIR = path.join(RESULTS_DIR, 'sessions');

// Ensure directories exist
[RESULTS_DIR, SESSIONS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
});

/**
 * Session tracking state
 */
class SessionTracker {
  constructor() {
    this.sessionId = process.env.CLAUDE_SESSION_ID || `session-${Date.now()}`;
    this.variant = process.env.GEPA_VARIANT || 'baseline';
    this.generation = parseInt(process.env.GEPA_GENERATION || '0');

    this.data = {
      sessionId: this.sessionId,
      variant: this.variant,
      generation: this.generation,
      startTime: new Date().toISOString(),
      endTime: null,
      toolCalls: [],
      errors: [],
      userFeedback: [],
      tokenUsage: { input: 0, output: 0 },
      metrics: {},
    };
  }

  trackToolCall(tool, input, output, duration) {
    this.data.toolCalls.push({
      tool,
      input: this.sanitize(input),
      output: this.summarize(output),
      duration,
      timestamp: new Date().toISOString(),
      success: !output?.error,
    });
  }

  trackError(error, context) {
    this.data.errors.push({
      error: error.message || String(error),
      context,
      timestamp: new Date().toISOString(),
    });
  }

  trackFeedback(type, value) {
    this.data.userFeedback.push({
      type, // 'thumbs_up', 'thumbs_down', 'correction', 'retry'
      value,
      timestamp: new Date().toISOString(),
    });
  }

  trackTokens(input, output) {
    this.data.tokenUsage.input += input;
    this.data.tokenUsage.output += output;
  }

  sanitize(obj) {
    // Remove sensitive data
    if (typeof obj !== 'object') return obj;
    const sanitized = { ...obj };
    const sensitiveKeys = ['apiKey', 'token', 'password', 'secret', 'key'];
    for (const key of Object.keys(sanitized)) {
      if (sensitiveKeys.some((s) => key.toLowerCase().includes(s))) {
        sanitized[key] = '[REDACTED]';
      }
    }
    return sanitized;
  }

  summarize(output) {
    // Truncate long outputs
    const str = typeof output === 'string' ? output : JSON.stringify(output);
    return str.length > 1000 ? str.slice(0, 1000) + '...[truncated]' : str;
  }

  finalize() {
    this.data.endTime = new Date().toISOString();
    this.data.duration =
      new Date(this.data.endTime) - new Date(this.data.startTime);

    // Calculate basic metrics
    this.data.metrics = {
      totalToolCalls: this.data.toolCalls.length,
      successfulToolCalls: this.data.toolCalls.filter((t) => t.success).length,
      errorCount: this.data.errors.length,
      avgToolDuration:
        this.data.toolCalls.length > 0
          ? this.data.toolCalls.reduce((sum, t) => sum + (t.duration || 0), 0) /
            this.data.toolCalls.length
          : 0,
      positiveFeeback: this.data.userFeedback.filter(
        (f) => f.type === 'thumbs_up'
      ).length,
      negativeFeeback: this.data.userFeedback.filter(
        (f) => f.type === 'thumbs_down'
      ).length,
    };

    return this.data;
  }

  save() {
    const data = this.finalize();
    const filename = `${this.generation}-${this.variant}-${this.sessionId}.json`;
    const filepath = path.join(SESSIONS_DIR, filename);
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));

    // Also append to scores.jsonl for quick analysis
    const scoreLine = {
      sessionId: this.sessionId,
      variant: this.variant,
      generation: this.generation,
      metrics: data.metrics,
      timestamp: data.endTime,
    };
    fs.appendFileSync(
      path.join(RESULTS_DIR, 'scores.jsonl'),
      JSON.stringify(scoreLine) + '\n'
    );

    return filepath;
  }
}

// Global tracker instance
let tracker = null;

/**
 * Hook handlers
 */
export function onSessionStart(context) {
  tracker = new SessionTracker();
  console.error(
    `[GEPA] Tracking session: ${tracker.sessionId} (gen=${tracker.generation}, variant=${tracker.variant})`
  );
}

export function onToolCall(tool, input) {
  if (!tracker) return;
  tracker._currentTool = { tool, input, startTime: Date.now() };
}

export function onToolResult(tool, result) {
  if (!tracker || !tracker._currentTool) return;
  const duration = Date.now() - tracker._currentTool.startTime;
  tracker.trackToolCall(tool, tracker._currentTool.input, result, duration);
  tracker._currentTool = null;
}

export function onError(error, context) {
  if (!tracker) return;
  tracker.trackError(error, context);
}

export function onUserFeedback(type, value) {
  if (!tracker) return;
  tracker.trackFeedback(type, value);
}

export function onSessionEnd() {
  if (!tracker) return;
  const filepath = tracker.save();
  console.error(`[GEPA] Session data saved to: ${filepath}`);
  tracker = null;
}

// CLI interface for testing
if (process.argv[1] === import.meta.url.replace('file://', '')) {
  const command = process.argv[2];

  if (command === 'test') {
    onSessionStart({});
    onToolCall('Read', { file: '/test/file.ts' });
    onToolResult('Read', { content: 'test content...' });
    onToolCall('Edit', { file: '/test/file.ts', changes: '...' });
    onToolResult('Edit', { success: true });
    onUserFeedback('thumbs_up', 'good job');
    onSessionEnd();
    console.log('Test session recorded');
  }
}
