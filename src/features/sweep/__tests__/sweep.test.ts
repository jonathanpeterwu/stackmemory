/**
 * Sweep Feature Tests - Consolidated
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as childProcess from 'child_process';
import { EventEmitter } from 'events';

vi.mock('fs');
vi.mock('child_process');

vi.mock('../../../core/monitoring/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

import {
  SweepServerManager,
  createServerManager,
} from '../sweep-server-manager.js';
import {
  SweepPredictionClient,
  createPredictionClient,
} from '../prediction-client.js';
import {
  buildSweepPrompt,
  trimContentAroundCursor,
  parseCompletion,
} from '../prompt-builder.js';
import {
  DEFAULT_SERVER_CONFIG,
  SWEEP_STOP_TOKENS,
  SweepPromptInput,
} from '../types.js';

describe('SweepServerManager', () => {
  let manager: SweepServerManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should create with default or custom config', () => {
      expect(new SweepServerManager()).toBeDefined();
      expect(new SweepServerManager({ port: 9999 })).toBeDefined();
    });
  });

  describe('getStatus', () => {
    it('should return not running when no PID file', async () => {
      manager = new SweepServerManager();
      const status = await manager.getStatus();
      expect(status.running).toBe(false);
    });

    it('should return running when server is healthy', async () => {
      const pidData = {
        pid: 12345,
        port: 8766,
        host: '127.0.0.1',
        modelPath: '/path/to/model.gguf',
        startedAt: Date.now(),
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(pidData));

      const originalKill = process.kill;
      process.kill = vi.fn().mockReturnValue(true);
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      manager = new SweepServerManager({ port: 8766, host: '127.0.0.1' });
      const status = await manager.getStatus();

      expect(status.running).toBe(true);
      expect(status.pid).toBe(12345);

      process.kill = originalKill;
    });
  });

  describe('startServer', () => {
    it('should throw error if model file not found', async () => {
      manager = new SweepServerManager({
        modelPath: '/nonexistent/model.gguf',
      });
      await expect(manager.startServer()).rejects.toThrow('Model not found');
    });
  });

  describe('factory function', () => {
    it('should create manager instance', () => {
      const created = createServerManager();
      expect(created).toBeInstanceOf(SweepServerManager);
    });
  });
});

describe('SweepPredictionClient', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('should use default or custom config', () => {
      expect(new SweepPredictionClient()).toBeDefined();
      expect(
        new SweepPredictionClient({ host: 'localhost', port: 9999 })
      ).toBeDefined();
    });
  });

  describe('factory function', () => {
    it('should create client instance', () => {
      expect(createPredictionClient()).toBeInstanceOf(SweepPredictionClient);
    });
  });
});

describe('Prompt Builder', () => {
  describe('trimContentAroundCursor', () => {
    it('should return unchanged when content fits', () => {
      const lines = ['line1', 'line2', 'line3'];
      const result = trimContentAroundCursor(lines, 1, 0, 1000);
      expect(result.didTrim).toBe(false);
      expect(result.lines).toEqual(lines);
    });

    it('should trim content around cursor', () => {
      const lines = Array(100).fill('x'.repeat(100));
      const result = trimContentAroundCursor(lines, 50, 0, 100);
      expect(result.didTrim).toBe(true);
      expect(result.lines.length).toBeLessThan(100);
    });
  });

  describe('buildSweepPrompt', () => {
    it('should build prompt with file separators', () => {
      const input: SweepPromptInput = {
        filePath: 'test.ts',
        currentContent: 'const x = 1;',
        recentDiffs: [],
      };
      const prompt = buildSweepPrompt(input);
      expect(prompt).toContain('<|file_sep|>');
      expect(prompt).toContain('test.ts');
    });
  });

  describe('parseCompletion', () => {
    it('should return null for empty completion', () => {
      const result = parseCompletion('', ['line1', 'line2'], 0, 2);
      expect(result).toBeNull();
    });

    it('should return null if no change', () => {
      const lines = ['line1', 'line2'];
      const result = parseCompletion('line1\nline2', lines, 0, 2);
      expect(result).toBeNull();
    });

    it('should parse changed content', () => {
      const lines = ['old1', 'old2'];
      const result = parseCompletion('new1\nnew2', lines, 0, 2);
      expect(result).not.toBeNull();
      expect(result!.lines).toEqual(['new1', 'new2']);
    });
  });
});

describe('Types and Defaults', () => {
  it('should export default configuration', () => {
    expect(DEFAULT_SERVER_CONFIG).toBeDefined();
    expect(DEFAULT_SERVER_CONFIG.port).toBe(8766);
  });

  it('should export stop tokens', () => {
    expect(SWEEP_STOP_TOKENS.length).toBeGreaterThan(0);
  });
});
