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
    it('should recognize valid commands (case-insensitive, with args, with whitespace)', () => {
      // Valid enabled commands
      expect(isCommand('status')).toBe(true);
      expect(isCommand('tasks')).toBe(true);
      expect(isCommand('help')).toBe(true);

      // With arguments
      expect(isCommand('approve 123')).toBe(true);

      // Case insensitive
      expect(isCommand('STATUS')).toBe(true);
      expect(isCommand('Status')).toBe(true);

      // With whitespace
      expect(isCommand('  status  ')).toBe(true);
    });

    it('should return false for invalid, disabled, or globally disabled commands', () => {
      // Invalid commands
      expect(isCommand('invalid')).toBe(false);
      expect(isCommand('')).toBe(false);

      // Disabled commands
      expect(isCommand('disabled-cmd')).toBe(false);

      // Globally disabled
      const config = loadCommandsConfig();
      config.enabled = false;
      saveCommandsConfig(config);
      expect(isCommand('status')).toBe(false);
    });
  });

  describe('processCommand', () => {
    describe('built-in commands', () => {
      it('should return help text with available commands and argument hints', async () => {
        const result = await processCommand('+1234567890', 'help');
        expect(result.handled).toBe(true);
        expect(result.response).toContain('Available commands:');
        expect(result.response).toContain('status');
        expect(result.response).toContain('approve <arg>');
        expect(result.response).not.toContain('disabled-cmd');
      });

      it('should handle status and tasks commands in-process', async () => {
        const statusResult = await processCommand('+1234567890', 'status');
        expect(statusResult.handled).toBe(true);
        expect(statusResult.response).toBeDefined();

        const tasksResult = await processCommand('+1234567890', 'tasks');
        expect(tasksResult.handled).toBe(true);
        expect(executeActionSafe).not.toHaveBeenCalled();
      });

      it('should return context digest or handle no context', async () => {
        const result = await processCommand('+1234567890', 'context');
        expect(result.handled).toBe(true);
        expect(result.response).toContain('FRAME:');

        vi.mocked(getFrameDigestData).mockResolvedValueOnce(null);
        const noContextResult = await processCommand('+1234567890', 'context');
        expect(noContextResult.response).toContain('No context available');
      });

      it('should sync context successfully or handle failure', async () => {
        const result = await processCommand('+1234567890', 'sync');
        expect(result.handled).toBe(true);
        expect(result.response).toContain('Context synced');

        vi.mocked(syncContext).mockResolvedValueOnce({
          success: false,
          error: 'No data',
        });
        const failResult = await processCommand('+1234567890', 'sync');
        expect(failResult.response).toContain('Sync failed');
      });
    });

    describe('PR commands (approve/merge)', () => {
      it('should approve and merge PRs with valid numbers', async () => {
        // Setup approve command
        addCommand({
          name: 'approve',
          description: 'Approve PR',
          enabled: true,
          requiresArg: true,
          argPattern: '^\\d+$',
          action: 'gh pr review',
        });
        const approveResult = await processCommand(
          '+1234567890',
          'approve 123'
        );
        expect(approveResult.handled).toBe(true);
        expect(executeActionSafe).toHaveBeenCalledWith(
          'gh pr review 123 --approve',
          'approve 123'
        );

        // Setup merge command
        addCommand({
          name: 'merge',
          description: 'Merge PR',
          enabled: true,
          requiresArg: true,
          argPattern: '^\\d+$',
          action: 'gh pr merge',
        });
        const mergeResult = await processCommand('+1234567890', 'merge 456');
        expect(mergeResult.handled).toBe(true);
      });

      it('should require argument and validate pattern', async () => {
        // Missing argument
        expect((await processCommand('+1234567890', 'approve')).error).toBe(
          'Missing argument'
        );
        // Invalid pattern
        expect(
          (await processCommand('+1234567890', 'merge pr-123')).error
        ).toBe('Invalid argument format');
      });
    });

    describe('invalid commands', () => {
      it('should return handled:false for unknown, empty, or disabled commands', async () => {
        expect((await processCommand('+1234567890', 'unknown')).handled).toBe(
          false
        );
        expect((await processCommand('+1234567890', '')).handled).toBe(false);

        disableCommands();
        expect((await processCommand('+1234567890', 'status')).handled).toBe(
          false
        );
      });
    });
  });

  describe('loadCommandsConfig / saveCommandsConfig', () => {
    it('should load default config when no file or invalid JSON, and load/save custom configs', () => {
      // No file - returns defaults
      unlinkSync(CONFIG_PATH);
      let config = loadCommandsConfig();
      expect(config.enabled).toBe(true);
      expect(config.commands.some((c) => c.name === 'status')).toBe(true);

      // Invalid JSON - returns defaults
      writeFileSync(CONFIG_PATH, 'invalid json {{{');
      config = loadCommandsConfig();
      expect(config.enabled).toBe(true);

      // Save custom config
      saveCommandsConfig({
        enabled: false,
        commands: [{ name: 'test', description: 'Test', enabled: true }],
      });
      config = loadCommandsConfig();
      expect(config.enabled).toBe(false);
      expect(config.commands.some((c) => c.name === 'test')).toBe(true);
    });
  });

  describe('enableCommands / disableCommands', () => {
    it('should enable, disable, and persist command state', () => {
      // Disable
      disableCommands();
      expect(isCommandsEnabled()).toBe(false);
      expect(loadCommandsConfig().enabled).toBe(false);

      // Enable
      enableCommands();
      expect(isCommandsEnabled()).toBe(true);
      expect(loadCommandsConfig().enabled).toBe(true);
    });
  });

  describe('addCommand / removeCommand', () => {
    it('should add and update commands (case-insensitive)', () => {
      // Add new command
      addCommand({
        name: 'newcmd',
        description: 'A new command',
        enabled: true,
        action: 'echo new',
      });
      expect(
        loadCommandsConfig().commands.find((c) => c.name === 'newcmd')
          ?.description
      ).toBe('A new command');

      // Update existing command
      addCommand({
        name: 'status',
        description: 'Updated',
        enabled: true,
        action: 'updated',
      });
      expect(
        loadCommandsConfig().commands.find((c) => c.name === 'status')
          ?.description
      ).toBe('Updated');

      // Case insensitive update - should not create duplicate
      addCommand({
        name: 'STATUS',
        description: 'Uppercase',
        enabled: true,
        action: 'test',
      });
      const statusCommands = loadCommandsConfig().commands.filter(
        (c) => c.name.toLowerCase() === 'status'
      );
      expect(statusCommands.length).toBe(1);
    });

    it('should remove commands (case-insensitive)', () => {
      expect(removeCommand('status')).toBe(true);
      expect(removeCommand('nonexistent')).toBe(false);
    });
  });

  describe('getAvailableCommands', () => {
    it('should return only enabled commands including default ones', () => {
      const commands = getAvailableCommands();

      // Only enabled
      expect(commands.every((c) => c.enabled)).toBe(true);
      expect(commands.find((c) => c.name === 'disabled-cmd')).toBeUndefined();

      // Default commands included
      const names = commands.map((c) => c.name);
      expect(names).toContain('status');
      expect(names).toContain('help');
      expect(names).toContain('sync');
    });
  });

  describe('special command handling', () => {
    it('should handle tasks command in-process and acknowledge commands without action', async () => {
      // Tasks command - handled in-process
      const tasksResult = await processCommand('+1234567890', 'tasks');
      expect(tasksResult.handled).toBe(true);
      expect(tasksResult.action).toBeUndefined();

      // Command without action - acknowledged
      addCommand({ name: 'ping', description: 'Simple ping', enabled: true });
      const pingResult = await processCommand('+1234567890', 'ping');
      expect(pingResult.handled).toBe(true);
      expect(pingResult.response).toContain('Command ping acknowledged');
    });
  });
});
