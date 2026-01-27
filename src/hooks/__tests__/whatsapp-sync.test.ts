/**
 * Tests for WhatsApp sync functionality
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  unlinkSync,
  mkdirSync,
} from 'fs';
import { join } from 'path';
import { homedir } from 'os';

import {
  generateMobileDigest,
  loadSyncOptions,
  saveSyncOptions,
  createFrameDigestData,
  type SyncOptions,
  type FrameDigestData,
} from '../whatsapp-sync.js';

// Internal functions need to be tested via exports or indirect testing
// For this test we'll use the module's internal helpers indirectly through generateMobileDigest

const SYNC_CONFIG_PATH = join(homedir(), '.stackmemory', 'whatsapp-sync.json');
let originalConfig: string | null = null;

describe('WhatsApp Sync', () => {
  beforeEach(() => {
    // Save original config
    if (existsSync(SYNC_CONFIG_PATH)) {
      originalConfig = readFileSync(SYNC_CONFIG_PATH, 'utf8');
    }

    // Create directory if needed
    mkdirSync(join(homedir(), '.stackmemory'), { recursive: true });

    // Write clean test config
    writeFileSync(
      SYNC_CONFIG_PATH,
      JSON.stringify({
        autoSyncOnClose: false,
        minFrameDuration: 30,
        includeDecisions: true,
        includeFiles: true,
        includeTests: true,
        maxDigestLength: 400,
      })
    );
  });

  afterEach(() => {
    // Restore original config
    if (originalConfig) {
      writeFileSync(SYNC_CONFIG_PATH, originalConfig);
    } else if (existsSync(SYNC_CONFIG_PATH)) {
      unlinkSync(SYNC_CONFIG_PATH);
    }
    originalConfig = null;
  });

  describe('loadSyncOptions', () => {
    it('should return defaults when no file exists or invalid JSON', () => {
      // Remove config file
      if (existsSync(SYNC_CONFIG_PATH)) {
        unlinkSync(SYNC_CONFIG_PATH);
      }
      let options = loadSyncOptions();
      expect(options.autoSyncOnClose).toBe(false);
      expect(options.minFrameDuration).toBe(30);

      // Invalid JSON
      writeFileSync(SYNC_CONFIG_PATH, 'not valid json');
      options = loadSyncOptions();
      expect(options.autoSyncOnClose).toBe(false);
    });

    it('should load options from file and merge partial configs', () => {
      // Full config
      writeFileSync(
        SYNC_CONFIG_PATH,
        JSON.stringify({ autoSyncOnClose: true, minFrameDuration: 60 })
      );
      let options = loadSyncOptions();
      expect(options.autoSyncOnClose).toBe(true);
      expect(options.minFrameDuration).toBe(60);
      // Defaults preserved
      expect(options.includeDecisions).toBe(true);
    });
  });

  describe('saveSyncOptions', () => {
    it('should save options to config file and create directory if needed', () => {
      const options: SyncOptions = {
        autoSyncOnClose: true,
        minFrameDuration: 120,
        includeDecisions: false,
        includeFiles: true,
        includeTests: true,
        maxDigestLength: 350,
      };

      saveSyncOptions(options);

      expect(existsSync(SYNC_CONFIG_PATH)).toBe(true);
      const saved = JSON.parse(readFileSync(SYNC_CONFIG_PATH, 'utf8'));
      expect(saved.autoSyncOnClose).toBe(true);
      expect(saved.minFrameDuration).toBe(120);
    });
  });

  describe('generateMobileDigest', () => {
    const baseDigestData: FrameDigestData = {
      frameId: 'frame-123',
      name: 'Test Frame',
      type: 'task',
      status: 'success',
      durationSeconds: 120,
      filesModified: [],
      testsRun: [],
      decisions: [],
      risks: [],
      toolCallCount: 5,
      errors: [],
    };

    it('should generate digest with basic frame info', () => {
      const digest = generateMobileDigest(baseDigestData);

      expect(digest).toContain('FRAME: Test Frame');
      expect(digest).toContain('[task]');
      expect(digest).toContain('2m');
      expect(digest).toContain('OK');
    });

    it('should include files when option enabled', () => {
      const data: FrameDigestData = {
        ...baseDigestData,
        filesModified: [
          { path: '/src/index.ts', operation: 'modify' },
          { path: '/src/utils.ts', operation: 'create' },
        ],
      };

      const options: SyncOptions = {
        autoSyncOnClose: false,
        minFrameDuration: 30,
        includeDecisions: true,
        includeFiles: true,
        includeTests: true,
        maxDigestLength: 400,
      };

      const digest = generateMobileDigest(data, options);

      expect(digest).toContain('FILES: 2');
      expect(digest).toContain('M:index.ts');
      expect(digest).toContain('C:utils.ts');
    });

    it('should exclude files when option disabled', () => {
      const data: FrameDigestData = {
        ...baseDigestData,
        filesModified: [{ path: '/src/index.ts', operation: 'modify' }],
      };

      const options: SyncOptions = {
        autoSyncOnClose: false,
        minFrameDuration: 30,
        includeDecisions: true,
        includeFiles: false,
        includeTests: true,
        maxDigestLength: 400,
      };

      const digest = generateMobileDigest(data, options);

      expect(digest).not.toContain('FILES:');
    });

    it('should include tests when option enabled', () => {
      const data: FrameDigestData = {
        ...baseDigestData,
        testsRun: [
          { name: 'test1', status: 'passed' },
          { name: 'test2', status: 'passed' },
          { name: 'test3', status: 'failed' },
        ],
      };

      const options: SyncOptions = {
        autoSyncOnClose: false,
        minFrameDuration: 30,
        includeDecisions: true,
        includeFiles: true,
        includeTests: true,
        maxDigestLength: 400,
      };

      const digest = generateMobileDigest(data, options);

      expect(digest).toContain('TESTS: 2ok/1fail');
    });

    it('should show all passed tests without failures', () => {
      const data: FrameDigestData = {
        ...baseDigestData,
        testsRun: [
          { name: 'test1', status: 'passed' },
          { name: 'test2', status: 'passed' },
        ],
      };

      const options: SyncOptions = {
        autoSyncOnClose: false,
        minFrameDuration: 30,
        includeDecisions: true,
        includeFiles: true,
        includeTests: true,
        maxDigestLength: 400,
      };

      const digest = generateMobileDigest(data, options);

      expect(digest).toContain('TESTS: 2 pass');
    });

    it('should include decisions when option enabled', () => {
      const data: FrameDigestData = {
        ...baseDigestData,
        decisions: [
          'Use TypeScript for type safety',
          'Implement caching layer',
          'Add retry logic for API calls',
        ],
      };

      const options: SyncOptions = {
        autoSyncOnClose: false,
        minFrameDuration: 30,
        includeDecisions: true,
        includeFiles: true,
        includeTests: true,
        maxDigestLength: 600,
      };

      const digest = generateMobileDigest(data, options);

      expect(digest).toContain('DECISIONS:');
      expect(digest).toContain('Use TypeScript for type safety');
    });

    it('should exclude decisions when option disabled', () => {
      const data: FrameDigestData = {
        ...baseDigestData,
        decisions: ['Some decision'],
      };

      const options: SyncOptions = {
        autoSyncOnClose: false,
        minFrameDuration: 30,
        includeDecisions: false,
        includeFiles: true,
        includeTests: true,
        maxDigestLength: 400,
      };

      const digest = generateMobileDigest(data, options);

      expect(digest).not.toContain('DECISIONS:');
    });

    it('should include risks', () => {
      const data: FrameDigestData = {
        ...baseDigestData,
        risks: ['Security vulnerability in dependency', 'Performance impact'],
      };

      const digest = generateMobileDigest(data);

      expect(digest).toContain('RISKS:');
      expect(digest).toContain('Security vulnerability in dependency');
    });

    it('should include unresolved errors', () => {
      const data: FrameDigestData = {
        ...baseDigestData,
        status: 'failure',
        errors: [
          {
            type: 'TypeError',
            message: 'Cannot read property',
            resolved: false,
          },
          { type: 'RangeError', message: 'Out of bounds', resolved: true },
        ],
      };

      const digest = generateMobileDigest(data);

      expect(digest).toContain('ERRORS: 1 unresolved');
      expect(digest).toContain('Cannot read property');
      expect(digest).not.toContain('Out of bounds');
    });

    it('should include correct NEXT action for each status', () => {
      expect(
        generateMobileDigest({ ...baseDigestData, status: 'success' })
      ).toContain('NEXT: commit & test');
      expect(
        generateMobileDigest({ ...baseDigestData, status: 'failure' })
      ).toContain('NEXT: fix errors');
      expect(
        generateMobileDigest({ ...baseDigestData, status: 'partial' })
      ).toContain('NEXT: review & continue');
      expect(
        generateMobileDigest({ ...baseDigestData, status: 'ongoing' })
      ).toContain('NEXT: check status');
    });

    it('should respect maxDigestLength', () => {
      const data: FrameDigestData = {
        ...baseDigestData,
        decisions: Array(10).fill(
          'This is a very long decision text that should be truncated'
        ),
        risks: Array(5).fill('This is a risk that may cause issues'),
        filesModified: Array(10).fill({
          path: '/very/long/file/path.ts',
          operation: 'modify',
        }),
      };

      const options: SyncOptions = {
        autoSyncOnClose: false,
        minFrameDuration: 30,
        includeDecisions: true,
        includeFiles: true,
        includeTests: true,
        maxDigestLength: 400,
      };

      const digest = generateMobileDigest(data, options);

      expect(digest.length).toBeLessThanOrEqual(400);
    });

    it('should truncate long frame names', () => {
      const data: FrameDigestData = {
        ...baseDigestData,
        name: 'This is a very long frame name that should be truncated to fit mobile display',
      };

      const digest = generateMobileDigest(data);

      // Name is truncated to 30 chars, so "This is a very long frame n..." is shown
      expect(digest).toContain('This is a very long frame n...');
    });

    it('should show +N more for extra files', () => {
      const data: FrameDigestData = {
        ...baseDigestData,
        filesModified: [
          { path: '/src/file1.ts', operation: 'modify' },
          { path: '/src/file2.ts', operation: 'create' },
          { path: '/src/file3.ts', operation: 'delete' },
          { path: '/src/file4.ts', operation: 'modify' },
          { path: '/src/file5.ts', operation: 'modify' },
        ],
      };

      const digest = generateMobileDigest(data);

      expect(digest).toContain('+2');
    });

    it('should show +N more for extra decisions', () => {
      const data: FrameDigestData = {
        ...baseDigestData,
        decisions: [
          'Decision 1',
          'Decision 2',
          'Decision 3',
          'Decision 4',
          'Decision 5',
        ],
      };

      const options: SyncOptions = {
        autoSyncOnClose: false,
        minFrameDuration: 30,
        includeDecisions: true,
        includeFiles: true,
        includeTests: true,
        maxDigestLength: 800,
      };

      const digest = generateMobileDigest(data, options);

      expect(digest).toContain('+2 more');
    });
  });

  describe('formatDuration (via generateMobileDigest)', () => {
    const baseData: FrameDigestData = {
      frameId: 'frame-123',
      name: 'Test',
      type: 'task',
      status: 'success',
      durationSeconds: 0,
      filesModified: [],
      testsRun: [],
      decisions: [],
      risks: [],
      toolCallCount: 0,
      errors: [],
    };

    it('should format duration correctly at various scales', () => {
      // Seconds
      expect(
        generateMobileDigest({ ...baseData, durationSeconds: 45 })
      ).toContain('45s');
      // Minutes
      expect(
        generateMobileDigest({ ...baseData, durationSeconds: 120 })
      ).toContain('2m');
      // Minutes and seconds
      expect(
        generateMobileDigest({ ...baseData, durationSeconds: 90 })
      ).toContain('1m30s');
      // Hours
      expect(
        generateMobileDigest({ ...baseData, durationSeconds: 3600 })
      ).toContain('1h');
      // Hours and minutes
      expect(
        generateMobileDigest({ ...baseData, durationSeconds: 5400 })
      ).toContain('1h30m');
    });
  });

  describe('truncate (via generateMobileDigest)', () => {
    const baseData: FrameDigestData = {
      frameId: 'frame-123',
      name: 'Test',
      type: 'task',
      status: 'success',
      durationSeconds: 60,
      filesModified: [],
      testsRun: [],
      decisions: [],
      risks: [],
      toolCallCount: 0,
      errors: [],
    };

    it('should truncate long text with ellipsis but not short text', () => {
      // Short text - no truncation
      const shortDigest = generateMobileDigest({ ...baseData, name: 'Short' });
      expect(shortDigest).toContain('FRAME: Short');
      expect(shortDigest).not.toMatch(/Short\.\.\./);

      // Long text - truncated
      const longDigest = generateMobileDigest({
        ...baseData,
        name: 'This is a very long frame name that exceeds the limit',
      });
      expect(longDigest).toContain('...');
    });
  });

  describe('getStatusSymbol (via generateMobileDigest)', () => {
    const baseData: FrameDigestData = {
      frameId: 'frame-123',
      name: 'Test',
      type: 'task',
      status: 'success',
      durationSeconds: 60,
      filesModified: [],
      testsRun: [],
      decisions: [],
      risks: [],
      toolCallCount: 0,
      errors: [],
    };

    it('should show correct status symbol for each status', () => {
      expect(
        generateMobileDigest({ ...baseData, status: 'success' })
      ).toContain('OK');
      expect(
        generateMobileDigest({ ...baseData, status: 'failure' })
      ).toContain('FAIL');
      expect(
        generateMobileDigest({ ...baseData, status: 'partial' })
      ).toContain('PARTIAL');
      expect(
        generateMobileDigest({ ...baseData, status: 'ongoing' })
      ).toContain('ACTIVE');
    });
  });

  describe('createFrameDigestData', () => {
    it('should create digest data from frame, events, and anchors', () => {
      const now = Math.floor(Date.now() / 1000);
      const frame = {
        frame_id: 'frame-456',
        name: 'Build Feature',
        type: 'feature',
        created_at: now - 300,
        closed_at: now,
      };
      const events: Array<{
        event_type: string;
        payload: Record<string, unknown>;
      }> = [];
      const anchors: Array<{ type: string; text: string }> = [];

      const data = createFrameDigestData(frame, events, anchors);

      expect(data.frameId).toBe('frame-456');
      expect(data.name).toBe('Build Feature');
      expect(data.type).toBe('feature');
      expect(data.durationSeconds).toBe(300);
      expect(data.status).toBe('partial'); // No files modified
    });

    it('should extract files from tool_call events', () => {
      const now = Math.floor(Date.now() / 1000);
      const frame = {
        frame_id: 'frame-789',
        name: 'Edit Files',
        type: 'task',
        created_at: now - 60,
        closed_at: now,
      };
      const events = [
        {
          event_type: 'tool_call',
          payload: { tool_name: 'Write', path: '/src/index.ts' },
        },
        {
          event_type: 'tool_call',
          payload: { tool_name: 'Read', path: '/src/config.ts' },
        },
        {
          event_type: 'tool_call',
          payload: { tool_name: 'Delete', path: '/src/old.ts' },
        },
      ];
      const anchors: Array<{ type: string; text: string }> = [];

      const data = createFrameDigestData(frame, events, anchors);

      // Read operations are filtered out from filesModified
      expect(data.filesModified).toHaveLength(2);
      expect(data.filesModified[0]).toEqual({
        path: '/src/index.ts',
        operation: 'create',
      });
      expect(data.filesModified[1]).toEqual({
        path: '/src/old.ts',
        operation: 'delete',
      });
      expect(data.toolCallCount).toBe(3);
    });

    it('should extract decisions and risks from anchors', () => {
      const now = Math.floor(Date.now() / 1000);
      const frame = {
        frame_id: 'frame-abc',
        name: 'Architecture Review',
        type: 'review',
        created_at: now - 600,
        closed_at: now,
      };
      const events: Array<{
        event_type: string;
        payload: Record<string, unknown>;
      }> = [];
      const anchors = [
        { type: 'DECISION', text: 'Use React for frontend' },
        { type: 'DECISION', text: 'Implement API caching' },
        { type: 'RISK', text: 'Breaking change in API' },
        { type: 'NOTE', text: 'Regular note' },
      ];

      const data = createFrameDigestData(frame, events, anchors);

      expect(data.decisions).toHaveLength(2);
      expect(data.decisions).toContain('Use React for frontend');
      expect(data.decisions).toContain('Implement API caching');
      expect(data.risks).toHaveLength(1);
      expect(data.risks).toContain('Breaking change in API');
    });

    it('should extract errors from events', () => {
      const now = Math.floor(Date.now() / 1000);
      const frame = {
        frame_id: 'frame-err',
        name: 'Failed Task',
        type: 'task',
        created_at: now - 120,
        closed_at: now,
      };
      const events = [
        {
          event_type: 'error',
          payload: { error: 'Connection timeout', type: 'NetworkError' },
        },
        {
          event_type: 'result',
          payload: { status: 'error', message: 'Invalid input' },
        },
      ];
      const anchors: Array<{ type: string; text: string }> = [];

      const data = createFrameDigestData(frame, events, anchors);

      expect(data.errors).toHaveLength(2);
      expect(data.errors[0].message).toBe('Connection timeout');
      expect(data.errors[0].type).toBe('NetworkError');
      expect(data.errors[1].message).toBe('Invalid input');
      expect(data.status).toBe('failure'); // Has unresolved errors
    });

    it('should set status to ongoing for unclosed frames', () => {
      const now = Math.floor(Date.now() / 1000);
      const frame = {
        frame_id: 'frame-ongoing',
        name: 'Active Task',
        type: 'task',
        created_at: now - 60,
        // No closed_at
      };
      const events: Array<{
        event_type: string;
        payload: Record<string, unknown>;
      }> = [];
      const anchors: Array<{ type: string; text: string }> = [];

      const data = createFrameDigestData(frame, events, anchors);

      expect(data.status).toBe('ongoing');
    });

    it('should set status to success for closed frame with files and no errors', () => {
      const now = Math.floor(Date.now() / 1000);
      const frame = {
        frame_id: 'frame-success',
        name: 'Successful Task',
        type: 'task',
        created_at: now - 60,
        closed_at: now,
      };
      const events = [
        {
          event_type: 'tool_call',
          payload: { tool_name: 'Write', path: '/src/file.ts' },
        },
      ];
      const anchors: Array<{ type: string; text: string }> = [];

      const data = createFrameDigestData(frame, events, anchors);

      expect(data.status).toBe('success');
    });

    it('should set status to partial when tests fail', () => {
      const now = Math.floor(Date.now() / 1000);
      const frame = {
        frame_id: 'frame-partial',
        name: 'Test Task',
        type: 'task',
        created_at: now - 60,
        closed_at: now,
      };
      // The regex looks for "N pass" and "N fail" patterns, output must contain "test"
      const events = [
        {
          event_type: 'tool_call',
          payload: { tool_name: 'Write', path: '/src/file.ts' },
        },
        {
          event_type: 'tool_result',
          payload: { output: 'test results: 5 pass, 2 fail' },
        },
      ];
      const anchors: Array<{ type: string; text: string }> = [];

      const data = createFrameDigestData(frame, events, anchors);

      expect(data.status).toBe('partial');
      expect(data.testsRun.some((t) => t.status === 'failed')).toBe(true);
    });

    it('should deduplicate files by path', () => {
      const now = Math.floor(Date.now() / 1000);
      const frame = {
        frame_id: 'frame-dedup',
        name: 'Edit Task',
        type: 'task',
        created_at: now - 60,
        closed_at: now,
      };
      const events = [
        {
          event_type: 'tool_call',
          payload: { tool_name: 'Write', path: '/src/file.ts' },
        },
        {
          event_type: 'tool_call',
          payload: { tool_name: 'Write', path: '/src/file.ts' },
        },
        {
          event_type: 'tool_call',
          payload: { tool_name: 'Write', path: '/src/file.ts' },
        },
      ];
      const anchors: Array<{ type: string; text: string }> = [];

      const data = createFrameDigestData(frame, events, anchors);

      expect(data.filesModified).toHaveLength(1);
      expect(data.toolCallCount).toBe(3);
    });

    it('should extract test results from tool_result events', () => {
      const now = Math.floor(Date.now() / 1000);
      const frame = {
        frame_id: 'frame-tests',
        name: 'Test Run',
        type: 'task',
        created_at: now - 60,
        closed_at: now,
      };
      // Output must contain "test" and have "N pass" pattern
      const events = [
        {
          event_type: 'tool_call',
          payload: { tool_name: 'Write', path: '/src/file.ts' },
        },
        {
          event_type: 'tool_result',
          payload: { output: 'test results: 10 pass' },
        },
      ];
      const anchors: Array<{ type: string; text: string }> = [];

      const data = createFrameDigestData(frame, events, anchors);

      expect(data.testsRun.length).toBeGreaterThan(0);
      expect(data.testsRun[0].status).toBe('passed');
    });
  });
});
