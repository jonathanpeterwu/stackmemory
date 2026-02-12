/**
 * Feedback Loops
 *
 * Trigger-based automated responses that close the loop between
 * detection and correction. Each loop has:
 *   trigger → detect → act → measure
 *
 * Loops are designed to be composable and independently toggleable.
 */

import { EventEmitter } from 'events';

// ─── Types ──────────────────────────────────────────────────────

export interface LoopEvent {
  loop: string;
  trigger: string;
  timestamp: number;
  data: Record<string, unknown>;
  action: string;
  outcome: 'success' | 'skipped' | 'error';
  durationMs?: number;
}

export interface LoopConfig {
  enabled: boolean;
  /** Minimum seconds between firings (debounce) */
  cooldownSec: number;
}

export interface FeedbackLoopsConfig {
  contextPressure: LoopConfig;
  editRecovery: LoopConfig;
  retrievalQuality: LoopConfig;
  traceErrorChain: LoopConfig;
  harnessRegression: LoopConfig;
  sessionDrift: LoopConfig;
}

export const DEFAULT_CONFIG: FeedbackLoopsConfig = {
  contextPressure: { enabled: true, cooldownSec: 60 },
  editRecovery: { enabled: true, cooldownSec: 0 },
  retrievalQuality: { enabled: true, cooldownSec: 300 },
  traceErrorChain: { enabled: true, cooldownSec: 30 },
  harnessRegression: { enabled: true, cooldownSec: 0 },
  sessionDrift: { enabled: true, cooldownSec: 120 },
};

// ─── Loop Definitions ───────────────────────────────────────────

/**
 * LOOP 1: Context Pressure → Auto-Digest
 *
 * Trigger:  session-monitor emits context:high (70%+)
 * Detect:   Token usage exceeds threshold
 * Act:      Auto-close old frames, generate digest, record to memory
 * Measure:  Token count after intervention, frames closed count
 *
 * Prevents context window saturation before it hits critical.
 */
export interface ContextPressureEvent {
  percentage: number;
  totalTokens: number;
  activeFrames: number;
  closedFrames: number;
  tokensRecovered: number;
}

/**
 * LOOP 2: Edit Failure → Fuzzy Recovery → Memory
 *
 * Trigger:  PostToolUse hook detects edit failure
 * Detect:   error_type = string_not_found | multiple_matches
 * Act:      Queue sm_edit fuzzy fallback, log confidence to telemetry
 * Measure:  Recovery rate, confidence distribution, repeat offender files
 *
 * Already partially built. This formalizes the detect→act→measure chain.
 */
export interface EditRecoveryEvent {
  filePath: string;
  errorType: string;
  recovered: boolean;
  confidence: number;
  method: string;
}

/**
 * LOOP 3: Retrieval Quality → Strategy Adaptation
 *
 * Trigger:  retrieval_log shows empty results or low top_score
 * Detect:   Empty result rate > 20% or avg top_score < 0.3
 * Act:      Switch search strategy (FTS5 → hybrid, broaden query)
 * Measure:  Empty result rate after switch, avg latency delta
 *
 * Adapts search strategy based on observed effectiveness.
 */
export interface RetrievalQualityEvent {
  emptyRate: number;
  avgTopScore: number;
  avgLatencyMs: number;
  currentStrategy: string;
  recommendedStrategy: string;
}

/**
 * LOOP 4: Trace Error Chain → Pattern Alert
 *
 * Trigger:  TraceDetector finalizes an ERROR_RECOVERY trace
 * Detect:   Same error pattern repeated 3+ times in a session
 * Act:      Surface as high-priority anchor, record to MEMORY.md
 * Measure:  Recurrence rate after intervention
 *
 * Catches agents stuck in error loops (edit fail → retry same thing).
 */
export interface TraceErrorChainEvent {
  traceType: string;
  errorPattern: string;
  occurrences: number;
  filesInvolved: string[];
  suggestedFix: string;
}

