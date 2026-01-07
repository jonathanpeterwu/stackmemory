#!/usr/bin/env node

/**
 * Claude hook for automatic Linear task updates
 * Triggers on task-related keywords and updates Linear automatically
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { LinearUpdateSkill } from '../scripts/claude-linear-skill.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Read hook input from Claude
const input = JSON.parse(fs.readFileSync(0, 'utf-8'));

async function processHook() {
  try {
    const skill = new LinearUpdateSkill();
    
    // Check if API key is available
    if (!skill.apiKey) {
      console.error('LINEAR_API_KEY not configured');
      process.exit(0); // Exit gracefully, don't block Claude
    }

    // Get the message or content from the hook
    const content = input.message || input.content || input.text || '';
    
    if (!content) {
      process.exit(0);
    }

    // Parse task ID and check if we should process
    const taskInfo = skill.parseTaskId(content);
    if (!taskInfo) {
      process.exit(0); // No task found
    }

    // Check for status keywords
    const status = skill.detectStatus(content);
    if (!status) {
      process.exit(0); // No status change detected
    }

    // Process the update
    const result = await skill.processUpdate(content, {
      addDetails: status === 'completed',
      comment: `Auto-updated by Claude: ${new Date().toISOString()}`,
    });

    if (result.success) {
      console.log(`Updated ${result.issue} to ${status}`);
    }

  } catch (error) {
    // Log error but don't block Claude
    const logFile = path.join(process.env.HOME, '.stackmemory', 'logs', 'linear-hook-errors.log');
    fs.appendFileSync(logFile, `[${new Date().toISOString()}] ${error.message}\n`);
  }

  process.exit(0);
}

// Run the hook
processHook();