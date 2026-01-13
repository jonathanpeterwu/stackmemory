#!/usr/bin/env node
/**
 * Auto-install Claude hooks for StackMemory integration
 * Runs during npm install/postinstall
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Colors for output
const colors = {
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  red: '\x1b[31m',
  reset: '\x1b[0m'
};

function log(color, message) {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function getClaudeHooksDir() {
  const homeDir = process.env.HOME || process.env.USERPROFILE;
  if (!homeDir) {
    throw new Error('Could not determine home directory');
  }
  
  const claudeHooksDir = path.join(homeDir, '.claude', 'hooks');
  
  // Create directory if it doesn't exist
  if (!fs.existsSync(claudeHooksDir)) {
    fs.mkdirSync(claudeHooksDir, { recursive: true });
    log('blue', '📁 Created ~/.claude/hooks directory');
  }
  
  return claudeHooksDir;
}

function getTemplatesDir() {
  // Check if running from global install or local install
  let templatesDir = path.join(__dirname, '..', 'templates', 'claude-hooks');
  
  if (!fs.existsSync(templatesDir)) {
    // Try from node_modules location
    templatesDir = path.join(__dirname, '..', '..', 'templates', 'claude-hooks');
  }
  
  if (!fs.existsSync(templatesDir)) {
    // Try from npm global location
    const globalDir = execSync('npm root -g', { encoding: 'utf8' }).trim();
    templatesDir = path.join(globalDir, '@stackmemoryai', 'stackmemory', 'templates', 'claude-hooks');
  }
  
  return templatesDir;
}

function installHooks() {
  try {
    log('blue', '🔧 Installing StackMemory Claude hooks...');
    
    const claudeHooksDir = getClaudeHooksDir();
    const templatesDir = getTemplatesDir();
    
    if (!fs.existsSync(templatesDir)) {
      log('yellow', '⚠️  Hook templates not found, skipping installation');
      return;
    }
    
    const hooks = [
      'on-startup',
      'on-exit', 
      'on-clear',
      'on-task-complete',
      'chromadb-wrapper'
    ];
    
    let installed = 0;
    let updated = 0;
    let skipped = 0;
    
    for (const hook of hooks) {
      const sourcePath = path.join(templatesDir, hook);
      const targetPath = path.join(claudeHooksDir, hook);
      
      if (!fs.existsSync(sourcePath)) {
        log('yellow', `⚠️  Template for ${hook} not found`);
        continue;
      }
      
      // Check if hook already exists
      if (fs.existsSync(targetPath)) {
        // Read existing and new content to compare
        const existingContent = fs.readFileSync(targetPath, 'utf8');
        const newContent = fs.readFileSync(sourcePath, 'utf8');
        
        if (existingContent === newContent) {
          skipped++;
          continue;
        }
        
        // Backup existing hook
        const backupPath = `${targetPath}.backup.${Date.now()}`;
        fs.copyFileSync(targetPath, backupPath);
        log('yellow', `📦 Backed up existing ${hook} hook`);
        updated++;
      } else {
        installed++;
      }
      
      // Copy new hook
      fs.copyFileSync(sourcePath, targetPath);
      fs.chmodSync(targetPath, 0o755); // Make executable
      
      log('green', `✅ Installed ${hook}`);
    }
    
    // Create logs directory for ChromaDB hooks
    const logsDir = path.join(process.env.HOME || process.env.USERPROFILE, '.stackmemory', 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir, { recursive: true });
    }
    
    log('green', `🎉 Claude hooks installation complete!`);
    log('blue', `📊 Installed: ${installed}, Updated: ${updated}, Skipped: ${skipped}`);
    
    if (installed > 0 || updated > 0) {
      log('blue', '\n📋 Claude Code will now:');
      log('blue', '  • Start StackMemory monitor on startup');
      log('blue', '  • Preserve context on clear/exit');
      log('blue', '  • Sync completed tasks to Linear');
      log('blue', '  • Save session state automatically');
    }
    
  } catch (error) {
    log('red', `❌ Failed to install Claude hooks: ${error.message}`);
    
    // Don't fail the install if hooks can't be installed
    if (process.env.STACKMEMORY_STRICT_INSTALL === 'true') {
      process.exit(1);
    } else {
      log('yellow', '⚠️  Continuing without Claude hooks (non-critical)');
    }
  }
}

// Only run if this script is called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  installHooks();
}

export { installHooks };