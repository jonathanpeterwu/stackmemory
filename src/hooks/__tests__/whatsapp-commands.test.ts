/**
 * Tests for WhatsApp command processor
 *
 * Tests command parsing, execution, and configuration management
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// Mock dependencies before imports
vi.mock('../sms-action-runner.js', () => ({
  executeActionSafe: vi.fn().mockResolvedValue({
    success: true,
    output: 'Command executed successfully',
  }),
}));

vi.mock('../whatsapp-sync.js', () => ({
  syncContext: vi.fn().mockResolvedValue({
    success: true,
    digestLength: 350,
  }),
  getFrameDigestData: vi.fn().mockResolvedValue({
    frameId: 'test-frame-123',
    name: 'Test Frame',
    type: 'task',
    status: 'success',
    durationSeconds: 120,
    filesModified: [{ path: 'src/test.ts', operation: 'modify' }],
    testsRun: [{ name: 'Test 1', status: 'passed' }],
    decisions: ['Used TypeScript'],
    risks: [],
    toolCallCount: 5,
    errors: [],
  }),
  generateMobileDigest: vi.fn().mockReturnValue('FRAME: Test [task] - 2m OK'),
  loadSyncOptions: vi.fn().mockReturnValue({
    autoSyncOnClose: false,
    minFrameDuration: 30,
    includeDecisions: true,
    includeFiles: true,
    includeTests: true,
    maxDigestLength: 400,
  }),
}));

vi.mock('../sms-notify.js', () => ({
  sendNotification: vi.fn().mockResolvedValue({
    success: true,
    promptId: 'test-prompt-123',
    channel: 'whatsapp',
  }),
}));

import {
  isCommand,
  processCommand,
  loadCommandsConfig,
  saveCommandsConfig,
  enableCommands,
  disableCommands,
  isCommandsEnabled,
  addCommand,
  removeCommand,
  getAvailableCommands,
  type WhatsAppCommand,
  type CommandsConfig,
} from '../whatsapp-commands.js';
import { executeActionSafe } from '../sms-action-runner.js';
import { syncContext, getFrameDigestData } from '../whatsapp-sync.js';

const CONFIG_PATH = join(homedir(), '.stackmemory', 'whatsapp-commands.json');
let originalConfig: string | null = null;

describe('WhatsApp Commands', () => {
  beforeEach(() => {
    // Save original config
    if (existsSync(CONFIG_PATH)) {
      originalConfig = readFileSync(CONFIG_PATH, 'utf8');
    }

    // Create directory if needed
    mkdirSync(join(homedir(), '.stackmemory'), { recursive: true });

    // Write clean test config
    writeFileSync(
      CONFIG_PATH,
      JSON.stringify({
        enabled: true,
        commands: [
          {
            name: 'status',
            description: 'Get current task/frame status',
            enabled: true,
            // No action - handled specially in-process
          },
          {
            name: 'tasks',
            description: 'List active tasks',
            enabled: true,
            // No action - handled specially in-process
          },
          {
            name: 'context',
            description: 'Get latest context digest',
            enabled: true,
          },
          {
            name: 'approve',
            description: 'Approve a PR (requires PR number)',
            enabled: true,
            requiresArg: true,
            argPattern: '^\\d+$',
          },
          {
            name: 'merge',
            description: 'Merge a PR (requires PR number)',
            enabled: true,
            requiresArg: true,
            argPattern: '^\\d+$',
          },
          {
            name: 'help',
            description: 'List available commands',
            enabled: true,
          },
          {
            name: 'sync',
            description: 'Push current context to WhatsApp',
            enabled: true,
          },
          {
            name: 'disabled-cmd',
            description: 'A disabled command',
            enabled: false,
            action: 'echo disabled',
          },
        ],
      })
    );

    // Reset mocks
    vi.clearAllMocks();
  });

  afterEach(() => {
    // Restore original config
    if (originalConfig) {
      writeFileSync(CONFIG_PATH, originalConfig);
    } else if (existsSync(CONFIG_PATH)) {
      unlinkSync(CONFIG_PATH);
    }
    originalConfig = null;
  });

  describe('isCommand', () => {
    it('should return true for valid enabled commands', () => {
      expect(isCommand('status')).toBe(true);
      expect(isCommand('tasks')).toBe(true);
      expect(isCommand('help')).toBe(true);
      expect(isCommand('sync')).toBe(true);
      expect(isCommand('context')).toBe(true);
    });

    it('should return true for commands with arguments', () => {
      expect(isCommand('approve 123')).toBe(true);
      expect(isCommand('merge 456')).toBe(true);
    });

    it('should be case insensitive', () => {
      expect(isCommand('STATUS')).toBe(true);
      expect(isCommand('Status')).toBe(true);
      expect(isCommand('HELP')).toBe(true);
    });

    it('should return false for invalid commands', () => {
      expect(isCommand('invalid')).toBe(false);
      expect(isCommand('unknown')).toBe(false);
      expect(isCommand('')).toBe(false);
      expect(isCommand('random text')).toBe(false);
    });

    it('should return false for disabled commands', () => {
      expect(isCommand('disabled-cmd')).toBe(false);
    });

    it('should return false when commands are globally disabled', () => {
      const config = loadCommandsConfig();
      config.enabled = false;
      saveCommandsConfig(config);

      expect(isCommand('status')).toBe(false);
      expect(isCommand('help')).toBe(false);
    });

    it('should handle whitespace', () => {
      expect(isCommand('  status  ')).toBe(true);
      expect(isCommand('\thelp\n')).toBe(true);
    });
  });

  describe('processCommand', () => {
    describe('help command', () => {
      it('should return help text for help command', async () => {
        const result = await processCommand('+1234567890', 'help');

        expect(result.handled).toBe(true);
        expect(result.response).toContain('Available commands:');
        expect(result.response).toContain('status');
        expect(result.response).toContain('tasks');
        expect(result.response).toContain('help');
      });

      it('should include argument hints for commands that require args', async () => {
        const result = await processCommand('+1234567890', 'help');

        expect(result.response).toContain('approve <arg>');
        expect(result.response).toContain('merge <arg>');
      });

      it('should not include disabled commands in help', async () => {
        const result = await processCommand('+1234567890', 'help');

        expect(result.response).not.toContain('disabled-cmd');
      });
    });

    describe('status command', () => {
      it('should handle status command in-process', async () => {
        const result = await processCommand('+1234567890', 'status');

        expect(result.handled).toBe(true);
        // status is now handled in-process, no executeActionSafe call
        expect(executeActionSafe).not.toHaveBeenCalled();
        // Response comes from in-process handler
        expect(result.response).toBeDefined();
      });
    });

    describe('tasks command', () => {
      it('should handle tasks command in-process', async () => {
        const result = await processCommand('+1234567890', 'tasks');

        expect(result.handled).toBe(true);
        // tasks is now handled in-process, no executeActionSafe call
        expect(executeActionSafe).not.toHaveBeenCalled();
        // Response comes from in-process handler
        expect(result.response).toBeDefined();
      });
    });

    describe('context command', () => {
      it('should return context digest', async () => {
        const result = await processCommand('+1234567890', 'context');

        expect(result.handled).toBe(true);
        expect(getFrameDigestData).toHaveBeenCalled();
        expect(result.response).toContain('FRAME:');
      });

      it('should handle no context available', async () => {
        vi.mocked(getFrameDigestData).mockResolvedValueOnce(null);

        const result = await processCommand('+1234567890', 'context');

        expect(result.handled).toBe(true);
        expect(result.response).toContain('No context available');
      });
    });

    describe('sync command', () => {
      it('should sync context successfully', async () => {
        const result = await processCommand('+1234567890', 'sync');

        expect(result.handled).toBe(true);
        expect(syncContext).toHaveBeenCalled();
        expect(result.response).toContain('Context synced');
        expect(result.response).toContain('350 chars');
      });

      it('should handle sync failure', async () => {
        vi.mocked(syncContext).mockResolvedValueOnce({
          success: false,
          error: 'No data to sync',
        });

        const result = await processCommand('+1234567890', 'sync');

        expect(result.handled).toBe(true);
        expect(result.response).toContain('Sync failed');
        expect(result.response).toContain('No data to sync');
      });
    });

    describe('approve command', () => {
      it('should approve PR with valid number', async () => {
        // The approve command has no initial action, but special handling builds it
        // First, update the command to have an action so the special handling triggers
        addCommand({
          name: 'approve',
          description: 'Approve a PR',
          enabled: true,
          requiresArg: true,
          argPattern: '^\\d+$',
          action: 'gh pr review', // Base action for special handling
        });

        const result = await processCommand('+1234567890', 'approve 123');

        expect(result.handled).toBe(true);
        expect(executeActionSafe).toHaveBeenCalledWith(
          'gh pr review 123 --approve',
          'approve 123'
        );
      });

      it('should require argument', async () => {
        const result = await processCommand('+1234567890', 'approve');

        expect(result.handled).toBe(true);
        expect(result.error).toBe('Missing argument');
        expect(result.response).toContain('requires an argument');
      });

      it('should validate argument pattern', async () => {
        const result = await processCommand('+1234567890', 'approve abc');

        expect(result.handled).toBe(true);
        expect(result.error).toBe('Invalid argument format');
        expect(result.response).toContain('Invalid argument format');
      });
    });

    describe('merge command', () => {
      it('should merge PR with valid number', async () => {
        // The merge command has no initial action, but special handling builds it
        // First, update the command to have an action so the special handling triggers
        addCommand({
          name: 'merge',
          description: 'Merge a PR',
          enabled: true,
          requiresArg: true,
          argPattern: '^\\d+$',
          action: 'gh pr merge', // Base action for special handling
        });

        const result = await processCommand('+1234567890', 'merge 456');

        expect(result.handled).toBe(true);
        expect(executeActionSafe).toHaveBeenCalledWith(
          'gh pr merge 456 --squash',
          'merge 456'
        );
      });

      it('should require argument', async () => {
        const result = await processCommand('+1234567890', 'merge');

        expect(result.handled).toBe(true);
        expect(result.error).toBe('Missing argument');
      });

      it('should reject non-numeric PR numbers', async () => {
        const result = await processCommand('+1234567890', 'merge pr-123');

        expect(result.handled).toBe(true);
        expect(result.error).toBe('Invalid argument format');
      });
    });

    describe('invalid commands', () => {
      it('should return handled:false for unknown commands', async () => {
        const result = await processCommand('+1234567890', 'unknown');

        expect(result.handled).toBe(false);
      });

      it('should return handled:false for empty messages', async () => {
        const result = await processCommand('+1234567890', '');

        expect(result.handled).toBe(false);
      });

      it('should return handled:false when commands disabled', async () => {
        disableCommands();

        const result = await processCommand('+1234567890', 'status');

        expect(result.handled).toBe(false);
      });
    });
  });

  describe('loadCommandsConfig / saveCommandsConfig', () => {
    it('should load default config when no file exists', () => {
      unlinkSync(CONFIG_PATH);

      const config = loadCommandsConfig();

      expect(config.enabled).toBe(true);
      expect(config.commands.length).toBeGreaterThan(0);
      expect(config.commands.some((c) => c.name === 'status')).toBe(true);
    });

    it('should load config from file', () => {
      const customConfig: CommandsConfig = {
        enabled: false,
        commands: [
          { name: 'custom', description: 'Custom command', enabled: true },
        ],
      };
      writeFileSync(CONFIG_PATH, JSON.stringify(customConfig));

      const config = loadCommandsConfig();

      expect(config.enabled).toBe(false);
      expect(config.commands.some((c) => c.name === 'custom')).toBe(true);
    });

    it('should save config to file', () => {
      const config: CommandsConfig = {
        enabled: true,
        commands: [
          {
            name: 'test',
            description: 'Test command',
            enabled: true,
            action: 'echo test',
          },
        ],
      };

      saveCommandsConfig(config);

      const saved = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'));
      expect(saved.enabled).toBe(true);
      expect(saved.commands[0].name).toBe('test');
    });

    it('should handle invalid JSON gracefully', () => {
      writeFileSync(CONFIG_PATH, 'invalid json {{{');

      const config = loadCommandsConfig();

      // Should return default config
      expect(config.enabled).toBe(true);
      expect(config.commands.length).toBeGreaterThan(0);
    });
  });

  describe('enableCommands / disableCommands', () => {
    it('should enable commands', () => {
      disableCommands();
      expect(isCommandsEnabled()).toBe(false);

      enableCommands();
      expect(isCommandsEnabled()).toBe(true);
    });

    it('should disable commands', () => {
      enableCommands();
      expect(isCommandsEnabled()).toBe(true);

      disableCommands();
      expect(isCommandsEnabled()).toBe(false);
    });

    it('should persist enable state', () => {
      enableCommands();

      // Reload and check
      const config = loadCommandsConfig();
      expect(config.enabled).toBe(true);
    });

    it('should persist disable state', () => {
      disableCommands();

      // Reload and check
      const config = loadCommandsConfig();
      expect(config.enabled).toBe(false);
    });
  });

  describe('addCommand / removeCommand', () => {
    it('should add a new command', () => {
      const newCmd: WhatsAppCommand = {
        name: 'newcmd',
        description: 'A new command',
        enabled: true,
        action: 'echo new',
      };

      addCommand(newCmd);

      const config = loadCommandsConfig();
      const added = config.commands.find((c) => c.name === 'newcmd');
      expect(added).toBeDefined();
      expect(added?.description).toBe('A new command');
    });

    it('should update existing command', () => {
      const updatedCmd: WhatsAppCommand = {
        name: 'status',
        description: 'Updated status command',
        enabled: true,
        action: 'stackmemory status --verbose',
      };

      addCommand(updatedCmd);

      const config = loadCommandsConfig();
      const statusCmd = config.commands.find((c) => c.name === 'status');
      expect(statusCmd?.description).toBe('Updated status command');
      expect(statusCmd?.action).toBe('stackmemory status --verbose');
    });

    it('should handle case insensitive command names when updating', () => {
      const updatedCmd: WhatsAppCommand = {
        name: 'STATUS',
        description: 'Uppercase update',
        enabled: true,
        action: 'stackmemory status',
      };

      addCommand(updatedCmd);

      const config = loadCommandsConfig();
      // Should update existing, not add new
      const statusCommands = config.commands.filter(
        (c) => c.name.toLowerCase() === 'status'
      );
      expect(statusCommands.length).toBe(1);
    });

    it('should remove a command', () => {
      const result = removeCommand('status');

      expect(result).toBe(true);
      const config = loadCommandsConfig();
      expect(config.commands.find((c) => c.name === 'status')).toBeUndefined();
    });

    it('should return false when removing non-existent command', () => {
      const result = removeCommand('nonexistent');

      expect(result).toBe(false);
    });

    it('should remove command case insensitively', () => {
      const result = removeCommand('STATUS');

      expect(result).toBe(true);
      const config = loadCommandsConfig();
      expect(config.commands.find((c) => c.name === 'status')).toBeUndefined();
    });
  });

  describe('getAvailableCommands', () => {
    it('should return only enabled commands', () => {
      const commands = getAvailableCommands();

      expect(commands.length).toBeGreaterThan(0);
      expect(commands.every((c) => c.enabled)).toBe(true);
      expect(commands.find((c) => c.name === 'disabled-cmd')).toBeUndefined();
    });

    it('should include all default commands when enabled', () => {
      const commands = getAvailableCommands();

      const commandNames = commands.map((c) => c.name);
      expect(commandNames).toContain('status');
      expect(commandNames).toContain('tasks');
      expect(commandNames).toContain('help');
      expect(commandNames).toContain('sync');
      expect(commandNames).toContain('context');
    });
  });

  describe('command with special handling (tasks)', () => {
    it('should handle tasks command in-process', async () => {
      const result = await processCommand('+1234567890', 'tasks');

      expect(result.handled).toBe(true);
      // tasks command is now handled specially, no action field
      expect(result.action).toBeUndefined();
      // Response comes from in-process handler
      expect(result.response).toBeDefined();
    });
  });

  describe('command without action', () => {
    it('should acknowledge command without action', async () => {
      // Add a command with no action
      addCommand({
        name: 'ping',
        description: 'Simple ping',
        enabled: true,
        // No action defined
      });

      const result = await processCommand('+1234567890', 'ping');

      expect(result.handled).toBe(true);
      expect(result.response).toContain('Command ping acknowledged');
    });
  });
});
