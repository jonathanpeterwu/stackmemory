/**
 * Railway Server Configuration
 * Handles Railway-specific environment variables and service references
 */

export interface RailwayConfig {
  // Server
  port: number;
  environment: string;
  
  // Database
  databaseUrl: string;
  
  // Redis
  redisUrl: string;
  redisHost: string;
  redisPort: number;
  redisUser?: string;
  redisPassword?: string;
  
  // Auth
  authMode: string;
  apiKeySecret: string;
  jwtSecret: string;
  
  // Features
  corsOrigins: string[];
  rateLimitEnabled: boolean;
  rateLimitFree: number;
  enableWebSocket: boolean;
  enableAnalytics: boolean;
  
  // Storage
  storageMode: 'redis' | 'postgres' | 'hybrid';
}

/**
 * Get Railway configuration with proper service references
 * Railway provides reference variables like ${{Postgres.DATABASE_URL}}
 */
export function getRailwayConfig(): RailwayConfig {
  // Parse CORS origins
  const corsOrigins = process.env.CORS_ORIGINS?.split(',') || [
    'https://claude.ai',
    'https://claude.anthropic.com',
    'http://localhost:3000'
  ];
  
  // Build Redis URL from Railway reference variables
  // Railway typically provides: REDIS_URL or individual components
  let redisUrl = process.env.REDIS_URL || '';
  
  // If no REDIS_URL, try to build from components
  if (!redisUrl && process.env.REDISHOST) {
    const host = process.env.REDISHOST;
    const port = process.env.REDISPORT || '6379';
    const user = process.env.REDISUSER || 'default';
    const password = process.env.REDISPASSWORD || '';
    
    if (password) {
      redisUrl = `redis://${user}:${password}@${host}:${port}`;
    } else {
      redisUrl = `redis://${host}:${port}`;
    }
  }
  
  // Fallback to local Redis if not in production
  if (!redisUrl && process.env.NODE_ENV !== 'production') {
    redisUrl = 'redis://localhost:6379';
  }
  
  return {
    // Server
    port: parseInt(process.env.PORT || '3000'),
    environment: process.env.NODE_ENV || 'development',
    
    // Database - Railway provides this as DATABASE_URL
    databaseUrl: process.env.DATABASE_URL || 'postgresql://localhost:5432/stackmemory',
    
    // Redis
    redisUrl,
    redisHost: process.env.REDISHOST || 'localhost',
    redisPort: parseInt(process.env.REDISPORT || '6379'),
    redisUser: process.env.REDISUSER,
    redisPassword: process.env.REDISPASSWORD,
    
    // Auth
    authMode: process.env.AUTH_MODE || 'api_key',
    apiKeySecret: process.env.API_KEY_SECRET || 'development-secret',
    jwtSecret: process.env.JWT_SECRET || 'development-jwt-secret',
    
    // Features
    corsOrigins,
    rateLimitEnabled: process.env.RATE_LIMIT_ENABLED === 'true',
    rateLimitFree: parseInt(process.env.RATE_LIMIT_FREE || '100'),
    enableWebSocket: process.env.ENABLE_WEBSOCKET !== 'false',
    enableAnalytics: process.env.ENABLE_ANALYTICS === 'true',
    
    // Storage mode
    storageMode: (process.env.STORAGE_MODE as any) || 'hybrid'
  };
}