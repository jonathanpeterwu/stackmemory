/**
 * Sweep Next-Edit Feature
 *
 * Provides next-edit predictions using Sweep 1.5B model
 * via a local llama-server instance.
 */

export * from './types.js';
export * from './prompt-builder.js';
export * from './prediction-client.js';
export * from './sweep-server-manager.js';
export * from './state-watcher.js';
export * from './status-bar.js';
export * from './tab-interceptor.js';
export {
  PtyWrapper,
  launchWrapper,
  type PtyWrapperConfig,
} from './pty-wrapper.js';
