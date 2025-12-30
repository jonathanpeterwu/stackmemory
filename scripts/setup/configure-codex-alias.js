#!/usr/bin/env node

import fs from 'fs';
import os from 'os';
import path, { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const ALIAS_NAME = 'codex-sm';
const WRAPPER_SCRIPT = 'codex-wrapper.sh';

function getShellConfigFiles() {
  const shell = process.env.SHELL || '';
  const home = os.homedir();
  const files = [];

  if (shell.includes('zsh')) {
    files.push(path.join(home, '.zshrc'));
    const zprofile = path.join(home, '.zprofile');
    if (fs.existsSync(zprofile)) files.push(zprofile);
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
    const scriptsDir = dirname(__dirname);
    const repoRoot = dirname(scriptsDir);
    const distBin = join(repoRoot, 'dist', 'src', 'cli', 'codex-sm.js');
    const wrapperPath = join(scriptsDir, WRAPPER_SCRIPT);

    // Prefer TypeScript bin (built file); fallback to shell wrapper
    const targetCmd = fs.existsSync(distBin)
      ? `node ${distBin}`
      : (fs.existsSync(wrapperPath)
          ? `${wrapperPath}`
          : null);

    if (!targetCmd) {
      console.log('⚠️  Neither built TS bin nor wrapper script found.');
      console.log('   Build first: npm run build');
      console.log(`   Or ensure ${WRAPPER_SCRIPT} exists in scripts/`);
      return;
    }

    const configFiles = getShellConfigFiles();
    const aliasLine = `alias ${ALIAS_NAME}="${targetCmd}"`;
    const marker = '# StackMemory Codex alias';
    let updatedOrConfigured = false;
    const touched = [];

    for (const configFile of configFiles) {
      let config = '';
      if (fs.existsSync(configFile)) config = fs.readFileSync(configFile, 'utf8');

      // If already present, replace existing alias line in-place
      if (config.includes(`alias ${ALIAS_NAME}=`)) {
        const newConfig = config.replace(
          new RegExp(`^.*alias\\s+${ALIAS_NAME}=.*$`, 'm'),
          aliasLine
        );
        if (newConfig !== config) {
          fs.writeFileSync(configFile, newConfig, 'utf8');
          console.log(`✅ Updated ${ALIAS_NAME} alias in ${configFile}`);
          updatedOrConfigured = true;
          touched.push(configFile);
          continue;
        }
      }

      // Otherwise, add once to the first config file available
      if (!updatedOrConfigured && configFiles.indexOf(configFile) === 0) {
        const aliasBlock = `\n${marker}\n${aliasLine}\n`;
        fs.appendFileSync(configFile, aliasBlock);
        console.log(`✅ Added ${ALIAS_NAME} alias to ${configFile}`);
        updatedOrConfigured = true;
        touched.push(configFile);
      }
    }

    if (touched.length > 0) {
      console.log(`   Run 'source ${touched[0]}' or restart your terminal to use it`);
      console.log(`   You can then use: ${ALIAS_NAME} [your message]`);
    } else {
      console.log(`ℹ️  No suitable shell config found to modify.`);
    }

    console.log(`\n📖 Usage:`);
    console.log(`   ${ALIAS_NAME}                    # Start Codex with StackMemory`);
    console.log(`   ${ALIAS_NAME} --auto-sync        # With Linear auto-sync`);
    console.log(`   ${ALIAS_NAME} --sync-interval=10 # Custom sync interval (minutes)`);
  } catch (error) {
    console.error('Error setting up alias:', error.message);
    console.log('\nManual setup:');
    console.log(`Add this line to your shell config file:`);
    console.log(`alias ${ALIAS_NAME}="${join(dirname(__dirname), WRAPPER_SCRIPT)}"`);
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
      const marker = '# StackMemory Codex alias';
      if (config.includes(marker) || config.includes(`alias ${ALIAS_NAME}=`)) {
        const lines = config.split('\n');
        const newLines = [];
        let skipNext = false;
        for (const line of lines) {
          if (line.includes(marker)) { skipNext = true; continue; }
          if (skipNext && line.includes(`alias ${ALIAS_NAME}=`)) { skipNext = false; continue; }
          skipNext = false;
          newLines.push(line);
        }
        fs.writeFileSync(configFile, newLines.join('\n'));
        console.log(`✅ Removed ${ALIAS_NAME} alias from ${configFile}`);
        removed = true;
      }
    }
  }
  if (!removed) console.log(`✗ ${ALIAS_NAME} alias not found in any config file`);
  process.exit(0);
}

setupAlias();
