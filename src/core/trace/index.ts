/**
 * Trace Module Export
 * Central export for all tracing functionality
 */

import type { TraceConfig } from './debug-trace.js';

export {
  trace,
  TraceContext,
  Trace,
  TraceClass,
  TraceCritical,
  type TraceConfig,
} from './debug-trace.js';

export {
  wrapCommand,
  wrapProgram,
  traceStep,
  traceQuery,
  traceAPI,
} from './cli-trace-wrapper.js';

export {
  createTracedDatabase,
  wrapDatabase,
  getQueryStatistics,
  createTracedTransaction,
} from './db-trace-wrapper.js';

export {
  TraceLinearAPI,
  createTracedFetch,
  wrapGraphQLClient,
} from './linear-api-wrapper.js';

/**
 * Initialize tracing based on environment configuration
 * Configuration is read directly from env vars by trace decorators
 */
export function initializeTracing(): void {
  // No-op - trace config is read from env vars on demand
}

/**
 * Helper to enable tracing for a specific scope
 */
export function withTracing<T>(fn: () => T, options?: Partial<TraceConfig>): T {
  const originalEnv = process.env['DEBUG_TRACE'];

  try {
    // Temporarily enable tracing
    process.env['DEBUG_TRACE'] = 'true';

    // Apply custom options if provided
    if (options) {
      if (options.output) process.env['TRACE_OUTPUT'] = options.output;
      if (options.verbosity) process.env['TRACE_VERBOSITY'] = options.verbosity;
      if (options.includeParams !== undefined) {
        process.env['TRACE_PARAMS'] = String(options.includeParams);
      }
      if (options.includeResults !== undefined) {
        process.env['TRACE_RESULTS'] = String(options.includeResults);
      }
      if (options.performanceThreshold !== undefined) {
        process.env['TRACE_PERF_THRESHOLD'] = String(
          options.performanceThreshold
        );
      }
    }

    return fn();
  } finally {
    // Restore original environment
    if (originalEnv === undefined) {
      delete process.env['DEBUG_TRACE'];
    } else {
      process.env['DEBUG_TRACE'] = originalEnv;
    }
  }
}

/**
 * Quick enable/disable functions for debugging
 */
export const enableTracing = () => {
  process.env['DEBUG_TRACE'] = 'true';
  console.log('Tracing enabled');
};

export const disableTracing = () => {
  delete process.env['DEBUG_TRACE'];
  console.log('Tracing disabled');
};

export const enableVerboseTracing = () => {
  process.env['DEBUG_TRACE'] = 'true';
  process.env['TRACE_VERBOSITY'] = 'full';
  process.env['TRACE_PARAMS'] = 'true';
  process.env['TRACE_RESULTS'] = 'true';
  process.env['TRACE_MEMORY'] = 'true';
  console.log('Verbose tracing enabled');
};

export const enableMinimalTracing = () => {
  process.env['DEBUG_TRACE'] = 'true';
  process.env['TRACE_VERBOSITY'] = 'summary';
  process.env['TRACE_PARAMS'] = 'false';
  process.env['TRACE_RESULTS'] = 'false';
  process.env['TRACE_MEMORY'] = 'false';
  console.log('✅ Minimal tracing enabled');
};
