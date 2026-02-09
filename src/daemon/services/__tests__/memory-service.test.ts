/**
 * Tests for DaemonMemoryService
 * Covers: threshold checks, cooldown, signal file, lifecycle
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { MemoryServiceConfig } from '../../daemon-config.js';

// Mock os module — ESM exports are not reconfigurable so we must use vi.mock
vi.mock('os', async () => {
  const actual = await vi.importActual<typeof import('os')>('os');
  return {
    ...actual,
    totalmem: vi.fn(() => actual.totalmem()),
    freemem: vi.fn(() => actual.freemem()),
    homedir: actual.homedir,
    tmpdir: actual.tmpdir,
  };
});

// Mock child_process.execSync to avoid running actual commands
vi.mock('child_process', async () => {
  const actual =
    await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    execSync: vi.fn(() => ''),
  };
});

// Import after mocks are set up
const { DaemonMemoryService } = await import('../memory-service.js');

const mockedTotalmem = vi.mocked(os.totalmem);
const mockedFreemem = vi.mocked(os.freemem);

function createConfig(
  overrides: Partial<MemoryServiceConfig> = {}
): MemoryServiceConfig {
  return {
    enabled: true,
    interval: 0.5, // 30s
    ramThreshold: 0.9,
    heapThreshold: 0.9,
    cooldownMinutes: 10,
    ...overrides,
  };
}

function mockMemory(ramUsedPercent: number, heapUsedPercent: number) {
  const total = 16 * 1024 * 1024 * 1024; // 16GB
  const free = total * (1 - ramUsedPercent);
  mockedTotalmem.mockReturnValue(total);
  mockedFreemem.mockReturnValue(free);

  const heapTotal = 1000 * 1024 * 1024; // 1GB
  const heapUsed = heapTotal * heapUsedPercent;
  vi.spyOn(process, 'memoryUsage').mockReturnValue({
    heapUsed,
    heapTotal,
    rss: 0,
    external: 0,
    arrayBuffers: 0,
  });
}

describe('DaemonMemoryService', () => {
  let tmpDir: string;
  let originalCwd: string;
  const logs: Array<{ level: string; message: string; data?: unknown }> = [];
  const onLog = (level: string, message: string, data?: unknown) => {
    logs.push({ level, message, data });
  };

  beforeEach(() => {
    vi.useFakeTimers();
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackmemory-mem-test-'));
    originalCwd = process.cwd();
    process.chdir(tmpDir);
    logs.length = 0;
    // Reset os mocks — use real-ish defaults (low usage, won't trigger)
    mockedTotalmem.mockReset().mockReturnValue(16 * 1024 * 1024 * 1024);
    mockedFreemem.mockReset().mockReturnValue(8 * 1024 * 1024 * 1024);
  });

  afterEach(() => {
    vi.useRealTimers();
    process.chdir(originalCwd);
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch {
      // cleanup best-effort
    }
    vi.restoreAllMocks();
  });

  describe('start/stop lifecycle', () => {
    it('should start and stop cleanly', () => {
      const service = new DaemonMemoryService(createConfig(), onLog);
      service.start();

      const state = service.getState();
      expect(state.lastCheckTime).toBeGreaterThan(0);

      service.stop();
      expect(logs.some((l) => l.message === 'Memory service started')).toBe(
        true
      );
      expect(logs.some((l) => l.message === 'Memory service stopped')).toBe(
        true
      );
    });

    it('should not start when disabled', () => {
      const service = new DaemonMemoryService(
        createConfig({ enabled: false }),
        onLog
      );
      service.start();

      const state = service.getState();
      expect(state.lastCheckTime).toBe(0);
      expect(logs).toHaveLength(0);
    });

    it('should not start twice', () => {
      const service = new DaemonMemoryService(createConfig(), onLog);
      service.start();
      const startCount = logs.filter(
        (l) => l.message === 'Memory service started'
      ).length;
      expect(startCount).toBe(1);

      service.start();
      const startCount2 = logs.filter(
        (l) => l.message === 'Memory service started'
      ).length;
      expect(startCount2).toBe(1);

      service.stop();
    });
  });

  describe('getState', () => {
    it('should return initial state', () => {
      const service = new DaemonMemoryService(createConfig(), onLog);
      const state = service.getState();

      expect(state.lastCheckTime).toBe(0);
      expect(state.lastTriggerTime).toBe(0);
      expect(state.triggerCount).toBe(0);
      expect(state.currentRamPercent).toBe(0);
      expect(state.currentHeapPercent).toBe(0);
      expect(state.errors).toEqual([]);
    });

    it('should return a copy (not a reference)', () => {
      const service = new DaemonMemoryService(createConfig(), onLog);
      const state1 = service.getState();
      const state2 = service.getState();
      expect(state1).not.toBe(state2);
      expect(state1).toEqual(state2);
    });
  });

  describe('updateConfig', () => {
    it('should update config and restart if was running', () => {
      const service = new DaemonMemoryService(createConfig(), onLog);
      service.start();
      logs.length = 0;

      service.updateConfig({ ramThreshold: 0.8 });

      expect(logs.some((l) => l.message === 'Memory service stopped')).toBe(
        true
      );
      expect(logs.some((l) => l.message === 'Memory service started')).toBe(
        true
      );

      service.stop();
    });

    it('should not restart if was not running', () => {
      const service = new DaemonMemoryService(createConfig(), onLog);
      service.updateConfig({ ramThreshold: 0.8 });
      expect(logs).toHaveLength(0);
    });
  });

  describe('threshold checks', () => {
    it('should not trigger when below threshold', () => {
      mockMemory(0.5, 0.5);

      const service = new DaemonMemoryService(createConfig(), onLog);
      service.start();

      const state = service.getState();
      expect(state.triggerCount).toBe(0);
      expect(state.currentRamPercent).toBeCloseTo(0.5, 1);
      expect(state.currentHeapPercent).toBeCloseTo(0.5, 1);

      service.stop();
    });

    it('should trigger when RAM exceeds threshold', () => {
      mockMemory(0.95, 0.5);

      const service = new DaemonMemoryService(createConfig(), onLog);
      service.start();

      const state = service.getState();
      expect(state.triggerCount).toBe(1);
      expect(state.lastTriggerTime).toBeGreaterThan(0);

      service.stop();
    });

    it('should trigger when heap exceeds threshold', () => {
      mockMemory(0.5, 0.95);

      const service = new DaemonMemoryService(createConfig(), onLog);
      service.start();

      const state = service.getState();
      expect(state.triggerCount).toBe(1);

      service.stop();
    });
  });

  describe('cooldown', () => {
    it('should prevent repeated triggers within cooldown period', () => {
      mockMemory(0.95, 0.5);

      const service = new DaemonMemoryService(
        createConfig({ cooldownMinutes: 10 }),
        onLog
      );
      service.start();
      expect(service.getState().triggerCount).toBe(1);

      // Advance 5 minutes — should still be in cooldown
      vi.advanceTimersByTime(5 * 60 * 1000);
      expect(service.getState().triggerCount).toBe(1);

      // Advance past cooldown (total 11min, interval fires every 30s)
      vi.advanceTimersByTime(6 * 60 * 1000);
      expect(service.getState().triggerCount).toBe(2);

      service.stop();
    });
  });

  describe('signal file', () => {
    it('should write signal file with correct JSON on trigger', () => {
      mockMemory(0.95, 0.5);

      const service = new DaemonMemoryService(createConfig(), onLog);
      service.start();

      const signalPath = path.join(
        tmpDir,
        '.stackmemory',
        '.memory-clear-signal'
      );
      expect(fs.existsSync(signalPath)).toBe(true);

      const signal = JSON.parse(fs.readFileSync(signalPath, 'utf8'));
      expect(signal.timestamp).toBeGreaterThan(0);
      expect(signal.reason).toContain('RAM');
      expect(signal.reason).toContain('95%');
      expect(signal.ramPercent).toBe(95);
      expect(signal.heapPercent).toBe(50);

      service.stop();
    });

    it('should not write signal file when below threshold', () => {
      mockMemory(0.5, 0.5);

      const service = new DaemonMemoryService(createConfig(), onLog);
      service.start();

      const signalPath = path.join(
        tmpDir,
        '.stackmemory',
        '.memory-clear-signal'
      );
      expect(fs.existsSync(signalPath)).toBe(false);

      service.stop();
    });
  });

  describe('execSync calls', () => {
    it('should trigger and write signal file even without stackmemory binary', () => {
      mockMemory(0.95, 0.5);

      const service = new DaemonMemoryService(createConfig(), onLog);
      service.start();

      // Even if binary not found, signal file is written and trigger counted
      expect(service.getState().triggerCount).toBe(1);
      const signalPath = path.join(
        tmpDir,
        '.stackmemory',
        '.memory-clear-signal'
      );
      expect(fs.existsSync(signalPath)).toBe(true);

      service.stop();
    });
  });

  describe('error handling', () => {
    it('should handle errors in memory check gracefully', () => {
      mockedTotalmem.mockImplementation(() => {
        throw new Error('totalmem failed');
      });

      const service = new DaemonMemoryService(createConfig(), onLog);
      service.start();

      const state = service.getState();
      expect(state.errors).toHaveLength(1);
      expect(state.errors[0]).toContain('totalmem failed');

      service.stop();
    });

    it('should cap errors at 10', () => {
      let callCount = 0;
      mockedTotalmem.mockImplementation(() => {
        callCount++;
        throw new Error(`fail ${callCount}`);
      });

      const service = new DaemonMemoryService(
        createConfig({ cooldownMinutes: 0 }),
        onLog
      );
      service.start();

      // Advance timers to trigger many checks (30s interval)
      for (let i = 0; i < 15; i++) {
        vi.advanceTimersByTime(30 * 1000);
      }

      const state = service.getState();
      expect(state.errors.length).toBeLessThanOrEqual(10);

      service.stop();
    });
  });
});
