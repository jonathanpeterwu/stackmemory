/**
 * Auto-background hook for Claude Code
 * Automatically backgrounds long-running or specific commands
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { writeFileSecure, ensureSecureDir } from './secure-fs.js';

export interface AutoBackgroundConfig {
  enabled: boolean;
  // Time-based: background if command runs longer than this (ms)
  timeoutMs: number;
  // Pattern-based: always background these commands
  alwaysBackground: string[];
  // Never background these (override)
  neverBackground: string[];
  // Log backgrounded commands
  verbose: boolean;
}

const DEFAULT_CONFIG: AutoBackgroundConfig = {
  enabled: true,
  timeoutMs: 5000, // 5 seconds
  alwaysBackground: [
    // Package managers
    'npm install',
    'npm ci',
    'yarn install',
    'pnpm install',
    'bun install',
    // Builds
    'npm run build',
    'yarn build',
    'pnpm build',
    'cargo build',
    'go build',
    'make',
    'cmake',
    // Tests
    'npm test',
    'npm run test',
    'yarn test',
    'pnpm test',
    'pytest',
    'jest',
    'vitest',
    'cargo test',
    'go test',
    // Docker
    'docker build',
    'docker-compose up',
    'docker compose up',
    // Git operations that can be slow
    'git clone',
    'git fetch --all',
    'git pull --all',
    // Type checking
    'npx tsc',
    'tsc --noEmit',
    // Linting large codebases
    'eslint .',
    'npm run lint',
  ],
  neverBackground: [
    // Interactive commands
    'vim',
    'nvim',
    'nano',
    'less',
    'more',
    'top',
    'htop',
    // Quick commands
    'echo',
    'cat',
    'ls',
    'pwd',
    'cd',
    'which',
    'git status',
    'git diff',
    'git log',
  ],
  verbose: false,
};

const CONFIG_PATH = join(homedir(), '.stackmemory', 'auto-background.json');

export function loadConfig(): AutoBackgroundConfig {
  try {
    if (existsSync(CONFIG_PATH)) {
      const data = readFileSync(CONFIG_PATH, 'utf8');
      return { ...DEFAULT_CONFIG, ...JSON.parse(data) };
    }
  } catch {
    // Use defaults
  }
  return DEFAULT_CONFIG;
}

export function saveConfig(config: AutoBackgroundConfig): void {
  try {
    ensureSecureDir(join(homedir(), '.stackmemory'));
    writeFileSecure(CONFIG_PATH, JSON.stringify(config, null, 2));
  } catch {
    // Silently fail
  }
}

export function shouldAutoBackground(
  command: string,
  config?: AutoBackgroundConfig
): boolean {
  const cfg = config || loadConfig();

  if (!cfg.enabled) return false;

  const normalizedCmd = command.trim().toLowerCase();

  // Check never-background list first (highest priority)
  for (const pattern of cfg.neverBackground) {
    if (normalizedCmd.startsWith(pattern.toLowerCase())) {
      return false;
    }
  }

  // Check always-background list
  for (const pattern of cfg.alwaysBackground) {
    if (normalizedCmd.startsWith(pattern.toLowerCase())) {
      return true;
    }
  }

  // Default: don't auto-background (let timeout handle it)
  return false;
}

/**
 * Hook response format for Claude Code
 * Returns modified tool input if command should be backgrounded
 */
export interface HookResponse {
  decision: 'allow' | 'modify' | 'block';
  modifiedInput?: Record<string, unknown>;
  reason?: string;
}

export function processToolUse(
  toolName: string,
  toolInput: Record<string, unknown>
): HookResponse {
  // Only process Bash tool
  if (toolName !== 'Bash') {
    return { decision: 'allow' };
  }

  const command = toolInput.command as string;
  if (!command) {
    return { decision: 'allow' };
  }

  // Skip if already backgrounded
  if (toolInput.run_in_background === true) {
    return { decision: 'allow' };
  }

  const config = loadConfig();

  if (shouldAutoBackground(command, config)) {
    if (config.verbose) {
      console.error(
        `[auto-background] Backgrounding: ${command.substring(0, 50)}...`
      );
    }

    return {
      decision: 'modify',
      modifiedInput: {
        ...toolInput,
        run_in_background: true,
      },
      reason: `Auto-backgrounded: matches pattern`,
    };
  }

  return { decision: 'allow' };
}

// CLI entry point removed - use stackmemory auto-bg command instead
