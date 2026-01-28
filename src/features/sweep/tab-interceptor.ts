/**
 * Tab Interceptor
 *
 * Intercepts Tab and Esc keystrokes when a Sweep prediction is active.
 * All other input passes through to the PTY child unchanged.
 */

const TAB = 0x09;
const ESC = 0x1b;

export interface TabInterceptorCallbacks {
  onAccept: () => void;
  onDismiss: () => void;
  onPassthrough: (data: Buffer) => void;
}

export class TabInterceptor {
  private predictionActive = false;
  private callbacks: TabInterceptorCallbacks;

  constructor(callbacks: TabInterceptorCallbacks) {
    this.callbacks = callbacks;
  }

  setPredictionActive(active: boolean): void {
    this.predictionActive = active;
  }

  isPredictionActive(): boolean {
    return this.predictionActive;
  }

  process(data: Buffer): void {
    if (!this.predictionActive) {
      this.callbacks.onPassthrough(data);
      return;
    }

    // Tab key: accept prediction
    if (data.length === 1 && data[0] === TAB) {
      this.callbacks.onAccept();
      return;
    }

    // Bare Escape: dismiss prediction
    // Distinguish from escape sequences (arrow keys, etc.) by length.
    // Bare Esc is a single byte; escape sequences are multi-byte.
    if (data.length === 1 && data[0] === ESC) {
      this.callbacks.onDismiss();
      return;
    }

    // Everything else passes through (including escape sequences)
    this.callbacks.onPassthrough(data);
  }
}
