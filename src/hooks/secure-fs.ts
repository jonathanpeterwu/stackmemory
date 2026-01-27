/**
 * Secure file system utilities for hooks
 * Ensures config files have restricted permissions (0600)
 */

import {
  writeFileSync,
  mkdirSync,
  chmodSync,
  existsSync,
  renameSync,
  unlinkSync,
} from 'fs';
import { dirname, join } from 'path';
import { randomBytes } from 'crypto';

/**
 * Write file with secure permissions (0600 - user read/write only)
 * Uses atomic write pattern: write to temp file, then rename
 * This prevents corruption if process crashes mid-write
 */
export function writeFileSecure(filePath: string, data: string): void {
  const dir = dirname(filePath);

  // Create directory with secure permissions if needed
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  // Generate temp file path in same directory (required for atomic rename)
  const tempPath = join(dir, `.tmp-${randomBytes(8).toString('hex')}`);

  try {
    // Write to temp file first
    writeFileSync(tempPath, data);

    // Set secure permissions on temp file
    chmodSync(tempPath, 0o600);

    // Atomic rename (same filesystem, so this is atomic on POSIX)
    renameSync(tempPath, filePath);
  } catch (error) {
    // Clean up temp file on failure
    try {
      if (existsSync(tempPath)) {
        unlinkSync(tempPath);
      }
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
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
