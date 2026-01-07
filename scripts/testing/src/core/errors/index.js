/**
 * Custom error classes for StackMemory
 * Provides a hierarchy of error types for better error handling and debugging
 */
export var ErrorCode;
(function (ErrorCode) {
    // Database errors (1000-1999)
    ErrorCode["DB_CONNECTION_FAILED"] = "DB_001";
    ErrorCode["DB_QUERY_FAILED"] = "DB_002";
    ErrorCode["DB_TRANSACTION_FAILED"] = "DB_003";
    ErrorCode["DB_MIGRATION_FAILED"] = "DB_004";
    ErrorCode["DB_CONSTRAINT_VIOLATION"] = "DB_005";
    ErrorCode["DB_SCHEMA_ERROR"] = "DB_006";
    ErrorCode["DB_INSERT_FAILED"] = "DB_007";
    ErrorCode["DB_UPDATE_FAILED"] = "DB_008";
    ErrorCode["DB_DELETE_FAILED"] = "DB_009";
    // Frame errors (2000-2999)
    ErrorCode["FRAME_NOT_FOUND"] = "FRAME_001";
    ErrorCode["FRAME_INVALID_STATE"] = "FRAME_002";
    ErrorCode["FRAME_PARENT_NOT_FOUND"] = "FRAME_003";
    ErrorCode["FRAME_CYCLE_DETECTED"] = "FRAME_004";
    ErrorCode["FRAME_ALREADY_CLOSED"] = "FRAME_005";
    ErrorCode["FRAME_INIT_FAILED"] = "FRAME_006";
    ErrorCode["FRAME_INVALID_INPUT"] = "FRAME_007";
    ErrorCode["FRAME_STACK_OVERFLOW"] = "FRAME_008";
    // Task errors (3000-3999)
    ErrorCode["TASK_NOT_FOUND"] = "TASK_001";
    ErrorCode["TASK_INVALID_STATE"] = "TASK_002";
    ErrorCode["TASK_DEPENDENCY_CONFLICT"] = "TASK_003";
    ErrorCode["TASK_CIRCULAR_DEPENDENCY"] = "TASK_004";
    // Integration errors (4000-4999)
    ErrorCode["LINEAR_AUTH_FAILED"] = "LINEAR_001";
    ErrorCode["LINEAR_API_ERROR"] = "LINEAR_002";
    ErrorCode["LINEAR_SYNC_FAILED"] = "LINEAR_003";
    ErrorCode["LINEAR_WEBHOOK_FAILED"] = "LINEAR_004";
    // MCP errors (5000-5999)
    ErrorCode["MCP_TOOL_NOT_FOUND"] = "MCP_001";
    ErrorCode["MCP_INVALID_PARAMS"] = "MCP_002";
    ErrorCode["MCP_EXECUTION_FAILED"] = "MCP_003";
    ErrorCode["MCP_RATE_LIMITED"] = "MCP_004";
    // Project errors (6000-6999)
    ErrorCode["PROJECT_NOT_FOUND"] = "PROJECT_001";
    ErrorCode["PROJECT_INVALID_PATH"] = "PROJECT_002";
    ErrorCode["PROJECT_GIT_ERROR"] = "PROJECT_003";
    // Validation errors (7000-7999)
    ErrorCode["VALIDATION_FAILED"] = "VAL_001";
    ErrorCode["INVALID_INPUT"] = "VAL_002";
    ErrorCode["MISSING_REQUIRED_FIELD"] = "VAL_003";
    ErrorCode["TYPE_MISMATCH"] = "VAL_004";
    // System errors (8000-8999)
    ErrorCode["INITIALIZATION_ERROR"] = "SYS_001";
    ErrorCode["NOT_FOUND"] = "SYS_002";
    ErrorCode["INTERNAL_ERROR"] = "SYS_003";
    ErrorCode["CONFIGURATION_ERROR"] = "SYS_004";
    ErrorCode["PERMISSION_DENIED"] = "SYS_005";
    ErrorCode["RESOURCE_EXHAUSTED"] = "SYS_006";
    ErrorCode["SERVICE_UNAVAILABLE"] = "SYS_007";
    ErrorCode["SYSTEM_INIT_FAILED"] = "SYS_008";
    // Collaboration errors (9000-9999)
    ErrorCode["STACK_CONTEXT_NOT_FOUND"] = "COLLAB_001";
    ErrorCode["HANDOFF_REQUEST_EXPIRED"] = "COLLAB_002";
    ErrorCode["MERGE_CONFLICT_UNRESOLVABLE"] = "COLLAB_003";
    ErrorCode["PERMISSION_VIOLATION"] = "COLLAB_004";
    ErrorCode["OPERATION_FAILED"] = "COLLAB_005";
    ErrorCode["OPERATION_EXPIRED"] = "COLLAB_006";
    ErrorCode["INVALID_STATE"] = "COLLAB_007";
    ErrorCode["RESOURCE_NOT_FOUND"] = "COLLAB_008";
    ErrorCode["HANDOFF_ALREADY_EXISTS"] = "COLLAB_009";
    ErrorCode["MERGE_SESSION_INVALID"] = "COLLAB_010";
    ErrorCode["STACK_SWITCH_FAILED"] = "COLLAB_011";
    ErrorCode["APPROVAL_TIMEOUT"] = "COLLAB_012";
    ErrorCode["CONFLICT_RESOLUTION_FAILED"] = "COLLAB_013";
    ErrorCode["TEAM_ACCESS_DENIED"] = "COLLAB_014";
    ErrorCode["STACK_LIMIT_EXCEEDED"] = "COLLAB_015";
})(ErrorCode || (ErrorCode = {}));
/**
 * Base error class for all StackMemory errors
 */
export class StackMemoryError extends Error {
    constructor(options) {
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
    toJSON() {
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
    constructor(message, code = ErrorCode.DB_QUERY_FAILED, context, cause) {
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
    constructor(message, code = ErrorCode.FRAME_INVALID_STATE, context) {
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
    constructor(message, code = ErrorCode.TASK_INVALID_STATE, context) {
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
    constructor(message, code = ErrorCode.LINEAR_API_ERROR, context, cause) {
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
    constructor(message, code = ErrorCode.MCP_EXECUTION_FAILED, context) {
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
    constructor(message, code = ErrorCode.VALIDATION_FAILED, context) {
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
    constructor(message, code = ErrorCode.PROJECT_NOT_FOUND, context) {
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
    constructor(message, code = ErrorCode.INTERNAL_ERROR, context, cause) {
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
export function isRetryableError(error) {
    if (error instanceof StackMemoryError) {
        return error.isRetryable;
    }
    // Check for common retryable error patterns
    if (error instanceof Error) {
        const message = error.message.toLowerCase();
        return (message.includes('econnrefused') ||
            message.includes('timeout') ||
            message.includes('enotfound') ||
            message.includes('socket hang up'));
    }
    return false;
}
/**
 * Helper function to safely extract error message
 */
export function getErrorMessage(error) {
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
export function wrapError(error, defaultMessage, code = ErrorCode.INTERNAL_ERROR, context) {
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
export function isStackMemoryError(error) {
    return error instanceof StackMemoryError;
}
/**
 * Create context-aware error handler
 */
export function createErrorHandler(defaultContext) {
    return (error, additionalContext) => {
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
        return wrapError(error, getErrorMessage(error), ErrorCode.INTERNAL_ERROR, context);
    };
}
