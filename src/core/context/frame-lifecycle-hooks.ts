/**
 * Frame Lifecycle Hooks
 * Allows external modules to subscribe to frame events without coupling to FrameManager
 */

import { logger } from '../monitoring/logger.js';
import type { Frame, Event, Anchor } from './frame-manager.js';

/**
 * Data passed to frame close hooks
 */
export interface FrameCloseData {
  frame: Frame;
  events: Event[];
  anchors: Anchor[];
}

/**
 * Hook function type for frame close events
 */
export type FrameCloseHook = (data: FrameCloseData) => Promise<void>;

/**
 * Hook function type for frame create events
 */
export type FrameCreateHook = (frame: Frame) => Promise<void>;

/**
 * Registered hook with metadata
 */
interface RegisteredHook<T> {
  name: string;
  handler: T;
  priority: number;
}

/**
 * Frame Lifecycle Hooks Registry
 * Singleton that manages all frame lifecycle hooks
 */
class FrameLifecycleHooksRegistry {
  private closeHooks: RegisteredHook<FrameCloseHook>[] = [];
  private createHooks: RegisteredHook<FrameCreateHook>[] = [];

  /**
   * Register a hook to be called when a frame is closed
   * @param name - Unique name for the hook (for logging/debugging)
   * @param handler - Async function to call when frame closes
   * @param priority - Higher priority hooks run first (default: 0)
   */
  onFrameClosed(
    name: string,
    handler: FrameCloseHook,
    priority: number = 0
  ): () => void {
    const hook: RegisteredHook<FrameCloseHook> = { name, handler, priority };
    this.closeHooks.push(hook);
    this.closeHooks.sort((a, b) => b.priority - a.priority);

    logger.debug('Registered frame close hook', { name, priority });

    // Return unregister function
    return () => {
      this.closeHooks = this.closeHooks.filter((h) => h !== hook);
      logger.debug('Unregistered frame close hook', { name });
    };
  }

  /**
   * Register a hook to be called when a frame is created
   * @param name - Unique name for the hook (for logging/debugging)
   * @param handler - Async function to call when frame is created
   * @param priority - Higher priority hooks run first (default: 0)
   */
  onFrameCreated(
    name: string,
    handler: FrameCreateHook,
    priority: number = 0
  ): () => void {
    const hook: RegisteredHook<FrameCreateHook> = { name, handler, priority };
    this.createHooks.push(hook);
    this.createHooks.sort((a, b) => b.priority - a.priority);

    logger.debug('Registered frame create hook', { name, priority });

    // Return unregister function
    return () => {
      this.createHooks = this.createHooks.filter((h) => h !== hook);
      logger.debug('Unregistered frame create hook', { name });
    };
  }

  /**
   * Trigger all close hooks (called by FrameManager)
   * Hooks are fire-and-forget - errors don't affect frame closure
   */
  async triggerClose(data: FrameCloseData): Promise<void> {
    if (this.closeHooks.length === 0) return;

    const results = await Promise.allSettled(
      this.closeHooks.map(async (hook) => {
        try {
          await hook.handler(data);
        } catch (error) {
          logger.warn(`Frame close hook "${hook.name}" failed`, {
            error: error instanceof Error ? error.message : String(error),
            frameId: data.frame.frame_id,
            frameName: data.frame.name,
          });
        }
      })
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      logger.debug('Some frame close hooks failed', {
        total: this.closeHooks.length,
        failed,
        frameId: data.frame.frame_id,
      });
    }
  }

  /**
   * Trigger all create hooks (called by FrameManager)
   * Hooks are fire-and-forget - errors don't affect frame creation
   */
  async triggerCreate(frame: Frame): Promise<void> {
    if (this.createHooks.length === 0) return;

    const results = await Promise.allSettled(
      this.createHooks.map(async (hook) => {
        try {
          await hook.handler(frame);
        } catch (error) {
          logger.warn(`Frame create hook "${hook.name}" failed`, {
            error: error instanceof Error ? error.message : String(error),
            frameId: frame.frame_id,
            frameName: frame.name,
          });
        }
      })
    );

    const failed = results.filter((r) => r.status === 'rejected').length;
    if (failed > 0) {
      logger.debug('Some frame create hooks failed', {
        total: this.createHooks.length,
        failed,
        frameId: frame.frame_id,
      });
    }
  }

  /**
   * Get count of registered hooks (useful for testing)
   */
  getHookCounts(): { close: number; create: number } {
    return {
      close: this.closeHooks.length,
      create: this.createHooks.length,
    };
  }

  /**
   * Clear all hooks (useful for testing)
   */
  clearAll(): void {
    this.closeHooks = [];
    this.createHooks = [];
    logger.debug('Cleared all frame lifecycle hooks');
  }
}

/**
 * Singleton instance of the hooks registry
 */
export const frameLifecycleHooks = new FrameLifecycleHooksRegistry();
