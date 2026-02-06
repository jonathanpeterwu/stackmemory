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

  describe('initialization and status', () => {
    it('should create with config and return correct status', async () => {
      // Create with default or custom config
      expect(new SweepServerManager()).toBeDefined();
      expect(new SweepServerManager({ port: 9999 })).toBeDefined();

      // Not running when no PID file
      manager = new SweepServerManager();
      let status = await manager.getStatus();
      expect(status.running).toBe(false);

      // Running when server is healthy
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
      status = await manager.getStatus();

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

  describe('initialization and factory', () => {
    it('should use default or custom config and factory creates instance', () => {
      expect(new SweepPredictionClient()).toBeDefined();
      expect(
        new SweepPredictionClient({ host: 'localhost', port: 9999 })
      ).toBeDefined();
      expect(createPredictionClient()).toBeInstanceOf(SweepPredictionClient);
    });
  });
});

describe('Prompt Builder', () => {
  describe('trimContentAroundCursor', () => {
    it('should preserve or trim content based on size', () => {
      // Unchanged when fits
      const smallLines = ['line1', 'line2', 'line3'];
      let result = trimContentAroundCursor(smallLines, 1, 0, 1000);
      expect(result.didTrim).toBe(false);
      expect(result.lines).toEqual(smallLines);

      // Trim when too large
      const largeLines = Array(100).fill('x'.repeat(100));
      result = trimContentAroundCursor(largeLines, 50, 0, 100);
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
    it('should handle empty, unchanged, and changed completions', () => {
      // Empty returns null
      expect(parseCompletion('', ['line1', 'line2'], 0, 2)).toBeNull();

      // No change returns null
      expect(
        parseCompletion('line1\nline2', ['line1', 'line2'], 0, 2)
      ).toBeNull();

      // Changed content returns parsed result
      const result = parseCompletion('new1\nnew2', ['old1', 'old2'], 0, 2);
      expect(result).not.toBeNull();
      expect(result!.lines).toEqual(['new1', 'new2']);
    });
  });
});

describe('Types and Defaults', () => {
  it('should export default configuration and stop tokens', () => {
    expect(DEFAULT_SERVER_CONFIG).toBeDefined();
    expect(DEFAULT_SERVER_CONFIG.port).toBe(8766);
    expect(SWEEP_STOP_TOKENS.length).toBeGreaterThan(0);
  });
});
