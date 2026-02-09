/**
 * Tests for StackMemory CLI Commands
 *
 * These tests verify CLI command registration and basic functionality.
 * They use mocks to isolate the CLI from external dependencies.
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
import { mkdtempSync, rmSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { tmpdir } from 'os';

// Hoist all mocks before any imports
vi.mock('../core/monitoring/logger', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
  },
}));

vi.mock('better-sqlite3', () => ({
  default: vi.fn().mockImplementation(() => ({
    exec: vi.fn(),
    prepare: vi.fn(() => ({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(() => []),
    })),
    close: vi.fn(),
  })),
}));

vi.mock('child_process', () => ({
  exec: vi.fn((cmd, callback) => {
    if (callback) {
      callback(null, '', '');
    }
  }),
  execSync: vi.fn(() => ''),
  spawn: vi.fn(() => ({
    on: vi.fn(),
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
  })),
}));

vi.mock('util', async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    promisify: vi.fn(() =>
      vi.fn().mockResolvedValue({ stdout: '', stderr: '' })
    ),
  };
});

// Mock the subagent client
vi.mock('../../integrations/claude-code/subagent-client', () => ({
  ClaudeCodeSubagentClient: vi.fn().mockImplementation(() => ({
    executeSubagent: vi.fn().mockResolvedValue({
      success: true,
      result: { message: 'Mocked subagent result' },
      tokens: 100,
    }),
  })),
}));

vi.mock('../core/context/frame-manager', () => ({
  FrameManager: vi.fn().mockImplementation(() => ({
    createFrame: vi.fn(() => 'frame-123'),
    getActiveFramePath: vi.fn(() => []),
    getStackDepth: vi.fn(() => 0),
    getHotStackContext: vi.fn(() => []),
    addEvent: vi.fn(),
    closeFrame: vi.fn(),
  })),
}));

vi.mock('../features/tasks/linear-task-manager.js', () => ({
  LinearTaskManager: vi.fn().mockImplementation(() => ({
    createTask: vi.fn(() => 'task-123'),
    getActiveTasks: vi.fn(() => []),
    getMetrics: vi.fn(() => ({
      total_tasks: 0,
      completion_rate: 0,
      blocked_tasks: 0,
    })),
  })),
}));

vi.mock('../integrations/linear/auth', () => ({
  LinearAuthManager: vi.fn().mockImplementation(() => ({
    isConfigured: vi.fn(() => false),
    loadConfig: vi.fn(),
    loadTokens: vi.fn(),
  })),
  LinearOAuthSetup: vi.fn().mockImplementation(() => ({
    setupInteractive: vi.fn(),
    completeAuth: vi.fn(),
    testConnection: vi.fn(),
  })),
}));

vi.mock('../integrations/linear/sync', () => ({
  LinearSyncEngine: vi.fn().mockImplementation(() => ({
    sync: vi.fn(() => ({
      success: true,
      synced: { toLinear: 1, fromLinear: 2, updated: 0 },
      conflicts: [],
      errors: [],
    })),
  })),
  DEFAULT_SYNC_CONFIG: {
    enabled: true,
    direction: 'bidirectional',
  },
}));

vi.mock('../integrations/linear/auto-sync.js', () => ({
  initializeAutoSync: vi.fn(),
  getAutoSyncService: vi.fn(() => null),
  stopAutoSync: vi.fn(),
}));

vi.mock('../integrations/linear/config.js', () => ({
  LinearConfigManager: vi.fn().mockImplementation(() => ({
    loadConfig: vi.fn(() => null),
    saveConfig: vi.fn(),
  })),
}));

// Mock update checker to do nothing
vi.mock('../core/utils/update-checker', () => ({
  UpdateChecker: {
    checkForUpdates: vi.fn().mockResolvedValue(undefined),
    forceCheck: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock('../core/monitoring/progress-tracker', () => ({
  ProgressTracker: vi.fn().mockImplementation(() => ({
    getSummary: vi.fn(() => 'Progress summary'),
    updateLinearStatus: vi.fn(),
  })),
}));

vi.mock('child_process', () => ({
  execSync: vi.fn(() => Buffer.from('mock git output')),
}));

// Mock all command registration modules
const mockRegisterProjectCommands = vi.fn();
const mockRegisterLinearCommands = vi.fn();
const mockRegisterLinearTestCommand = vi.fn();
const mockCreateSessionCommands = vi.fn();
const mockRegisterWorktreeCommands = vi.fn();
const mockRegisterOnboardingCommand = vi.fn();
const mockWebhookCommand = vi.fn(() => ({ name: 'webhook' }));
const mockRegisterTaskCommands = vi.fn();
const mockRegisterSearchCommands = vi.fn();
const mockRegisterLogCommands = vi.fn();
const mockRegisterContextCommands = vi.fn();

vi.mock('./commands/projects', () => ({
  registerProjectCommands: mockRegisterProjectCommands,
}));

vi.mock('./commands/linear', () => ({
  registerLinearCommands: mockRegisterLinearCommands,
}));

vi.mock('./commands/linear-test', () => ({
  registerLinearTestCommand: mockRegisterLinearTestCommand,
}));

vi.mock('./commands/session', () => ({
  createSessionCommands: mockCreateSessionCommands,
}));

vi.mock('./commands/worktree', () => ({
  registerWorktreeCommands: mockRegisterWorktreeCommands,
}));

vi.mock('./commands/onboard', () => ({
  registerOnboardingCommand: mockRegisterOnboardingCommand,
}));

vi.mock('./commands/webhook', () => ({
  webhookCommand: mockWebhookCommand,
}));

vi.mock('./commands/tasks', () => ({
  registerTaskCommands: mockRegisterTaskCommands,
}));

vi.mock('./commands/search', () => ({
  registerSearchCommands: mockRegisterSearchCommands,
}));

vi.mock('./commands/log', () => ({
  registerLogCommands: mockRegisterLogCommands,
}));

vi.mock('./commands/context', () => ({
  registerContextCommands: mockRegisterContextCommands,
}));

vi.mock('../core/projects/project-manager.js', () => ({
  ProjectManager: {
    getInstance: vi.fn(() => ({
      detectProject: vi.fn(),
    })),
  },
}));

vi.mock('../core/session/index.js', () => ({
  sessionManager: {
    initialize: vi.fn(),
    getOrCreateSession: vi.fn(() => ({
      sessionId: 'test-session-123',
      projectId: 'test-project',
      state: 'active',
      startedAt: Date.now() - 600000,
      branch: 'main',
    })),
    listSessions: vi.fn(() => []),
  },
  FrameQueryMode: {
    CURRENT_SESSION: 'current_session',
    ALL_ACTIVE: 'all_active',
    PROJECT_ACTIVE: 'project_active',
    HISTORICAL: 'historical',
  },
}));

vi.mock('../integrations/mcp/server.js', () => ({
  runMCPServer: vi.fn().mockResolvedValue(undefined),
}));

describe('CLI Commands', () => {
  let tempDir: string;
  let originalArgv: string[];
  let consoleSpy: {
    log: ReturnType<typeof vi.spyOn>;
    error: ReturnType<typeof vi.spyOn>;
  };
  let exitSpy: ReturnType<typeof vi.spyOn>;
  let programModule: { program: any };

  beforeAll(async () => {
    // Prevent multiple listener warnings
    process.setMaxListeners(50);
    // Import once — vi.mock() calls are hoisted and apply globally
    programModule = await import('../index.js');
  });

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'stackmemory-cli-test-'));
    originalArgv = [...process.argv];

    vi.spyOn(process, 'cwd').mockReturnValue(tempDir);

    consoleSpy = {
      log: vi.spyOn(console, 'log').mockImplementation(() => {}),
      error: vi.spyOn(console, 'error').mockImplementation(() => {}),
    };

    exitSpy = vi
      .spyOn(process, 'exit')
      .mockImplementation((() => {}) as () => never);
  });

  afterEach(() => {
    vi.spyOn(process, 'cwd').mockRestore();
    process.argv = originalArgv;

    consoleSpy.log.mockRestore();
    consoleSpy.error.mockRestore();
    exitSpy.mockRestore();

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }

    vi.clearAllMocks();
  });

  describe('init command', () => {
    it('should initialize StackMemory in current directory', async () => {
      const { program } = programModule;

      process.argv = ['node', 'stackmemory', 'init'];
      await program.parseAsync(process.argv);

      const stackmemoryDir = join(tempDir, '.stackmemory');
      expect(existsSync(stackmemoryDir)).toBe(true);
    });
  });

  describe('status command', () => {
    it('should show status when StackMemory is initialized', async () => {
      const dbDir = join(tempDir, '.stackmemory');
      mkdirSync(dbDir, { recursive: true });
      writeFileSync(join(dbDir, 'context.db'), '');

      const { program } = programModule;

      process.argv = ['node', 'stackmemory', 'status'];
      await program.parseAsync(process.argv);

      // Verify the command executed (it outputs session/status info)
      expect(consoleSpy.log).toHaveBeenCalled();
    });

    it('should show error when StackMemory is not initialized', async () => {
      const { program } = programModule;

      process.argv = ['node', 'stackmemory', 'status'];
      await program.parseAsync(process.argv);

      expect(consoleSpy.log).toHaveBeenCalledWith(
        '❌ StackMemory not initialized. Run "stackmemory init" first.'
      );
    });
  });

  describe('update-check command', () => {
    it('should check for updates', async () => {
      const { program } = programModule;

      process.argv = ['node', 'stackmemory', 'update-check'];
      await program.parseAsync(process.argv);

      expect(consoleSpy.log).toHaveBeenCalledWith('🔍 Checking for updates...');
    });
  });

  describe('ping command', () => {
    it('should respond with pong and timestamp', async () => {
      const { program } = programModule;

      process.argv = ['node', 'stackmemory', 'ping'];
      await program.parseAsync(process.argv);

      expect(consoleSpy.log).toHaveBeenCalledWith(
        expect.stringMatching(
          /^pong \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
        )
      );
    });
  });

  describe('mcp-server command', () => {
    it('should start MCP server with default options', async () => {
      const { program } = programModule;

      process.argv = ['node', 'stackmemory', 'mcp-server'];
      await program.parseAsync(process.argv);

      expect(consoleSpy.log).toHaveBeenCalledWith(
        '🚀 Starting StackMemory MCP Server...'
      );
    });

    it('should start MCP server with custom project path', async () => {
      const customPath = '/custom/project/path';

      const { program } = programModule;

      process.argv = [
        'node',
        'stackmemory',
        'mcp-server',
        '--project',
        customPath,
      ];
      await program.parseAsync(process.argv);

      expect(consoleSpy.log).toHaveBeenCalledWith(`   Project: ${customPath}`);
    });
  });

  describe('Command registration', () => {
    it('should export program with registered commands', async () => {
      const { program } = programModule;

      // Verify program is exported and has commands
      expect(program).toBeDefined();
      expect(program.commands.length).toBeGreaterThan(0);

      // Verify key commands are registered
      const commandNames = program.commands.map((cmd) => cmd.name());
      expect(commandNames).toContain('init');
      expect(commandNames).toContain('status');
      expect(commandNames).toContain('mcp-server');
    });
  });

  describe('Error handling', () => {
    it('should handle unknown commands gracefully', async () => {
      const { program } = programModule;
      program.exitOverride();

      process.argv = ['node', 'stackmemory', 'unknown-command'];

      await expect(program.parseAsync(process.argv)).rejects.toThrow();
    });
  });
});
