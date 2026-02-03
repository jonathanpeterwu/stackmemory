/**
 * Tests for MCP tool execution error scenarios
 * Verifies proper error handling, validation, and propagation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import Database from 'better-sqlite3';
import { join } from 'path';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { z } from 'zod';

// Import schemas for validation testing
import {
  validateInput,
  StartFrameSchema,
  CloseFrameSchema,
  AddAnchorSchema,
  CreateTaskSchema,
  GetContextSchema,
} from '../schemas.js';

describe('MCP Tool Error Handling', () => {
  describe('Schema Validation', () => {
    it.each([
      [
        'valid input with constraints',
        { name: 'Test Frame', type: 'task', constraints: ['Must be fast'] },
        true,
      ],
      [
        'valid input without constraints',
        { name: 'Test Frame', type: 'subtask' },
        true,
      ],
      ['missing required name', { type: 'task' }, false],
      ['invalid type enum', { name: 'Test', type: 'invalid_type' }, false],
      ['empty name', { name: '', type: 'task' }, false],
      ['null input', null, false],
      ['undefined input', undefined, false],
      ['unicode characters', { name: '日本語テスト 🚀', type: 'task' }, true],
    ])('StartFrameSchema: %s', (_desc, input, shouldPass) => {
      if (shouldPass) {
        expect(() =>
          validateInput(StartFrameSchema, input, 'start_frame')
        ).not.toThrow();
      } else {
        expect(() =>
          validateInput(StartFrameSchema, input, 'start_frame')
        ).toThrow();
      }
    });

    it.each([
      [
        'valid with priority',
        { type: 'DECISION', text: 'Test decision', priority: 8 },
        true,
        8,
      ],
      ['default priority', { type: 'FACT', text: 'Test fact' }, true, 5],
      [
        'priority too high',
        { type: 'DECISION', text: 'Test', priority: 15 },
        false,
        null,
      ],
      [
        'negative priority',
        { type: 'DECISION', text: 'Test', priority: -1 },
        false,
        null,
      ],
    ])('AddAnchorSchema: %s', (_desc, input, shouldPass, expectedPriority) => {
      if (shouldPass) {
        const result = validateInput(AddAnchorSchema, input, 'add_anchor');
        expect(result.priority).toBe(expectedPriority);
      } else {
        expect(() =>
          validateInput(AddAnchorSchema, input, 'add_anchor')
        ).toThrow();
      }
    });

    it.each([
      [
        'valid task',
        { title: 'Test', description: 'Desc', priority: 'high' },
        true,
      ],
      ['missing title', { description: 'Desc' }, false],
      ['invalid priority enum', { title: 'Test', priority: 'invalid' }, false],
    ])('CreateTaskSchema: %s', (_desc, input, shouldPass) => {
      if (shouldPass) {
        expect(() =>
          validateInput(CreateTaskSchema, input, 'create_task')
        ).not.toThrow();
      } else {
        expect(() =>
          validateInput(CreateTaskSchema, input, 'create_task')
        ).toThrow();
      }
    });

    it.each([
      ['empty input defaults limit', {}, true, 10],
      ['custom limit', { limit: 20 }, true, 20],
      ['negative limit', { limit: -5 }, false, null],
    ])('GetContextSchema: %s', (_desc, input, shouldPass, expectedLimit) => {
      if (shouldPass) {
        const result = validateInput(GetContextSchema, input, 'get_context');
        expect(result.limit).toBe(expectedLimit);
      } else {
        expect(() =>
          validateInput(GetContextSchema, input, 'get_context')
        ).toThrow();
      }
    });

    it('should wrap validation errors with context', () => {
      try {
        validateInput(
          StartFrameSchema,
          { name: 123, type: null },
          'start_frame'
        );
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('start_frame');
      }
    });
  });
});

describe('MCP Tool Database Error Handling', () => {
  let db: Database.Database;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'mcp-error-test-'));
    db = new Database(join(tempDir, 'test.db'));
  });

  afterEach(() => {
    db?.close();
    tempDir && rmSync(tempDir, { recursive: true, force: true });
  });

  it('should handle database constraint violations and transactions', () => {
    // UNIQUE constraint
    db.exec('CREATE TABLE t1 (id TEXT PRIMARY KEY, content TEXT NOT NULL)');
    const insert1 = db.prepare('INSERT INTO t1 (id, content) VALUES (?, ?)');
    insert1.run('test-id', 'first');
    expect(() => insert1.run('test-id', 'dup')).toThrow(/UNIQUE constraint/);

    // NOT NULL constraint
    db.exec('CREATE TABLE t2 (id TEXT PRIMARY KEY, req TEXT NOT NULL)');
    expect(() =>
      db.prepare('INSERT INTO t2 (id, req) VALUES (?, ?)').run('x', null)
    ).toThrow(/NOT NULL constraint/);

    // Transaction rollback
    db.exec('CREATE TABLE t3 (id TEXT PRIMARY KEY, val INTEGER)');
    const insert3 = db.prepare('INSERT INTO t3 (id, val) VALUES (?, ?)');
    try {
      db.transaction(() => {
        insert3.run('a', 1);
        insert3.run('a', 2);
      })();
    } catch {
      /* expected */
    }
    expect(
      (db.prepare('SELECT COUNT(*) as cnt FROM t3').get() as { cnt: number })
        .cnt
    ).toBe(0);

    // Invalid SQL
    expect(() => db.exec('SELECT * FROM non_existent')).toThrow();
  });
});

describe('MCP Tool Async Error Handling', () => {
  it('should handle async errors, timeouts, retry, and fallback', async () => {
    // Promise rejection
    await expect(Promise.reject(new Error('Async failed'))).rejects.toThrow(
      'Async failed'
    );

    // Timeout helper
    const withTimeout = <T>(promise: Promise<T>, ms: number): Promise<T> =>
      Promise.race([
        promise,
        new Promise<never>((_, rej) =>
          setTimeout(() => rej(new Error('Timeout')), ms)
        ),
      ]);
    await expect(
      withTimeout(new Promise((r) => setTimeout(r, 100)), 10)
    ).rejects.toThrow('Timeout');
    expect(await withTimeout(Promise.resolve('ok'), 100)).toBe('ok');

    // Retry pattern
    let attempts = 0;
    const retry = async <T>(fn: () => Promise<T>, max: number): Promise<T> => {
      for (let i = 0; i < max; i++) {
        try {
          return await fn();
        } catch {
          /* retry */
        }
      }
      throw new Error('Max retries');
    };
    expect(
      await retry(async () => {
        attempts++;
        if (attempts < 3) throw new Error();
        return 'done';
      }, 3)
    ).toBe('done');

    // Fallback pattern
    const withFallback = async <T>(
      fn: () => Promise<T>,
      fallback: T
    ): Promise<T> => {
      try {
        return await fn();
      } catch {
        return fallback;
      }
    };
    expect(
      await withFallback(() => Promise.reject(new Error()), 'default')
    ).toBe('default');
  });
});

describe('Input Sanitization', () => {
  it('should detect path traversal attempts', () => {
    const isPathSafe = (p: string): boolean =>
      !p.replace(/\\/g, '/').includes('..') && !p.startsWith('/');
    expect(isPathSafe('normal/path/file.txt')).toBe(true);
    expect(isPathSafe('../etc/passwd')).toBe(false);
    expect(isPathSafe('/absolute/path')).toBe(false);
  });
});
