/**
 * Error recovery utilities for StackMemory
 * Provides retry logic, circuit breakers, and fallback mechanisms
 */
import { logger } from '../monitoring/logger.js';
import { isRetryableError, getErrorMessage, } from './index.js';
export var CircuitState;
(function (CircuitState) {
    CircuitState["CLOSED"] = "closed";
    CircuitState["OPEN"] = "open";
    CircuitState["HALF_OPEN"] = "half_open";
})(CircuitState || (CircuitState = {}));
/**
 * Exponential backoff with jitter
 */
export function calculateBackoff(attempt, initialDelay, maxDelay, factor) {
    const exponentialDelay = Math.min(initialDelay * Math.pow(factor, attempt - 1), maxDelay);
    // Add jitter (0-25% of delay)
    const jitter = exponentialDelay * Math.random() * 0.25;
    return Math.floor(exponentialDelay + jitter);
}
/**
 * Retry with exponential backoff
 */
export async function retry(fn, options = {}) {
    const { maxAttempts = 3, initialDelay = 1000, maxDelay = 30000, backoffFactor = 2, timeout, onRetry, } = options;
    let lastError;
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
        try {
            // Add timeout if specified
            if (timeout) {
                return await Promise.race([
                    fn(),
                    new Promise((_, reject) => setTimeout(() => reject(new Error(`Operation timed out after ${timeout}ms`)), timeout)),
                ]);
            }
            return await fn();
        }
        catch (error) {
            lastError = error;
            // Don't retry if not retryable or last attempt
            if (!isRetryableError(error) || attempt === maxAttempts) {
                throw error;
            }
            const delay = calculateBackoff(attempt, initialDelay, maxDelay, backoffFactor);
            logger.warn(`Retry attempt ${attempt}/${maxAttempts} after ${delay}ms`, {
                error: getErrorMessage(error),
                attempt,
                delay,
            });
            if (onRetry) {
                onRetry(attempt, error);
            }
            await new Promise((resolve) => setTimeout(resolve, delay));
        }
    }
    throw lastError;
}
/**
 * Circuit breaker implementation
 */
export class CircuitBreaker {
    constructor(name, options = {}) {
        this.name = name;
        this.state = CircuitState.CLOSED;
        this.failures = 0;
        this.successCount = 0;
        this.options = {
            failureThreshold: options.failureThreshold ?? 5,
            resetTimeout: options.resetTimeout ?? 60000,
            halfOpenRequests: options.halfOpenRequests ?? 3,
        };
    }
    async execute(fn) {
        // Check if circuit should transition from OPEN to HALF_OPEN
        if (this.state === CircuitState.OPEN) {
            const timeSinceLastFailure = this.lastFailTime
                ? Date.now() - this.lastFailTime.getTime()
                : 0;
            if (timeSinceLastFailure >= this.options.resetTimeout) {
                this.state = CircuitState.HALF_OPEN;
                this.successCount = 0;
                logger.info(`Circuit breaker ${this.name} entering half-open state`);
            }
            else {
                throw new Error(`Circuit breaker ${this.name} is OPEN. Retry after ${this.options.resetTimeout - timeSinceLastFailure}ms`);
            }
        }
        try {
            const result = await fn();
            // Handle success
            if (this.state === CircuitState.HALF_OPEN) {
                this.successCount++;
                if (this.successCount >= this.options.halfOpenRequests) {
                    this.state = CircuitState.CLOSED;
                    this.failures = 0;
                    logger.info(`Circuit breaker ${this.name} is now CLOSED`);
                }
            }
            else {
                this.failures = 0;
            }
            return result;
        }
        catch (error) {
            this.handleFailure(error);
            throw error;
        }
    }
    handleFailure(error) {
        this.failures++;
        this.lastFailTime = new Date();
        if (this.state === CircuitState.HALF_OPEN) {
            this.state = CircuitState.OPEN;
            logger.error(`Circuit breaker ${this.name} reopened due to failure in half-open state`);
        }
        else if (this.state === CircuitState.CLOSED &&
            this.failures >= this.options.failureThreshold) {
            this.state = CircuitState.OPEN;
            logger.error(`Circuit breaker ${this.name} opened after ${this.failures} failures`);
        }
    }
    getState() {
        return this.state;
    }
    reset() {
        this.state = CircuitState.CLOSED;
        this.failures = 0;
        this.successCount = 0;
        this.lastFailTime = undefined;
        logger.info(`Circuit breaker ${this.name} manually reset`);
    }
}
/**
 * Fallback with multiple strategies
 */
