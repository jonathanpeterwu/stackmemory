import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';

vi.mock('fs');
vi.mock('os');

const mockedFs = vi.mocked(fs);
const mockedOs = vi.mocked(os);

// Must import after mocking
import {
  ensureWorkerStateDir,
  saveRegistry,
  loadRegistry,
  clearRegistry,
  getWorkersDir,
  type WorkerSession,
} from '../worker-registry.js';

describe('worker-registry', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mockedOs.homedir.mockReturnValue('/home/test');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('ensureWorkerStateDir', () => {
    it('creates directory when it does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      const dir = ensureWorkerStateDir('w0-abc123');

      expect(dir).toContain('w0-abc123');
      expect(mockedFs.mkdirSync).toHaveBeenCalledWith(dir, { recursive: true });
    });

    it('returns existing directory without creating', () => {
      mockedFs.existsSync.mockReturnValue(true);

      const dir = ensureWorkerStateDir('w1-def456');

      expect(dir).toContain('w1-def456');
      expect(mockedFs.mkdirSync).not.toHaveBeenCalled();
    });
  });

  describe('saveRegistry / loadRegistry', () => {
    it('saves and loads a session', () => {
      mockedFs.existsSync.mockReturnValue(true);

      const session: WorkerSession = {
        sessionName: 'claude-sm-test1234',
        workers: [
          {
            id: 'w0-aaa',
            pane: '0',
            cwd: '/tmp/proj',
            startedAt: '2025-01-01T00:00:00Z',
            stateDir: '/home/test/.stackmemory/workers/w0-aaa',
          },
        ],
        createdAt: '2025-01-01T00:00:00Z',
      };

      saveRegistry(session);

      expect(mockedFs.writeFileSync).toHaveBeenCalledWith(
        expect.stringContaining('registry.json'),
        JSON.stringify(session, null, 2)
      );

      // Now simulate loading
      mockedFs.readFileSync.mockReturnValue(JSON.stringify(session));
      const loaded = loadRegistry();

      expect(loaded).toEqual(session);
    });

    it('returns null when no registry file', () => {
      mockedFs.existsSync.mockReturnValue(false);

      expect(loadRegistry()).toBeNull();
    });

    it('returns null on corrupted file', () => {
      mockedFs.existsSync.mockReturnValue(true);
      mockedFs.readFileSync.mockReturnValue('not-json{{{');

      expect(loadRegistry()).toBeNull();
    });
  });

  describe('clearRegistry', () => {
    it('removes registry file if it exists', () => {
      mockedFs.existsSync.mockReturnValue(true);

      clearRegistry();

      expect(mockedFs.rmSync).toHaveBeenCalledWith(
        expect.stringContaining('registry.json'),
        { force: true }
      );
    });

    it('does nothing if file does not exist', () => {
      mockedFs.existsSync.mockReturnValue(false);

      clearRegistry();

      expect(mockedFs.rmSync).not.toHaveBeenCalled();
    });
  });

  describe('getWorkersDir', () => {
    it('returns the workers directory path', () => {
      const dir = getWorkersDir();
      expect(dir).toContain('workers');
      expect(dir).toContain('.stackmemory');
    });
  });
});
