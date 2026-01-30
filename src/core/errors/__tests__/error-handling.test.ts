/**
 * Tests for error handling system
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
  createErrorHandler,
} from '../index.js';
import {
  safeExecute,
  safeExecuteSync,
  executeWithFallback,
  extractError,
  isNetworkError,
  toTypedError,
  assertCondition,
  assertDefined,
} from '../error-utils.js';

describe('Error System', () => {
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
    expect(error.message).toBe('Test error');
    expect(error.name).toBe('StackMemoryError');
    expect(error.code).toBe(ErrorCode.VALIDATION_FAILED);
    expect(error.context).toEqual({ field: 'test' });
    expect(error.cause).toBe(cause);
    expect(error.isRetryable).toBe(true);
    expect(error.httpStatus).toBe(400);
    expect(error.timestamp).toBeInstanceOf(Date);
  });

  it('should handle error codes', () => {
    expect(ErrorCode.VALIDATION_FAILED).toBe('VAL_001');
    expect(ErrorCode.DB_CONNECTION_FAILED).toBe('DB_001');
    expect(ErrorCode.LINEAR_AUTH_FAILED).toBe('LINEAR_001');
  });

  it('should create specialized error types', () => {
    const dbError = new DatabaseError('DB failed', ErrorCode.DB_QUERY_FAILED);
    expect(dbError.httpStatus).toBe(503);

    const integrationError = new IntegrationError('API failed');
    expect(integrationError.isRetryable).toBe(true);
    expect(integrationError.httpStatus).toBe(502);

    const validationError = new ValidationError('Invalid input');
    expect(validationError.isRetryable).toBe(false);
    expect(validationError.httpStatus).toBe(400);

    const systemError = new SystemError('Internal error');
    expect(systemError.httpStatus).toBe(500);
  });

  it('should serialize error to JSON', () => {
    const error = new StackMemoryError({
      message: 'Test',
      code: ErrorCode.INTERNAL_ERROR,
    });

    const json = error.toJSON();
    expect(json.name).toBe('StackMemoryError');
    expect(json.code).toBe(ErrorCode.INTERNAL_ERROR);
    expect(json.message).toBe('Test');
    expect(json.timestamp).toBeDefined();
  });
});

describe('Error Utilities', () => {
  describe('isRetryableError', () => {
    it('should identify retryable StackMemoryError', () => {
      const retryable = new IntegrationError('API failed');
      expect(isRetryableError(retryable)).toBe(true);

      const nonRetryable = new ValidationError('Invalid');
      expect(isRetryableError(nonRetryable)).toBe(false);
    });

    it('should identify network errors as retryable', () => {
      expect(isRetryableError(new Error('ECONNREFUSED'))).toBe(true);
      expect(isRetryableError(new Error('Socket hang up'))).toBe(true);
      expect(isRetryableError(new Error('Timeout'))).toBe(true);
    });
  });

  describe('getErrorMessage', () => {
    it('should extract message from Error', () => {
      expect(getErrorMessage(new Error('Test'))).toBe('Test');
    });

    it('should handle string errors', () => {
      expect(getErrorMessage('String error')).toBe('String error');
    });

    it('should handle unknown errors', () => {
      expect(getErrorMessage(null)).toBe('An unknown error occurred');
      expect(getErrorMessage(undefined)).toBe('An unknown error occurred');
      expect(getErrorMessage(42)).toBe('An unknown error occurred');
    });

    it('should handle objects with message property', () => {
      expect(getErrorMessage({ message: 'Object error' })).toBe('Object error');
    });
  });

  describe('wrapError', () => {
    it('should return StackMemoryError unchanged', () => {
      const original = new ValidationError('Test');
      expect(wrapError(original, 'Default')).toBe(original);
    });

    it('should wrap regular Error', () => {
      const original = new Error('Original');
      const wrapped = wrapError(original, 'Default');

      expect(wrapped).toBeInstanceOf(SystemError);
      expect(wrapped.message).toBe('Original');
      expect(wrapped.cause).toBe(original);
    });

    it('should use default message for non-Error', () => {
      const wrapped = wrapError('string', 'Default message');
      expect(wrapped.message).toBe('Default message');
    });
  });

  describe('getUserFriendlyMessage', () => {
    it('should return friendly messages for known codes', () => {
      expect(getUserFriendlyMessage(ErrorCode.AUTH_FAILED)).toContain(
        'Authentication'
      );
      expect(getUserFriendlyMessage(ErrorCode.FILE_NOT_FOUND)).toContain(
        'not found'
      );
      expect(getUserFriendlyMessage(ErrorCode.NETWORK_ERROR)).toContain(
        'internet'
      );
    });

    it('should return generic message for unknown codes', () => {
      const msg = getUserFriendlyMessage('UNKNOWN_CODE' as ErrorCode);
      expect(msg).toContain('unexpected error');
    });
  });

  describe('createErrorHandler', () => {
    it('should merge context', () => {
      const handler = createErrorHandler({ component: 'test' });
      const error = new ValidationError('Test');
      const handled = handler(error, { operation: 'validate' });

      expect(handled.context?.component).toBe('test');
      expect(handled.context?.operation).toBe('validate');
    });
  });
});

describe('Error Utils', () => {
  describe('safeExecute', () => {
    it('should return result on success', async () => {
      const result = await safeExecute(async () => 'success', {
        operation: 'test',
        component: 'test',
      });
      expect(result).toBe('success');
    });

    it('should return undefined on failure', async () => {
      const result = await safeExecute(
        async () => {
          throw new Error('fail');
        },
        { operation: 'test', component: 'test' }
      );
      expect(result).toBeUndefined();
    });

    it('should return default value on failure', async () => {
      const result = await safeExecute(
        async () => {
          throw new Error('fail');
        },
        { operation: 'test', component: 'test' },
        'default'
      );
      expect(result).toBe('default');
    });
  });

  describe('safeExecuteSync', () => {
    it('should handle sync operations', () => {
      const result = safeExecuteSync(() => 'success', {
        operation: 'test',
        component: 'test',
      });
      expect(result).toBe('success');
    });

    it('should return default on failure', () => {
      const result = safeExecuteSync(
        () => {
          throw new Error('fail');
        },
        { operation: 'test', component: 'test' },
        'default'
      );
      expect(result).toBe('default');
    });
  });

  describe('executeWithFallback', () => {
    it('should return null on failure', async () => {
      const result = await executeWithFallback(
        async () => {
          throw new Error('fail');
        },
        { operation: 'test', component: 'test' }
      );
      expect(result).toBeNull();
    });
  });

  describe('extractError', () => {
    it('should extract from StackMemoryError', () => {
      const error = new IntegrationError(
        'API failed',
        ErrorCode.LINEAR_API_ERROR
      );
      const extracted = extractError(error);

      expect(extracted.message).toBe('API failed');
      expect(extracted.code).toBe(ErrorCode.LINEAR_API_ERROR);
      expect(extracted.isRetryable).toBe(true);
    });

    it('should extract from regular Error', () => {
      const error = new Error('Regular error');
      const extracted = extractError(error);

      expect(extracted.message).toBe('Regular error');
      expect(extracted.cause).toBe(error);
    });

    it('should handle non-Error values', () => {
      expect(extractError('string').message).toBe('string');
      expect(extractError(null).message).toBe('Unknown error');
    });
  });

  describe('isNetworkError', () => {
    it('should identify network errors', () => {
      expect(isNetworkError(new Error('ECONNREFUSED'))).toBe(true);
      expect(isNetworkError(new Error('ENOTFOUND'))).toBe(true);
      expect(isNetworkError(new Error('timeout'))).toBe(true);
      expect(isNetworkError(new Error('socket hang up'))).toBe(true);
      expect(isNetworkError(new Error('ECONNRESET'))).toBe(true);
    });

    it('should return false for non-network errors', () => {
      expect(isNetworkError(new Error('Validation failed'))).toBe(false);
      expect(isNetworkError('string')).toBe(false);
    });
  });

  describe('toTypedError', () => {
    it('should return StackMemoryError unchanged', () => {
      const error = new ValidationError('Test');
      expect(toTypedError(error)).toBe(error);
    });

    it('should wrap unknown errors', () => {
      const wrapped = toTypedError(new Error('test'), ErrorCode.API_ERROR);
      expect(wrapped).toBeInstanceOf(SystemError);
      expect(wrapped.code).toBe(ErrorCode.API_ERROR);
    });
  });

  describe('assertCondition', () => {
    it('should not throw when condition is true', () => {
      expect(() => assertCondition(true, 'Test')).not.toThrow();
    });

    it('should throw when condition is false', () => {
      expect(() => assertCondition(false, 'Test')).toThrow(StackMemoryError);
    });
  });

  describe('assertDefined', () => {
    it('should not throw for defined values', () => {
      expect(() => assertDefined('value', 'Test')).not.toThrow();
      expect(() => assertDefined(0, 'Test')).not.toThrow();
      expect(() => assertDefined('', 'Test')).not.toThrow();
    });

    it('should throw for null or undefined', () => {
      expect(() => assertDefined(null, 'Test')).toThrow(StackMemoryError);
      expect(() => assertDefined(undefined, 'Test')).toThrow(StackMemoryError);
    });
  });
});