export async function withFallback(primary, fallbacks, context) {
    const errors = [];
    // Try primary
    try {
        return await primary();
    }
    catch (error) {
        errors.push(error);
        logger.warn('Primary operation failed, trying fallbacks', {
            error: getErrorMessage(error),
            context,
        });
    }
    // Try fallbacks in order
    for (let i = 0; i < fallbacks.length; i++) {
        try {
            const result = await fallbacks[i]();
            logger.info(`Fallback ${i + 1} succeeded`, { context });
            return result;
        }
        catch (error) {
            errors.push(error);
            if (i < fallbacks.length - 1) {
                logger.warn(`Fallback ${i + 1} failed, trying next`, {
                    error: getErrorMessage(error),
                    context,
                });
            }
        }
    }
    // All attempts failed
    throw new Error(`All attempts failed. Errors: ${errors.map(getErrorMessage).join(', ')}`);
}
/**
 * Bulkhead pattern - limit concurrent operations
 */
export class Bulkhead {
    constructor(name, maxConcurrent) {
        this.name = name;
        this.maxConcurrent = maxConcurrent;
        this.running = 0;
        this.queue = [];
    }
    async execute(fn) {
        if (this.running >= this.maxConcurrent) {
            await new Promise((resolve) => {
                this.queue.push(resolve);
            });
        }
        this.running++;
        try {
            return await fn();
        }
        finally {
            this.running--;
            const next = this.queue.shift();
            if (next) {
                next();
            }
        }
    }
    getStats() {
        return {
            running: this.running,
            queued: this.queue.length,
            maxConcurrent: this.maxConcurrent,
        };
    }
}
/**
 * Timeout wrapper with proper cleanup
 */
export async function withTimeout(fn, timeoutMs, timeoutMessage) {
    return Promise.race([
        fn(),
        new Promise((_, reject) => setTimeout(() => reject(new Error(timeoutMessage ?? `Operation timed out after ${timeoutMs}ms`)), timeoutMs)),
    ]);
}
/**
 * Graceful degradation helper
 */
export async function gracefulDegrade(fn, defaultValue, logContext) {
    try {
        return await fn();
    }
    catch (error) {
        logger.warn('Operation failed, using default value', {
            error: getErrorMessage(error),
            ...logContext,
        });
        return defaultValue;
    }
}
/**
 * Create a resilient operation with multiple recovery strategies
 */
export function createResilientOperation(name, options = {}) {
    const circuitBreaker = options.circuitBreaker
        ? new CircuitBreaker(name, options.circuitBreaker)
        : null;
    const bulkhead = options.bulkhead
        ? new Bulkhead(name, options.bulkhead)
        : null;
    return async (fn) => {
        let currentFn = fn;
        // Wrap with bulkhead if configured
        if (bulkhead) {
            const wrapped = currentFn;
            currentFn = () => bulkhead.execute(wrapped);
        }
        // Wrap with timeout if configured
        if (options.timeout) {
            const wrapped = currentFn;
            currentFn = () => withTimeout(wrapped, options.timeout);
        }
        // Wrap with retry if configured
        if (options.retry) {
            const wrapped = currentFn;
            currentFn = () => retry(wrapped, options.retry);
        }
        // Wrap with circuit breaker if configured
        if (circuitBreaker) {
            const wrapped = currentFn;
            currentFn = () => circuitBreaker.execute(wrapped);
        }
        // Execute with fallback if configured
        if (options.fallback) {
            return withFallback(currentFn, [options.fallback]);
        }
        return currentFn();
    };
}
