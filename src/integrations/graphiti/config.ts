/**
 * Graphiti Integration Config
 */

import type { GraphitiBackend } from './types.js';

export interface GraphitiIntegrationConfig {
  enabled: boolean;
  endpoint: string; // Graphiti REST/MCP endpoint (BYO deployment)
  backend: GraphitiBackend;
  projectNamespace?: string; // logical segregation per StackMemory project
  timeoutMs: number;
  maxRetries: number;
  // Context construction
  maxTokens: number;
  maxHops: number;
}

export const DEFAULT_GRAPHITI_CONFIG: GraphitiIntegrationConfig = {
  enabled: !!process.env.GRAPHITI_ENDPOINT,
  endpoint:
    process.env.GRAPHITI_ENDPOINT?.replace(/\/$/, '') ||
    'http://localhost:8080',
  backend: (process.env.GRAPHITI_BACKEND as GraphitiBackend) || 'neo4j',
  projectNamespace: process.env.STACKMEMORY_PROJECT_ID || 'default',
  timeoutMs: 5000,
  maxRetries: 2,
  maxTokens: 1600,
  maxHops: 2,
};
