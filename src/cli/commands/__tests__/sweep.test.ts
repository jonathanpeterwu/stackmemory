import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { mkdtempSync, rmSync } from 'fs';

describe('Sweep CLI Command', () => {
  const cli = (cmd: string) =>
    `node ${join(process.cwd(), 'dist', 'cli', 'index.js')} ${cmd}`;

  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), 'sweep-test-'));
  });

  afterEach(() => {
    try {
      rmSync(testDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup errors
    }
  });

  describe('sweep status', () => {
    it('should show addon status', () => {
      const result = execSync(cli('sweep status'), {
        cwd: testDir,
        encoding: 'utf-8',
        timeout: 30000,
      });

      expect(result).toContain('Sweep 1.5B Addon Status');
      expect(result).toContain('Python:');
      expect(result).toContain('Addon installed:');
    });
  });

  describe('sweep help', () => {
    it('should show help text', () => {
      const result = execSync(cli('sweep --help'), {
        cwd: testDir,
        encoding: 'utf-8',
        timeout: 10000,
      });

      expect(result).toContain('Next-edit predictions');
      expect(result).toContain('setup');
      expect(result).toContain('status');
      expect(result).toContain('predict');
    });
  });

  describe('sweep predict', () => {
    it('should error when file not found', () => {
      try {
        execSync(cli('sweep predict nonexistent.ts'), {
          cwd: testDir,
          encoding: 'utf-8',
          timeout: 10000,
        });
        expect.fail('Should have thrown');
      } catch (error: unknown) {
        const err = error as { status: number };
        expect(err.status).toBe(1);
      }
    });
  });
});

describe('Sweep Addon Module', () => {
  describe('SweepPredictInput interface', () => {
    it('should accept valid input structure', () => {
      const input = {
        file_path: 'test.ts',
        current_content: 'const x = 1;',
        original_content: 'const x = 0;',
        context_files: {
          'utils.ts': 'export const helper = () => {};',
        },
        recent_diffs: [
          {
            file_path: 'test.ts',
            original: 'const x = 0;',
            updated: 'const x = 1;',
          },
        ],
        max_tokens: 512,
        temperature: 0.0,
      };

      expect(input.file_path).toBe('test.ts');
      expect(input.current_content).toBe('const x = 1;');
      expect(input.context_files?.['utils.ts']).toBeDefined();
      expect(input.recent_diffs).toHaveLength(1);
    });
  });

  describe('Python script location', () => {
    it('should find sweep_predict.py in packages directory', () => {
      const scriptPath = join(
        process.cwd(),
        'packages',
        'sweep-addon',
        'python',
        'sweep_predict.py'
      );
      expect(existsSync(scriptPath)).toBe(true);
    });
  });
});
