/**
 * Tests for SMS notification functionality
 *
 * Note: These tests use the actual config path (~/.stackmemory) but with
 * isolated test data. We save/restore the config around tests.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import {
  loadSMSConfig,
  saveSMSConfig,
  getMissingConfig,
  processIncomingResponse,
  cleanupExpiredPrompts,
  type SMSConfig,
} from '../sms-notify.js';

const CONFIG_PATH = join(homedir(), '.stackmemory', 'sms-notify.json');
let originalConfig: string | null = null;

describe('SMS Notify', () => {
  // Store original env vars
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    // Save original config
    if (existsSync(CONFIG_PATH)) {
      originalConfig = readFileSync(CONFIG_PATH, 'utf8');
    }

    // Create directory if needed
    mkdirSync(join(homedir(), '.stackmemory'), { recursive: true });

    // Write clean test config to isolate from real config
    writeFileSync(
      CONFIG_PATH,
      JSON.stringify({
        enabled: false,
        channel: 'whatsapp',
        notifyOn: {
          taskComplete: true,
          reviewReady: true,
          error: true,
          custom: true,
        },
        responseTimeout: 300,
        pendingPrompts: [],
      })
    );

    // Save and clear env vars
    const envVars = [
      'TWILIO_ACCOUNT_SID',
      'TWILIO_AUTH_TOKEN',
      'TWILIO_WHATSAPP_FROM',
      'TWILIO_WHATSAPP_TO',
      'TWILIO_SMS_FROM',
      'TWILIO_SMS_TO',
      'TWILIO_CHANNEL',
      'TWILIO_FROM_NUMBER',
      'TWILIO_TO_NUMBER',
    ];
    for (const v of envVars) {
      originalEnv[v] = process.env[v];
      delete process.env[v];
    }
  });

  afterEach(() => {
    // Restore original config
    if (originalConfig) {
      writeFileSync(CONFIG_PATH, originalConfig);
    } else if (existsSync(CONFIG_PATH)) {
      unlinkSync(CONFIG_PATH);
    }
    originalConfig = null;

    // Restore env vars
    for (const [k, v] of Object.entries(originalEnv)) {
      if (v !== undefined) {
        process.env[k] = v;
      } else {
        delete process.env[k];
      }
    }
  });

  describe('loadSMSConfig', () => {
    it('should return default config when no file exists', () => {
      const config = loadSMSConfig();

      expect(config.enabled).toBe(false);
      expect(config.channel).toBe('whatsapp');
      expect(config.responseTimeout).toBe(300);
      expect(config.pendingPrompts).toEqual([]);
    });

    it('should load config from file', () => {
      const configPath = join(homedir(), '.stackmemory', 'sms-notify.json');
      const savedConfig = {
        enabled: true,
        channel: 'sms',
        responseTimeout: 600,
      };
      writeFileSync(configPath, JSON.stringify(savedConfig));

      const config = loadSMSConfig();

      expect(config.enabled).toBe(true);
      expect(config.channel).toBe('sms');
      expect(config.responseTimeout).toBe(600);
    });

    it('should apply environment variables', () => {
      process.env['TWILIO_ACCOUNT_SID'] = 'test-sid';
      process.env['TWILIO_AUTH_TOKEN'] = 'test-token';
      process.env['TWILIO_WHATSAPP_FROM'] = '+14155238886';
      process.env['TWILIO_WHATSAPP_TO'] = '+18005551234';

      const config = loadSMSConfig();

      expect(config.accountSid).toBe('test-sid');
      expect(config.authToken).toBe('test-token');
      expect(config.whatsappFromNumber).toBe('+14155238886');
      expect(config.whatsappToNumber).toBe('+18005551234');
    });

    it('should prefer env vars over file config for credentials', () => {
      const configPath = join(homedir(), '.stackmemory', 'sms-notify.json');
      writeFileSync(configPath, JSON.stringify({ accountSid: 'file-sid' }));
      process.env['TWILIO_ACCOUNT_SID'] = 'env-sid';

      const config = loadSMSConfig();

      expect(config.accountSid).toBe('env-sid');
    });
  });

  describe('saveSMSConfig', () => {
    it('should save config without sensitive credentials', () => {
      const config: SMSConfig = {
        enabled: true,
        channel: 'whatsapp',
        accountSid: 'secret-sid',
        authToken: 'secret-token',
        whatsappFromNumber: '+14155238886',
        whatsappToNumber: '+18005551234',
        notifyOn: {
          taskComplete: true,
          reviewReady: true,
          error: false,
          custom: true,
        },
        responseTimeout: 300,
        pendingPrompts: [],
      };

      saveSMSConfig(config);

      const configPath = join(homedir(), '.stackmemory', 'sms-notify.json');
      const saved = JSON.parse(readFileSync(configPath, 'utf8'));

      expect(saved.accountSid).toBeUndefined();
      expect(saved.authToken).toBeUndefined();
      expect(saved.enabled).toBe(true);
      expect(saved.whatsappFromNumber).toBe('+14155238886');
    });
  });

  describe('getMissingConfig', () => {
    it('should return result with missing and configured arrays', () => {
      const result = getMissingConfig();

      // Result should have the expected shape
      expect(result).toHaveProperty('ready');
      expect(result).toHaveProperty('missing');
      expect(result).toHaveProperty('configured');
      expect(Array.isArray(result.missing)).toBe(true);
      expect(Array.isArray(result.configured)).toBe(true);
    });

    it('should report ready when fully configured', () => {
      process.env['TWILIO_ACCOUNT_SID'] = 'test-sid';
      process.env['TWILIO_AUTH_TOKEN'] = 'test-token';
      process.env['TWILIO_WHATSAPP_FROM'] = '+14155238886';
      process.env['TWILIO_WHATSAPP_TO'] = '+18005551234';

      const result = getMissingConfig();

      expect(result.ready).toBe(true);
      expect(result.missing).toHaveLength(0);
      expect(result.configured).toContain('TWILIO_ACCOUNT_SID');
    });

    it('should check SMS numbers when channel is sms', () => {
      process.env['TWILIO_ACCOUNT_SID'] = 'test-sid';
      process.env['TWILIO_AUTH_TOKEN'] = 'test-token';
      process.env['TWILIO_CHANNEL'] = 'sms';
      process.env['TWILIO_SMS_FROM'] = '+12025551234';
      process.env['TWILIO_SMS_TO'] = '+18005551234';

      const result = getMissingConfig();

      expect(result.ready).toBe(true);
      expect(result.configured).toContain('TWILIO_SMS_FROM');
    });
  });

  describe('processIncomingResponse', () => {
    beforeEach(() => {
      // Set up a config with pending prompts
      const config: SMSConfig = {
        enabled: true,
        channel: 'whatsapp',
        notifyOn: {
          taskComplete: true,
          reviewReady: true,
          error: true,
          custom: true,
        },
        responseTimeout: 300,
        pendingPrompts: [
          {
            id: 'test-prompt-1',
            timestamp: new Date().toISOString(),
            message: 'Choose an option',
            options: [
              { key: '1', label: 'Option A' },
              { key: '2', label: 'Option B' },
            ],
            type: 'options',
            expiresAt: new Date(Date.now() + 60000).toISOString(), // 1 min from now
          },
        ],
      };
      saveSMSConfig(config);
    });

    it('should match numeric response to options', () => {
      const result = processIncomingResponse('+18005551234', '1');

      expect(result.matched).toBe(true);
      expect(result.response).toBe('1'); // Returns the key, not label
    });

    it('should match second option', () => {
      const result = processIncomingResponse('+18005551234', '2');

      expect(result.matched).toBe(true);
      expect(result.response).toBe('2'); // Returns the key, not label
    });

    it('should not match invalid option', () => {
      const result = processIncomingResponse('+18005551234', '5');

      expect(result.matched).toBe(false);
      expect(result.prompt).toBeDefined();
    });

    it('should return no match when no pending prompts', () => {
      // Clear pending prompts
      const config = loadSMSConfig();
      config.pendingPrompts = [];
      saveSMSConfig(config);

      const result = processIncomingResponse('+18005551234', '1');

      expect(result.matched).toBe(false);
      expect(result.prompt).toBeUndefined();
    });

    it('should handle yes/no prompts', () => {
      const config = loadSMSConfig();
      config.pendingPrompts = [
        {
          id: 'yesno-prompt',
          timestamp: new Date().toISOString(),
          message: 'Continue?',
          options: [
            { key: 'y', label: 'Yes' },
            { key: 'n', label: 'No' },
          ],
          type: 'yesno',
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
      ];
      saveSMSConfig(config);

      const yesResult = processIncomingResponse('+18005551234', 'y');
      expect(yesResult.matched).toBe(true);
      expect(yesResult.response).toBe('y'); // Returns the key, not label
    });

    it('should handle freeform prompts', () => {
      const config = loadSMSConfig();
      config.pendingPrompts = [
        {
          id: 'freeform-prompt',
          timestamp: new Date().toISOString(),
          message: 'Enter your message',
          options: [],
          type: 'freeform',
          expiresAt: new Date(Date.now() + 60000).toISOString(),
        },
      ];
      saveSMSConfig(config);

      const result = processIncomingResponse('+18005551234', 'Hello world');
      expect(result.matched).toBe(true);
      expect(result.response).toBe('hello world');
    });
  });

  describe('cleanupExpiredPrompts', () => {
    it('should remove expired prompts', () => {
      const config: SMSConfig = {
        enabled: true,
        channel: 'whatsapp',
        notifyOn: {
          taskComplete: true,
          reviewReady: true,
          error: true,
          custom: true,
        },
        responseTimeout: 300,
        pendingPrompts: [
          {
            id: 'expired-prompt',
            timestamp: new Date(Date.now() - 120000).toISOString(),
            message: 'Old prompt',
            options: [],
            type: 'freeform',
            expiresAt: new Date(Date.now() - 60000).toISOString(), // Expired 1 min ago
          },
          {
            id: 'valid-prompt',
            timestamp: new Date().toISOString(),
            message: 'New prompt',
            options: [],
            type: 'freeform',
            expiresAt: new Date(Date.now() + 60000).toISOString(), // Valid for 1 min
          },
        ],
      };
      saveSMSConfig(config);

      const removed = cleanupExpiredPrompts();

      expect(removed).toBe(1);

      const updatedConfig = loadSMSConfig();
      expect(updatedConfig.pendingPrompts).toHaveLength(1);
      expect(updatedConfig.pendingPrompts[0].id).toBe('valid-prompt');
    });

    it('should return 0 when no prompts expired', () => {
      const config: SMSConfig = {
        enabled: true,
        channel: 'whatsapp',
        notifyOn: {
          taskComplete: true,
          reviewReady: true,
          error: true,
          custom: true,
        },
        responseTimeout: 300,
        pendingPrompts: [
          {
            id: 'valid-prompt',
            timestamp: new Date().toISOString(),
            message: 'Valid prompt',
            options: [],
            type: 'freeform',
            expiresAt: new Date(Date.now() + 60000).toISOString(),
          },
        ],
      };
      saveSMSConfig(config);

      const removed = cleanupExpiredPrompts();

      expect(removed).toBe(0);
    });
  });
});
