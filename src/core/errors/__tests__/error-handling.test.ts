/**
 * Essential tests for error handling system
 */

import { describe, it, expect } from 'vitest';
import { StackMemoryError, ErrorCode } from '../index.js';

describe('Error System', () => {
  it('should create StackMemoryError', () => {
    const error = new StackMemoryError({
      message: 'Test error',
      code: ErrorCode.VALIDATION_FAILED
    });
    
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('Test error');
    expect(error.name).toBe('StackMemoryError');
  });

  it('should handle error codes', () => {
    expect(ErrorCode.VALIDATION_FAILED).toBe('VAL_001');
    expect(ErrorCode.DB_CONNECTION_FAILED).toBe('DB_001');
  });
});