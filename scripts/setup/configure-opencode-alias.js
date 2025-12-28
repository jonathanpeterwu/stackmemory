#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ALIAS_NAME = 'opencode-sm';
const WRAPPER_SCRIPT = 'opencode-wrapper.sh';

function getShellConfigFiles() {
  const shell = process.env.SHELL || '';
  const home = os.homedir();
  const files = [];

  if (shell.includes('zsh')) {
    files.push(path.join(home, '.zshrc'));
    // Also check .zprofile for some systems
    const zprofile = path.join(home, '.zprofile');
    if (fs.existsSync(zprofile)) {
      files.push(zprofile);
    }
  }

  if (shell.includes('bash') || !shell.includes('zsh')) {
    const profilePath = path.join(home, '.bash_profile');
    const rcPath = path.join(home, '.bashrc');
    if (fs.existsSync(profilePath)) files.push(profilePath);
    if (fs.existsSync(rcPath)) files.push(rcPath);
  }

  if (shell.includes('fish')) {
    files.push(path.join(home, '.config', 'fish', 'config.fish'));
  }

  return files.length > 0 ? files : [path.join(home, '.bashrc')];
}

function setupAlias() {
  try {
    const wrapperPath = join(dirname(__dirname), WRAPPER_SCRIPT);

    if (!fs.existsSync(wrapperPath)) {
      console.log(`⚠️  Wrapper script not found at ${wrapperPath}`);
      console.log(
        '   Please ensure opencode-wrapper.sh exists in the scripts directory'
      );
      return;
    }

    const configFiles = getShellConfigFiles();
    const aliasLine = `alias ${ALIAS_NAME}="${wrapperPath}"`;
    const marker = '# StackMemory OpenCode alias';
    let alreadyConfigured = false;
    let configuredIn = [];

    for (const configFile of configFiles) {
      let config = '';
      if (fs.existsSync(configFile)) {
        config = fs.readFileSync(configFile, 'utf8');
      }

      // Check if already has the alias (with marker or just the alias itself)
      if (config.includes(marker) || config.includes(`alias ${ALIAS_NAME}=`)) {
        configuredIn.push(configFile);
        alreadyConfigured = true;
        continue;
      }

      // Only add to primary shell config (first in the list)
      if (configuredIn.length === 0 && configFiles.indexOf(configFile) === 0) {
        const aliasBlock = `\n${marker}\n${aliasLine}\n`;
        fs.appendFileSync(configFile, aliasBlock);
        configuredIn.push(configFile);
        console.log(`✅ Added ${ALIAS_NAME} alias to ${configFile}`);
      }
    }

    if (alreadyConfigured && configuredIn.length > 0) {
      console.log(
        `✓ ${ALIAS_NAME} alias already configured in: ${configuredIn.join(', ')}`
      );
    } else if (configuredIn.length > 0) {
      console.log(
        `   Run 'source ${configuredIn[0]}' or restart your terminal to use it`
      );
      console.log(`   You can then use: ${ALIAS_NAME} [your message]`);
    }

    console.log(`\n📖 Usage:`);
    console.log(
      `   ${ALIAS_NAME}                    # Start OpenCode with StackMemory`
    );
    console.log(`   ${ALIAS_NAME} --auto-sync        # With Linear auto-sync`);
    console.log(
      `   ${ALIAS_NAME} --sync-interval=10 # Custom sync interval (minutes)`
    );
  } catch (error) {
    console.error('Error setting up alias:', error.message);
    console.log('\nManual setup:');
    console.log(`Add this line to your shell config file:`);
    console.log(
      `alias ${ALIAS_NAME}="${join(dirname(__dirname), WRAPPER_SCRIPT)}"`
    );
  }
}

if (process.argv.includes('--check')) {
  const configFiles = getShellConfigFiles();
  let found = false;

  for (const configFile of configFiles) {
    if (fs.existsSync(configFile)) {
      const config = fs.readFileSync(configFile, 'utf8');
      if (config.includes(`alias ${ALIAS_NAME}=`)) {
        console.log(`✓ ${ALIAS_NAME} alias is configured in ${configFile}`);
        found = true;
        break;
      }
    }
  }

  if (!found) {
    console.log(`✗ ${ALIAS_NAME} alias not found`);
    process.exit(1);
  }
  process.exit(0);
}

if (process.argv.includes('--remove')) {
  const configFiles = getShellConfigFiles();
  let removed = false;

  for (const configFile of configFiles) {
    if (fs.existsSync(configFile)) {
      let config = fs.readFileSync(configFile, 'utf8');
      const marker = '# StackMemory OpenCode alias';

      if (config.includes(marker)) {
        // Remove the alias block
        const lines = config.split('\n');
        const newLines = [];
        let skipNext = false;

        for (const line of lines) {
          if (line.includes(marker)) {
            skipNext = true;
            continue;
          }
          if (skipNext && line.includes(`alias ${ALIAS_NAME}=`)) {
            skipNext = false;
            continue;
          }
          skipNext = false;
          newLines.push(line);
        }

        fs.writeFileSync(configFile, newLines.join('\n'));
        console.log(`✅ Removed ${ALIAS_NAME} alias from ${configFile}`);
        removed = true;
      }
    }
  }

  if (!removed) {
    console.log(`✗ ${ALIAS_NAME} alias not found in any config file`);
  }
  process.exit(0);
}

setupAlias();
