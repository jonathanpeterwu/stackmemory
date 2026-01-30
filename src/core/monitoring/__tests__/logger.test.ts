/**
 * Tests for Logger utility
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Reset singleton between tests
let Logger: typeof import('../logger.js').Logger;
let LogLevel: typeof import('../logger.js').LogLevel;

describe('Logger', () => {
  beforeEach(async () => {
    vi.resetModules();
    // Clear any environment variables that affect logger
    delete process.env['STACKMEMORY_LOG_LEVEL'];
    delete process.env['STACKMEMORY_LOG_FILE'];

    // Re-import to get fresh singleton
    const module = await import('../logger.js');
    Logger = module.Logger;
    LogLevel = module.LogLevel;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('LogLevel', () => {
    it('should have correct log level values', () => {
      expect(LogLevel.ERROR).toBe(0);
      expect(LogLevel.WARN).toBe(1);
      expect(LogLevel.INFO).toBe(2);
      expect(LogLevel.DEBUG).toBe(3);
    });
  });

  describe('getInstance', () => {
    it('should return singleton instance', () => {
      const instance1 = Logger.getInstance();
      const instance2 = Logger.getInstance();
      expect(instance1).toBe(instance2);
    });
  });

  describe('logging methods', () => {
    it('should log error messages', () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const logger = Logger.getInstance();

      logger.error('Test error message');

      expect(consoleSpy).toHaveBeenCalled();
      const logOutput = consoleSpy.mock.calls[0][0];
      expect(logOutput).toContain('ERROR');
      expect(logOutput).toContain('Test error message');
    });

    it('should log error with Error object', () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const logger = Logger.getInstance();
      const testError = new Error('Test error object');

      logger.error('Error occurred', testError);

      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should log error with context', () => {
      const consoleSpy = vi
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const logger = Logger.getInstance();

      logger.error('Error with context', { detail: 'some info' });

      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should log warn messages', () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
      const logger = Logger.getInstance();

      logger.warn('Test warning message');

      expect(consoleSpy).toHaveBeenCalled();
      const logOutput = consoleSpy.mock.calls[0][0];
      expect(logOutput).toContain('WARN');
      expect(logOutput).toContain('Test warning message');
    });

    it('should log info messages', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = Logger.getInstance();

      logger.info('Test info message');

      expect(consoleSpy).toHaveBeenCalled();
      const logOutput = consoleSpy.mock.calls[0][0];
      expect(logOutput).toContain('INFO');
      expect(logOutput).toContain('Test info message');
    });

    it('should log info with context', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = Logger.getInstance();

      logger.info('Info with context', { key: 'value' });

      expect(consoleSpy).toHaveBeenCalled();
    });

    it('should not log debug messages at INFO level', () => {
      const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
      const logger = Logger.getInstance();

      logger.debug('Debug message');

      // Debug should not be logged at INFO level (default)
      const debugCalls = consoleSpy.mock.calls.filter((call) =>
        call[0]?.includes?.('DEBUG')
      );
      expect(debugCalls.length).toBe(0);
    });
  });
});

describe('Logger with DEBUG level', () => {
  beforeEach(async () => {
    vi.resetModules();
    process.env['STACKMEMORY_LOG_LEVEL'] = 'DEBUG';

    const module = await import('../logger.js');
    Logger = module.Logger;
    LogLevel = module.LogLevel;
  });

  afterEach(() => {
    delete process.env['STACKMEMORY_LOG_LEVEL'];
    vi.restoreAllMocks();
  });

  it('should log debug messages when level is DEBUG', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = Logger.getInstance();

    logger.debug('Debug message');

    expect(consoleSpy).toHaveBeenCalled();
    const logOutput = consoleSpy.mock.calls[0][0];
    expect(logOutput).toContain('DEBUG');
    expect(logOutput).toContain('Debug message');
  });
});

describe('Logger with ERROR level', () => {
  beforeEach(async () => {
    vi.resetModules();
    process.env['STACKMEMORY_LOG_LEVEL'] = 'ERROR';

    const module = await import('../logger.js');
    Logger = module.Logger;
    LogLevel = module.LogLevel;
  });

  afterEach(() => {
    delete process.env['STACKMEMORY_LOG_LEVEL'];
    vi.restoreAllMocks();
  });

  it('should not log info messages at ERROR level', () => {
    const consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
    const logger = Logger.getInstance();

    logger.info('Info message');

    const infoCalls = consoleSpy.mock.calls.filter((call) =>
      call[0]?.includes?.('INFO')
    );
    expect(infoCalls.length).toBe(0);
  });

  it('should not log warn messages at ERROR level', () => {
    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logger = Logger.getInstance();

    logger.warn('Warn message');

    const warnCalls = consoleSpy.mock.calls.filter((call) =>
      call[0]?.includes?.('WARN')
    );
    expect(warnCalls.length).toBe(0);
  });
});
