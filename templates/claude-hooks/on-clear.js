#!/usr/bin/env node

/**
 * Claude Code Clear Hook - Save context before clearing
 */

import { execSync, spawn } from 'child_process';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const traceDir = join(homedir(), '.stackmemory', 'traces');
const sessionFile = join(traceDir, 'current-session.json');

let sessionData = null;
if (existsSync(sessionFile)) {
  try {
    sessionData = JSON.parse(readFileSync(sessionFile, 'utf8'));
  } catch (err) {
    // Ignore parse errors
  }
}

// Log session clear
const clearData = {
  action: 'session_clear',
  timestamp: new Date().toISOString(),
  sessionId: sessionData?.sessionId || 'unknown',
  workingDirectory: process.cwd(),
  clearReason: process.env.CLAUDE_CLEAR_REASON || 'user_initiated'
};

// Save to StackMemory if available
const stackmemoryPath = join(homedir(), '.stackmemory', 'bin', 'stackmemory');
if (existsSync(stackmemoryPath)) {
  try {
    spawn(stackmemoryPath, ['context', 'save', '--json', JSON.stringify({
      message: 'Claude Code session cleared - context preserved',
      metadata: clearData
    })], { detached: true, stdio: 'ignore' });
  } catch (err) {
    // Silent fail
  }
}

// Write clear log
const clearLogFile = join(traceDir, `clear-${new Date().toISOString().split('T')[0]}.jsonl`);
const logEntry = JSON.stringify(clearData) + '\n';

try {
  require('fs').appendFileSync(clearLogFile, logEntry);
} catch (err) {
  // Silent fail
}

console.log('📚 Context saved before clear');