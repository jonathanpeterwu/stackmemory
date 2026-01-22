#!/usr/bin/env node

/**
 * Post-Edit Sweep Hook for Claude Code
 *
 * Runs Sweep 1.5B predictions after file edits to suggest next changes.
 * Tracks recent diffs and provides context-aware predictions.
 */

import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const CONFIG = {
  enabled: process.env.SWEEP_ENABLED !== 'false',
  maxRecentDiffs: 5,
  predictionTimeout: 30000,
  minEditSize: 10,
  stateFile: path.join(
    process.env.HOME || '/tmp',
    '.stackmemory',
    'sweep-state.json'
  ),
  logFile: path.join(
    process.env.HOME || '/tmp',
    '.stackmemory',
    'sweep-predictions.log'
  ),
  pythonScript: path.join(
    process.env.HOME || '/tmp',
    '.stackmemory',
    'sweep',
    'sweep_predict.py'
  ),
};

// Fallback locations for sweep_predict.py
const SCRIPT_LOCATIONS = [
  CONFIG.pythonScript,
  path.join(
    process.cwd(),
    'packages',
    'sweep-addon',
    'python',
    'sweep_predict.py'
  ),
  path.join(
    process.cwd(),
    'node_modules',
    '@stackmemoryai',
    'sweep-addon',
    'python',
    'sweep_predict.py'
  ),
];

function findPythonScript() {
  for (const loc of SCRIPT_LOCATIONS) {
    if (fs.existsSync(loc)) {
      return loc;
    }
  }
  return null;
}

function loadState() {
  try {
    if (fs.existsSync(CONFIG.stateFile)) {
      return JSON.parse(fs.readFileSync(CONFIG.stateFile, 'utf-8'));
    }
  } catch {
    // Ignore errors
  }
  return { recentDiffs: [], lastPrediction: null, fileContents: {} };
}

