/**
 * Tests for ProgressTracker
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { ProgressTracker, Change, TaskProgress } from '../progress-tracker.js';
import * as fs from 'fs';
import * as path from 'path';

// Mock fs operations
vi.mock('fs', () => ({
  existsSync: vi.fn(),
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
}));

describe('ProgressTracker', () => {
  let tracker: ProgressTracker;
  const mockProjectRoot = '/tmp/test-project';
  const mockProgressFile = path.join(
    mockProjectRoot,
    '.stackmemory',
    'progress.json'
  );

  beforeEach(() => {
    vi.clearAllMocks();
    // Default: no existing progress file
    vi.mocked(fs.existsSync).mockReturnValue(false);
    tracker = new ProgressTracker(mockProjectRoot);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('constructor', () => {
    it('should create tracker with correct progress file path', () => {
      expect(fs.existsSync).toHaveBeenCalledWith(mockProgressFile);
    });

    it('should load existing progress file if present', () => {
      const existingData = {
        version: '1.0.0',
        lastUpdated: '2024-01-01T00:00:00.000Z',
        recentChanges: [],
      };
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(JSON.stringify(existingData));

      const newTracker = new ProgressTracker(mockProjectRoot);
      const progress = newTracker.getProgress();

      expect(progress.version).toBe('1.0.0');
    });

    it('should create default progress if file is corrupted', () => {
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue('invalid json');

      const newTracker = new ProgressTracker(mockProjectRoot);
      const progress = newTracker.getProgress();

      expect(progress.recentChanges).toEqual([]);
    });
  });

  describe('startSession', () => {
    it('should initialize a new session', () => {
      tracker.startSession();

      const progress = tracker.getProgress();
      expect(progress.currentSession).toBeDefined();
      expect(progress.currentSession?.tasksCompleted).toEqual([]);
      expect(progress.currentSession?.inProgress).toEqual([]);
    });

    it('should save progress after starting session', () => {
      tracker.startSession();

      expect(fs.writeFileSync).toHaveBeenCalled();
    });
  });

  describe('startTask', () => {
    it('should add task to in progress list', () => {
      tracker.startTask('Implement feature X');

      const progress = tracker.getProgress();
      expect(progress.currentSession?.inProgress).toContain(
        'Implement feature X'
      );
    });

    it('should create session if not exists', () => {
      tracker.startTask('New task');

      const progress = tracker.getProgress();
      expect(progress.currentSession).toBeDefined();
    });

    it('should not add duplicate task', () => {
      tracker.startTask('Same task');
      tracker.startTask('Same task');

      const progress = tracker.getProgress();
      const count = progress.currentSession?.inProgress.filter(
        (t: string) => t === 'Same task'
      ).length;
      expect(count).toBe(1);
    });
  });

  describe('completeTask', () => {
    it('should move task from in progress to completed', () => {
      tracker.startTask('Task to complete');
      tracker.completeTask('Task to complete');

      const progress = tracker.getProgress();
      expect(progress.currentSession?.inProgress).not.toContain(
        'Task to complete'
      );
      expect(
        progress.currentSession?.tasksCompleted.find(
          (t: TaskProgress) => t.task === 'Task to complete'
        )
      ).toBeDefined();
    });

    it('should record completion timestamp', () => {
      tracker.completeTask('New completed task');

      const progress = tracker.getProgress();
      const completedTask = progress.currentSession?.tasksCompleted[0];
      expect(completedTask?.completedAt).toBeDefined();
      expect(completedTask?.status).toBe('completed');
    });

    it('should record changes with task completion', () => {
      tracker.completeTask('Task with changes', ['file1.ts', 'file2.ts']);

      const progress = tracker.getProgress();
      const completedTask = progress.currentSession?.tasksCompleted[0];
      expect(completedTask?.changes).toEqual(['file1.ts', 'file2.ts']);
    });
  });

  describe('addChange', () => {
    it('should add change to recent changes', () => {
      const change: Change = {
        date: '2024-01-15',
        version: '1.0.0',
        type: 'feature',
        description: 'Added new feature',
      };

      tracker.addChange(change);

      const progress = tracker.getProgress();
      expect(progress.recentChanges[0]).toEqual(change);
    });

    it('should keep only last 20 changes', () => {
      // Add 25 changes
      for (let i = 0; i < 25; i++) {
        tracker.addChange({
          date: `2024-01-${String(i + 1).padStart(2, '0')}`,
          version: '1.0.0',
          type: 'feature',
          description: `Change ${i}`,
        });
      }

      const progress = tracker.getProgress();
      expect(progress.recentChanges.length).toBe(20);
      // Most recent should be first
      expect(progress.recentChanges[0].description).toBe('Change 24');
    });
  });

  describe('updateLinearStatus', () => {
    it('should create linear integration if not exists', () => {
      tracker.updateLinearStatus({ lastSync: '2024-01-01T00:00:00Z' });

      const progress = tracker.getProgress();
      expect(progress.linearIntegration).toBeDefined();
      expect(progress.linearIntegration?.status).toBe('active');
    });

    it('should update existing linear status', () => {
      tracker.updateLinearStatus({ tasksSynced: 5 });
      tracker.updateLinearStatus({ tasksSynced: 10 });

      const progress = tracker.getProgress();
      expect(progress.linearIntegration?.tasksSynced).toBe(10);
    });
  });

  describe('addNote', () => {
    it('should add note to notes array', () => {
      tracker.addNote('Important observation');

      const progress = tracker.getProgress();
      expect(progress.notes).toContain('Important observation');
    });

    it('should keep only last 10 notes', () => {
      for (let i = 0; i < 15; i++) {
        tracker.addNote(`Note ${i}`);
      }

      const progress = tracker.getProgress();
      expect(progress.notes?.length).toBe(10);
      expect(progress.notes?.[0]).toBe('Note 14');
    });
  });

  describe('getSummary', () => {
    it('should generate summary string', () => {
      tracker.startSession();
      tracker.startTask('Test task');
      tracker.addChange({
        date: '2024-01-15',
        version: '1.0.0',
        type: 'feature',
        description: 'Test change',
      });

      const summary = tracker.getSummary();

      expect(summary).toContain('StackMemory Progress');
      expect(summary).toContain('Test task');
      expect(summary).toContain('Test change');
    });

    it('should include linear status if present', () => {
      tracker.updateLinearStatus({ lastSync: '2024-01-01T00:00:00Z' });

      const summary = tracker.getSummary();

      expect(summary).toContain('Linear Integration');
    });

    it('should include notes if present', () => {
      tracker.addNote('Important note');

      const summary = tracker.getSummary();

      expect(summary).toContain('Recent Notes');
      expect(summary).toContain('Important note');
    });
  });

  describe('endSession', () => {
    it('should clear current session', () => {
      tracker.startSession();
      tracker.startTask('Some task');
      tracker.endSession();

      const progress = tracker.getProgress();
      expect(progress.currentSession).toBeUndefined();
    });
  });

  describe('getProgress', () => {
    it('should return current progress data', () => {
      const progress = tracker.getProgress();

      expect(progress.version).toBeDefined();
      expect(progress.lastUpdated).toBeDefined();
      expect(progress.recentChanges).toBeDefined();
    });
  });
});