/**
 * LOOP 5: Harness Regression → Baseline Alert
 *
 * Trigger:  New harness-metrics.jsonl entry
 * Detect:   Approval rate drops below target OR latency P95 exceeds target
 * Act:      Log warning, flag in bench report, emit event for hooks
 * Measure:  Rolling 10-run approval rate vs baseline
 *
 * Catches degradation in the plan-code-review loop quality.
 */
export interface HarnessRegressionEvent {
  metric: string;
  current: number;
  target: number;
  direction: 'above' | 'below';
  rollingWindow: number;
}

/**
 * LOOP 6: Session Drift → Auto-Checkpoint
 *
 * Trigger:  Daemon heartbeat (60s interval)
 * Detect:   Active frame type diverges from initial task type,
 *           OR depth > 5 without closing frames
 * Act:      Auto-create checkpoint, suggest frame close
 * Measure:  Stack depth after intervention, frame close rate
 *
 * Prevents unbounded frame nesting and scope creep.
 */
export interface SessionDriftEvent {
  currentDepth: number;
  maxRecommendedDepth: number;
  oldestOpenFrameAge: number;
  driftScore: number;
}

// ─── Engine ─────────────────────────────────────────────────────

export class FeedbackLoopEngine extends EventEmitter {
  private config: FeedbackLoopsConfig;
  private lastFired: Map<string, number> = new Map();
  private history: LoopEvent[] = [];
  private maxHistory = 200;

  constructor(config: Partial<FeedbackLoopsConfig> = {}) {
    super();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Fire a loop if enabled and not in cooldown.
   * Returns the LoopEvent if fired, null if skipped.
   */
  fire(
    loopName: keyof FeedbackLoopsConfig,
    trigger: string,
    data: Record<string, unknown>,
    action: string,
    outcome: LoopEvent['outcome'] = 'success'
  ): LoopEvent | null {
    const cfg = this.config[loopName];
    if (!cfg?.enabled) return null;

    const now = Date.now();
    const lastTime = this.lastFired.get(loopName) || 0;
    if (now - lastTime < cfg.cooldownSec * 1000) return null;

    const event: LoopEvent = {
      loop: loopName,
      trigger,
      timestamp: now,
      data,
      action,
      outcome,
    };

    this.lastFired.set(loopName, now);
    this.history.push(event);
    if (this.history.length > this.maxHistory) {
      this.history = this.history.slice(-this.maxHistory);
    }

    this.emit('loop', event);
    this.emit(`loop:${loopName}`, event);
    return event;
  }

  /** Get recent loop events, optionally filtered by loop name. */
  getHistory(loopName?: string, limit = 50): LoopEvent[] {
    const filtered = loopName
      ? this.history.filter((e) => e.loop === loopName)
      : this.history;
    return filtered.slice(-limit);
  }

  /** Get summary stats per loop. */
  getStats(): Record<
    string,
    {
      fires: number;
      successes: number;
      errors: number;
      lastFired: number | null;
    }
  > {
    const stats: Record<
      string,
      {
        fires: number;
        successes: number;
        errors: number;
        lastFired: number | null;
      }
    > = {};

    for (const event of this.history) {
      if (!stats[event.loop]) {
        stats[event.loop] = {
          fires: 0,
          successes: 0,
          errors: 0,
          lastFired: null,
        };
      }
      stats[event.loop].fires++;
      if (event.outcome === 'success') stats[event.loop].successes++;
      if (event.outcome === 'error') stats[event.loop].errors++;
      stats[event.loop].lastFired = event.timestamp;
    }

    return stats;
  }

  /** Update config at runtime. */
  updateConfig(partial: Partial<FeedbackLoopsConfig>): void {
    this.config = { ...this.config, ...partial };
  }

  /** Get current config. */
  getConfig(): FeedbackLoopsConfig {
    return { ...this.config };
  }
}

/** Singleton for process-wide use. */
export const feedbackLoops = new FeedbackLoopEngine();
