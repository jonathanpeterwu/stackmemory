#!/usr/bin/env node

/**
 * Claude Code Startup Hook - Initialize StackMemory tracing and spawn session daemon
 *
 * This hook runs when Claude Code starts and:
 * 1. Creates session trace record
 * 2. Initializes StackMemory if available
 * 3. Spawns a detached session daemon for periodic context saving
 */

import { execSync, spawn } from 'child_process';
import {
  existsSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  unlinkSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const stackmemoryDir = join(homedir(), '.stackmemory');
const traceDir = join(stackmemoryDir, 'traces');
const sessionsDir = join(stackmemoryDir, 'sessions');
const logsDir = join(stackmemoryDir, 'logs');
const sessionFile = join(traceDir, 'current-session.json');

// Ensure required directories exist
[traceDir, sessionsDir, logsDir].forEach((dir) => {
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
});

// Generate session ID
const sessionId = process.env.CLAUDE_INSTANCE_ID || `session-${Date.now()}`;
const pidFile = join(sessionsDir, `${sessionId}.pid`);

// Create session trace record
const sessionData = {
  sessionId,
  startTime: new Date().toISOString(),
  workingDirectory: process.cwd(),
  gitBranch: null,
  gitRepo: null,
};

// Get Git info if available
try {
  sessionData.gitRepo = execSync('git remote get-url origin', {
    encoding: 'utf8',
  }).trim();
  sessionData.gitBranch = execSync('git rev-parse --abbrev-ref HEAD', {
    encoding: 'utf8',
  }).trim();
} catch (err) {
  // Not in a git repo
}

writeFileSync(sessionFile, JSON.stringify(sessionData, null, 2));

/**
 * Check if daemon is already running for this session
 */
function isDaemonRunning() {
  if (!existsSync(pidFile)) {
    return false;
  }

  try {
    const pid = parseInt(readFileSync(pidFile, 'utf8').trim(), 10);
    // Check if process is running (signal 0 tests existence)
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // Process not running, remove stale PID file
    try {
      unlinkSync(pidFile);
    } catch {
      // Ignore cleanup errors
    }
    return false;
  }
}

/**
 * Spawn the session daemon as a detached process
 */
function spawnSessionDaemon() {
  // Check for daemon binary locations in order of preference
  const daemonPaths = [
    join(stackmemoryDir, 'bin', 'session-daemon'),
    join(stackmemoryDir, 'bin', 'session-daemon.js'),
    // Development path (when running from source)
    join(
      process.cwd(),
      'node_modules',
      '@stackmemoryai',
      'stackmemory',
      'dist',
      'daemon',
      'session-daemon.js'
    ),
    // Global npm install path
    join(
      homedir(),
      '.npm-global',
      'lib',
      'node_modules',
      '@stackmemoryai',
      'stackmemory',
      'dist',
      'daemon',
      'session-daemon.js'
    ),
  ];

  let daemonPath = null;
  for (const p of daemonPaths) {
    if (existsSync(p)) {
      daemonPath = p;
      break;
    }
  }

  if (!daemonPath) {
    // Log warning but don't fail startup
    const logEntry = {
      timestamp: new Date().toISOString(),
      level: 'WARN',
      sessionId,
      message: 'Session daemon binary not found, skipping daemon spawn',
      data: { searchedPaths: daemonPaths },
    };
    try {
      const logFile = join(logsDir, 'daemon.log');
      writeFileSync(logFile, JSON.stringify(logEntry) + '\n', { flag: 'a' });
    } catch {
      // Ignore log errors
    }
    return null;
  }

  // Spawn daemon with detached option so it continues after this script exits
  const daemonProcess = spawn(
    'node',
    [
      daemonPath,
      '--session-id',
      sessionId,
      '--save-interval',
      '900', // 15 minutes in seconds
      '--inactivity-timeout',
      '1800', // 30 minutes in seconds
    ],
    {
      detached: true,
      stdio: 'ignore',
      env: {
        ...process.env,
        STACKMEMORY_SESSION: sessionId,
      },
    }
  );

  // Unref so parent can exit independently
  daemonProcess.unref();

  // Log daemon spawn
  const logEntry = {
    timestamp: new Date().toISOString(),
    level: 'INFO',
    sessionId,
    message: 'Session daemon spawned',
    data: {
      daemonPid: daemonProcess.pid,
      daemonPath,
      saveInterval: 900,
      inactivityTimeout: 1800,
    },
  };
  try {
    const logFile = join(logsDir, 'daemon.log');
    writeFileSync(logFile, JSON.stringify(logEntry) + '\n', { flag: 'a' });
  } catch {
    // Ignore log errors
  }

  return daemonProcess.pid;
}

// Initialize StackMemory if available and spawn daemon
const stackmemoryPath = join(stackmemoryDir, 'bin', 'stackmemory');
if (existsSync(stackmemoryPath)) {
  try {
    // Try to init or get status (will fail silently if already initialized)
    spawn(stackmemoryPath, ['init'], { detached: true, stdio: 'ignore' });

    // Log session start
    spawn(
      stackmemoryPath,
      [
        'context',
        'save',
        '--json',
        JSON.stringify({
          message: 'Claude Code session started',
          metadata: sessionData,
        }),
      ],
      { detached: true, stdio: 'ignore' }
    );
  } catch (err) {
    // Silent fail
  }
}

// Spawn session daemon if not already running
let daemonPid = null;
if (!isDaemonRunning()) {
  daemonPid = spawnSessionDaemon();
}

// Output session info
const daemonStatus = daemonPid
  ? `Daemon spawned (PID: ${daemonPid})`
  : isDaemonRunning()
    ? 'Daemon already running'
    : 'Daemon not started';

console.log(`StackMemory tracing enabled - Session: ${sessionId}`);
console.log(`  Working directory: ${sessionData.workingDirectory}`);
if (sessionData.gitBranch) {
  console.log(`  Git branch: ${sessionData.gitBranch}`);
}
console.log(`  ${daemonStatus}`);
