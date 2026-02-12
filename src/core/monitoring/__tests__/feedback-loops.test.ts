import { describe, it, expect, vi } from 'vitest';
import { FeedbackLoopEngine, DEFAULT_CONFIG } from '../feedback-loops.js';

describe('FeedbackLoopEngine', () => {
  it('fires enabled loops and respects cooldown', () => {
    const engine = new FeedbackLoopEngine();
    const listener = vi.fn();
    engine.on('loop', listener);

    // First fire succeeds
    const e1 = engine.fire(
      'editRecovery',
      'PostToolUse',
      { filePath: 'foo.ts', errorType: 'string_not_found' },
      'fuzzy_fallback'
    );
    expect(e1).not.toBeNull();
    expect(e1!.loop).toBe('editRecovery');
    expect(listener).toHaveBeenCalledTimes(1);

    // editRecovery has cooldown=0, so fires again immediately
    const e2 = engine.fire(
      'editRecovery',
      'PostToolUse',
      { filePath: 'bar.ts' },
      'fuzzy_fallback'
    );
    expect(e2).not.toBeNull();

    // contextPressure has cooldown=60s, second fire within cooldown skips
    const e3 = engine.fire(
      'contextPressure',
      'context:high',
      { percentage: 75 },
      'auto_digest'
    );
    expect(e3).not.toBeNull();
    const e4 = engine.fire(
      'contextPressure',
      'context:high',
      { percentage: 78 },
      'auto_digest'
    );
    expect(e4).toBeNull(); // cooldown
  });

  it('skips disabled loops', () => {
    const engine = new FeedbackLoopEngine({
      editRecovery: { enabled: false, cooldownSec: 0 },
    });

    const result = engine.fire(
      'editRecovery',
      'PostToolUse',
      {},
      'fuzzy_fallback'
    );
    expect(result).toBeNull();
  });

  it('tracks history and stats', () => {
    const engine = new FeedbackLoopEngine();

    engine.fire('editRecovery', 'test', {}, 'act1', 'success');
    engine.fire('editRecovery', 'test', {}, 'act2', 'error');
    engine.fire('traceErrorChain', 'test', {}, 'alert', 'success');

    const history = engine.getHistory();
    expect(history).toHaveLength(3);

    const editHistory = engine.getHistory('editRecovery');
    expect(editHistory).toHaveLength(2);

    const stats = engine.getStats();
    expect(stats['editRecovery'].fires).toBe(2);
    expect(stats['editRecovery'].successes).toBe(1);
    expect(stats['editRecovery'].errors).toBe(1);
    expect(stats['traceErrorChain'].fires).toBe(1);
  });

  it('emits per-loop events', () => {
    const engine = new FeedbackLoopEngine();
    const editListener = vi.fn();
    const traceListener = vi.fn();
    engine.on('loop:editRecovery', editListener);
    engine.on('loop:traceErrorChain', traceListener);

    engine.fire('editRecovery', 'test', {}, 'act');
    expect(editListener).toHaveBeenCalledTimes(1);
    expect(traceListener).not.toHaveBeenCalled();
  });

  it('default config has all 6 loops', () => {
    expect(Object.keys(DEFAULT_CONFIG)).toHaveLength(6);
    for (const cfg of Object.values(DEFAULT_CONFIG)) {
      expect(cfg).toHaveProperty('enabled');
      expect(cfg).toHaveProperty('cooldownSec');
    }
  });
});
