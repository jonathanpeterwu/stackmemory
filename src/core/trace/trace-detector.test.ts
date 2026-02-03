/**
 * Tests for Trace Detection and Bundling System
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { TraceDetector } from './trace-detector.js';
import { ToolCall, TraceType } from './types.js';
import { v4 as uuidv4 } from 'uuid';

describe('TraceDetector', () => {
  let detector: TraceDetector;

  beforeEach(() => {
    detector = new TraceDetector();
  });

  describe('Basic trace detection', () => {
    it('should bundle tools by time proximity and respect max size', () => {
      const baseTime = Date.now();

      // Bundle tools within time proximity
      detector.addToolCall({
        id: uuidv4(),
        tool: 'search',
        timestamp: baseTime,
      });
      detector.addToolCall({
        id: uuidv4(),
        tool: 'read',
        timestamp: baseTime + 1000,
      });
      detector.addToolCall({
        id: uuidv4(),
        tool: 'edit',
        timestamp: baseTime + 2000,
      });
      expect(detector.getTraces()).toHaveLength(0); // Not finalized
      detector.flush();
      expect(detector.getTraces()).toHaveLength(1);
      expect(detector.getTraces()[0].tools).toHaveLength(3);

      // New trace after time gap (40s > 30s threshold)
      const detector2 = new TraceDetector();
      detector2.addToolCall({
        id: uuidv4(),
        tool: 'search',
        timestamp: baseTime,
      });
      detector2.addToolCall({
        id: uuidv4(),
        tool: 'read',
        timestamp: baseTime + 40000,
      });
      detector2.flush();
      expect(detector2.getTraces()).toHaveLength(2);

      // Max trace size (51 tools splits into 50 + 1)
      const detector3 = new TraceDetector();
      for (let i = 0; i < 51; i++) {
        detector3.addToolCall({
          id: uuidv4(),
          tool: 'read',
          timestamp: baseTime + i * 100,
        });
      }
      detector3.flush();
      expect(detector3.getTraces()).toHaveLength(2);
      expect(detector3.getTraces()[0].tools).toHaveLength(50);
    });
  });

  describe('Trace type detection', () => {
    it.each([
      [['search', 'grep', 'read', 'edit'], TraceType.SEARCH_DRIVEN, false],
      [['write', 'edit', 'test'], TraceType.FEATURE_IMPLEMENTATION, false],
      [['grep', 'search', 'read'], TraceType.EXPLORATION, false],
    ])('should detect trace type for tools %s', (tools, expectedType) => {
      const baseTime = Date.now();
      tools.forEach((tool, i) =>
        detector.addToolCall({
          id: uuidv4(),
          tool,
          timestamp: baseTime + i * 1000,
        })
      );
      detector.flush();
      expect(detector.getTraces()[0].type).toBe(expectedType);
    });

    it('should detect error recovery traces', () => {
      const baseTime = Date.now();
      detector.addToolCall({
        id: uuidv4(),
        tool: 'bash',
        timestamp: baseTime,
        error: 'Command failed',
      });
      detector.addToolCall({
        id: uuidv4(),
        tool: 'edit',
        timestamp: baseTime + 1000,
      });
      detector.addToolCall({
        id: uuidv4(),
        tool: 'bash',
        timestamp: baseTime + 2000,
      });
      detector.flush();
      expect(detector.getTraces()[0].type).toBe(TraceType.ERROR_RECOVERY);
      expect(detector.getTraces()[0].metadata.causalChain).toBe(true);
    });
  });

  describe('Directory-based trace boundaries', () => {
    it('should handle directory boundaries', () => {
      const baseTime = Date.now();

      // Same directory stays together
      detector.addToolCall({
        id: uuidv4(),
        tool: 'read',
        timestamp: baseTime,
        filesAffected: ['/src/core/file1.ts'],
      });
      detector.addToolCall({
        id: uuidv4(),
        tool: 'edit',
        timestamp: baseTime + 1000,
        filesAffected: ['/src/core/file2.ts'],
      });
      detector.flush();
      expect(detector.getTraces()).toHaveLength(1);

      // Different directories split when configured
      const d2 = new TraceDetector({ sameDirThreshold: true });
      d2.addToolCall({
        id: uuidv4(),
        tool: 'read',
        timestamp: baseTime,
        filesAffected: ['/src/core/file1.ts'],
      });
      d2.addToolCall({
        id: uuidv4(),
        tool: 'edit',
        timestamp: baseTime + 1000,
        filesAffected: ['/src/utils/file2.ts'],
      });
      d2.flush();
      expect(d2.getTraces()).toHaveLength(2);
    });
  });

  describe('Trace scoring', () => {
    it('should score traces with MAX strategy and bonuses', () => {
      const baseTime = Date.now();

      // MAX scoring: search (0.95*0.4=0.38) > read (0.25*0.4=0.1)
      detector.addToolCall({ id: uuidv4(), tool: 'read', timestamp: baseTime });
      detector.addToolCall({
        id: uuidv4(),
        tool: 'search',
        timestamp: baseTime + 1000,
      });
      detector.flush();
      expect(detector.getTraces()[0].score).toBeGreaterThan(0.3);
      expect(detector.getTraces()[0].score).toBeLessThan(0.5);

      // Causal chain bonus
      const d1 = new TraceDetector();
      d1.addToolCall({ id: uuidv4(), tool: 'edit', timestamp: baseTime });
      d1.flush();
      const noError = d1.getTraces()[0].score;

      const d2 = new TraceDetector();
      d2.addToolCall({
        id: uuidv4(),
        tool: 'bash',
        timestamp: baseTime,
        error: 'Failed',
      });
      d2.addToolCall({
        id: uuidv4(),
        tool: 'edit',
        timestamp: baseTime + 1000,
      });
      d2.flush();
      expect(d2.getTraces()[0].score).toBeGreaterThan(noError);

      // Decision recording
      const d3 = new TraceDetector();
      d3.addToolCall({
        id: uuidv4(),
        tool: 'decision_recording',
        timestamp: baseTime,
        arguments: { decision: 'Use React hooks' },
      });
      d3.flush();
      expect(d3.getTraces()[0].metadata.decisionsRecorded).toContain(
        'Use React hooks'
      );
    });
  });

  describe('Trace compression', () => {
    it('should compress old traces but not recent ones', () => {
      const oldTime = Date.now() - 25 * 60 * 60 * 1000; // 25 hours ago

      // Old trace gets compressed
      detector.addToolCall({
        id: uuidv4(),
        tool: 'search',
        timestamp: oldTime,
      });
      detector.addToolCall({
        id: uuidv4(),
        tool: 'read',
        timestamp: oldTime + 1000,
      });
      detector.flush();
      expect(detector.getTraces()[0].compressed?.pattern).toBe('search→read');

      // Recent trace not compressed
      const d2 = new TraceDetector();
      d2.addToolCall({ id: uuidv4(), tool: 'search', timestamp: Date.now() });
      d2.flush();
      expect(d2.getTraces()[0].compressed).toBeUndefined();

      // Multiple traces: old compressed, recent not
      const d3 = new TraceDetector();
      d3.addToolCall({
        id: uuidv4(),
        tool: 'search',
        timestamp: Date.now() - 30 * 60 * 60 * 1000,
      });
      d3.flush();
      d3.addToolCall({ id: uuidv4(), tool: 'read', timestamp: Date.now() });
      d3.flush();
      expect(d3.getTraces()[0].compressed).toBeDefined();
      expect(d3.getTraces()[1].compressed).toBeUndefined();
    });
  });

  describe('Trace queries and filters', () => {
    beforeEach(() => {
      const baseTime = Date.now();
      ['search', 'read', 'edit'].forEach((tool, i) =>
        detector.addToolCall({
          id: uuidv4(),
          tool,
          timestamp: baseTime + i * 1000,
        })
      );
      detector.flush();
      detector.addToolCall({
        id: uuidv4(),
        tool: 'bash',
        timestamp: baseTime + 40000,
        error: 'Command failed',
      });
      detector.addToolCall({
        id: uuidv4(),
        tool: 'edit',
        timestamp: baseTime + 41000,
      });
      detector.addToolCall({
        id: uuidv4(),
        tool: 'bash',
        timestamp: baseTime + 42000,
      });
      detector.flush();
    });

    it('should filter, export, and get statistics', () => {
      expect(detector.getTracesByType(TraceType.SEARCH_DRIVEN)).toHaveLength(1);
      expect(detector.getTracesByType(TraceType.ERROR_RECOVERY)).toHaveLength(
        1
      );
      expect(detector.getHighImportanceTraces(0.25).length).toBeGreaterThan(0);
      expect(JSON.parse(detector.exportTraces())).toHaveLength(2);
      const stats = detector.getStatistics();
      expect(stats.totalTraces).toBe(2);
      expect(stats.averageScore).toBeGreaterThan(0);
    });
  });

  describe('Metadata extraction', () => {
    it('should extract files, errors, and calculate duration', () => {
      const baseTime = Date.now();

      // Files modified
      detector.addToolCall({
        id: uuidv4(),
        tool: 'edit',
        timestamp: baseTime,
        filesAffected: ['/src/file1.ts', '/src/file2.ts'],
      });
      detector.addToolCall({
        id: uuidv4(),
        tool: 'write',
        timestamp: baseTime + 1000,
        filesAffected: ['/src/file3.ts'],
      });
      detector.flush();
      expect(detector.getTraces()[0].metadata.filesModified).toHaveLength(3);

      // Errors encountered
      const d2 = new TraceDetector();
      d2.addToolCall({
        id: uuidv4(),
        tool: 'bash',
        timestamp: baseTime,
        error: 'Command not found',
      });
      d2.addToolCall({
        id: uuidv4(),
        tool: 'test',
        timestamp: baseTime + 1000,
        error: 'Test failed',
      });
      d2.flush();
      expect(d2.getTraces()[0].metadata.errorsEncountered).toContain(
        'Command not found'
      );
      expect(d2.getTraces()[0].metadata.errorsEncountered).toContain(
        'Test failed'
      );

      // Duration
      const d3 = new TraceDetector();
      d3.addToolCall({ id: uuidv4(), tool: 'search', timestamp: baseTime });
      d3.addToolCall({
        id: uuidv4(),
        tool: 'read',
        timestamp: baseTime + 5000,
      });
      d3.flush();
      expect(
        d3.getTraces()[0].metadata.endTime -
          d3.getTraces()[0].metadata.startTime
      ).toBe(5000);
    });
  });
});
