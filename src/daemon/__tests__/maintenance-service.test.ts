/**
 * Tests for DaemonMaintenanceService
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DaemonMaintenanceService } from '../services/maintenance-service.js';
import type { MaintenanceServiceConfig } from '../daemon-config.js';

describe('DaemonMaintenanceService', () => {
  let service: DaemonMaintenanceService;
  let logSpy: ReturnType<typeof vi.fn>;
  let config: MaintenanceServiceConfig;

  beforeEach(() => {
    logSpy = vi.fn();
    config = {
      enabled: true,
      interval: 360,
      staleFrameThresholdDays: 30,
      ftsRebuildInterval: 24,
      embeddingBatchSize: 50,
      vacuumInterval: 168,
    };
    service = new DaemonMaintenanceService(config, logSpy);
  });

  it('should initialize with clean state, start, stop, and handle config updates', () => {
    const state = service.getState();
    expect(state.lastRunTime).toBe(0);
    expect(state.staleFramesCleaned).toBe(0);
    expect(state.ftsRebuilds).toBe(0);
    expect(state.errors).toEqual([]);

    // Start/stop
    service.start();
    expect(logSpy).toHaveBeenCalledWith(
      'INFO',
      'Maintenance service started',
      expect.any(Object)
    );
    service.stop();
    expect(logSpy).toHaveBeenCalledWith('INFO', 'Maintenance service stopped');

    // Config update restarts
    service.start();
    service.updateConfig({ interval: 120 });
    const stopCalls = logSpy.mock.calls.filter(
      (c: any[]) => c[1] === 'Maintenance service stopped'
    );
    expect(stopCalls.length).toBe(2);
    service.stop();
  });

  it('should not start if disabled', () => {
    const disabled = new DaemonMaintenanceService(
      { ...config, enabled: false },
      logSpy
    );
    disabled.start();
    const startCalls = logSpy.mock.calls.filter(
      (c: any[]) => c[1] === 'Maintenance service started'
    );
    expect(startCalls.length).toBe(0);
  });

  it('should handle forceRun gracefully when no DB exists', async () => {
    await service.forceRun();
    const state = service.getState();
    expect(state.errors.length).toBeLessThanOrEqual(10);
  });
});
