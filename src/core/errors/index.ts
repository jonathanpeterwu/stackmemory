/**
 * Custom error classes for StackMemory
 * Provides a hierarchy of error types for better error handling and debugging
 */

export enum ErrorCode {
  // Database errors (DB_*)
  DB_CONNECTION_FAILED = 'DB_001',
  DB_QUERY_FAILED = 'DB_002',
  DB_TRANSACTION_FAILED = 'DB_003',
  DB_MIGRATION_FAILED = 'DB_004',
  DB_CONSTRAINT_VIOLATION = 'DB_005',
  DB_SCHEMA_ERROR = 'DB_006',
  DB_INSERT_FAILED = 'DB_007',
  DB_UPDATE_FAILED = 'DB_008',
  DB_DELETE_FAILED = 'DB_009',
  DB_CORRUPTION = 'DB_010',

  // Frame errors (FRAME_*)
  FRAME_NOT_FOUND = 'FRAME_001',
  FRAME_INVALID_STATE = 'FRAME_002',
  FRAME_PARENT_NOT_FOUND = 'FRAME_003',
  FRAME_CYCLE_DETECTED = 'FRAME_004',
  FRAME_ALREADY_CLOSED = 'FRAME_005',
  FRAME_INIT_FAILED = 'FRAME_006',
  FRAME_INVALID_INPUT = 'FRAME_007',
  FRAME_STACK_OVERFLOW = 'FRAME_008',

  // Task errors (TASK_*)
  TASK_NOT_FOUND = 'TASK_001',
  TASK_INVALID_STATE = 'TASK_002',
  TASK_DEPENDENCY_CONFLICT = 'TASK_003',
  TASK_CIRCULAR_DEPENDENCY = 'TASK_004',

  // Integration errors (LINEAR_*)
  LINEAR_AUTH_FAILED = 'LINEAR_001',
  LINEAR_API_ERROR = 'LINEAR_002',
  LINEAR_SYNC_FAILED = 'LINEAR_003',
  LINEAR_WEBHOOK_FAILED = 'LINEAR_004',

  // MCP errors (MCP_*)
  MCP_TOOL_NOT_FOUND = 'MCP_001',
  MCP_INVALID_PARAMS = 'MCP_002',
  MCP_EXECUTION_FAILED = 'MCP_003',
  MCP_RATE_LIMITED = 'MCP_004',

  // Project errors (PROJECT_*)
  PROJECT_NOT_FOUND = 'PROJECT_001',
  PROJECT_INVALID_PATH = 'PROJECT_002',
  PROJECT_GIT_ERROR = 'PROJECT_003',

  // Validation errors (VAL_*)
  VALIDATION_FAILED = 'VAL_001',
  INVALID_INPUT = 'VAL_002',
  MISSING_REQUIRED_FIELD = 'VAL_003',
  TYPE_MISMATCH = 'VAL_004',

  // System errors (SYS_*)
  INITIALIZATION_ERROR = 'SYS_001',
  NOT_FOUND = 'SYS_002',
  INTERNAL_ERROR = 'SYS_003',
  CONFIGURATION_ERROR = 'SYS_004',
  PERMISSION_DENIED = 'SYS_005',
  RESOURCE_EXHAUSTED = 'SYS_006',
  SERVICE_UNAVAILABLE = 'SYS_007',
  SYSTEM_INIT_FAILED = 'SYS_008',
  UNKNOWN_ERROR = 'SYS_009',
  OPERATION_TIMEOUT = 'SYS_010',

  // Authentication errors (AUTH_*)
  AUTH_FAILED = 'AUTH_001',
  TOKEN_EXPIRED = 'AUTH_002',
  INVALID_CREDENTIALS = 'AUTH_003',

  // File system errors (FS_*)
  FILE_NOT_FOUND = 'FS_001',
  DISK_FULL = 'FS_002',

  // Git errors (GIT_*)
  NOT_GIT_REPO = 'GIT_001',
  GIT_COMMAND_FAILED = 'GIT_002',
  INVALID_BRANCH = 'GIT_003',

  // Network errors (NET_*)
  NETWORK_ERROR = 'NET_001',
  API_ERROR = 'NET_002',

  // Collaboration errors (COLLAB_*)
  STACK_CONTEXT_NOT_FOUND = 'COLLAB_001',
  HANDOFF_REQUEST_EXPIRED = 'COLLAB_002',
  MERGE_CONFLICT_UNRESOLVABLE = 'COLLAB_003',
  PERMISSION_VIOLATION = 'COLLAB_004',
  OPERATION_FAILED = 'COLLAB_005',
  OPERATION_EXPIRED = 'COLLAB_006',
  INVALID_STATE = 'COLLAB_007',
  RESOURCE_NOT_FOUND = 'COLLAB_008',
  HANDOFF_ALREADY_EXISTS = 'COLLAB_009',
  MERGE_SESSION_INVALID = 'COLLAB_010',
  STACK_SWITCH_FAILED = 'COLLAB_011',
  APPROVAL_TIMEOUT = 'COLLAB_012',
  CONFLICT_RESOLUTION_FAILED = 'COLLAB_013',
  TEAM_ACCESS_DENIED = 'COLLAB_014',
  STACK_LIMIT_EXCEEDED = 'COLLAB_015',
}

