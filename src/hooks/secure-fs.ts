/**
 * Secure file system utilities for hooks
 * Ensures config files have restricted permissions (0600)
 */

import { writeFileSync, mkdirSync, chmodSync, existsSync } from 'fs';
import { dirname } from 'path';

/**
 * Write file with secure permissions (0600 - user read/write only)
 * Also ensures parent directory has 0700 permissions
 */
export function writeFileSecure(filePath: string, data: string): void {
  const dir = dirname(filePath);

  // Create directory with secure permissions if needed
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  // Write file
  writeFileSync(filePath, data);

  // Set secure permissions (user read/write only)
  chmodSync(filePath, 0o600);
}

/**
 * Ensure directory exists with secure permissions (0700)
 */
export function ensureSecureDir(dirPath: string): void {
  if (!existsSync(dirPath)) {
    mkdirSync(dirPath, { recursive: true, mode: 0o700 });
  } else {
    // Set permissions on existing directory
    try {
      chmodSync(dirPath, 0o700);
    } catch {
      // Ignore if we can't change permissions (not owner)
    }
  }
}
