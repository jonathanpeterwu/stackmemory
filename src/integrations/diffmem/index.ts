/**
 * DiffMem Integration
 * User memory management for StackMemory
 */

export type {
  UserMemory,
  MemoryQuery,
  LearnedInsight,
  DiffMemStatus,
} from './types.js';

export type { DiffMemIntegrationConfig } from './config.js';
export { DEFAULT_DIFFMEM_CONFIG } from './config.js';

export { DiffMemClient, DiffMemClientError } from './client.js';