export interface ErrorContext {
  [key: string]: unknown;
}

export interface StackMemoryErrorOptions {
  code: ErrorCode;
  message: string;
  context?: ErrorContext;
  cause?: Error;
  isRetryable?: boolean;
  httpStatus?: number;
}

/**
 * Base error class for all StackMemory errors
 */
export class StackMemoryError extends Error {
  public readonly code: ErrorCode;
  public readonly context?: ErrorContext;
  public readonly cause?: Error;
  public readonly isRetryable: boolean;
  public readonly httpStatus: number;
  public readonly timestamp: Date;

  constructor(options: StackMemoryErrorOptions) {
    super(options.message);
    this.name = this.constructor.name;
    this.code = options.code;
    this.context = options.context;
    this.cause = options.cause;
    this.isRetryable = options.isRetryable ?? false;
    this.httpStatus = options.httpStatus ?? 500;
    this.timestamp = new Date();

    // Maintains proper stack trace for where our error was thrown
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor);
    }
  }

  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      context: this.context,
      isRetryable: this.isRetryable,
      httpStatus: this.httpStatus,
      timestamp: this.timestamp.toISOString(),
      stack: this.stack,
      cause: this.cause?.message,
    };
  }
}

/**
 * Database-related errors
 */
export class DatabaseError extends StackMemoryError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.DB_QUERY_FAILED,
    context?: ErrorContext,
    cause?: Error
  ) {
    super({
      code,
      message,
      context,
      cause,
      isRetryable: code === ErrorCode.DB_CONNECTION_FAILED,
      httpStatus: 503,
    });
  }
}

/**
 * Frame-related errors
 */
export class FrameError extends StackMemoryError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.FRAME_INVALID_STATE,
    context?: ErrorContext
  ) {
    super({
      code,
      message,
      context,
      isRetryable: false,
      httpStatus: 400,
    });
  }
}

/**
 * Task-related errors
 */
export class TaskError extends StackMemoryError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.TASK_INVALID_STATE,
    context?: ErrorContext
  ) {
    super({
      code,
      message,
      context,
      isRetryable: false,
      httpStatus: 400,
    });
  }
}

/**
 * Integration errors (Linear, etc.)
 */
export class IntegrationError extends StackMemoryError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.LINEAR_API_ERROR,
    context?: ErrorContext,
    cause?: Error
  ) {
    super({
      code,
      message,
      context,
      cause,
      isRetryable: true,
      httpStatus: 502,
    });
  }
}

/**
 * MCP-related errors
 */
export class MCPError extends StackMemoryError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.MCP_EXECUTION_FAILED,
    context?: ErrorContext
  ) {
    super({
      code,
      message,
      context,
      isRetryable: code === ErrorCode.MCP_RATE_LIMITED,
      httpStatus: code === ErrorCode.MCP_RATE_LIMITED ? 429 : 400,
    });
  }
}

/**
 * Validation errors
 */
export class ValidationError extends StackMemoryError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.VALIDATION_FAILED,
    context?: ErrorContext
  ) {
    super({
      code,
      message,
      context,
      isRetryable: false,
      httpStatus: 400,
    });
  }
}

/**
 * Project-related errors
 */
export class ProjectError extends StackMemoryError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.PROJECT_NOT_FOUND,
    context?: ErrorContext
  ) {
    super({
      code,
      message,
      context,
      isRetryable: false,
      httpStatus: 404,
    });
  }
}

/**
 * System/Internal errors
 */
export class SystemError extends StackMemoryError {
  constructor(
    message: string,
    code: ErrorCode = ErrorCode.INTERNAL_ERROR,
    context?: ErrorContext,
    cause?: Error
  ) {
    super({
      code,
      message,
      context,
      cause,
      isRetryable: code === ErrorCode.SERVICE_UNAVAILABLE,
      httpStatus: 500,
    });
  }
}

/**
 * Helper function to determine if an error is retryable
 */
export function isRetryableError(error: unknown): boolean {
  if (error instanceof StackMemoryError) {
    return error.isRetryable;
  }
  // Check for common retryable error patterns
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    return (
      message.includes('econnrefused') ||
      message.includes('timeout') ||
      message.includes('enotfound') ||
      message.includes('socket hang up')
    );
  }
  return false;
}

/**
 * Helper function to safely extract error message
 */
