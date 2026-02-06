/**
 * Tests for Logger utility - Consolidated
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

let Logger: typeof import('../logger.js').Logger;
let LogLevel: typeof import('../logger.js').LogLevel;

describe('Logger', () => {
  beforeEach(async () => {
    vi.resetModules();
    delete process.env['STACKMEMORY_LOG_LEVEL'];
    const module = await import('../logger.js');
    Logger = module.Logger;
    LogLevel = module.LogLevel;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('log levels', () => {
    it('should have correct log level values and return singleton', () => {
      expect(LogLevel.ERROR).toBe(0);
      expect(LogLevel.WARN).toBe(1);
      expect(LogLevel.INFO).toBe(2);
      expect(LogLevel.DEBUG).toBe(3);
      expect(Logger.getInstance()).toBe(Logger.getInstance());
    });
  });

  describe('logging methods', () => {
    it('should log at all levels with context', () => {
      const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = Logger.getInstance();

      logger.error('Error message', new Error('test'));
      logger.warn('Warn message');
      logger.info('Info message', { key: 'value' });

      expect(errorSpy).toHaveBeenCalled();
      expect(warnSpy).toHaveBeenCalled();
      expect(logSpy).toHaveBeenCalled();
    });

    it('should filter debug at INFO level', () => {
      const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = Logger.getInstance();

      logger.debug('Debug message');

      const debugCalls = logSpy.mock.calls.filter((call) =>
        call[0]?.includes?.('DEBUG')
      );
      expect(debugCalls.length).toBe(0);
    });
  });
});

describe('Logger level configuration', () => {
  afterEach(() => {
    delete process.env['STACKMEMORY_LOG_LEVEL'];
    vi.restoreAllMocks();
  });

  it('should respect log level configuration', async () => {
    // DEBUG level should log debug
    vi.resetModules();
    process.env['STACKMEMORY_LOG_LEVEL'] = 'DEBUG';
    let { Logger } = await import('../logger.js');

    let logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    Logger.getInstance().debug('Debug message');
    expect(logSpy.mock.calls[0][0]).toContain('DEBUG');

    // ERROR level should filter info/warn
    vi.resetModules();
    process.env['STACKMEMORY_LOG_LEVEL'] = 'ERROR';
    ({ Logger } = await import('../logger.js'));

    logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logger = Logger.getInstance();

    logger.info('Info message');
    logger.warn('Warn message');

    expect(
      logSpy.mock.calls.filter((c) => c[0]?.includes?.('INFO')).length
    ).toBe(0);
    expect(
      warnSpy.mock.calls.filter((c) => c[0]?.includes?.('WARN')).length
    ).toBe(0);
  });
});
