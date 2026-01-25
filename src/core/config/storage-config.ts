/**
 * Storage Configuration for StackMemory
 * Handles storage mode detection and ChromaDB configuration
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

export type StorageMode = 'sqlite' | 'hybrid';

export interface ChromaDBConfig {
  enabled: boolean;
  apiKey?: string;
  apiUrl?: string;
  tenant?: string;
  database?: string;
}

export interface StorageConfig {
  mode: StorageMode;
  chromadb: ChromaDBConfig;
}

const DEFAULT_STORAGE_CONFIG: StorageConfig = {
  mode: 'sqlite',
  chromadb: {
    enabled: false,
  },
};

const STACKMEMORY_DIR = join(homedir(), '.stackmemory');
const CONFIG_FILE = join(STACKMEMORY_DIR, 'storage-config.json');

/**
 * Load storage configuration from disk
 */
export function loadStorageConfig(): StorageConfig {
  try {
    if (existsSync(CONFIG_FILE)) {
      const content = readFileSync(CONFIG_FILE, 'utf-8');
      const config = JSON.parse(content) as Partial<StorageConfig>;
      return {
        mode: config.mode || DEFAULT_STORAGE_CONFIG.mode,
        chromadb: {
          ...DEFAULT_STORAGE_CONFIG.chromadb,
          ...config.chromadb,
        },
      };
    }
  } catch (error) {
    console.warn('Failed to load storage config, using defaults:', error);
  }
  return DEFAULT_STORAGE_CONFIG;
}

/**
 * Save storage configuration to disk
 */
export function saveStorageConfig(config: StorageConfig): void {
  try {
    if (!existsSync(STACKMEMORY_DIR)) {
      mkdirSync(STACKMEMORY_DIR, { recursive: true });
    }
    writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2), 'utf-8');
  } catch (error) {
    console.error('Failed to save storage config:', error);
    throw error;
  }
}

/**
 * Check if ChromaDB is enabled and properly configured
 */
export function isChromaDBEnabled(): boolean {
  const config = loadStorageConfig();

  if (!config.chromadb.enabled) {
    return false;
  }

  // ChromaDB requires an API key to be configured
  const apiKey = config.chromadb.apiKey || process.env['CHROMADB_API_KEY'];
  if (!apiKey) {
    return false;
  }

  return true;
}

/**
 * Get the current storage mode
 * Returns 'sqlite' for local-only storage
 * Returns 'hybrid' when ChromaDB is enabled (SQLite + ChromaDB)
 */
export function getStorageMode(): StorageMode {
  const config = loadStorageConfig();

  // Verify ChromaDB is actually usable before returning hybrid
  if (config.mode === 'hybrid' && !isChromaDBEnabled()) {
    return 'sqlite';
  }

  return config.mode;
}

/**
 * Get ChromaDB configuration (for use when initializing ChromaDB adapter)
 */
export function getChromaDBConfig(): ChromaDBConfig | null {
  if (!isChromaDBEnabled()) {
    return null;
  }

  const config = loadStorageConfig();
  const apiKey = config.chromadb.apiKey || process.env['CHROMADB_API_KEY'];
  const apiUrl =
    config.chromadb.apiUrl ||
    process.env['CHROMADB_API_URL'] ||
    'https://api.trychroma.com';

  return {
    enabled: true,
    apiKey,
    apiUrl,
    tenant:
      config.chromadb.tenant ||
      process.env['CHROMADB_TENANT'] ||
      'default_tenant',
    database:
      config.chromadb.database ||
      process.env['CHROMADB_DATABASE'] ||
      'default_database',
  };
}

/**
 * Enable ChromaDB with the given configuration
 */
export function enableChromaDB(chromaConfig: {
  apiKey: string;
  apiUrl?: string;
  tenant?: string;
  database?: string;
}): void {
  const config = loadStorageConfig();
  config.mode = 'hybrid';
  config.chromadb = {
    enabled: true,
    apiKey: chromaConfig.apiKey,
    apiUrl: chromaConfig.apiUrl || 'https://api.trychroma.com',
    tenant: chromaConfig.tenant || 'default_tenant',
    database: chromaConfig.database || 'default_database',
  };
  saveStorageConfig(config);
}

/**
 * Disable ChromaDB and use SQLite-only mode
 */
export function disableChromaDB(): void {
  const config = loadStorageConfig();
  config.mode = 'sqlite';
  config.chromadb = {
    enabled: false,
  };
  saveStorageConfig(config);
}

/**
 * Get a human-readable description of the current storage mode
 */
export function getStorageModeDescription(): string {
  const mode = getStorageMode();
  if (mode === 'hybrid') {
    return 'Hybrid (SQLite + ChromaDB for semantic search and cloud backup)';
  }
  return 'SQLite (local storage only, fast, no external dependencies)';
}
