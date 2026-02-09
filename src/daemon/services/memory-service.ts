/**
 * Memory Monitor Service
 * Monitors system RAM and Node.js heap usage, triggering
 * capture/clear cycle when thresholds are exceeded.
 */

import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';
import { freemem, homedir, totalmem } from 'os';
import type { MemoryServiceConfig } from '../daemon-config.js';

export interface MemoryServiceState {
  lastCheckTime: number;
  lastTriggerTime: number;
  triggerCount: number;
  currentRamPercent: number;
  currentHeapPercent: number;
  errors: string[];
}

export class DaemonMemoryService {
  private config: MemoryServiceConfig;
  private state: MemoryServiceState;
  private intervalId?: NodeJS.Timeout;
  private isRunning = false;
  private onLog: (level: string, message: string, data?: unknown) => void;

  constructor(
    config: MemoryServiceConfig,
    onLog: (level: string, message: string, data?: unknown) => void
  ) {
    this.config = config;
    this.onLog = onLog;
    this.state = {
      lastCheckTime: 0,
      lastTriggerTime: 0,
      triggerCount: 0,
      currentRamPercent: 0,
      currentHeapPercent: 0,
      errors: [],
    };
  }

  start(): void {
    if (this.isRunning || !this.config.enabled) {
      return;
    }

    this.isRunning = true;
    const intervalMs = this.config.interval * 60 * 1000;

    this.onLog('INFO', 'Memory service started', {
      interval: this.config.interval,
      ramThreshold: this.config.ramThreshold,
      heapThreshold: this.config.heapThreshold,
      cooldownMinutes: this.config.cooldownMinutes,
    });

    // Initial check
    this.checkMemory();

    // Schedule periodic checks
    this.intervalId = setInterval(() => {
      this.checkMemory();
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.isRunning = false;
    this.onLog('INFO', 'Memory service stopped');
  }

  getState(): MemoryServiceState {
    return { ...this.state };
  }

  updateConfig(config: Partial<MemoryServiceConfig>): void {
    const wasRunning = this.isRunning;
    if (wasRunning) {
      this.stop();
    }

    this.config = { ...this.config, ...config };

    if (wasRunning && this.config.enabled) {
      this.start();
    }
  }

  private checkMemory(): void {
    if (!this.isRunning) return;

    try {
      const total = totalmem();
      const free = freemem();
      const ramPercent = (total - free) / total;

      const heap = process.memoryUsage();
      const heapPercent = heap.heapUsed / heap.heapTotal;

      this.state.currentRamPercent = ramPercent;
      this.state.currentHeapPercent = heapPercent;
      this.state.lastCheckTime = Date.now();

      this.onLog('DEBUG', 'Memory check', {
        ramPercent: Math.round(ramPercent * 100),
        heapPercent: Math.round(heapPercent * 100),
      });

      const ramExceeded = ramPercent > this.config.ramThreshold;
      const heapExceeded = heapPercent > this.config.heapThreshold;

      if (!ramExceeded && !heapExceeded) return;

      // Check cooldown
      const cooldownMs = this.config.cooldownMinutes * 60 * 1000;
      const elapsed = Date.now() - this.state.lastTriggerTime;
      if (this.state.lastTriggerTime > 0 && elapsed < cooldownMs) {
        this.onLog('DEBUG', 'Memory threshold exceeded but in cooldown', {
          remainingMs: cooldownMs - elapsed,
        });
        return;
      }

      const reason = ramExceeded
        ? `RAM ${Math.round(ramPercent * 100)}% > ${Math.round(this.config.ramThreshold * 100)}%`
        : `Heap ${Math.round(heapPercent * 100)}% > ${Math.round(this.config.heapThreshold * 100)}%`;

      this.onLog('WARN', `Memory threshold exceeded: ${reason}`);
      this.triggerCaptureAndClear(reason, ramPercent, heapPercent);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.state.errors.push(errorMsg);
      this.onLog('ERROR', 'Memory check failed', { error: errorMsg });

      if (this.state.errors.length > 10) {
        this.state.errors = this.state.errors.slice(-10);
      }
    }
  }

  private triggerCaptureAndClear(
    reason: string,
    ramPercent: number,
    heapPercent: number
  ): void {
    try {
      // Write signal file FIRST so the hook can warn the user immediately
      this.writeSignalFile(reason, ramPercent, heapPercent);

      this.state.lastTriggerTime = Date.now();
      this.state.triggerCount++;

      const stackmemoryBin = this.getStackMemoryBin();

      if (stackmemoryBin) {
        // Capture current context
        try {
          execSync(`"${stackmemoryBin}" capture --no-commit --basic`, {
            timeout: 30000,
            encoding: 'utf8',
            stdio: 'pipe',
          });
          this.onLog('INFO', 'Context captured before memory clear');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.onLog('WARN', 'Capture failed', { error: msg });
        }

        // Clear saved context
        try {
          execSync(`"${stackmemoryBin}" clear --save`, {
            timeout: 30000,
            encoding: 'utf8',
            stdio: 'pipe',
          });
          this.onLog('INFO', 'Context cleared');
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          this.onLog('WARN', 'Clear failed', { error: msg });
        }
      }

      this.onLog('INFO', 'Memory trigger completed', {
        triggerCount: this.state.triggerCount,
        reason,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.state.errors.push(errorMsg);
      this.onLog('ERROR', 'Memory trigger failed', { error: errorMsg });

      if (this.state.errors.length > 10) {
        this.state.errors = this.state.errors.slice(-10);
      }
    }
  }

  private writeSignalFile(
    reason: string,
    ramPercent: number,
    heapPercent: number
  ): void {
    const signalDir = join(process.cwd(), '.stackmemory');
    if (!existsSync(signalDir)) {
      mkdirSync(signalDir, { recursive: true });
    }

    const signalPath = join(signalDir, '.memory-clear-signal');
    const signal = {
      timestamp: Date.now(),
      reason,
      ramPercent: Math.round(ramPercent * 100),
      heapPercent: Math.round(heapPercent * 100),
    };

    writeFileSync(signalPath, JSON.stringify(signal, null, 2));
    this.onLog('INFO', 'Signal file written', { path: signalPath });
  }

  private getStackMemoryBin(): string | null {
    const homeDir = homedir();

    const locations = [
      join(homeDir, '.stackmemory', 'bin', 'stackmemory'),
      join(homeDir, '.local', 'bin', 'stackmemory'),
      '/usr/local/bin/stackmemory',
      '/opt/homebrew/bin/stackmemory',
    ];

    for (const loc of locations) {
      if (existsSync(loc)) {
        return loc;
      }
    }

    try {
      const result = execSync('which stackmemory', {
        encoding: 'utf8',
        stdio: 'pipe',
      }).trim();
      if (result && existsSync(result)) {
        return result;
      }
    } catch {
      // Not in PATH
    }

    return null;
  }
}
