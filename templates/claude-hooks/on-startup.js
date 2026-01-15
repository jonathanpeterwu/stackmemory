#!/usr/bin/env node

/**
 * Claude Code Startup Hook - Initialize StackMemory tracing
 */

import { execSync, spawn } from 'child_process';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const traceDir = join(homedir(), '.stackmemory', 'traces');
const sessionFile = join(traceDir, 'current-session.json');

// Ensure trace directory exists
if (!existsSync(traceDir)) {
  mkdirSync(traceDir, { recursive: true });
}

// Create session trace record
const sessionData = {
  sessionId: process.env.CLAUDE_INSTANCE_ID || `session-${Date.now()}`,
  startTime: new Date().toISOString(),
  workingDirectory: process.cwd(),
  gitBranch: null,
  gitRepo: null
};

// Get Git info if available
try {
  sessionData.gitRepo = execSync('git remote get-url origin', { encoding: 'utf8' }).trim();
  sessionData.gitBranch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
} catch (err) {
  // Not in a git repo
}

writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));

// Initialize StackMemory if available and not already initialized
const stackmemoryPath = join(homedir(), '.stackmemory', 'bin', 'stackmemory');
if (existsSync(stackmemoryPath)) {
  try {
    // Try to init or get status (will fail silently if already initialized)
    spawn(stackmemoryPath, ['init'], { detached: true, stdio: 'ignore' });
    
    // Log session start
    spawn(stackmemoryPath, ['context', 'save', '--json', JSON.stringify({
      message: 'Claude Code session started',
      metadata: sessionData
    })], { detached: true, stdio: 'ignore' });
  } catch (err) {
    // Silent fail
  }
}

console.log(`🔍 StackMemory tracing enabled - Session: ${sessionData.sessionId}`);