/**
 * StackMemory Hook Configuration
 * Loads and manages hook configuration
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname } from 'path';
import { HookEventType } from './events.js';

export type OutputType =
  | 'overlay'
  | 'notification'
  | 'log'
  | 'prepend'
  | 'silent';

export interface HookConfig {
  enabled: boolean;
  handler: string;
  output: OutputType;
  delay_ms?: number;
  debounce_ms?: number;
  cooldown_ms?: number;
  options?: Record<string, unknown>;
}

export interface HooksConfig {
  version: string;
  daemon: {
    enabled: boolean;
    log_level: 'debug' | 'info' | 'warn' | 'error';
    pid_file: string;
    log_file: string;
  };
  file_watch: {
    enabled: boolean;
    paths: string[];
    ignore: string[];
    extensions: string[];
  };
  hooks: Partial<Record<HookEventType, HookConfig>>;
}

const DEFAULT_CONFIG: HooksConfig = {
  version: '1.0.0',
  daemon: {
    enabled: true,
    log_level: 'info',
    pid_file: join(process.env.HOME || '/tmp', '.stackmemory', 'hooks.pid'),
    log_file: join(process.env.HOME || '/tmp', '.stackmemory', 'hooks.log'),
  },
  file_watch: {
    enabled: true,
    paths: ['.'],
    ignore: ['node_modules', '.git', 'dist', 'build', '.next', '__pycache__'],
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java'],
  },
  hooks: {
    file_change: {
      enabled: true,
      handler: 'sweep-predict',
      output: 'log',
      debounce_ms: 2000,
      cooldown_ms: 10000,
    },
    session_start: {
      enabled: true,
      handler: 'context-load',
      output: 'silent',
    },
    suggestion_ready: {
      enabled: true,
      handler: 'display-suggestion',
      output: 'overlay',
    },
  },
};

export function getConfigPath(): string {
  return join(process.env.HOME || '/tmp', '.stackmemory', 'hooks.yaml');
}

export function loadConfig(): HooksConfig {
  const configPath = getConfigPath();

  if (!existsSync(configPath)) {
    return DEFAULT_CONFIG;
  }

  try {
    const content = readFileSync(configPath, 'utf-8');
    const parsed = parseYaml(content);
    return mergeConfig(DEFAULT_CONFIG, parsed);
  } catch {
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: HooksConfig): void {
  const configPath = getConfigPath();
  const dir = dirname(configPath);

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const yaml = toYaml(config);
  writeFileSync(configPath, yaml);
}

export function initConfig(): HooksConfig {
  const configPath = getConfigPath();

  if (existsSync(configPath)) {
    return loadConfig();
  }

  saveConfig(DEFAULT_CONFIG);
  return DEFAULT_CONFIG;
}

function parseYaml(content: string): Partial<HooksConfig> {
  const result: Record<string, unknown> = {};
  const lines = content.split('\n');
  const stack: { indent: number; obj: Record<string, unknown> }[] = [
    { indent: -1, obj: result },
  ];

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) continue;

    const indent = line.search(/\S/);
    const trimmed = line.trim();

    while (stack.length > 1 && stack[stack.length - 1].indent >= indent) {
      stack.pop();
    }

    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;

    const key = trimmed.slice(0, colonIdx).trim();
    const value = trimmed.slice(colonIdx + 1).trim();

    const current = stack[stack.length - 1].obj;

    if (value === '' || value === '|') {
      current[key] = {};
      stack.push({ indent, obj: current[key] as Record<string, unknown> });
    } else if (value.startsWith('[') && value.endsWith(']')) {
      current[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/['"]/g, ''));
    } else if (value === 'true') {
      current[key] = true;
    } else if (value === 'false') {
      current[key] = false;
    } else if (/^\d+$/.test(value)) {
      current[key] = parseInt(value, 10);
    } else {
      current[key] = value.replace(/['"]/g, '');
    }
  }

  return result as Partial<HooksConfig>;
}

function toYaml(obj: unknown, indent = 0): string {
  const spaces = '  '.repeat(indent);
  let result = '';

  if (Array.isArray(obj)) {
    result += `[${obj.map((v) => (typeof v === 'string' ? `'${v}'` : v)).join(', ')}]\n`;
  } else if (typeof obj === 'object' && obj !== null) {
    for (const [key, value] of Object.entries(obj)) {
      if (
        typeof value === 'object' &&
        value !== null &&
        !Array.isArray(value)
      ) {
        result += `${spaces}${key}:\n${toYaml(value, indent + 1)}`;
      } else {
        result += `${spaces}${key}: ${toYaml(value, indent)}`;
      }
    }
  } else if (typeof obj === 'string') {
    result += `${obj}\n`;
  } else if (typeof obj === 'boolean' || typeof obj === 'number') {
    result += `${obj}\n`;
  } else {
    result += '\n';
  }

  return result;
}

function mergeConfig(
  defaults: HooksConfig,
  overrides: Partial<HooksConfig>
): HooksConfig {
  return {
    ...defaults,
    ...overrides,
    daemon: { ...defaults.daemon, ...(overrides.daemon || {}) },
    file_watch: { ...defaults.file_watch, ...(overrides.file_watch || {}) },
    hooks: { ...defaults.hooks, ...(overrides.hooks || {}) },
  };
}
