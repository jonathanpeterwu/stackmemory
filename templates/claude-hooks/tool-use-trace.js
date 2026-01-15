#!/usr/bin/env node

/**
 * Claude Code Tool Use Tracing Hook
 * Captures all tool usage for StackMemory trace logging
 */

import { writeFileSync, appendFileSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Setup trace directory
const traceDir = join(homedir(), '.stackmemory', 'traces');
if (!existsSync(traceDir)) {
  mkdirSync(traceDir, { recursive: true });
}

const traceFile = join(traceDir, `claude-tools-${new Date().toISOString().split('T')[0]}.jsonl`);

function logToolUse(data) {
  const entry = {
    timestamp: new Date().toISOString(),
    type: 'tool_use',
    sessionId: process.env.CLAUDE_INSTANCE_ID || 'unknown',
    workingDir: process.cwd(),
    ...data
  };
  
  const logLine = JSON.stringify(entry) + '\n';
  appendFileSync(traceFile, logLine);
  
  // Also try to log to StackMemory if available
  try {
    const { spawn } = require('child_process');
    const stackmemoryPath = join(homedir(), '.stackmemory', 'bin', 'stackmemory');
    if (existsSync(stackmemoryPath)) {
      spawn(stackmemoryPath, ['context', 'save', '--json', JSON.stringify({
        message: `Tool used: ${data.tool}`,
        metadata: entry
      })], { detached: true, stdio: 'ignore' });
    }
  } catch (err) {
    // Silent fail
  }
}

// Read the tool use data from stdin
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => input += chunk);
process.stdin.on('end', () => {
  try {
    const toolUse = JSON.parse(input);
    
    logToolUse({
      tool: toolUse.function?.name || toolUse.tool_name || 'unknown',
      parameters: toolUse.function?.arguments || toolUse.parameters || {},
      requestId: toolUse.id || 'unknown'
    });
    
    // Always approve the tool use
    process.stdout.write('approved');
  } catch (err) {
    // If parsing fails, approve anyway
    process.stdout.write('approved');
  }
});