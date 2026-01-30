/**
 * Tests for Metrics collector
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

  describe('record', () => {
    it('should record a metric value', async () => {
      await Metrics.record('test.metric', 42);

      const stats = Metrics.getStats('test.metric');
      expect(stats['test.metric']).toBeDefined();
      expect(stats['test.metric'].sum).toBe(42);
      expect(stats['test.metric'].count).toBe(1);
    });

    it('should record multiple metric values', async () => {
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

    it('should record metric with tags', async () => {
      await Metrics.record('tagged.metric', 100, { env: 'test' });

      const stats = Metrics.getStats('tagged.metric');
      expect(stats['tagged.metric']).toBeDefined();
    });
  });

  describe('increment', () => {
    it('should increment a counter', async () => {
      await Metrics.increment('test.counter');
      await Metrics.increment('test.counter');
      await Metrics.increment('test.counter');

      const stats = Metrics.getStats('test.counter');
      expect(stats['test.counter'].sum).toBe(3);
      expect(stats['test.counter'].count).toBe(3);
    });

    it('should increment with custom value', async () => {
      // Note: increment doesn't take a custom value parameter in the current API
      // Each call increments by 1
      await Metrics.increment('test.counter');

      const stats = Metrics.getStats('test.counter');
      expect(stats['test.counter'].sum).toBe(1);
    });

    it('should increment with tags', async () => {
      await Metrics.increment('tagged.counter', { operation: 'insert' });

      const stats = Metrics.getStats('tagged.counter');
      expect(stats['tagged.counter']).toBeDefined();
    });
  });

  describe('timing', () => {
    it('should record timing metric', async () => {
      await Metrics.timing('operation.duration', 150);
      await Metrics.timing('operation.duration', 200);

      const stats = Metrics.getStats('operation.duration');
      expect(stats['operation.duration'].sum).toBe(350);
      expect(stats['operation.duration'].avg).toBe(175);
      expect(stats['operation.duration'].min).toBe(150);
      expect(stats['operation.duration'].max).toBe(200);
    });

    it('should record timing with tags', async () => {
      await Metrics.timing('api.latency', 50, { endpoint: '/test' });

      const stats = Metrics.getStats('api.latency');
      expect(stats['api.latency']).toBeDefined();
    });
  });

  describe('getStats', () => {
    it('should return empty object for non-existent metric', () => {
      const stats = Metrics.getStats('nonexistent');
      expect(stats).toEqual({});
    });

    it('should return all stats when no metric specified', async () => {
      await Metrics.record('metric1', 10);
      await Metrics.record('metric2', 20);

      const stats = Metrics.getStats();
      expect(stats['metric1']).toBeDefined();
      expect(stats['metric2']).toBeDefined();
    });

    it('should calculate average correctly', async () => {
      await Metrics.record('avg.test', 10);
      await Metrics.record('avg.test', 30);

      const stats = Metrics.getStats('avg.test');
      expect(stats['avg.test'].avg).toBe(20);
    });
  });

  describe('reset', () => {
    it('should clear all metrics', async () => {
      await Metrics.record('test.metric', 42);
      await Metrics.increment('test.counter');

      Metrics.reset();

      const stats = Metrics.getStats();
      expect(Object.keys(stats).length).toBe(0);
    });
  });

  describe('event emitter', () => {
    it('should emit metric events', async () => {
      const handler = vi.fn();
      Metrics.on('metric', handler);

      await Metrics.record('event.test', 100);

      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({
          metric: 'event.test',
          value: 100,
          type: 'gauge',
        })
      );
    });
  });

  describe('metrics export', () => {
    it('should export same API via default export', () => {
      expect(metrics).toBe(Metrics);
    });
  });
});
