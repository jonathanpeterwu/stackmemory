import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as childProcess from 'child_process';

vi.mock('child_process');

const mockedExecSync = vi.mocked(childProcess.execSync);

import {
  isTmuxAvailable,
  createTmuxSession,
  sendToPane,
  killTmuxSession,
  listPanes,
  sendCtrlC,
  sessionExists,
} from '../tmux-manager.js';

describe('tmux-manager', () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('isTmuxAvailable', () => {
    it('returns true when tmux is on PATH', () => {
      mockedExecSync.mockReturnValue(Buffer.from('/usr/bin/tmux'));
      expect(isTmuxAvailable()).toBe(true);
    });

    it('returns false when tmux is not found', () => {
      mockedExecSync.mockImplementation(() => {
        throw new Error('not found');
      });
      expect(isTmuxAvailable()).toBe(false);
    });
  });

  describe('createTmuxSession', () => {
    it('creates session and splits for multiple panes', () => {
      mockedExecSync.mockReturnValue(Buffer.from(''));

      createTmuxSession('test-sess', 3);

      // new-session
      expect(mockedExecSync).toHaveBeenCalledWith(
        'tmux new-session -d -s test-sess',
        { stdio: 'ignore' }
      );
      // 2 split-windows (panes 1 and 2)
      const splitCalls = mockedExecSync.mock.calls.filter((c) =>
        String(c[0]).includes('split-window')
      );
      expect(splitCalls).toHaveLength(2);
    });

    it('creates session with 1 pane (no splits)', () => {
      mockedExecSync.mockReturnValue(Buffer.from(''));

      createTmuxSession('solo', 1);

      const splitCalls = mockedExecSync.mock.calls.filter((c) =>
        String(c[0]).includes('split-window')
      );
      expect(splitCalls).toHaveLength(0);
    });
  });

  describe('sendToPane', () => {
    it('constructs correct send-keys command', () => {
      mockedExecSync.mockReturnValue(Buffer.from(''));

      sendToPane('sess', '0', 'echo hello');

      expect(mockedExecSync).toHaveBeenCalledWith(
        expect.stringContaining('tmux send-keys -t sess:0'),
        { stdio: 'ignore' }
      );
    });
  });

  describe('killTmuxSession', () => {
    it('runs kill-session command', () => {
      mockedExecSync.mockReturnValue(Buffer.from(''));

      killTmuxSession('sess');

      expect(mockedExecSync).toHaveBeenCalledWith('tmux kill-session -t sess', {
        stdio: 'ignore',
      });
    });
  });

  describe('listPanes', () => {
    it('returns pane indices', () => {
      mockedExecSync.mockReturnValue('0\n1\n2\n' as unknown as Buffer);

      const panes = listPanes('sess');

      expect(panes).toEqual(['0', '1', '2']);
    });

    it('returns empty array on error', () => {
      mockedExecSync.mockImplementation(() => {
        throw new Error('no session');
      });

      expect(listPanes('nope')).toEqual([]);
    });
  });

  describe('sendCtrlC', () => {
    it('sends C-c to specified pane', () => {
      mockedExecSync.mockReturnValue(Buffer.from(''));

      sendCtrlC('sess', '1');

      expect(mockedExecSync).toHaveBeenCalledWith(
        'tmux send-keys -t sess:1 C-c',
        { stdio: 'ignore' }
      );
    });
  });

  describe('sessionExists', () => {
    it('returns true when session exists', () => {
      mockedExecSync.mockReturnValue(Buffer.from(''));
      expect(sessionExists('sess')).toBe(true);
    });

    it('returns false when session does not exist', () => {
      mockedExecSync.mockImplementation(() => {
        throw new Error('no session');
      });
      expect(sessionExists('nope')).toBe(false);
    });
  });
});
