/**
 * Tests for ProgressTracker - Consolidated
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProgressTracker, Change } from '../progress-tracker.js';
import * as fs from 'fs';
import * as path from 'path';

vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

describe('ProgressTracker', () => {
  let tracker: ProgressTracker;
  const mockProjectRoot = '/tmp/test-project';

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(fs.existsSync).mockReturnValue(false);
    tracker = new ProgressTracker(mockProjectRoot);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initialization', () => {
    it('should load existing progress file if present', () => {
      const existingData = {
        version: '1.0.0',
        lastUpdated: '2024-01-01T00:00:00.000Z',
        recentChanges: [],
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingData));

      const newTracker = new ProgressTracker(mockProjectRoot);
      expect(newTracker.getProgress().version).toBe('1.0.0');
    });

    it('should create default progress if file is corrupted', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('invalid json');

      const newTracker = new ProgressTracker(mockProjectRoot);
      expect(newTracker.getProgress().recentChanges).toEqual([]);
    });
  });

  describe('session and task management', () => {
    it('should manage session lifecycle', () => {
      tracker.startSession();
      const progress = tracker.getProgress();
      expect(progress.currentSession).toBeDefined();
      expect(fs.writeFileSync).toHaveBeenCalled();

      tracker.endSession();
      expect(tracker.getProgress().currentSession).toBeUndefined();
    });

    it('should track task lifecycle', () => {
      tracker.startTask('Test task');
      expect(tracker.getProgress().currentSession?.inProgress).toContain(
        'Test task'
      );

      tracker.completeTask('Test task', ['file1.ts']);
      const session = tracker.getProgress().currentSession;
      expect(session?.inProgress).not.toContain('Test task');
      expect(session?.tasksCompleted[0]?.task).toBe('Test task');
      expect(session?.tasksCompleted[0]?.changes).toEqual(['file1.ts']);
    });
  });

  describe('changes and notes', () => {
    it('should track changes with limit', () => {
      for (let i = 0; i < 25; i++) {
        tracker.addChange({
          date: `2024-01-${String(i + 1).padStart(2, '0')}`,
          version: '1.0.0',
          type: 'feature',
          description: `Change ${i}`,
        });
      }
      const changes = tracker.getProgress().recentChanges;
      expect(changes.length).toBe(20);
      expect(changes[0].description).toBe('Change 24');
    });

    it('should track notes with limit', () => {
      for (let i = 0; i < 15; i++) {
        tracker.addNote(`Note ${i}`);
      }
      const notes = tracker.getProgress().notes;
      expect(notes?.length).toBe(10);
    });
  });

  describe('linear integration', () => {
    it('should update linear status', () => {
      tracker.updateLinearStatus({ lastSync: '2024-01-01T00:00:00Z' });
      tracker.updateLinearStatus({ tasksSynced: 10 });

      const linear = tracker.getProgress().linearIntegration;
      expect(linear?.status).toBe('active');
      expect(linear?.tasksSynced).toBe(10);
    });
  });

  describe('summary', () => {
    it('should generate progress summary', () => {
      tracker.startSession();
      tracker.startTask('Test task');
      tracker.addNote('Important note');
      tracker.updateLinearStatus({ lastSync: '2024-01-01T00:00:00Z' });

      const summary = tracker.getSummary();
      expect(summary).toContain('StackMemory Progress');
      expect(summary).toContain('Test task');
      expect(summary).toContain('Linear Integration');
    });
  });
});
