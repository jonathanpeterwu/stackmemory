/**
 * Essential tests for error handling system
 */

import { describe, it, expect } from 'vitest';
import { StackMemoryError, ErrorCode } from '../index.js';

describe('Error System', () => {
  it('should create StackMemoryError', () => {
    const error = new StackMemoryError('Test error', ErrorCode.VALIDATION_FAILED);
    
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBeDefined();
  });

  it('should handle error codes', () => {
    expect(ErrorCode.VALIDATION_FAILED).toBeDefined();
    expect(ErrorCode.NETWORK_ERROR).toBeDefined();
  });
});