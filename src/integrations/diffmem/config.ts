/**
 * DiffMem Integration Configuration
 */

export interface DiffMemIntegrationConfig {
  endpoint: string;
  userId: string;
  timeout: number;
  maxRetries: number;
  enabled: boolean;
}

export const DEFAULT_DIFFMEM_CONFIG: DiffMemIntegrationConfig = {
  endpoint: process.env.DIFFMEM_ENDPOINT || 'http://localhost:8000',
  userId: process.env.DIFFMEM_USER_ID || 'default',
  timeout: 5000,
  maxRetries: 3,
  enabled:
    process.env.DIFFMEM_ENABLED === 'true' || !!process.env.DIFFMEM_ENDPOINT,
};
