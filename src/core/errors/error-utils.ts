/**
 * Error Utilities for StackMemory
 * Provides consistent error handling patterns and utilities
 */

import { logger } from '../monitoring/logger.js';
import {
  StackMemoryError,
  ErrorCode,
  getErrorMessage,
  SystemError,
  IntegrationError,
  DatabaseError,
} from './index.js';

/**
 * Log context for silent error handling
 * Used when errors should be logged but not thrown
 */
export interface SilentErrorContext {
  operation: string;
  component: string;
  additionalInfo?: Record<string, unknown>;
}

/**
 * Safely execute an operation and return undefined on failure
 * Logs the error with context for debugging
 */
export async function safeExecute<T>(
  operation: () => Promise<T>,
  context: SilentErrorContext,
  defaultValue?: T
): Promise<T | undefined> {
  try {
    return await operation();
  } catch (error: unknown) {
    logger.debug(
      `Silent failure in ${context.component}.${context.operation}`,
      {
        error: getErrorMessage(error),
        ...context.additionalInfo,
      }
    );
    return defaultValue;
  }
}

/**
 * Synchronous version of safeExecute
 */
export function safeExecuteSync<T>(
  operation: () => T,
  context: SilentErrorContext,
  defaultValue?: T
): T | undefined {
  try {
    return operation();
  } catch (error: unknown) {
    logger.debug(
      `Silent failure in ${context.component}.${context.operation}`,
      {
        error: getErrorMessage(error),
        ...context.additionalInfo,
      }
    );
    return defaultValue;
  }
}

/**
 * Execute with logging on failure but without throwing
 * Returns null on error, allowing caller to handle gracefully
 */
export async function executeWithFallback<T>(
  operation: () => Promise<T>,
  context: SilentErrorContext
): Promise<T | null> {
  try {
    return await operation();
  } catch (error: unknown) {
    logger.warn(`Operation failed: ${context.component}.${context.operation}`, {
      error: getErrorMessage(error),
      ...context.additionalInfo,
    });
    return null;
  }
}

/**
 * Synchronous version of executeWithFallback
 */
export function executeWithFallbackSync<T>(
  operation: () => T,
  context: SilentErrorContext
): T | null {
  try {
    return operation();
  } catch (error: unknown) {
    logger.warn(`Operation failed: ${context.component}.${context.operation}`, {
      error: getErrorMessage(error),
      ...context.additionalInfo,
    });
    return null;
  }
}

/**
 * Type-safe error extraction
 * Handles the common pattern of extracting error message from unknown errors
 */
export function extractError(error: unknown): {
  message: string;
  code?: string;
  isRetryable: boolean;
  cause?: Error;
} {
  if (error instanceof StackMemoryError) {
    return {
      message: error.message,
      code: error.code,
      isRetryable: error.isRetryable,
      cause: error.cause,
    };
  }

  if (error instanceof Error) {
    const nodeError = error as NodeJS.ErrnoException;
    return {
      message: error.message,
      code: nodeError.code,
      isRetryable: isNetworkError(error),
      cause: error,
    };
  }

  return {
    message: typeof error === 'string' ? error : 'Unknown error',
    isRetryable: false,
  };
}

/**
 * Check if error is a network-related error that may be retryable
 */
export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const message = error.message.toLowerCase();
  const networkIndicators = [
    'econnrefused',
    'enotfound',
    'timeout',
    'socket hang up',
    'econnreset',
    'epipe',
    'network',
    'fetch failed',
  ];

  return networkIndicators.some((indicator) => message.includes(indicator));
}

/**
 * Create a typed error from an unknown error
 */
export function toTypedError(
  error: unknown,
  fallbackCode: ErrorCode = ErrorCode.UNKNOWN_ERROR
): StackMemoryError {
  if (error instanceof StackMemoryError) {
    return error;
  }

  const extracted = extractError(error);
  return new SystemError(
    extracted.message,
    fallbackCode,
    { originalError: extracted.code },
    extracted.cause
  );
}

/**
 * Create an integration error from an API response
 */
export function createApiError(
  response: { status: number; statusText: string },
  body?: string,
  context?: Record<string, unknown>
): IntegrationError {
  const code =
    response.status === 401 || response.status === 403
      ? ErrorCode.LINEAR_AUTH_FAILED
      : ErrorCode.LINEAR_API_ERROR;

  return new IntegrationError(
    `API error: ${response.status} ${response.statusText}`,
    code,
    {
      status: response.status,
      statusText: response.statusText,
      body,
      ...context,
    }
  );
}

/**
 * Log and rethrow with additional context
 */
export function logAndRethrow(
  error: unknown,
  context: SilentErrorContext
): never {
  const extracted = extractError(error);
  logger.error(`Error in ${context.component}.${context.operation}`, {
    error: extracted.message,
    code: extracted.code,
    ...context.additionalInfo,
  });

  if (error instanceof Error) {
    throw error;
  }
  throw new SystemError(extracted.message, ErrorCode.UNKNOWN_ERROR);
}

/**
 * Wrap database operations with proper error handling
 */
export async function withDatabaseErrorHandling<T>(
  operation: () => Promise<T>,
  operationName: string
): Promise<T> {
  try {
    return await operation();
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    logger.error(`Database operation failed: ${operationName}`, {
      error: message,
    });

    if (error instanceof DatabaseError) {
      throw error;
    }

    throw new DatabaseError(
      `${operationName}: ${message}`,
      ErrorCode.DB_QUERY_FAILED,
      { operation: operationName },
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Wrap sync database operations with proper error handling
 */
export function withDatabaseErrorHandlingSync<T>(
  operation: () => T,
  operationName: string
): T {
  try {
    return operation();
  } catch (error: unknown) {
    const message = getErrorMessage(error);
    logger.error(`Database operation failed: ${operationName}`, {
      error: message,
    });

    if (error instanceof DatabaseError) {
      throw error;
    }

    throw new DatabaseError(
      `${operationName}: ${message}`,
      ErrorCode.DB_QUERY_FAILED,
      { operation: operationName },
      error instanceof Error ? error : undefined
    );
  }
}

/**
 * Assert condition and throw if not met
 */
export function assertCondition(
  condition: boolean,
  message: string,
  code: ErrorCode = ErrorCode.VALIDATION_FAILED
): asserts condition {
  if (!condition) {
    throw new StackMemoryError({
      message,
      code,
    });
  }
}

/**
 * Assert value is not null or undefined
 */
export function assertDefined<T>(
  value: T | null | undefined,
  message: string,
  code: ErrorCode = ErrorCode.NOT_FOUND
): asserts value is T {
  if (value === null || value === undefined) {
    throw new StackMemoryError({
      message,
      code,
    });
  }
}
