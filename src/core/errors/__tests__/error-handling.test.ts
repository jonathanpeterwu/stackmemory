/**
 * Tests for error handling system
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  StackMemoryError,
  DatabaseError,
  FrameError,
  TaskError,
  ValidationError,
  ErrorCode,
  isRetryableError,
  getErrorMessage,
  wrapError,
  isStackMemoryError,
} from '../index.js';
import {
  retry,
  CircuitBreaker,
  withFallback,
  calculateBackoff,
  CircuitState,
  withTimeout,
  gracefulDegrade,
} from '../recovery.js';

describe('Error Classes', () => {
  describe('StackMemoryError', () => {
    it('should create error with all properties', () => {
      const error = new StackMemoryError({
        code: ErrorCode.INTERNAL_ERROR,
        message: 'Test error',
        context: { key: 'value' },
        isRetryable: true,
        httpStatus: 500,
      });

      expect(error.code).toBe(ErrorCode.INTERNAL_ERROR);
      expect(error.message).toBe('Test error');
      expect(error.context).toEqual({ key: 'value' });
      expect(error.isRetryable).toBe(true);
      expect(error.httpStatus).toBe(500);
      expect(error.timestamp).toBeInstanceOf(Date);
    });

    it('should serialize to JSON correctly', () => {
      const error = new StackMemoryError({
        code: ErrorCode.DB_CONNECTION_FAILED,
        message: 'Connection failed',
      });

      const json = error.toJSON();
      expect(json.code).toBe(ErrorCode.DB_CONNECTION_FAILED);
      expect(json.message).toBe('Connection failed');
      expect(json.timestamp).toBeDefined();
    });
  });

  describe('DatabaseError', () => {
    it('should be retryable for connection failures', () => {
      const error = new DatabaseError(
        'Connection lost',
        ErrorCode.DB_CONNECTION_FAILED
      );
      expect(error.isRetryable).toBe(true);
    });

    it('should not be retryable for query failures', () => {
      const error = new DatabaseError(
        'Invalid SQL',
        ErrorCode.DB_QUERY_FAILED
      );
      expect(error.isRetryable).toBe(false);
    });
  });

  describe('Error Helpers', () => {
    it('should identify retryable errors', () => {
      const retryable = new DatabaseError(
        'Connection lost',
        ErrorCode.DB_CONNECTION_FAILED
      );
      const nonRetryable = new ValidationError('Invalid input');

      expect(isRetryableError(retryable)).toBe(true);
      expect(isRetryableError(nonRetryable)).toBe(false);
    });

    it('should identify retryable network errors', () => {
      const networkError = new Error('ECONNREFUSED');
      const timeoutError = new Error('Request timeout');
      
      expect(isRetryableError(networkError)).toBe(true);
      expect(isRetryableError(timeoutError)).toBe(true);
    });

    it('should extract error messages safely', () => {
      expect(getErrorMessage(new Error('Test'))).toBe('Test');
      expect(getErrorMessage('String error')).toBe('String error');
      expect(getErrorMessage({ message: 'Object error' })).toBe('Object error');
      expect(getErrorMessage(null)).toBe('An unknown error occurred');
      expect(getErrorMessage(undefined)).toBe('An unknown error occurred');
    });

    it('should wrap errors correctly', () => {
      const originalError = new Error('Original');
      const wrapped = wrapError(
        originalError,
        'Wrapped message',
        ErrorCode.INTERNAL_ERROR,
        { extra: 'context' }
      );

      expect(wrapped).toBeInstanceOf(StackMemoryError);
      expect(wrapped.cause).toBe(originalError);
      expect(wrapped.context).toEqual({ extra: 'context' });
    });

    it('should not double-wrap StackMemoryErrors', () => {
      const stackError = new FrameError('Frame error');
      const wrapped = wrapError(stackError, 'Default');
      
      expect(wrapped).toBe(stackError);
    });
  });
});

describe('Recovery Utilities', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Retry Logic', () => {
    it('should retry on failure', async () => {
      let attempts = 0;
      const fn = vi.fn(async () => {
        attempts++;
        if (attempts < 3) {
          throw new DatabaseError('Connection lost', ErrorCode.DB_CONNECTION_FAILED);
        }
        return 'success';
      });

      const result = await retry(fn, {
        maxAttempts: 3,
        initialDelay: 10,
      });

      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(3);
    });

    it('should not retry non-retryable errors', async () => {
      const fn = vi.fn(async () => {
        throw new ValidationError('Invalid data');
      });

      await expect(
        retry(fn, { maxAttempts: 3 })
      ).rejects.toThrow('Invalid data');
      
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should respect timeout', async () => {
      const fn = vi.fn(async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return 'slow';
      });

      await expect(
        retry(fn, { timeout: 50 })
      ).rejects.toThrow('Operation timed out');
    });

    it('should calculate backoff correctly', () => {
      const delay1 = calculateBackoff(1, 100, 10000, 2);
      const delay2 = calculateBackoff(2, 100, 10000, 2);
      const delay3 = calculateBackoff(3, 100, 10000, 2);

      // Base delays without jitter
      expect(delay1).toBeGreaterThanOrEqual(100);
      expect(delay1).toBeLessThanOrEqual(125); // With max 25% jitter

      expect(delay2).toBeGreaterThanOrEqual(200);
      expect(delay2).toBeLessThanOrEqual(250);

      expect(delay3).toBeGreaterThanOrEqual(400);
      expect(delay3).toBeLessThanOrEqual(500);
    });
  });

  describe('Circuit Breaker', () => {
    it('should open after threshold failures', async () => {
      const breaker = new CircuitBreaker('test', {
        failureThreshold: 2,
        resetTimeout: 100,
      });

      const failingFn = vi.fn(async () => {
        throw new Error('Failed');
      });

      // First two failures
      await expect(breaker.execute(failingFn)).rejects.toThrow('Failed');
      await expect(breaker.execute(failingFn)).rejects.toThrow('Failed');

      // Circuit should be open
      expect(breaker.getState()).toBe(CircuitState.OPEN);

      // Next call should fail immediately
      await expect(breaker.execute(failingFn)).rejects.toThrow(
        'Circuit breaker test is OPEN'
      );
      expect(failingFn).toHaveBeenCalledTimes(2); // Not called on open circuit
    });

    it('should transition to half-open after timeout', async () => {
      const breaker = new CircuitBreaker('test', {
        failureThreshold: 1,
        resetTimeout: 50,
        halfOpenRequests: 1,
      });

      const fn = vi.fn(async () => {
        throw new Error('Failed');
      });

      // Open the circuit
      await expect(breaker.execute(fn)).rejects.toThrow();
      expect(breaker.getState()).toBe(CircuitState.OPEN);

      // Wait for reset timeout
      await new Promise(resolve => setTimeout(resolve, 60));

      // Should allow one request in half-open
      const successFn = vi.fn(async () => 'success');
      const result = await breaker.execute(successFn);
      
      expect(result).toBe('success');
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });

    it('should reset manually', () => {
      const breaker = new CircuitBreaker('test', {
        failureThreshold: 1,
      });

      breaker.reset();
      expect(breaker.getState()).toBe(CircuitState.CLOSED);
    });
  });

  describe('Fallback Mechanism', () => {
    it('should use fallback on primary failure', async () => {
      const primary = vi.fn(async () => {
        throw new Error('Primary failed');
      });
      const fallback1 = vi.fn(async () => 'fallback result');

      const result = await withFallback(primary, [fallback1]);

      expect(result).toBe('fallback result');
      expect(primary).toHaveBeenCalledTimes(1);
      expect(fallback1).toHaveBeenCalledTimes(1);
    });

    it('should try multiple fallbacks', async () => {
      const primary = vi.fn(async () => {
        throw new Error('Primary failed');
      });
      const fallback1 = vi.fn(async () => {
        throw new Error('Fallback1 failed');
      });
      const fallback2 = vi.fn(async () => 'fallback2 result');

      const result = await withFallback(primary, [fallback1, fallback2]);

      expect(result).toBe('fallback2 result');
      expect(fallback1).toHaveBeenCalledTimes(1);
      expect(fallback2).toHaveBeenCalledTimes(1);
    });

    it('should throw if all attempts fail', async () => {
      const primary = vi.fn(async () => {
        throw new Error('Primary');
      });
      const fallback = vi.fn(async () => {
        throw new Error('Fallback');
      });

      await expect(
        withFallback(primary, [fallback])
      ).rejects.toThrow('All attempts failed');
    });
  });

  describe('Timeout Wrapper', () => {
    it('should timeout long operations', async () => {
      const slowFn = async () => {
        await new Promise(resolve => setTimeout(resolve, 1000));
        return 'slow';
      };

      await expect(
        withTimeout(slowFn, 50, 'Custom timeout')
      ).rejects.toThrow('Custom timeout');
    });

    it('should complete fast operations', async () => {
      const fastFn = async () => {
        await new Promise(resolve => setTimeout(resolve, 10));
        return 'fast';
      };

      const result = await withTimeout(fastFn, 100);
      expect(result).toBe('fast');
    });
  });

  describe('Graceful Degradation', () => {
    it('should return default on failure', async () => {
      const failingFn = vi.fn(async () => {
        throw new Error('Failed');
      });

      const result = await gracefulDegrade(failingFn, 'default');
      expect(result).toBe('default');
    });

    it('should return result on success', async () => {
      const successFn = vi.fn(async () => 'success');
      
      const result = await gracefulDegrade(successFn, 'default');
      expect(result).toBe('success');
    });
  });
});