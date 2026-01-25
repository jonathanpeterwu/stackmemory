#!/usr/bin/env node
/**
 * Sweep Suggestion Script for Shell Integration
 * Reads input from stdin and returns a suggestion
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(
  process.env.HOME || '/tmp',
  '.stackmemory',
  'sweep-state.json'
);

function loadState() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      return JSON.parse(fs.readFileSync(STATE_FILE, 'utf-8'));
    }
  } catch {
    // Ignore
  }
  return { recentDiffs: [], fileContents: {} };
}

function getRecentFile(state) {
  if (!state.recentDiffs || state.recentDiffs.length === 0) {
    return null;
  }
  return state.recentDiffs[0]?.file_path;
}

function getFilename(filepath) {
  if (!filepath) return null;
  return path.basename(filepath);
}

function getSuggestion(userInput) {
  const state = loadState();
  const recentFile = getRecentFile(state);
  const filename = getFilename(recentFile);

  if (!filename) return null;

  const input = userInput.toLowerCase().trim();

  // Git commands - suggest based on recent file
  if (input.startsWith('git commit')) {
    if (input === 'git commit') {
      return ` -m "Update ${filename}"`;
    }
    if (input === 'git commit -m') {
      return ` "Update ${filename}"`;
    }
    if (input === 'git commit -m "') {
      return `Update ${filename}"`;
    }
  }

  if (input === 'git add') {
    return ` ${recentFile}`;
  }

  if (input === 'git diff') {
    return ` ${recentFile}`;
  }

  if (input === 'git log') {
    return ` --oneline -10`;
  }

  // Action keywords at end
  const actionPatterns = {
    fix: ` the bug in ${filename}`,
    add: ` feature to ${filename}`,
    update: ` ${filename}`,
    refactor: ` ${filename}`,
    test: ` ${filename}`,
    implement: ` in ${filename}`,
    create: ` new function in ${filename}`,
    delete: ` from ${filename}`,
    remove: ` from ${filename}`,
    edit: ` ${filename}`,
    open: ` ${recentFile}`,
    check: ` ${filename}`,
    review: ` ${filename}`,
    debug: ` ${filename}`,
  };

  for (const [keyword, suffix] of Object.entries(actionPatterns)) {
    if (input.endsWith(keyword)) {
      return suffix;
    }
    if (input.endsWith(keyword + ' ')) {
      return suffix.trim();
    }
  }

  // Preposition patterns
  if (
    input.endsWith(' in ') ||
    input.endsWith(' to ') ||
    input.endsWith(' for ')
  ) {
    return filename;
  }

  if (input.endsWith(' file ') || input.endsWith(' the ')) {
    return filename;
  }

  // npm/node commands
  if (input === 'npm run') {
    return ' build';
  }

  if (input === 'npm test') {
    return ` -- ${filename.replace(/\.[^/.]+$/, '')}`;
  }

  if (input === 'node') {
    return ` ${recentFile}`;
  }

  // Cat/less/vim
  if (
    input === 'cat' ||
    input === 'less' ||
    input === 'vim' ||
    input === 'code'
  ) {
    return ` ${recentFile}`;
  }

  return null;
}

async function main() {
  let data = '';

  process.stdin.setEncoding('utf8');

  for await (const chunk of process.stdin) {
    data += chunk;
  }

  const userInput = data.trim();

  if (!userInput || userInput.length < 2) {
    process.exit(0);
  }

  const suggestion = getSuggestion(userInput);

  if (suggestion) {
    console.log(suggestion);
  }
}

main().catch(() => process.exit(0));
