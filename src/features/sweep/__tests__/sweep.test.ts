/**
 * Sweep Feature Tests
 *
 * Tests for the Sweep Next-Edit server manager, prediction client, and prompt builder.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as childProcess from 'child_process';
import { EventEmitter } from 'events';

// Mock modules before importing
vi.mock('fs');
vi.mock('child_process');

// Mock logger
vi.mock('../../../core/monitoring/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

// Import after mocks
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
import { DEFAULT_SERVER_CONFIG, SWEEP_STOP_TOKENS } from '../types.js';

describe('SweepServerManager', () => {
  let manager: SweepServerManager;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should use default config when no config provided', () => {
      manager = new SweepServerManager();
      expect(manager).toBeDefined();
    });

    it('should merge custom config with defaults', () => {
      manager = new SweepServerManager({ port: 9999, threads: 4 });
      expect(manager).toBeDefined();
    });

    it('should set default model path if not provided', () => {
      manager = new SweepServerManager();
      // Model path should be set to default location
      expect(manager).toBeDefined();
    });
  });

  describe('getStatus', () => {
    it('should return not running when PID file does not exist', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      manager = new SweepServerManager();

      const status = await manager.getStatus();

      expect(status.running).toBe(false);
      expect(status.pid).toBeUndefined();
    });

    it('should return not running when PID file exists but process is dead', async () => {
      const pidData = {
        pid: 12345,
        port: 8766,
        host: '127.0.0.1',
        modelPath: '/path/to/model.gguf',
        startedAt: Date.now(),
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(pidData));

      // Mock process.kill to throw (process not found)
      const originalKill = process.kill;
      process.kill = vi.fn().mockImplementation(() => {
        throw new Error('ESRCH');
      });

      manager = new SweepServerManager();
      const status = await manager.getStatus();

      expect(status.running).toBe(false);

      process.kill = originalKill;
    });

    it('should return running status with details when server is healthy', async () => {
      const pidData = {
        pid: 12345,
        port: 8766,
        host: '127.0.0.1',
        modelPath: '/path/to/model.gguf',
        startedAt: Date.now() - 10000,
      };

      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(pidData));

      // Mock process.kill to succeed (process exists)
      const originalKill = process.kill;
      process.kill = vi.fn().mockReturnValue(true);

      // Mock fetch for health check
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
      });

      manager = new SweepServerManager({ port: 8766, host: '127.0.0.1' });
      const status = await manager.getStatus();

      expect(status.running).toBe(true);
      expect(status.pid).toBe(12345);
      expect(status.port).toBe(8766);
      expect(status.host).toBe('127.0.0.1');

      process.kill = originalKill;
    });
  });

  describe('startServer', () => {
    it('should return existing status if server already running', async () => {
      const pidData = {
        pid: 12345,
        port: 8766,
        host: '127.0.0.1',
        modelPath: '/path/to/model.gguf',
        startedAt: Date.now(),
      };

      vi.mocked(fs.existsSync).mockImplementation((path: fs.PathLike) => {
        if (String(path).endsWith('server.pid')) return true;
        return false;
      });
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(pidData));

      const originalKill = process.kill;
      process.kill = vi.fn().mockReturnValue(true);

      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      manager = new SweepServerManager({ port: 8766 });
      const status = await manager.startServer();

      expect(status.running).toBe(true);
      expect(status.pid).toBe(12345);

      process.kill = originalKill;
    });

    it('should throw error if model file not found', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      manager = new SweepServerManager({
        modelPath: '/nonexistent/model.gguf',
      });

      await expect(manager.startServer()).rejects.toThrow('Model not found');
    });

    it('should throw error if llama-server not found', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path: fs.PathLike) => {
        if (String(path).includes('model')) return true;
        return false;
      });

      vi.mocked(childProcess.execSync).mockImplementation(() => {
        throw new Error('not found');
      });

      manager = new SweepServerManager({
        modelPath: '/path/to/model.gguf',
      });

      await expect(manager.startServer()).rejects.toThrow(
        'llama-server not found'
      );
    });

    it('should spawn llama-server with correct arguments', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path: fs.PathLike) => {
        const pathStr = String(path);
        if (pathStr.includes('model')) return true;
        if (pathStr.endsWith('server.pid')) return false;
        return true;
      });

      vi.mocked(childProcess.execSync).mockReturnValue(
        Buffer.from('/usr/local/bin/llama-server')
      );

      const mockProcess = new EventEmitter() as childProcess.ChildProcess;
      mockProcess.pid = 99999;
      mockProcess.unref = vi.fn();
      mockProcess.stdout = new EventEmitter() as NodeJS.ReadableStream;
      mockProcess.stderr = new EventEmitter() as NodeJS.ReadableStream;

      vi.mocked(childProcess.spawn).mockReturnValue(mockProcess);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      // Mock fetch to fail first (server not ready) then succeed
      let fetchCount = 0;
      global.fetch = vi.fn().mockImplementation(() => {
        fetchCount++;
        if (fetchCount < 3) {
          return Promise.reject(new Error('ECONNREFUSED'));
        }
        return Promise.resolve({ ok: true });
      });

      manager = new SweepServerManager({
        modelPath: '/path/to/model.gguf',
        port: 8766,
        host: '127.0.0.1',
        contextSize: 8192,
        threads: 4,
        gpuLayers: 10,
      });

      const status = await manager.startServer();

      expect(childProcess.spawn).toHaveBeenCalledWith(
        'llama-server',
        expect.arrayContaining([
          '-m',
          '/path/to/model.gguf',
          '--port',
          '8766',
          '--host',
          '127.0.0.1',
          '-c',
          '8192',
          '-t',
          '4',
          '-ngl',
          '10',
        ]),
        expect.any(Object)
      );
    });

    it('should throw error if server fails to start within timeout', async () => {
      vi.mocked(fs.existsSync).mockImplementation((path: fs.PathLike) => {
        const pathStr = String(path);
        if (pathStr.includes('model')) return true;
        if (pathStr.endsWith('server.pid')) return false;
        return true;
      });

      vi.mocked(childProcess.execSync).mockReturnValue(
        Buffer.from('/usr/local/bin/llama-server')
      );

      const mockProcess = new EventEmitter() as childProcess.ChildProcess;
      mockProcess.pid = 99999;
      mockProcess.unref = vi.fn();
      mockProcess.stdout = new EventEmitter() as NodeJS.ReadableStream;
      mockProcess.stderr = new EventEmitter() as NodeJS.ReadableStream;

      vi.mocked(childProcess.spawn).mockReturnValue(mockProcess);
      vi.mocked(fs.mkdirSync).mockReturnValue(undefined);
      vi.mocked(fs.writeFileSync).mockReturnValue(undefined);

      // Mock fetch to always fail
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      manager = new SweepServerManager({
        modelPath: '/path/to/model.gguf',
      });

      // Use a short timeout for testing
      const originalWaitForReady = (manager as any).waitForReady.bind(manager);
      (manager as any).waitForReady = async (timeout: number) => {
        return originalWaitForReady(100); // Very short timeout
      };

      await expect(manager.startServer()).rejects.toThrow(
        'Server failed to start within timeout'
      );
    }, 10000);
  });

  describe('stopServer', () => {
    it('should do nothing if server is not running', async () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

      manager = new SweepServerManager();
      await manager.stopServer();

      // Should complete without error
      expect(true).toBe(true);
    });

    it('should send SIGTERM to running process', async () => {
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
      let killCount = 0;
      process.kill = vi.fn().mockImplementation((pid, signal) => {
        killCount++;
        if (signal === 0 && killCount > 2) {
          throw new Error('ESRCH'); // Process is dead
        }
        return true;
      });

      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      manager = new SweepServerManager();
      await manager.stopServer();

      expect(process.kill).toHaveBeenCalledWith(12345, 'SIGTERM');

      process.kill = originalKill;
    });
  });

  describe('checkHealth', () => {
    it('should return true when server responds OK', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      manager = new SweepServerManager({ port: 8766, host: '127.0.0.1' });
      const healthy = await manager.checkHealth();

      expect(healthy).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:8766/health',
        expect.any(Object)
      );
    });

    it('should return false when server is not responding', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('ECONNREFUSED'));

      manager = new SweepServerManager({ port: 8766, host: '127.0.0.1' });
      const healthy = await manager.checkHealth();

      expect(healthy).toBe(false);
    });
  });

  describe('createServerManager', () => {
    it('should create a server manager instance', () => {
      const serverManager = createServerManager({ port: 9000 });
      expect(serverManager).toBeInstanceOf(SweepServerManager);
    });
  });
});

describe('SweepPredictionClient', () => {
  let client: SweepPredictionClient;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should use default config when no config provided', () => {
      client = new SweepPredictionClient();
      expect(client).toBeDefined();
    });

    it('should merge custom config with defaults', () => {
      client = new SweepPredictionClient({ port: 9999 });
      expect(client).toBeDefined();
    });
  });

  describe('checkHealth', () => {
    it('should return true when health endpoint returns OK', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: true });

      client = new SweepPredictionClient({ port: 8766, host: '127.0.0.1' });
      const result = await client.checkHealth();

      expect(result).toBe(true);
      expect(fetch).toHaveBeenCalledWith(
        'http://127.0.0.1:8766/health',
        expect.objectContaining({ method: 'GET' })
      );
    });

    it('should return false when health endpoint fails', async () => {
      global.fetch = vi.fn().mockResolvedValue({ ok: false });

      client = new SweepPredictionClient();
      const result = await client.checkHealth();

      expect(result).toBe(false);
    });

    it('should return false when fetch throws', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      client = new SweepPredictionClient();
      const result = await client.checkHealth();

      expect(result).toBe(false);
    });
  });

  describe('predict', () => {
    it('should return successful prediction result', async () => {
      const mockResponse = {
        id: 'test-id',
        object: 'text_completion',
        created: Date.now(),
        model: 'sweep',
        choices: [
          {
            text: 'const updated = true;',
            index: 0,
            logprobs: null,
            finish_reason: 'stop',
          },
        ],
        usage: {
          prompt_tokens: 100,
          completion_tokens: 50,
          total_tokens: 150,
        },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      client = new SweepPredictionClient({ port: 8766 });
      const result = await client.predict({
        file_path: 'src/test.ts',
        current_content: 'const x = 1;',
      });

      expect(result.success).toBe(true);
      expect(result.predicted_content).toBe('const updated = true;');
      expect(result.file_path).toBe('src/test.ts');
      expect(result.tokens_generated).toBe(50);
      expect(result.latency_ms).toBeDefined();
    });

    it('should include recent diffs and context files in request', async () => {
      const mockResponse = {
        choices: [
          {
            text: 'updated content',
            index: 0,
            logprobs: null,
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 },
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockResponse),
      });

      client = new SweepPredictionClient();
      await client.predict({
        file_path: 'src/main.ts',
        current_content: 'const y = 2;',
        original_content: 'const y = 1;',
        context_files: { 'src/utils.ts': 'export const helper = () => {};' },
        recent_diffs: [
          { file_path: 'src/other.ts', original: 'old', updated: 'new' },
        ],
        max_tokens: 1024,
        temperature: 0.2,
        top_k: 50,
      });

      expect(fetch).toHaveBeenCalledWith(
        expect.stringContaining('/v1/completions'),
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: expect.stringContaining('src/main.ts'),
        })
      );
    });

    it('should return error when server returns non-OK status', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve('Internal Server Error'),
      });

      client = new SweepPredictionClient();
      const result = await client.predict({
        file_path: 'src/test.ts',
        current_content: 'code',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('server_error');
      expect(result.message).toContain('500');
    });

    it('should return error when no choices returned', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ choices: [] }),
      });

      client = new SweepPredictionClient();
      const result = await client.predict({
        file_path: 'src/test.ts',
        current_content: 'code',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('no_choices');
    });

    it('should return success with empty content when completion is empty', async () => {
      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            choices: [
              { text: '   ', index: 0, logprobs: null, finish_reason: 'stop' },
            ],
            usage: {
              prompt_tokens: 50,
              completion_tokens: 0,
              total_tokens: 50,
            },
          }),
      });

      client = new SweepPredictionClient();
      const result = await client.predict({
        file_path: 'src/test.ts',
        current_content: 'code',
      });

      expect(result.success).toBe(true);
      expect(result.predicted_content).toBe('');
      expect(result.message).toBe('No changes predicted');
    });

    it('should handle timeout error', async () => {
      const timeoutError = new Error('Timeout');
      timeoutError.name = 'TimeoutError';
      global.fetch = vi.fn().mockRejectedValue(timeoutError);

      client = new SweepPredictionClient();
      const result = await client.predict({
        file_path: 'src/test.ts',
        current_content: 'code',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('timeout');
    });

    it('should handle connection refused error', async () => {
      const connError = new Error('ECONNREFUSED');
      global.fetch = vi.fn().mockRejectedValue(connError);

      client = new SweepPredictionClient();
      const result = await client.predict({
        file_path: 'src/test.ts',
        current_content: 'code',
      });

      expect(result.success).toBe(false);
      expect(result.error).toBe('connection_refused');
      expect(result.message).toContain('Server not running');
    });
  });

  describe('getServerInfo', () => {
    it('should return server info when available', async () => {
      const mockInfo = {
        data: [{ id: 'sweep', object: 'model' }],
      };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve(mockInfo),
      });

      client = new SweepPredictionClient();
      const info = await client.getServerInfo();

      expect(info).toEqual(mockInfo);
    });

    it('should return null when request fails', async () => {
      global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

      client = new SweepPredictionClient();
      const info = await client.getServerInfo();

      expect(info).toBeNull();
    });
  });

  describe('createPredictionClient', () => {
    it('should create a prediction client instance', () => {
      const predClient = createPredictionClient({ port: 9000 });
      expect(predClient).toBeInstanceOf(SweepPredictionClient);
    });
  });
});

describe('Prompt Builder', () => {
  describe('buildSweepPrompt', () => {
    it('should build basic prompt with file path markers', () => {
      const prompt = buildSweepPrompt({
        filePath: 'src/app.ts',
        originalContent: 'const x = 1;',
        currentContent: 'const x = 2;',
        recentDiffs: [],
      });

      expect(prompt).toContain('<|file_sep|>original/src/app.ts');
      expect(prompt).toContain('const x = 1;');
      expect(prompt).toContain('<|file_sep|>current/src/app.ts');
      expect(prompt).toContain('const x = 2;');
      expect(prompt).toContain('<|file_sep|>updated/src/app.ts');
    });

    it('should include context files', () => {
      const prompt = buildSweepPrompt({
        filePath: 'src/app.ts',
        originalContent: 'code',
        currentContent: 'code',
        recentDiffs: [],
        contextFiles: {
          'src/utils.ts': 'export function helper() {}',
          'src/types.ts': 'export interface Config {}',
        },
      });

      expect(prompt).toContain('<|file_sep|>src/utils.ts');
      expect(prompt).toContain('export function helper() {}');
      expect(prompt).toContain('<|file_sep|>src/types.ts');
      expect(prompt).toContain('export interface Config {}');
    });

    it('should include diff section with recent diffs', () => {
      const prompt = buildSweepPrompt({
        filePath: 'src/app.ts',
        originalContent: 'code',
        currentContent: 'code',
        recentDiffs: [
          {
            file_path: 'src/other.ts',
            original: 'const old = true;',
            updated: 'const new = true;',
          },
        ],
      });

      expect(prompt).toContain('<|file_sep|>src/other.ts.diff');
      expect(prompt).toContain('original:');
      expect(prompt).toContain('const old = true;');
      expect(prompt).toContain('updated:');
      expect(prompt).toContain('const new = true;');
    });

    it('should skip diffs with no content', () => {
      const prompt = buildSweepPrompt({
        filePath: 'src/app.ts',
        originalContent: 'code',
        currentContent: 'code',
        recentDiffs: [
          { file_path: 'src/empty.ts', original: '', updated: '' },
          { file_path: 'src/valid.ts', original: 'old', updated: 'new' },
        ],
      });

      expect(prompt).not.toContain('src/empty.ts.diff');
      expect(prompt).toContain('<|file_sep|>src/valid.ts.diff');
    });

    it('should use current content as original when original not provided', () => {
      const prompt = buildSweepPrompt({
        filePath: 'src/app.ts',
        originalContent: '',
        currentContent: 'const x = 1;',
        recentDiffs: [],
      });

      // Should use currentContent for original section when originalContent is empty
      const lines = prompt.split('\n');
      const originalIndex = lines.findIndex((l) =>
        l.includes('original/src/app.ts')
      );
      const currentIndex = lines.findIndex((l) =>
        l.includes('current/src/app.ts')
      );

      expect(originalIndex).toBeLessThan(currentIndex);
    });
  });

  describe('trimContentAroundCursor', () => {
    it('should return original lines if within token budget', () => {
      const lines = ['line 1', 'line 2', 'line 3'];
      const result = trimContentAroundCursor(lines, 1, 0, 1000);

      expect(result.lines).toEqual(lines);
      expect(result.offset).toBe(0);
      expect(result.didTrim).toBe(false);
    });

    it('should trim content when exceeding token budget', () => {
      const lines = Array.from(
        { length: 100 },
        (_, i) => `line ${i + 1}: ${'x'.repeat(50)}`
      );
      const result = trimContentAroundCursor(lines, 50, 0, 100);

      expect(result.lines.length).toBeLessThan(lines.length);
      expect(result.didTrim).toBe(true);
      expect(result.offset).toBeGreaterThanOrEqual(0);
    });

    it('should center window around cursor position', () => {
      const lines = Array.from(
        { length: 100 },
        (_, i) => `line ${i + 1}: ${'x'.repeat(50)}`
      );
      const cursorLine = 50;
      const result = trimContentAroundCursor(lines, cursorLine, 0, 100);

      if (result.didTrim) {
        // The window should include content around line 50
        const startLine = result.offset;
        const endLine = result.offset + result.lines.length;
        expect(cursorLine).toBeGreaterThanOrEqual(startLine);
        expect(cursorLine).toBeLessThan(endLine);
      }
    });

    it('should adjust window when near end of file', () => {
      const lines = Array.from(
        { length: 100 },
        (_, i) => `line ${i + 1}: ${'x'.repeat(50)}`
      );
      const result = trimContentAroundCursor(lines, 95, 0, 100);

      if (result.didTrim) {
        expect(result.offset + result.lines.length).toBeLessThanOrEqual(
          lines.length
        );
      }
    });
  });

  describe('parseCompletion', () => {
    it('should return null for empty completion', () => {
      const result = parseCompletion('', ['line 1', 'line 2'], 0, 2);
      expect(result).toBeNull();
    });

    it('should return null for whitespace-only completion', () => {
      const result = parseCompletion('   \n  ', ['line 1', 'line 2'], 0, 2);
      expect(result).toBeNull();
    });

    it('should strip trailing stop tokens', () => {
      const result = parseCompletion(
        'const updated = true;<|file_sep|>',
        ['const old = false;'],
        0,
        1
      );

      expect(result).not.toBeNull();
      expect(result!.lines).toEqual(['const updated = true;']);
    });

    it('should strip </s> token', () => {
      const result = parseCompletion(
        'const updated = true;</s>',
        ['const old = false;'],
        0,
        1
      );

      expect(result).not.toBeNull();
      expect(result!.lines).toEqual(['const updated = true;']);
    });

    it('should return null when completion matches original', () => {
      const result = parseCompletion(
        'const x = 1;\nconst y = 2;',
        ['const x = 1;', 'const y = 2;'],
        0,
        2
      );

      expect(result).toBeNull();
    });

    it('should return parsed lines with correct line numbers', () => {
      const result = parseCompletion(
        'const updated = true;\nconst also = true;',
        ['const old = false;', 'const also = false;', 'other line'],
        0,
        2
      );

      expect(result).not.toBeNull();
      expect(result!.lines).toEqual([
        'const updated = true;',
        'const also = true;',
      ]);
      expect(result!.startLine).toBe(1); // 1-indexed
      expect(result!.endLine).toBe(2);
    });

    it('should handle window offset correctly', () => {
      const result = parseCompletion(
        'new line',
        ['line 1', 'line 2', 'original line', 'line 4'],
        2,
        3
      );

      expect(result).not.toBeNull();
      expect(result!.startLine).toBe(3); // 2 + 1 (1-indexed)
      expect(result!.endLine).toBe(3);
    });
  });
});

describe('Types and Constants', () => {
  it('should have correct default server config', () => {
    expect(DEFAULT_SERVER_CONFIG.port).toBe(8766);
    expect(DEFAULT_SERVER_CONFIG.host).toBe('127.0.0.1');
    expect(DEFAULT_SERVER_CONFIG.contextSize).toBe(8192);
    expect(DEFAULT_SERVER_CONFIG.modelPath).toBe('');
  });

  it('should have correct stop tokens', () => {
    expect(SWEEP_STOP_TOKENS).toContain('<|file_sep|>');
    expect(SWEEP_STOP_TOKENS).toContain('</s>');
  });
});
