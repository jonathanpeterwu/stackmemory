#!/usr/bin/env node

/**
 * claude-sm-danger: Claude-SM wrapper with --dangerously-skip-permissions
 * Shorthand for: claude-sm --dangerously-skip-permissions [args]
 */

import { spawn } from 'child_process';
import * as path from 'path';

// __filename and __dirname are provided by esbuild banner for ESM compatibility

// Get the claude-sm script path
const claudeSmPath = path.join(__dirname, 'claude-sm.js');

// Prepend the danger flag to all args
const args = ['--dangerously-skip-permissions', ...process.argv.slice(2)];

// Spawn claude-sm with the danger flag
const child = spawn('node', [claudeSmPath, ...args], {
  stdio: 'inherit',
  env: process.env,
});

child.on('exit', (code) => {
  process.exit(code || 0);
});

child.on('error', (err) => {
  console.error('Failed to launch claude-sm:', err.message);
  process.exit(1);
});