function saveState(state) {
  try {
    const dir = path.dirname(CONFIG.stateFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(CONFIG.stateFile, JSON.stringify(state, null, 2));
  } catch {
    // Ignore errors
  }
}

function log(message, data = {}) {
  try {
    const dir = path.dirname(CONFIG.logFile);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    const entry = {
      timestamp: new Date().toISOString(),
      message,
      ...data,
    };
    fs.appendFileSync(CONFIG.logFile, JSON.stringify(entry) + '\n');
  } catch {
    // Ignore
  }
}

async function runPrediction(filePath, currentContent, recentDiffs) {
  const scriptPath = findPythonScript();
  if (!scriptPath) {
    log('Sweep script not found');
    return null;
  }

  const input = {
    file_path: filePath,
    current_content: currentContent,
    recent_diffs: recentDiffs,
  };

  return new Promise((resolve) => {
    const proc = spawn('python3', [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
      timeout: CONFIG.predictionTimeout,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => (stdout += data));
    proc.stderr.on('data', (data) => (stderr += data));

    const timeout = setTimeout(() => {
      proc.kill();
      resolve(null);
    }, CONFIG.predictionTimeout);

    proc.on('close', (code) => {
      clearTimeout(timeout);
      try {
        if (stdout.trim()) {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } else {
          resolve(null);
        }
      } catch {
        resolve(null);
      }
    });

    proc.on('error', () => {
      clearTimeout(timeout);
      resolve(null);
    });

    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();
  });
}

async function readInput() {
  let input = '';
  for await (const chunk of process.stdin) {
    input += chunk;
  }
  return JSON.parse(input);
}

async function handleEdit(toolInput, toolResult) {
  if (!CONFIG.enabled) return;

  const { file_path, old_string, new_string } = toolInput;
  if (!file_path || !old_string || !new_string) return;

  // Skip tiny edits
  if (
    new_string.length < CONFIG.minEditSize &&
    old_string.length < CONFIG.minEditSize
  ) {
    return;
  }

  const state = loadState();

  // Record the diff
  const diff = {
    file_path,
    original: old_string,
    updated: new_string,
    timestamp: Date.now(),
  };

  state.recentDiffs.unshift(diff);
  state.recentDiffs = state.recentDiffs.slice(0, CONFIG.maxRecentDiffs);

  // Update file content cache
  try {
    if (fs.existsSync(file_path)) {
      state.fileContents[file_path] = fs.readFileSync(file_path, 'utf-8');
    }
  } catch {
    // Ignore
  }

  saveState(state);
  log('Edit recorded', { file_path, diffSize: new_string.length });

  // Run prediction in background (don't block)
  if (state.recentDiffs.length >= 2) {
    runPredictionAsync(file_path, state);
  }
}

async function runPredictionAsync(filePath, state) {
  try {
    const currentContent = state.fileContents[filePath] || '';
    if (!currentContent) return;

    const result = await runPrediction(
      filePath,
      currentContent,
      state.recentDiffs
    );

    if (result && result.success && result.predicted_content) {
      state.lastPrediction = {
        file_path: filePath,
        prediction: result.predicted_content,
        latency_ms: result.latency_ms,
        timestamp: Date.now(),
      };
      saveState(state);

      log('Prediction complete', {
        file_path: filePath,
        latency_ms: result.latency_ms,
        tokens: result.tokens_generated,
      });

      // Output prediction hint (will be shown in Claude Code)
      const hint = formatPredictionHint(result);
      if (hint) {
        console.error(hint);
      }
    }
  } catch (error) {
    log('Prediction error', { error: error.message });
  }
}

function formatPredictionHint(result) {
  if (!result.predicted_content || result.predicted_content.trim().length < 5) {
    return null;
  }

  const preview = result.predicted_content
    .trim()
    .split('\n')
    .slice(0, 3)
    .join('\n');
  const truncated = result.predicted_content.length > 200;

  return `
[Sweep Prediction] Next edit suggestion (${result.latency_ms}ms):
${preview}${truncated ? '\n...' : ''}
`;
}

async function handleWrite(toolInput, toolResult) {
  if (!CONFIG.enabled) return;

  const { file_path, content } = toolInput;
  if (!file_path || !content) return;

  const state = loadState();

  // Cache file content
  state.fileContents[file_path] = content;
  saveState(state);

  log('Write recorded', { file_path, size: content.length });
}

async function main() {
  try {
    const input = await readInput();
    const { tool_name, tool_input, tool_result, event_type } = input;

    // Only handle post-tool-use events
    if (event_type !== 'post_tool_use') {
      process.exit(0);
    }

    // Handle different tools
    switch (tool_name) {
      case 'Edit':
        await handleEdit(tool_input, tool_result);
        break;
      case 'Write':
        await handleWrite(tool_input, tool_result);
        break;
    }

    // Success
    console.log(JSON.stringify({ status: 'ok' }));
  } catch (error) {
    log('Hook error', { error: error.message });
    console.log(JSON.stringify({ status: 'error', message: error.message }));
  }
}

// Handle info request
if (process.argv.includes('--info')) {
  console.log(
    JSON.stringify({
      hook: 'post-edit-sweep',
      version: '1.0.0',
      description: 'Runs Sweep 1.5B predictions after file edits',
      config: {
        enabled: CONFIG.enabled,
        maxRecentDiffs: CONFIG.maxRecentDiffs,
        predictionTimeout: CONFIG.predictionTimeout,
      },
    })
  );
  process.exit(0);
}

// Handle status request
if (process.argv.includes('--status')) {
  const state = loadState();
  const scriptPath = findPythonScript();
  console.log(
    JSON.stringify(
      {
        enabled: CONFIG.enabled,
        scriptFound: !!scriptPath,
        scriptPath,
        recentDiffs: state.recentDiffs.length,
        lastPrediction: state.lastPrediction,
      },
      null,
      2
    )
  );
  process.exit(0);
}

// Handle clear request
if (process.argv.includes('--clear')) {
  saveState({ recentDiffs: [], lastPrediction: null, fileContents: {} });
  console.log('Sweep state cleared');
  process.exit(0);
}

main().catch((error) => {
  console.error(JSON.stringify({ status: 'error', message: error.message }));
  process.exit(1);
});