export function getErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  if (typeof error === 'string') {
    return error;
  }
  if (error && typeof error === 'object' && 'message' in error) {
    return String(error.message);
  }
  return 'An unknown error occurred';
}

/**
 * Helper function to wrap unknown errors in StackMemoryError
 */
export function wrapError(
  error: unknown,
  defaultMessage: string,
  code: ErrorCode = ErrorCode.INTERNAL_ERROR,
  context?: ErrorContext
): StackMemoryError {
  if (error instanceof StackMemoryError) {
    return error;
  }

  const cause = error instanceof Error ? error : undefined;
  const message = error instanceof Error ? error.message : defaultMessage;

  return new SystemError(message, code, context, cause);
}

/**
 * Type guard to check if error is a StackMemoryError
 */
export function isStackMemoryError(error: unknown): error is StackMemoryError {
  return error instanceof StackMemoryError;
}

/**
 * Create context-aware error handler
 */
export function createErrorHandler(defaultContext: ErrorContext) {
  return (error: unknown, additionalContext?: ErrorContext) => {
    const context = { ...defaultContext, ...additionalContext };

    if (error instanceof StackMemoryError) {
      // Create a new error with merged context since context is readonly
      return new StackMemoryError({
        code: error.code,
        message: error.message,
        context: { ...error.context, ...context },
        cause: error.cause,
        isRetryable: error.isRetryable,
        httpStatus: error.httpStatus,
      });
    }

    return wrapError(
      error,
      getErrorMessage(error),
      ErrorCode.INTERNAL_ERROR,
      context
    );
  };
}

/**
 * User-friendly error messages for each error code
 */
export function getUserFriendlyMessage(code: ErrorCode): string {
  switch (code) {
    // Auth errors
    case ErrorCode.AUTH_FAILED:
      return 'Authentication failed. Please check your credentials and try again.';
    case ErrorCode.TOKEN_EXPIRED:
      return 'Your session has expired. Please log in again.';
    case ErrorCode.INVALID_CREDENTIALS:
      return 'Invalid credentials provided. Please check and try again.';

    // File system errors
    case ErrorCode.FILE_NOT_FOUND:
      return 'The requested file or directory was not found.';
    case ErrorCode.PERMISSION_DENIED:
      return 'Permission denied. Please check file permissions or run with appropriate privileges.';
    case ErrorCode.DISK_FULL:
      return 'Insufficient disk space. Please free up space and try again.';

    // Git errors
    case ErrorCode.NOT_GIT_REPO:
      return 'This command requires a git repository. Please run it from within a git repository.';
    case ErrorCode.GIT_COMMAND_FAILED:
      return 'Git operation failed. Please ensure your repository is in a valid state.';
    case ErrorCode.INVALID_BRANCH:
      return 'Invalid branch specified. Please check the branch name and try again.';

    // Database errors
    case ErrorCode.DB_CONNECTION_FAILED:
      return 'Database connection failed. Please try again or contact support if the issue persists.';
    case ErrorCode.DB_QUERY_FAILED:
      return 'Database query failed. Please try again.';
    case ErrorCode.DB_CORRUPTION:
      return 'Database appears to be corrupted. Please contact support.';

    // Network errors
    case ErrorCode.NETWORK_ERROR:
      return 'Network error. Please check your internet connection and try again.';
    case ErrorCode.API_ERROR:
      return 'API request failed. Please try again later.';
    case ErrorCode.OPERATION_TIMEOUT:
      return 'The operation timed out. Please try again.';

    // Validation errors
    case ErrorCode.INVALID_INPUT:
      return 'Invalid input provided. Please check your command and try again.';
    case ErrorCode.VALIDATION_FAILED:
      return 'Validation failed. Please check your input and try again.';
    case ErrorCode.MISSING_REQUIRED_FIELD:
      return 'A required field is missing. Please provide all required information.';

    // System errors
    case ErrorCode.CONFIGURATION_ERROR:
      return 'Configuration error. Please check your settings.';
    case ErrorCode.SERVICE_UNAVAILABLE:
      return 'Service is temporarily unavailable. Please try again later.';

    // Default
    default:
      return 'An unexpected error occurred. Please try again or contact support.';
  }
}

/**
 * ErrorHandler provides utilities for handling errors in CLI context
 */
export class ErrorHandler {
  private static retryMap = new Map<string, number>();
  private static readonly MAX_RETRIES = 3;

