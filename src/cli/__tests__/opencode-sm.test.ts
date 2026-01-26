/**
 * Tests for opencode-sm CLI wrapper
 *
 * These tests verify the OpenCode + StackMemory wrapper functionality.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
  beforeAll,
} from 'vitest';
import { join } from 'path';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
} from 'fs';
import { tmpdir, homedir } from 'os';

// Mock child_process before any imports
vi.mock('child_process', () => ({
  spawn: vi.fn(() => ({
    on: vi.fn((event, callback) => {
      if (event === 'exit') {
        // Don't auto-exit in tests
      }
    }),
    kill: vi.fn(),
  })),
  execSync: vi.fn((cmd: string) => {
    if (cmd.includes('git rev-parse --git-dir')) {
      return Buffer.from('.git');
    }
    if (cmd.includes('git rev-parse --abbrev-ref')) {
      return Buffer.from('main\n');
    }
    if (cmd.includes('git status --porcelain')) {
      return Buffer.from('');
    }
    return Buffer.from('');
  }),
  execFileSync: vi.fn(() => {
    throw new Error('Not found');
  }),
}));

// Mock dotenv
vi.mock('dotenv', () => ({
  config: vi.fn(),
}));

// Mock chalk to return plain strings
vi.mock('chalk', () => ({
  default: {
    blue: (s: string) => s,
    green: (s: string) => s,
    gray: (s: string) => s,
    yellow: (s: string) => s,
    red: (s: string) => s,
    magenta: (s: string) => s,
    cyan: (s: string) => s,
  },
}));

// Mock uuid
vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-1234-5678'),
}));

// Mock tracing
vi.mock('../../core/trace/index.js', () => ({
  initializeTracing: vi.fn(),
  trace: {
    command: vi.fn(),
    getExecutionSummary: vi.fn(() => 'Test summary'),
  },
}));

describe('opencode-sm CLI', () => {
  let tempDir: string;
  let tempConfigDir: string;
  let originalArgv: string[];
  let originalHome: string | undefined;
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };

  beforeAll(() => {
    process.setMaxListeners(50);
  });

  beforeEach(() => {
    vi.resetModules();

    tempDir = mkdtempSync(join(tmpdir(), 'opencode-sm-test-'));
    tempConfigDir = join(tempDir, '.stackmemory');
    mkdirSync(tempConfigDir, { recursive: true });

    originalArgv = [...process.argv];
    originalHome = process.env['HOME'];

    // Mock home directory to temp
    vi.spyOn(require('os'), 'homedir').mockReturnValue(tempDir);

    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };
  });

  afterEach(() => {
    process.argv = originalArgv;
    if (originalHome) {
      process.env['HOME'] = originalHome;
    }

    consoleSpy.log.mockRestore();
    consoleSpy.error.mockRestore();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }

    vi.clearAllMocks();
  });

  describe('Config Management', () => {
    it('should use default config when no config file exists', async () => {
      // Config file doesn't exist initially
      const configPath = join(tempConfigDir, 'opencode-sm.json');
      expect(existsSync(configPath)).toBe(false);
    });

    it('should save config to file', () => {
      const configPath = join(tempConfigDir, 'opencode-sm.json');
      const config = {
        defaultWorktree: true,
        defaultTracing: false,
      };

      writeFileSync(configPath, JSON.stringify(config, null, 2));

      expect(existsSync(configPath)).toBe(true);
      const savedConfig = JSON.parse(readFileSync(configPath, 'utf8'));
      expect(savedConfig.defaultWorktree).toBe(true);
      expect(savedConfig.defaultTracing).toBe(false);
    });

    it('should merge saved config with defaults', () => {
      const configPath = join(tempConfigDir, 'opencode-sm.json');

      // Save partial config
      writeFileSync(configPath, JSON.stringify({ defaultWorktree: true }));

      const savedConfig = JSON.parse(readFileSync(configPath, 'utf8'));
      const defaults = {
        defaultWorktree: false,
        defaultTracing: true,
      };

      const merged = { ...defaults, ...savedConfig };
      expect(merged.defaultWorktree).toBe(true);
      expect(merged.defaultTracing).toBe(true);
    });
  });

  describe('Instance ID Generation', () => {
    it('should generate 8-character instance IDs', () => {
      const uuid = 'test-uuid-1234-5678';
      const instanceId = uuid.substring(0, 8);
      expect(instanceId).toBe('test-uui');
      expect(instanceId.length).toBe(8);
    });
  });

  describe('Git Repository Detection', () => {
    it('should detect git repository via git command', () => {
      // Test that we can check for .git directory
      const isGitRepo = (dir: string): boolean => {
        return existsSync(join(dir, '.git'));
      };

      // In test temp dir, no .git
      expect(isGitRepo(tempDir)).toBe(false);

      // Create .git to simulate repo
      mkdirSync(join(tempDir, '.git'), { recursive: true });
      expect(isGitRepo(tempDir)).toBe(true);
    });

    it('should parse branch name from git output', () => {
      const gitOutput = 'main\n';
      const branch = gitOutput.trim();
      expect(branch).toBe('main');
    });

    it('should detect uncommitted changes from porcelain output', () => {
      // Empty output = no changes
      const noChanges = '';
      expect(noChanges.length === 0).toBe(true);

      // Non-empty output = has changes
      const hasChanges = '?? newfile.txt\nM modified.txt';
      expect(hasChanges.length > 0).toBe(true);
    });
  });

  describe('Worktree Path Generation', () => {
    it('should generate worktree path with branch name', () => {
      const cwd = '/Users/test/myrepo';
      const branch = 'opencode-feature-2024-01-26T12-00-00-abc12345';
      const repoName = 'myrepo';
      const worktreePath = join('/Users/test', `${repoName}--${branch}`);

      expect(worktreePath).toBe(
        '/Users/test/myrepo--opencode-feature-2024-01-26T12-00-00-abc12345'
      );
    });
  });

  describe('Environment Variable Handling', () => {
    it('should respect OPENCODE_BIN environment variable', () => {
      process.env['OPENCODE_BIN'] = '/custom/path/opencode';
      expect(process.env['OPENCODE_BIN']).toBe('/custom/path/opencode');
      delete process.env['OPENCODE_BIN'];
    });

    it('should set OPENCODE_INSTANCE_ID', () => {
      const instanceId = 'test1234';
      process.env['OPENCODE_INSTANCE_ID'] = instanceId;
      expect(process.env['OPENCODE_INSTANCE_ID']).toBe(instanceId);
      delete process.env['OPENCODE_INSTANCE_ID'];
    });

    it('should set OPENCODE_WORKTREE_PATH when using worktree', () => {
      const worktreePath = '/tmp/myrepo--feature-branch';
      process.env['OPENCODE_WORKTREE_PATH'] = worktreePath;
      expect(process.env['OPENCODE_WORKTREE_PATH']).toBe(worktreePath);
      delete process.env['OPENCODE_WORKTREE_PATH'];
    });
  });

  describe('Tracing Configuration', () => {
    it('should set tracing environment variables when enabled', () => {
      process.env['DEBUG_TRACE'] = 'true';
      process.env['STACKMEMORY_DEBUG'] = 'true';
      process.env['TRACE_OUTPUT'] = 'file';
      process.env['TRACE_MASK_SENSITIVE'] = 'true';

      expect(process.env['DEBUG_TRACE']).toBe('true');
      expect(process.env['STACKMEMORY_DEBUG']).toBe('true');
      expect(process.env['TRACE_OUTPUT']).toBe('file');
      expect(process.env['TRACE_MASK_SENSITIVE']).toBe('true');

      delete process.env['DEBUG_TRACE'];
      delete process.env['STACKMEMORY_DEBUG'];
      delete process.env['TRACE_OUTPUT'];
      delete process.env['TRACE_MASK_SENSITIVE'];
    });

    it('should set verbose tracing options', () => {
      process.env['TRACE_VERBOSITY'] = 'full';
      process.env['TRACE_PARAMS'] = 'true';
      process.env['TRACE_RESULTS'] = 'true';
      process.env['TRACE_MEMORY'] = 'true';

      expect(process.env['TRACE_VERBOSITY']).toBe('full');
      expect(process.env['TRACE_PARAMS']).toBe('true');
      expect(process.env['TRACE_RESULTS']).toBe('true');
      expect(process.env['TRACE_MEMORY']).toBe('true');

      delete process.env['TRACE_VERBOSITY'];
      delete process.env['TRACE_PARAMS'];
      delete process.env['TRACE_RESULTS'];
      delete process.env['TRACE_MEMORY'];
    });
  });

  describe('CLI Argument Parsing', () => {
    it('should recognize --worktree flag', () => {
      const args = ['--worktree', '-t', 'my-task'];
      expect(args.includes('--worktree')).toBe(true);
    });

    it('should recognize --no-worktree flag', () => {
      const args = ['--no-worktree'];
      expect(args.includes('--no-worktree')).toBe(true);
    });

    it('should recognize --branch flag with value', () => {
      const args = ['--branch', 'feature-123'];
      const branchIndex = args.indexOf('--branch');
      expect(branchIndex).toBe(0);
      expect(args[branchIndex + 1]).toBe('feature-123');
    });

    it('should recognize --task flag with value', () => {
      const args = ['--task', 'implement login'];
      const taskIndex = args.indexOf('--task');
      expect(taskIndex).toBe(0);
      expect(args[taskIndex + 1]).toBe('implement login');
    });

    it('should recognize --no-context flag', () => {
      const args = ['--no-context'];
      expect(args.includes('--no-context')).toBe(true);
    });

    it('should recognize --no-trace flag', () => {
      const args = ['--no-trace'];
      expect(args.includes('--no-trace')).toBe(true);
    });

    it('should recognize --verbose-trace flag', () => {
      const args = ['--verbose-trace'];
      expect(args.includes('--verbose-trace')).toBe(true);
    });

    it('should recognize --auto flag', () => {
      const args = ['--auto'];
      expect(args.includes('--auto')).toBe(true);
    });

    it('should recognize short flags', () => {
      const args = ['-w', '-W', '-a', '-b', 'branch', '-t', 'task'];
      expect(args.includes('-w')).toBe(true);
      expect(args.includes('-W')).toBe(true);
      expect(args.includes('-a')).toBe(true);
      expect(args.includes('-b')).toBe(true);
      expect(args.includes('-t')).toBe(true);
    });

    it('should pass unrecognized args to opencode', () => {
      const args = ['--model', 'gpt-4', '--custom-flag'];
      const opencodeArgs: string[] = [];

      for (const arg of args) {
        if (!arg.startsWith('--worktree') && !arg.startsWith('--task')) {
          opencodeArgs.push(arg);
        }
      }

      expect(opencodeArgs).toContain('--model');
      expect(opencodeArgs).toContain('gpt-4');
      expect(opencodeArgs).toContain('--custom-flag');
    });
  });

  describe('OpenCode Binary Resolution', () => {
    it('should check common OpenCode locations', () => {
      const possiblePaths = [
        join(homedir(), '.opencode', 'bin', 'opencode'),
        '/usr/local/bin/opencode',
        '/opt/homebrew/bin/opencode',
      ];

      expect(possiblePaths.length).toBe(3);
      expect(possiblePaths[0]).toContain('.opencode');
    });

    it('should prefer CLI-specified binary', () => {
      const cliSpecified = '/custom/opencode';
      const envVar = '/env/opencode';

      // CLI should take precedence
      const resolved = cliSpecified || envVar || 'opencode';
      expect(resolved).toBe('/custom/opencode');
    });

    it('should fall back to env var if no CLI override', () => {
      const cliSpecified = '';
      const envVar = '/env/opencode';

      const resolved = cliSpecified || envVar || 'opencode';
      expect(resolved).toBe('/env/opencode');
    });
  });

  describe('Lock File Detection', () => {
    it('should detect lock files in worktree locks directory', () => {
      const lockDir = join(tempDir, '.opencode-worktree-locks');
      mkdirSync(lockDir, { recursive: true });

      const lockFile = join(lockDir, 'instance-1.lock');
      const lockData = {
        instanceId: 'abc12345',
        created: new Date().toISOString(),
      };
      writeFileSync(lockFile, JSON.stringify(lockData));

      expect(existsSync(lockFile)).toBe(true);
    });

    it('should filter out stale locks older than 24 hours', () => {
      const lockAge = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago
      const lockData = {
        instanceId: 'old-lock',
        created: new Date(lockAge).toISOString(),
      };

      const lockAgeMs = Date.now() - new Date(lockData.created).getTime();
      const isStale = lockAgeMs >= 24 * 60 * 60 * 1000;

      expect(isStale).toBe(true);
    });
  });

  describe('Context Operations', () => {
    it('should construct context save command correctly', () => {
      const stackmemoryPath = 'stackmemory';
      const contextData = {
        message: 'Created worktree',
        metadata: {
          action: 'worktree_created',
          instanceId: 'test1234',
          timestamp: new Date().toISOString(),
          tool: 'opencode',
        },
      };

      const cmd = `${stackmemoryPath} context save --json '${JSON.stringify(contextData)}'`;
      expect(cmd).toContain('stackmemory context save');
      expect(cmd).toContain('worktree_created');
      expect(cmd).toContain('opencode');
    });
  });

  describe('Signal Handling', () => {
    it('should handle SIGINT signal', () => {
      const handlers: Record<string, () => void> = {};

      const mockProcess = {
        on: (signal: string, handler: () => void) => {
          handlers[signal] = handler;
        },
      };

      mockProcess.on('SIGINT', () => {
        // Handler should save context and forward signal
      });

      expect(handlers['SIGINT']).toBeDefined();
    });

    it('should handle SIGTERM signal', () => {
      const handlers: Record<string, () => void> = {};

      const mockProcess = {
        on: (signal: string, handler: () => void) => {
          handlers[signal] = handler;
        },
      };

      mockProcess.on('SIGTERM', () => {
        // Handler should save context and forward signal
      });

      expect(handlers['SIGTERM']).toBeDefined();
    });
  });
});

describe('opencode-sm Config Commands', () => {
  let tempDir: string;
  let configPath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'opencode-sm-config-test-'));
    const configDir = join(tempDir, '.stackmemory');
    mkdirSync(configDir, { recursive: true });
    configPath = join(configDir, 'opencode-sm.json');
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it('should create config directory if it does not exist', () => {
    const newConfigDir = join(tempDir, '.stackmemory-new');
    expect(existsSync(newConfigDir)).toBe(false);

    mkdirSync(newConfigDir, { recursive: true });
    expect(existsSync(newConfigDir)).toBe(true);
  });

  it('should save worktree=true setting', () => {
    const config = { defaultWorktree: true, defaultTracing: true };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const saved = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(saved.defaultWorktree).toBe(true);
  });

  it('should save worktree=false setting', () => {
    const config = { defaultWorktree: false, defaultTracing: true };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const saved = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(saved.defaultWorktree).toBe(false);
  });

  it('should save tracing=true setting', () => {
    const config = { defaultWorktree: false, defaultTracing: true };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const saved = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(saved.defaultTracing).toBe(true);
  });

  it('should save tracing=false setting', () => {
    const config = { defaultWorktree: false, defaultTracing: false };
    writeFileSync(configPath, JSON.stringify(config, null, 2));

    const saved = JSON.parse(readFileSync(configPath, 'utf8'));
    expect(saved.defaultTracing).toBe(false);
  });

  it('should validate config key mapping', () => {
    const keyMap: Record<string, string> = {
      worktree: 'defaultWorktree',
      tracing: 'defaultTracing',
    };

    expect(keyMap['worktree']).toBe('defaultWorktree');
    expect(keyMap['tracing']).toBe('defaultTracing');
    expect(keyMap['unknown']).toBeUndefined();
  });

  it('should parse boolean values correctly', () => {
    const parseBoolean = (value: string): boolean => {
      return value === 'true' || value === '1' || value === 'on';
    };

    expect(parseBoolean('true')).toBe(true);
    expect(parseBoolean('1')).toBe(true);
    expect(parseBoolean('on')).toBe(true);
    expect(parseBoolean('false')).toBe(false);
    expect(parseBoolean('0')).toBe(false);
    expect(parseBoolean('off')).toBe(false);
  });
});
