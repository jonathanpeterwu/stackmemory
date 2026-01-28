/**
 * Sweep State Watcher
 *
 * Watches sweep-state.json for new predictions via fs.watch.
 * Emits events when predictions arrive or loading begins.
 */

import { EventEmitter } from 'events';
import { watch, readFileSync, existsSync, type FSWatcher } from 'fs';
import { join } from 'path';

const HOME = process.env['HOME'] || '/tmp';
const DEFAULT_STATE_FILE = join(HOME, '.stackmemory', 'sweep-state.json');

export interface PredictionEvent {
  file_path: string;
  prediction: string;
  latency_ms: number;
  timestamp: number;
}

interface SweepState {
  recentDiffs: Array<{
    file_path: string;
    original: string;
    updated: string;
    timestamp: number;
  }>;
  lastPrediction: {
    file_path: string;
    prediction: string;
    latency_ms: number;
    timestamp: number;
  } | null;
  pendingPrediction: number | null;
  fileContents: Record<string, unknown>;
}

export class SweepStateWatcher extends EventEmitter {
  private stateFile: string;
  private lastPredictionTs = 0;
  private lastPendingTs = 0;
  private watcher: FSWatcher | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(stateFile?: string) {
    super();
    this.stateFile = stateFile || DEFAULT_STATE_FILE;
  }

  start(): void {
    if (this.watcher) return;

    if (!existsSync(this.stateFile)) {
      // Poll until file appears
      this.pollTimer = setInterval(() => {
        if (existsSync(this.stateFile)) {
          clearInterval(this.pollTimer!);
          this.pollTimer = null;
          this.startWatching();
        }
      }, 1000);
      return;
    }

    this.startWatching();
  }

  private startWatching(): void {
    // Read initial state
    this.readState();

    this.watcher = watch(this.stateFile, () => {
      // Debounce rapid writes
      if (this.debounceTimer) clearTimeout(this.debounceTimer);
      this.debounceTimer = setTimeout(() => this.readState(), 100);
    });

    this.watcher.on('error', () => {
      // File may have been deleted, try to re-watch
      this.watcher?.close();
      this.watcher = null;
      setTimeout(() => this.start(), 1000);
    });
  }

  private readState(): void {
    try {
      if (!existsSync(this.stateFile)) return;

      const raw = readFileSync(this.stateFile, 'utf-8');
      const state: SweepState = JSON.parse(raw);

      // Check for new pending prediction (loading state)
      if (
        state.pendingPrediction &&
        state.pendingPrediction !== this.lastPendingTs
      ) {
        this.lastPendingTs = state.pendingPrediction;
        this.emit('loading');
      }

      // Check for new completed prediction
      if (
        state.lastPrediction &&
        state.lastPrediction.timestamp > this.lastPredictionTs
      ) {
        this.lastPredictionTs = state.lastPrediction.timestamp;
        const event: PredictionEvent = {
          file_path: state.lastPrediction.file_path,
          prediction: state.lastPrediction.prediction,
          latency_ms: state.lastPrediction.latency_ms,
          timestamp: state.lastPrediction.timestamp,
        };
        this.emit('prediction', event);
      }
    } catch {
      // Ignore parse errors from partial writes
    }
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
  }
}