  /**
   * Handle an error and exit the process
   */
  static handle(error: unknown, operation: string): never {
    if (error instanceof StackMemoryError) {
      const userMessage = getUserFriendlyMessage(error.code);
      console.error(`❌ ${userMessage}`);

      if (error.isRetryable) {
        console.error('💡 This error may be recoverable. Please try again.');
      }

      process.exit(1);
    }

    if (error instanceof Error) {
      let stackMemoryError: StackMemoryError;

      if ('code' in error && typeof error.code === 'string') {
        stackMemoryError = ErrorHandler.fromNodeError(
          error as NodeJS.ErrnoException,
          { operation }
        );
      } else {
        stackMemoryError = wrapError(
          error,
          error.message,
          ErrorCode.OPERATION_FAILED,
          {
            operation,
          }
        );
      }

      const userMessage = getUserFriendlyMessage(stackMemoryError.code);
      console.error(`❌ ${userMessage}`);

      if (stackMemoryError.isRetryable) {
        console.error('💡 This error may be recoverable. Please try again.');
      }

      process.exit(1);
    }

    // Unknown error type
    console.error('❌ An unexpected error occurred.');
    process.exit(1);
  }

  /**
   * Convert Node.js error to StackMemoryError
   */
  static fromNodeError(
    nodeError: NodeJS.ErrnoException,
    context: ErrorContext = {}
  ): StackMemoryError {
    const code = nodeError.code;

    switch (code) {
      case 'ENOENT':
        return new SystemError(
          `File or directory not found: ${nodeError.path}`,
          ErrorCode.FILE_NOT_FOUND,
          { ...context, path: nodeError.path },
          nodeError
        );

      case 'EACCES':
      case 'EPERM':
        return new SystemError(
          `Permission denied: ${nodeError.path}`,
          ErrorCode.PERMISSION_DENIED,
          { ...context, path: nodeError.path },
          nodeError
        );

      case 'ENOSPC':
        return new SystemError(
          'No space left on device',
          ErrorCode.DISK_FULL,
          context,
          nodeError
        );

      case 'ETIMEDOUT':
        return new SystemError(
          'Operation timed out',
          ErrorCode.OPERATION_TIMEOUT,
          context,
          nodeError
        );

      default:
        return new SystemError(
          nodeError.message,
          ErrorCode.UNKNOWN_ERROR,
          { ...context, nodeErrorCode: code },
          nodeError
        );
    }
  }

  /**
   * Safely execute an operation with optional fallback
   */
  static async safeExecute<T>(
    operation: () => Promise<T> | T,
    operationName: string,
    fallback?: T
  ): Promise<T | undefined> {
    try {
      return await operation();
    } catch (error: unknown) {
      if (fallback !== undefined) {
        return fallback;
      }
      ErrorHandler.handle(error, operationName);
    }
  }

  /**
   * Execute with automatic retry and exponential backoff
   */
  static async withRetry<T>(
    operation: () => Promise<T> | T,
    operationName: string,
    maxRetries: number = ErrorHandler.MAX_RETRIES
  ): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const result = await operation();
        ErrorHandler.retryMap.delete(operationName);
        return result;
      } catch (error: unknown) {
        lastError = error;

        if (error instanceof StackMemoryError && !error.isRetryable) {
          ErrorHandler.handle(error, operationName);
        }

        if (attempt === maxRetries) {
          break;
        }

        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }

    ErrorHandler.handle(
      lastError,
      `${operationName} (after ${maxRetries} attempts)`
    );
  }

  /**
   * Create a circuit breaker for an operation
   */
  static createCircuitBreaker<T>(
    operation: () => Promise<T> | T,
    operationName: string,
    threshold: number = 5
  ) {
    let failures = 0;
    let lastFailure = 0;
    const resetTimeout = 30000;

    return async (): Promise<T> => {
      const now = Date.now();

      if (now - lastFailure > resetTimeout) {
        failures = 0;
      }

      if (failures >= threshold) {
        throw new SystemError(
          `Circuit breaker open for '${operationName}'`,
          ErrorCode.SERVICE_UNAVAILABLE,
          { operationName, failures, threshold }
        );
      }

      try {
        const result = await operation();
        failures = 0;
        return result;
      } catch (error: unknown) {
        failures++;
        lastFailure = now;
        throw error;
      }
    };
  }
}

/**
 * Validation utilities
 */
export const validateInput = (
  value: unknown,
  name: string,
  validator: (val: unknown) => boolean
): asserts value is NonNullable<unknown> => {
  if (!validator(value)) {
    throw new ValidationError(
      `Invalid ${name}: ${String(value)}`,
      ErrorCode.INVALID_INPUT,
      { name, value }
    );
  }
};

export const validateEmail = (email: string): asserts email is string => {
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email) || email.length > 254) {
    throw new ValidationError(
      `Invalid email format: ${email}`,
      ErrorCode.INVALID_INPUT,
      { email }
    );
  }
};

export const validatePath = (filePath: string): asserts filePath is string => {
  if (!filePath || filePath.includes('..') || filePath.includes('\0')) {
    throw new ValidationError(
      `Invalid path: ${filePath}`,
      ErrorCode.INVALID_INPUT,
      { path: filePath }
    );
  }
};

// Re-export error utilities
export * from './error-utils.js';
