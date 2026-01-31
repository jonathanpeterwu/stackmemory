/**
 * Tests for Metrics collector - Consolidated
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Metrics, metrics } from '../metrics.js';

describe('Metrics', () => {
  beforeEach(() => {
    Metrics.reset();
  });

  afterEach(() => {
    Metrics.reset();
  });

  describe('recording metrics', () => {
    it('should record, increment, and time metrics', async () => {
      await Metrics.record('test.metric', 10);
      await Metrics.record('test.metric', 20);
      await Metrics.record('test.metric', 30);

      const stats = Metrics.getStats('test.metric');
      expect(stats['test.metric'].sum).toBe(60);
      expect(stats['test.metric'].count).toBe(3);
      expect(stats['test.metric'].avg).toBe(20);
      expect(stats['test.metric'].min).toBe(10);
      expect(stats['test.metric'].max).toBe(30);
    });

    it('should increment counters', async () => {
      await Metrics.increment('test.counter');
      await Metrics.increment('test.counter');

      const stats = Metrics.getStats('test.counter');
      expect(stats['test.counter'].sum).toBe(2);
    });

    it('should record timing with tags', async () => {
      await Metrics.timing('api.latency', 50, { endpoint: '/test' });
      await Metrics.timing('api.latency', 100);

      const stats = Metrics.getStats('api.latency');
      expect(stats['api.latency'].avg).toBe(75);
    });
  });

  describe('getStats', () => {
    it('should return stats for specific or all metrics', async () => {
      await Metrics.record('metric1', 10);
      await Metrics.record('metric2', 20);

      expect(Metrics.getStats('nonexistent')).toEqual({});
      expect(Metrics.getStats()['metric1']).toBeDefined();
      expect(Metrics.getStats()['metric2']).toBeDefined();
    });
  });

  describe('events and reset', () => {
    it('should emit metric events', async () => {
      const handler = vi.fn();
      Metrics.on('metric', handler);

      await Metrics.record('event.test', 100);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          metric: 'event.test',
          value: 100,
        })
      );
    });

    it('should clear all metrics on reset', async () => {
      await Metrics.record('test.metric', 42);
      Metrics.reset();
      expect(Object.keys(Metrics.getStats()).length).toBe(0);
    });
  });

  it('should export same API via default export', () => {
    expect(metrics).toBe(Metrics);
  });
});
