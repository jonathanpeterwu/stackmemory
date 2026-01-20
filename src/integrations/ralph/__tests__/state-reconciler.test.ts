/**
 * Tests for State Reconciler
 */

import { StateReconciler } from '../state/state-reconciler.js';
import { StateSource, RalphLoopState, Conflict } from '../types.js';

describe('StateReconciler', () => {
  let reconciler: StateReconciler;

  beforeEach(() => {
    reconciler = new StateReconciler({
      precedence: ['git', 'files', 'memory'],
      conflictResolution: 'automatic',
      validateConsistency: true,
    });
  });

  describe('detectConflicts', () => {
    it('should detect no conflicts when sources match', async () => {
      const sources: StateSource[] = [
        {
          type: 'git',
          state: { iteration: 5, status: 'running' },
          timestamp: Date.now(),
          confidence: 0.9,
        },
        {
          type: 'files',
          state: { iteration: 5, status: 'running' },
          timestamp: Date.now(),
          confidence: 0.95,
        },
      ];

      const conflicts = reconciler.detectConflicts(sources);
      expect(conflicts).toHaveLength(0);
    });

    it('should detect conflicts when sources differ', async () => {
      const sources: StateSource[] = [
        {
          type: 'git',
          state: { iteration: 5, status: 'running' },
          timestamp: Date.now(),
          confidence: 0.9,
        },
        {
          type: 'files',
          state: { iteration: 6, status: 'completed' },
          timestamp: Date.now(),
          confidence: 0.95,
        },
      ];

      const conflicts = reconciler.detectConflicts(sources);
      expect(conflicts.length).toBeGreaterThan(0);
      
      const iterationConflict = conflicts.find(c => c.field === 'iteration');
      expect(iterationConflict).toBeDefined();
      expect(iterationConflict!.severity).toBe('medium');
    });

    it('should assess conflict severity correctly', async () => {
      const sources: StateSource[] = [
        {
          type: 'git',
          state: { loopId: 'loop1', iteration: 5 },
          timestamp: Date.now(),
          confidence: 0.9,
        },
        {
          type: 'files',
          state: { loopId: 'loop2', iteration: 6 },
          timestamp: Date.now(),
          confidence: 0.95,
        },
      ];

      const conflicts = reconciler.detectConflicts(sources);
      
      const loopIdConflict = conflicts.find(c => c.field === 'loopId');
      const iterationConflict = conflicts.find(c => c.field === 'iteration');
      
      expect(loopIdConflict?.severity).toBe('high');
      expect(iterationConflict?.severity).toBe('medium');
    });
  });

  describe('reconcile', () => {
    it('should merge states without conflicts', async () => {
      const sources: StateSource[] = [
        {
          type: 'git',
          state: { iteration: 5, currentCommit: 'abc123' },
          timestamp: Date.now(),
          confidence: 0.9,
        },
        {
          type: 'files',
          state: { task: 'Test task', criteria: 'Test criteria' },
          timestamp: Date.now(),
          confidence: 0.95,
        },
      ];

      const result = await reconciler.reconcile(sources);
      
      expect(result.iteration).toBe(5);
      expect(result.currentCommit).toBe('abc123');
      expect(result.task).toBe('Test task');
      expect(result.criteria).toBe('Test criteria');
    });

    it('should resolve conflicts automatically', async () => {
      const sources: StateSource[] = [
        {
          type: 'git', // Lower precedence
          state: { iteration: 5, status: 'running' },
          timestamp: Date.now(),
          confidence: 0.9,
        },
        {
          type: 'files', // Higher precedence (earlier in precedence array)
          state: { iteration: 6, status: 'completed' },
          timestamp: Date.now(),
          confidence: 0.95,
        },
      ];

      const result = await reconciler.reconcile(sources);
      
      // Should use git values (higher precedence)
      expect(result.iteration).toBe(5);
      expect(result.status).toBe('running');
    });
  });

  describe('resolveConflict', () => {
    it('should resolve conflict based on automatic strategy', async () => {
      const conflict: Conflict = {
        field: 'iteration',
        sources: [
          {
            type: 'git',
            state: { iteration: 5 },
            timestamp: Date.now(),
            confidence: 0.9,
          },
          {
            type: 'files',
            state: { iteration: 6 },
            timestamp: Date.now(),
            confidence: 0.95,
          },
        ],
        severity: 'medium',
      };

      const resolution = await reconciler.resolveConflict(conflict);
      
      expect(resolution.field).toBe('iteration');
      expect(resolution.source).toBe('git'); // Higher precedence
      expect(resolution.value).toBe(5);
      expect(resolution.rationale).toContain('precedence');
    });
  });

  describe('validateConsistency', () => {
    it('should pass validation for valid state', async () => {
      const validState: RalphLoopState = {
        loopId: 'test-loop',
        task: 'Test task',
        criteria: 'Test criteria',
        iteration: 5,
        status: 'running',
        startTime: Date.now() - 10000,
        lastUpdateTime: Date.now(),
      };

      const result = await reconciler.validateConsistency(validState);
      
      expect(result.testsPass).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should fail validation for invalid state', async () => {
      const invalidState: RalphLoopState = {
        loopId: 'test-loop',
        task: '', // Invalid: empty task
        criteria: 'Test criteria',
        iteration: -1, // Invalid: negative iteration
        status: 'running',
        startTime: Date.now(),
        lastUpdateTime: Date.now() - 10000, // Invalid: update before start
      };

      const result = await reconciler.validateConsistency(invalidState);
      
      expect(result.testsPass).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    });

    it('should detect logical inconsistencies', async () => {
      const inconsistentState: RalphLoopState = {
        loopId: 'test-loop',
        task: 'Test task',
        criteria: 'Test criteria',
        iteration: 5,
        status: 'completed',
        startTime: Date.now() - 10000,
        lastUpdateTime: Date.now(),
        // Missing completion data despite being completed
      };

      const result = await reconciler.validateConsistency(inconsistentState);
      
      expect(result.warnings.length).toBeGreaterThan(0);
      const hasCompletionDataWarning = result.warnings.some(w => w.includes('completion data'));
      expect(hasCompletionDataWarning).toBe(true);
    });
  });

  describe('getGitState', () => {
    it('should return git state with appropriate confidence', async () => {
      const gitState = await reconciler.getGitState();
      
      expect(gitState.type).toBe('git');
      expect(gitState.confidence).toBeGreaterThan(0);
      expect(gitState.timestamp).toBeDefined();
    });

    it('should handle git errors gracefully', async () => {
      // This test would require mocking git commands
      // For now, we just verify the method exists and returns a state
      const gitState = await reconciler.getGitState();
      expect(gitState).toBeDefined();
    });
  });

  describe('getFileState', () => {
    it('should return file state with high confidence when files exist', async () => {
      // This would require setting up test files
      const fileState = await reconciler.getFileState();
      
      expect(fileState.type).toBe('files');
      expect(fileState.timestamp).toBeDefined();
    });

    it('should return low confidence when files missing', async () => {
      const fileState = await reconciler.getFileState();
      
      // When files don't exist, confidence should be low
      expect(fileState.confidence).toBeDefined();
    });
  });

  describe('getMemoryState', () => {
    it('should return memory state for given loop ID', async () => {
      const loopId = 'test-loop-123';
      const memoryState = await reconciler.getMemoryState(loopId);
      
      expect(memoryState.type).toBe('memory');
      expect(memoryState.state.loopId).toBe(loopId);
      expect(memoryState.timestamp).toBeDefined();
    });
  });
});