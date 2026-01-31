/**
 * Tests for error handling system - Consolidated
 */

import { describe, it, expect } from 'vitest';
import {
  StackMemoryError,
  ErrorCode,
  DatabaseError,
  IntegrationError,
  ValidationError,
  SystemError,
  isRetryableError,
  getErrorMessage,
  wrapError,
  getUserFriendlyMessage,
} from '../index.js';
import {
  safeExecuteSync,
  executeWithFallback,
  extractError,
  isNetworkError,
  assertCondition,
  assertDefined,
} from '../error-utils.js';

describe('Error Types', () => {
  it('should create StackMemoryError with all properties', () => {
    const cause = new Error('Original error');
    const error = new StackMemoryError({
      message: 'Test error',
      code: ErrorCode.VALIDATION_FAILED,
      context: { field: 'test' },
      cause,
      isRetryable: true,
      httpStatus: 400,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(error.isRetryable).toBe(true);
    expect(error.httpStatus).toBe(400);
    expect(error.toJSON().name).toBe('StackMemoryError');
  });

  it('should create specialized error types with correct defaults', () => {
    expect(
      new DatabaseError('DB failed', ErrorCode.DB_QUERY_FAILED).httpStatus
    ).toBe(503);
    expect(new IntegrationError('API failed').isRetryable).toBe(true);
    expect(new ValidationError('Invalid input').isRetryable).toBe(false);
    expect(new SystemError('Internal error').httpStatus).toBe(500);
  });
});

describe('Error Utilities', () => {
  it('should identify retryable errors', () => {
    expect(isRetryableError(new IntegrationError('API failed'))).toBe(true);
    expect(isRetryableError(new ValidationError('Invalid'))).toBe(false);
    expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
  });

  it('should extract error messages', () => {
    expect(getErrorMessage(new Error('Test'))).toBe('Test');
    expect(getErrorMessage('String error')).toBe('String error');
    expect(getErrorMessage(null)).toContain('error');
  });

  it('should wrap errors with context', () => {
    const original = new Error('Original');
    const wrapped = wrapError(original, 'Context message');
    expect(wrapped).toBeInstanceOf(StackMemoryError);
  });

  it('should provide user-friendly messages', () => {
    const dbError = new DatabaseError(
      'Connection refused',
      ErrorCode.DB_CONNECTION_FAILED
    );
    const message = getUserFriendlyMessage(dbError);
    expect(message).toBeDefined();
  });
});

describe('Safe Execution', () => {
  const context = { component: 'test', operation: 'test' };

  it('should execute sync safely and return result', () => {
    const result = safeExecuteSync(() => 42, context);
    expect(result).toBe(42);
  });

  it('should return undefined on sync error', () => {
    const result = safeExecuteSync(() => {
      throw new Error('Sync failure');
    }, context);
    expect(result).toBeUndefined();
  });

  it('should execute with fallback returning null on error', async () => {
    const result = await executeWithFallback(async () => {
      throw new Error('Failed');
    }, context);
    expect(result).toBeNull();
  });
});

describe('Assertions', () => {
  it('should assert conditions', () => {
    expect(() => assertCondition(true, 'Should pass')).not.toThrow();
    expect(() => assertCondition(false, 'Should fail')).toThrow(
      StackMemoryError
    );
  });

  it('should assert defined values', () => {
    assertDefined('value', 'test'); // Should not throw
    expect(() => assertDefined(undefined, 'undefined test')).toThrow(
      StackMemoryError
    );
    expect(() => assertDefined(null, 'null test')).toThrow(StackMemoryError);
  });
});

describe('Network Error Detection', () => {
  it('should identify network errors', () => {
    expect(isNetworkError(new Error('econnrefused'))).toBe(true);
    expect(isNetworkError(new Error('timeout occurred'))).toBe(true);
    expect(isNetworkError(new Error('Regular error'))).toBe(false);
  });
});

describe('extractError', () => {
  it('should extract error details', () => {
    const extracted = extractError(new Error('Test'));
    expect(extracted.message).toBe('Test');

    const extracted2 = extractError('String error');
    expect(extracted2.message).toBe('String error');

    const extracted3 = extractError(null);
    expect(extracted3.message).toContain('error');
  });
});
