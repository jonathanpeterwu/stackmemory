/**
 * Linear Sync Service Wrapper
 * Wraps LinearAutoSyncService for daemon integration
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import type { LinearServiceConfig } from '../daemon-config.js';

export interface LinearServiceState {
  lastSyncTime: number;
  syncCount: number;
  errors: string[];
  nextSyncTime?: number;
}

export class DaemonLinearService {
  private config: LinearServiceConfig;
  private state: LinearServiceState;
  private intervalId?: NodeJS.Timeout;
  private isRunning = false;
  private onLog: (level: string, message: string, data?: unknown) => void;

  constructor(
    config: LinearServiceConfig,
    onLog: (level: string, message: string, data?: unknown) => void
  ) {
    this.config = config;
    this.onLog = onLog;
    this.state = {
      lastSyncTime: 0,
      syncCount: 0,
      errors: [],
    };
  }

  async start(): Promise<void> {
    if (this.isRunning || !this.config.enabled) {
      return;
    }

    // Check if Linear is configured
    if (!this.isLinearConfigured()) {
      this.onLog('WARN', 'Linear not configured, skipping linear service');
      return;
    }

    this.isRunning = true;
    const intervalMs = this.config.interval * 60 * 1000;

    this.onLog('INFO', 'Linear service started', {
      interval: this.config.interval,
      quietHours: this.config.quietHours,
    });

    // Initial sync
    await this.performSync();

    // Schedule periodic syncs
    this.intervalId = setInterval(async () => {
      await this.performSync();
    }, intervalMs);
  }

  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = undefined;
    }
    this.isRunning = false;
    this.onLog('INFO', 'Linear service stopped');
  }

  getState(): LinearServiceState {
    return {
      ...this.state,
      nextSyncTime: this.isRunning
        ? this.state.lastSyncTime + this.config.interval * 60 * 1000
        : undefined,
    };
  }

  updateConfig(config: Partial<LinearServiceConfig>): void {
    const wasRunning = this.isRunning;
    if (wasRunning) {
      this.stop();
    }

    this.config = { ...this.config, ...config };

    if (wasRunning && this.config.enabled) {
      this.start();
    }
  }

  async forceSync(): Promise<void> {
    await this.performSync();
  }

  private async performSync(): Promise<void> {
    if (!this.isRunning) return;

    // Check quiet hours
    if (this.isInQuietHours()) {
      this.onLog('DEBUG', 'Skipping sync during quiet hours');
      return;
    }

    try {
      // Dynamically import LinearAutoSyncService to avoid loading if not needed
      const { LinearAutoSyncService } =
        await import('../../integrations/linear/auto-sync.js');

      const projectRoot = this.findProjectRoot();
      if (!projectRoot) {
        this.onLog('WARN', 'No project root found for Linear sync');
        return;
      }

      const syncService = new LinearAutoSyncService(projectRoot, {
        enabled: true,
        interval: this.config.interval,
        retryAttempts: this.config.retryAttempts,
        retryDelay: this.config.retryDelay,
        quietHours: this.config.quietHours,
      });

      await syncService.forceSync();
      syncService.stop();

      this.state.syncCount++;
      this.state.lastSyncTime = Date.now();

      this.onLog('INFO', 'Linear sync completed', {
        syncCount: this.state.syncCount,
      });
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.state.errors.push(errorMsg);
      this.onLog('ERROR', 'Linear sync failed', { error: errorMsg });

      // Keep only last 10 errors
      if (this.state.errors.length > 10) {
        this.state.errors = this.state.errors.slice(-10);
      }
    }
  }

  private isLinearConfigured(): boolean {
    const homeDir = homedir();
    const configPath = join(homeDir, '.stackmemory', 'linear-auth.json');
    return existsSync(configPath) || !!process.env['LINEAR_API_KEY'];
  }

  private findProjectRoot(): string | null {
    // Check common locations
    const cwd = process.cwd();
    if (existsSync(join(cwd, '.stackmemory'))) {
      return cwd;
    }

    // Check home directory
    const homeDir = homedir();
    if (existsSync(join(homeDir, '.stackmemory'))) {
      return homeDir;
    }

    return null;
  }

  private isInQuietHours(): boolean {
    if (!this.config.quietHours) return false;

    const now = new Date();
    const currentHour = now.getHours();
    const { start, end } = this.config.quietHours;

    if (start > end) {
      // Quiet hours span midnight (e.g., 22:00 - 07:00)
      return currentHour >= start || currentHour < end;
    } else {
      // Quiet hours within same day
      return currentHour >= start && currentHour < end;
    }
  }
}
