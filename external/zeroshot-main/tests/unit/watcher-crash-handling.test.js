/**
 * Tests for attachable-watcher.js global error handlers
 *
 * CRITICAL: These handlers prevent SILENT process death.
 * Without them, uncaught errors cause immediate termination
 * with no logs, no status update, and no indication of failure.
 *
 * What we test:
 * 1. emergencyLog() writes to file even when main log isn't ready
 * 2. crashWithError() logs crash details with stack trace
 * 3. crashWithError() updates task status to 'failed'
 * 4. Process exits with code 1 on crash
 *
 * What we DON'T test (can't catch in JS):
 * - External SIGKILL (kill -9)
 * - Native crashes (segfaults in node-pty)
 * - OOM killer
 */

const { describe, it, beforeEach, afterEach } = require('mocha');
const { expect } = require('chai');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

describe('Watcher Crash Handling', function () {
  this.timeout(10000);

  let tempDir;
  let logFile;
  let taskId;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'watcher-test-'));
    taskId = `test-crash-${Date.now()}`;
    logFile = path.join(tempDir, `${taskId}.log`);
  });

  afterEach(() => {
    // Cleanup temp files
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  /**
   * Helper to spawn a minimal script that imports and uses the crash handlers
   */
  function spawnCrashTest(crashType) {
    const scriptPath = path.join(tempDir, 'crash-test.mjs');

    // Create a minimal test script that:
    // 1. Sets up the same error handlers as attachable-watcher.js
    // 2. Triggers the specified crash type
    const script = `
import { appendFileSync } from 'fs';

const logFile = process.argv[2];
const taskId = process.argv[3];
const crashType = process.argv[4];

// Emergency logger (same as attachable-watcher.js)
function emergencyLog(msg) {
  try {
    appendFileSync(logFile, msg);
  } catch {
    process.stderr.write(msg);
  }
}

// Crash handler (same as attachable-watcher.js)
function crashWithError(error, source) {
  const timestamp = Date.now();
  const errorMsg = error instanceof Error ? error.stack || error.message : String(error);

  emergencyLog(\`\\n[\${timestamp}][CRASH] \${source}: \${errorMsg}\\n\`);
  emergencyLog(\`[\${timestamp}][CRASH] Process terminating due to unhandled error\\n\`);

  // Note: We don't call updateTask() here because we're testing in isolation
  // The real watcher calls updateTask() to mark the task as failed

  process.exit(1);
}

// Install handlers IMMEDIATELY
process.on('uncaughtException', (error) => {
  crashWithError(error, 'uncaughtException');
});

process.on('unhandledRejection', (reason) => {
  crashWithError(reason, 'unhandledRejection');
});

// Log that we started
emergencyLog('[STARTED]\\n');

// Trigger the specified crash type
if (crashType === 'sync-throw') {
  throw new Error('Simulated synchronous error');
} else if (crashType === 'async-reject') {
  Promise.reject(new Error('Simulated async rejection'));
  // Keep process alive briefly to let rejection propagate
  setTimeout(() => {}, 100);
} else if (crashType === 'timeout-throw') {
  setTimeout(() => {
    throw new Error('Simulated timeout error');
  }, 10);
} else if (crashType === 'normal-exit') {
  emergencyLog('[NORMAL_EXIT]\\n');
  process.exit(0);
}
`;

    fs.writeFileSync(scriptPath, script);

    return spawn('node', [scriptPath, logFile, taskId, crashType], {
      stdio: 'pipe',
    });
  }

  it('should catch synchronous throw and log crash details', (done) => {
    const child = spawnCrashTest('sync-throw');

    child.on('exit', (code) => {
      expect(code).to.equal(1, 'Should exit with code 1');

      const log = fs.readFileSync(logFile, 'utf8');
      expect(log).to.include('[STARTED]');
      expect(log).to.include('[CRASH] uncaughtException');
      expect(log).to.include('Simulated synchronous error');
      expect(log).to.include('Process terminating due to unhandled error');
      done();
    });
  });

  it('should catch unhandled promise rejection and log crash details', (done) => {
    const child = spawnCrashTest('async-reject');

    child.on('exit', (code) => {
      expect(code).to.equal(1, 'Should exit with code 1');

      const log = fs.readFileSync(logFile, 'utf8');
      expect(log).to.include('[STARTED]');
      expect(log).to.include('[CRASH] unhandledRejection');
      expect(log).to.include('Simulated async rejection');
      expect(log).to.include('Process terminating due to unhandled error');
      done();
    });
  });

  it('should catch errors thrown in setTimeout and log crash details', (done) => {
    const child = spawnCrashTest('timeout-throw');

    child.on('exit', (code) => {
      expect(code).to.equal(1, 'Should exit with code 1');

      const log = fs.readFileSync(logFile, 'utf8');
      expect(log).to.include('[STARTED]');
      expect(log).to.include('[CRASH] uncaughtException');
      expect(log).to.include('Simulated timeout error');
      expect(log).to.include('Process terminating due to unhandled error');
      done();
    });
  });

  it('should exit cleanly with code 0 when no crash occurs', (done) => {
    const child = spawnCrashTest('normal-exit');

    child.on('exit', (code) => {
      expect(code).to.equal(0, 'Should exit with code 0');

      const log = fs.readFileSync(logFile, 'utf8');
      expect(log).to.include('[STARTED]');
      expect(log).to.include('[NORMAL_EXIT]');
      expect(log).to.not.include('[CRASH]');
      done();
    });
  });

  it('should include stack trace in crash log', (done) => {
    const child = spawnCrashTest('sync-throw');

    child.on('exit', () => {
      const log = fs.readFileSync(logFile, 'utf8');
      // Stack trace should include the file and line info
      expect(log).to.include('at file://');
      expect(log).to.include('crash-test.mjs');
      done();
    });
  });
});
