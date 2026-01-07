#!/usr/bin/env node

/**
 * ChromaDB hook for code changes
 * Triggers when files are edited, created, or deleted
 */

import { ChromaDBContextSaver, TRIGGER_EVENTS } from './chromadb-save-hook.js';
import fs from 'fs';

async function onCodeChange() {
  try {
    // Read Claude's input about the code change
    const input = JSON.parse(fs.readFileSync(0, 'utf-8'));
    
    const saver = new ChromaDBContextSaver();
    
    // Extract file information
    const files = input.files || [];
    const operation = input.operation || 'edit'; // edit, create, delete
    
    // Save context about code changes
    await saver.saveContext(TRIGGER_EVENTS.CODE_CHANGE, {
      files: files,
      operation: operation,
      linesAdded: input.linesAdded || 0,
      linesRemoved: input.linesRemoved || 0,
      description: input.description || `Code ${operation} on ${files.length} file(s)`,
    });
    
  } catch (error) {
    // Silently fail to not block Claude
    fs.appendFileSync(
      `${process.env.HOME}/.stackmemory/logs/hook-errors.log`,
      `[${new Date().toISOString()}] on-code-change: ${error.message}\n`
    );
  }
}

onCodeChange();