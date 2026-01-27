#!/usr/bin/env node

/**
 * Auto-install Claude hooks during npm install
 * This runs as a postinstall script to set up tracing hooks and daemon
 *
 * INTERACTIVE: Asks for user consent before modifying ~/.claude
 */

import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readFileSync,
  writeFileSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createInterface } from 'readline';

import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const claudeHooksDir = join(homedir(), '.claude', 'hooks');
const claudeConfigFile = join(homedir(), '.claude', 'hooks.json');
const templatesDir = join(__dirname, '..', 'templates', 'claude-hooks');
const stackmemoryBinDir = join(homedir(), '.stackmemory', 'bin');
const distDir = join(__dirname, '..', 'dist');

/**
 * Ask user for confirmation before installing hooks
 * Returns true if user consents, false otherwise
 */
async function askForConsent() {
  // Skip prompt if:
  // 1. Not a TTY (CI/CD, piped input)
  // 2. STACKMEMORY_AUTO_HOOKS=true is set
  // 3. Running in CI environment
  if (
    !process.stdin.isTTY ||
    process.env.STACKMEMORY_AUTO_HOOKS === 'true' ||
    process.env.CI === 'true'
  ) {
    // In non-interactive mode, skip hook installation silently
    console.log(
      'StackMemory installed. Run "stackmemory setup-mcp" to configure Claude Code integration.'
    );
    return false;
  }

  console.log('\n📦 StackMemory Post-Install\n');
  console.log(
    'StackMemory can integrate with Claude Code by installing hooks that:'
  );
  console.log('  - Track tool usage for better context');
  console.log('  - Enable session persistence across restarts');
  console.log('  - Sync context with Linear (optional)');
  console.log('\nThis will modify files in ~/.claude/\n');

  return new Promise((resolve) => {
    const rl = createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question('Install Claude Code hooks? [y/N] ', (answer) => {
      rl.close();
      const normalized = answer.toLowerCase().trim();
      resolve(normalized === 'y' || normalized === 'yes');
    });

    // Timeout after 30 seconds - default to no
    setTimeout(() => {
      console.log('\n(Timed out, skipping hook installation)');
      rl.close();
      resolve(false);
    }, 30000);
  });
}

async function installClaudeHooks() {
  try {
    // Create Claude hooks directory if it doesn't exist
    if (!existsSync(claudeHooksDir)) {
      mkdirSync(claudeHooksDir, { recursive: true });
      console.log('Created ~/.claude/hooks directory');
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
          console.log(`  Backed up: ${hookFile}`);
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
        console.log(`  Installed: ${hookFile}`);
      }
    }

    // Update hooks.json configuration
    let hooksConfig = {};
    if (existsSync(claudeConfigFile)) {
      try {
        hooksConfig = JSON.parse(readFileSync(claudeConfigFile, 'utf8'));
      } catch {
        // Start fresh if parse fails
      }
    }

    // Add our hooks (don't overwrite existing hooks unless they're ours)
    const newHooksConfig = {
      ...hooksConfig,
      'tool-use-approval': join(claudeHooksDir, 'tool-use-trace.js'),
      'on-startup': join(claudeHooksDir, 'on-startup.js'),
      'on-clear': join(claudeHooksDir, 'on-clear.js'),
    };

    writeFileSync(claudeConfigFile, JSON.stringify(newHooksConfig, null, 2));

    if (installed > 0) {
      console.log(`\n[OK] Installed ${installed} Claude hooks`);
      console.log(`     Traces: ~/.stackmemory/traces/`);
      console.log('     To disable: set DEBUG_TRACE=false in .env');
    }

    // Install session daemon binary
    await installSessionDaemon();

    return true;
  } catch (error) {
    console.error('Hook installation failed:', error.message);
    console.error('(Non-critical - StackMemory works without hooks)');
    return false;
  }
}

/**
 * Install the session daemon binary to ~/.stackmemory/bin/
 */
async function installSessionDaemon() {
  try {
    // Create bin directory if needed
    if (!existsSync(stackmemoryBinDir)) {
      mkdirSync(stackmemoryBinDir, { recursive: true });
      console.log('Created StackMemory bin directory');
    }

    // Look for the daemon in dist
    const daemonSrc = join(distDir, 'daemon', 'session-daemon.js');
    const daemonDest = join(stackmemoryBinDir, 'session-daemon.js');

    if (existsSync(daemonSrc)) {
      copyFileSync(daemonSrc, daemonDest);

      // Make executable
      try {
        const { execSync } = await import('child_process');
        execSync(`chmod +x "${daemonDest}"`, { stdio: 'ignore' });
      } catch {
        // Silent fail on chmod
      }

      console.log('Installed session daemon binary');
    } else {
      console.log('Session daemon not found in dist (build first)');
    }
  } catch (error) {
    console.error('Failed to install session daemon:', error.message);
    // Non-critical error
  }
}

// Only run if called directly (not imported)
if (import.meta.url === `file://${process.argv[1]}`) {
  const consent = await askForConsent();
  if (consent) {
    await installClaudeHooks();
    console.log(
      '\nNext: Run "stackmemory setup-mcp" to complete Claude Code integration.'
    );
  } else {
    console.log(
      'Skipped hook installation. Run "stackmemory hooks install" later if needed.'
    );
  }
}

export { installClaudeHooks };
