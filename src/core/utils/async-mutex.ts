/**
 * Simple async mutex implementation for thread-safe operations
 * Prevents race conditions when multiple async operations compete for the same resource
 */

export class AsyncMutex {
  private locked = false;
  private waiting: Array<() => void> = [];
  private lockHolder: string | null = null;
  private lockAcquiredAt: number = 0;
  private readonly lockTimeout: number;

  constructor(lockTimeoutMs: number = 300000) {
    // Default 5 minute timeout
    this.lockTimeout = lockTimeoutMs;
  }

  /**
   * Acquire the lock. Waits if already locked.
   * Returns a release function that MUST be called when done.
   */
  async acquire(holder?: string): Promise<() => void> {
    // Check for stale lock (lock timeout)
    if (this.locked && this.lockAcquiredAt > 0) {
      const elapsed = Date.now() - this.lockAcquiredAt;
      if (elapsed > this.lockTimeout) {
        console.warn(
          `[AsyncMutex] Stale lock detected (held by ${this.lockHolder} for ${elapsed}ms), forcing release`
        );
        this.forceRelease();
      }
    }

    if (!this.locked) {
      this.locked = true;
      this.lockHolder = holder || 'unknown';
      this.lockAcquiredAt = Date.now();
      return () => this.release();
    }

    // Wait for lock to be released
    return new Promise((resolve) => {
      this.waiting.push(() => {
        this.locked = true;
        this.lockHolder = holder || 'unknown';
        this.lockAcquiredAt = Date.now();
        resolve(() => this.release());
      });
    });
  }

  /**
   * Try to acquire the lock without waiting
   * Returns release function if acquired, null if already locked
   */
  tryAcquire(holder?: string): (() => void) | null {
    // Check for stale lock
    if (this.locked && this.lockAcquiredAt > 0) {
      const elapsed = Date.now() - this.lockAcquiredAt;
      if (elapsed > this.lockTimeout) {
        console.warn(
          `[AsyncMutex] Stale lock detected (held by ${this.lockHolder} for ${elapsed}ms), forcing release`
        );
        this.forceRelease();
      }
    }

    if (!this.locked) {
      this.locked = true;
      this.lockHolder = holder || 'unknown';
      this.lockAcquiredAt = Date.now();
      return () => this.release();
    }
    return null;
  }

  private release(): void {
    const next = this.waiting.shift();
    if (next) {
      next();
    } else {
      this.locked = false;
      this.lockHolder = null;
      this.lockAcquiredAt = 0;
    }
  }

  private forceRelease(): void {
    this.locked = false;
    this.lockHolder = null;
    this.lockAcquiredAt = 0;
  }

  /**
   * Execute a function while holding the lock
   */
  async withLock<T>(fn: () => Promise<T>, holder?: string): Promise<T> {
    const release = await this.acquire(holder);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Check if currently locked
   */
  isLocked(): boolean {
    return this.locked;
  }

  /**
   * Get current lock status
   */
  getStatus(): {
    locked: boolean;
    holder: string | null;
    acquiredAt: number;
    waitingCount: number;
  } {
    return {
      locked: this.locked,
      holder: this.lockHolder,
      acquiredAt: this.lockAcquiredAt,
      waitingCount: this.waiting.length,
    };
  }
}

// Singleton instance for sync operations
export const syncMutex = new AsyncMutex(300000); // 5 minute timeout
