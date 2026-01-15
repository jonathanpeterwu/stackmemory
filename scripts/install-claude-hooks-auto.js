#!/usr/bin/env node

/**
 * Auto-install Claude hooks during npm install
 * This runs as a postinstall script to set up tracing hooks
 */

import { existsSync, mkdirSync, copyFileSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const claudeHooksDir = join(homedir(), '.claude', 'hooks');
const claudeConfigFile = join(homedir(), '.claude', 'hooks.json');
const templatesDir = join(__dirname, '..', 'templates', 'claude-hooks');

async function installClaudeHooks() {
  try {
    // Create Claude hooks directory if it doesn't exist
    if (!existsSync(claudeHooksDir)) {
      mkdirSync(claudeHooksDir, { recursive: true });
      console.log('📁 Created Claude hooks directory');
    }

    // Copy hook files
    const hookFiles = ['tool-use-trace.js', 'on-startup.js', 'on-clear.js'];
    let installed = 0;

    for (const hookFile of hookFiles) {
      const srcPath = join(templatesDir, hookFile);
      const destPath = join(claudeHooksDir, hookFile);
      
      if (existsSync(srcPath)) {
        // Backup existing hook if it exists
        if (existsSync(destPath)) {
          const backupPath = `${destPath}.backup-${Date.now()}`;
          copyFileSync(destPath, backupPath);
          console.log(`📋 Backed up existing hook: ${hookFile}`);
        }
        
        copyFileSync(srcPath, destPath);
        
        // Make executable
        try {
          const { execSync } = await import('child_process');
          execSync(`chmod +x "${destPath}"`, { stdio: 'ignore' });
        } catch {
          // Silent fail on chmod
        }
        
        installed++;
        console.log(`✅ Installed hook: ${hookFile}`);
      }
    }

    // Update hooks.json configuration
    let hooksConfig = {};
    if (existsSync(claudeConfigFile)) {
      try {
        hooksConfig = JSON.parse(readFileSync(claudeConfigFile, 'utf8'));
        console.log('📋 Loaded existing hooks.json');
      } catch (err) {
        console.log('⚠️  Could not parse existing hooks.json, creating new');
      }
    }

    // Add our hooks (don't overwrite existing hooks unless they're ours)
    const newHooksConfig = {
      ...hooksConfig,
      'tool-use-approval': join(claudeHooksDir, 'tool-use-trace.js'),
      'on-startup': join(claudeHooksDir, 'on-startup.js'),
      'on-clear': join(claudeHooksDir, 'on-clear.js')
    };

    writeFileSync(claudeConfigFile, JSON.stringify(newHooksConfig, null, 2));
    console.log('🔧 Updated hooks.json configuration');

    if (installed > 0) {
      console.log(`\n🎉 Successfully installed ${installed} Claude hooks for StackMemory tracing!`);
      console.log('🔍 Tool usage and session data will now be automatically logged');
      console.log(`📁 Traces saved to: ${join(homedir(), '.stackmemory', 'traces')}`);
      console.log('\nTo disable tracing, set DEBUG_TRACE=false in your .env file');
    }

    return true;
  } catch (error) {
    console.error('❌ Failed to install Claude hooks:', error.message);
    console.error('   This is not critical - StackMemory will still work without hooks');
    return false;
  }
}

// Only run if called directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  console.log('🔧 Installing StackMemory Claude Code integration hooks...\n');
  await installClaudeHooks();
}

export { installClaudeHooks };