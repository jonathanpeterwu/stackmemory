/**
 * Error handling re-exports for backwards compatibility
 *
 * All error handling is now consolidated in src/core/errors/index.ts
 * This module re-exports for code that imports from monitoring/error-handler
 */

export {
  // Error codes
  ErrorCode,

  // Error classes
  StackMemoryError,
  DatabaseError,
  FrameError,
  TaskError,
  IntegrationError,
  MCPError,
  ValidationError,
  ProjectError,
  SystemError,

  // Error handler
  ErrorHandler,

  // Utilities
  getUserFriendlyMessage,
  isRetryableError,
  getErrorMessage,
  wrapError,
  isStackMemoryError,
  createErrorHandler,

  // Validators
  validateInput,
  validateEmail,
  validatePath,

  // Types
  type ErrorContext,
  type StackMemoryErrorOptions,
} from '../errors/index.js';
