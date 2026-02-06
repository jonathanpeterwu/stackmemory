/**
 * Chrome Storage Helpers
 * Manages auth tokens and extension config in chrome.storage
 */

import {
  type LinearAuth,
  type ExtensionConfig,
  type ExtensionError,
  type Result,
  DEFAULT_CONFIG,
  ok,
  err,
} from './types.js';

const STORAGE_KEYS = {
  AUTH: 'linear_auth',
  CONFIG: 'extension_config',
} as const;

/**
 * Get stored Linear auth
 */
export async function getAuth(): Promise<LinearAuth | null> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.AUTH);
    return result[STORAGE_KEYS.AUTH] || null;
  } catch {
    return null;
  }
}

/**
 * Store Linear auth
 */
export async function setAuth(
  auth: LinearAuth
): Promise<Result<void, ExtensionError>> {
  try {
    await chrome.storage.local.set({ [STORAGE_KEYS.AUTH]: auth });
    return ok(undefined);
  } catch (error) {
    return err({
      code: 'NETWORK_ERROR',
      message: error instanceof Error ? error.message : 'Failed to save auth',
    });
  }
}

/**
 * Clear stored auth (logout)
 */
export async function clearAuth(): Promise<void> {
  await chrome.storage.local.remove(STORAGE_KEYS.AUTH);
}

/**
 * Check if user is authenticated
 */
export async function isAuthenticated(): Promise<boolean> {
  const auth = await getAuth();
  if (!auth) return false;

  // Check if token is expired
  if (auth.expiresAt && auth.expiresAt < Date.now()) {
    return false;
  }

  return true;
}

/**
 * Get extension config
 */
export async function getConfig(): Promise<ExtensionConfig> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEYS.CONFIG);
    return { ...DEFAULT_CONFIG, ...result[STORAGE_KEYS.CONFIG] };
  } catch {
    return DEFAULT_CONFIG;
  }
}

/**
 * Update extension config
 */
export async function updateConfig(
  updates: Partial<ExtensionConfig>
): Promise<Result<void, ExtensionError>> {
  try {
    const current = await getConfig();
    const updated = { ...current, ...updates };
    await chrome.storage.local.set({ [STORAGE_KEYS.CONFIG]: updated });
    return ok(undefined);
  } catch (error) {
    return err({
      code: 'NETWORK_ERROR',
      message: error instanceof Error ? error.message : 'Failed to save config',
    });
  }
}

/**
 * Listen for auth changes
 */
export function onAuthChange(
  callback: (auth: LinearAuth | null) => void
): () => void {
  const listener = (
    changes: { [key: string]: chrome.storage.StorageChange },
    areaName: string
  ) => {
    if (areaName === 'local' && changes[STORAGE_KEYS.AUTH]) {
      callback(changes[STORAGE_KEYS.AUTH].newValue || null);
    }
  };

  chrome.storage.onChanged.addListener(listener);

  return () => {
    chrome.storage.onChanged.removeListener(listener);
  };
}
