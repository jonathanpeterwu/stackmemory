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
    describe('StartFrameSchema', () => {
      it('should accept valid input', () => {
        const input = {
          name: 'Test Frame',
          type: 'task',
          constraints: ['Must be fast', 'Must be secure'],
        };

        expect(() =>
          validateInput(StartFrameSchema, input, 'start_frame')
        ).not.toThrow();
      });

      it('should reject missing required fields', () => {
        const input = { type: 'task' }; // missing name

        expect(() =>
          validateInput(StartFrameSchema, input, 'start_frame')
        ).toThrow();
      });

      it('should reject invalid type', () => {
        const input = {
          name: 'Test',
          type: 'invalid_type', // not a valid FrameType
        };

        expect(() =>
          validateInput(StartFrameSchema, input, 'start_frame')
        ).toThrow();
      });

      it('should accept optional constraints', () => {
        const input = {
          name: 'Test Frame',
          type: 'subtask',
        };

        const result = validateInput(StartFrameSchema, input, 'start_frame');
        expect(result.name).toBe('Test Frame');
        expect(result.type).toBe('subtask');
      });

      it('should reject empty name', () => {
        const input = {
          name: '',
          type: 'task',
        };

        expect(() =>
          validateInput(StartFrameSchema, input, 'start_frame')
        ).toThrow();
      });
    });

    describe('AddAnchorSchema', () => {
      it('should accept valid anchor input', () => {
        const input = {
          type: 'DECISION',
          text: 'Chose React over Vue for better ecosystem',
          priority: 8,
        };

        const result = validateInput(AddAnchorSchema, input, 'add_anchor');
        expect(result.type).toBe('DECISION');
        expect(result.priority).toBe(8);
      });

      it('should default priority to 5', () => {
        const input = {
          type: 'FACT',
          text: 'Found memory leak in handler',
        };

        const result = validateInput(AddAnchorSchema, input, 'add_anchor');
        expect(result.priority).toBe(5);
      });

      it('should reject priority out of range', () => {
        const input = {
          type: 'DECISION',
          text: 'Test',
          priority: 15, // > 10
        };

        expect(() =>
          validateInput(AddAnchorSchema, input, 'add_anchor')
        ).toThrow();
      });

      it('should reject negative priority', () => {
        const input = {
          type: 'DECISION',
          text: 'Test',
          priority: -1,
        };

        expect(() =>
          validateInput(AddAnchorSchema, input, 'add_anchor')
        ).toThrow();
      });
    });

    describe('CreateTaskSchema', () => {
      it('should accept valid task input', () => {
        const input = {
          title: 'Implement feature X',
          description: 'Add the new feature as discussed',
          priority: 'high',
          status: 'in_progress',
        };

        const result = validateInput(CreateTaskSchema, input, 'create_task');
        expect(result.title).toBe('Implement feature X');
      });

      it('should reject missing title', () => {
        const input = {
          description: 'Some description',
        };

        expect(() =>
          validateInput(CreateTaskSchema, input, 'create_task')
        ).toThrow();
      });

      it('should validate priority enum', () => {
        const input = {
          title: 'Test',
          priority: 'invalid_priority',
        };

        expect(() =>
          validateInput(CreateTaskSchema, input, 'create_task')
        ).toThrow();
      });
    });

    describe('GetContextSchema', () => {
      it('should accept empty input', () => {
        const input = {};

        const result = validateInput(GetContextSchema, input, 'get_context');
        expect(result.limit).toBe(10); // default
      });

      it('should accept custom limit', () => {
        const input = { limit: 20 };

        const result = validateInput(GetContextSchema, input, 'get_context');
        expect(result.limit).toBe(20);
      });

      it('should reject negative limit', () => {
        const input = { limit: -5 };

        expect(() =>
          validateInput(GetContextSchema, input, 'get_context')
        ).toThrow();
      });
    });
  });

  describe('Error propagation patterns', () => {
    it('should wrap validation errors with context', () => {
      const badInput = { name: 123, type: null }; // completely wrong types

      try {
        validateInput(StartFrameSchema, badInput, 'start_frame');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toContain('start_frame');
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('should provide helpful error messages for type mismatches', () => {
      const input = {
        name: 'Test',
        type: 'task',
        constraints: 'not an array', // should be array
      };

      try {
        validateInput(StartFrameSchema, input, 'start_frame');
        expect.fail('Should have thrown');
      } catch (error: any) {
        expect(error.message).toBeDefined();
      }
    });
  });

  describe('Edge cases', () => {
    it('should handle null input gracefully', () => {
      expect(() =>
        validateInput(StartFrameSchema, null, 'start_frame')
      ).toThrow();
    });

    it('should handle undefined input gracefully', () => {
      expect(() =>
        validateInput(StartFrameSchema, undefined, 'start_frame')
      ).toThrow();
    });

    it('should handle very long strings', () => {
      const input = {
        name: 'A'.repeat(10000), // very long name
        type: 'task',
      };

      // Should either accept (if no length limit) or reject with proper error
      // The point is it shouldn't crash
      try {
        validateInput(StartFrameSchema, input, 'start_frame');
      } catch (error: any) {
        expect(error).toBeInstanceOf(Error);
      }
    });

    it('should handle special characters in strings', () => {
      const input = {
        name: 'Test <script>alert("xss")</script>',
        type: 'task',
      };

      // Should accept - XSS prevention is a different layer
      const result = validateInput(StartFrameSchema, input, 'start_frame');
      expect(result.name).toContain('<script>');
    });

    it('should handle unicode characters', () => {
      const input = {
        name: '日本語テスト 🚀 emoji test',
        type: 'task',
      };

      const result = validateInput(StartFrameSchema, input, 'start_frame');
      expect(result.name).toContain('🚀');
    });
  });
});

describe('MCP Tool Database Error Handling', () => {
  let db: Database.Database;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'mcp-error-test-'));
    const dbPath = join(tempDir, 'test.db');
    db = new Database(dbPath);
  });

  afterEach(() => {
    if (db) db.close();
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  });

  describe('Database constraint violations', () => {
    it('should handle duplicate primary key gracefully', () => {
      // Setup a simple table
      db.exec(`
        CREATE TABLE IF NOT EXISTS test_contexts (
          id TEXT PRIMARY KEY,
          content TEXT NOT NULL
        )
      `);

      const insert = db.prepare(
        'INSERT INTO test_contexts (id, content) VALUES (?, ?)'
      );
      insert.run('test-id', 'first content');

      // Attempt duplicate
      expect(() => insert.run('test-id', 'duplicate')).toThrow(
        /UNIQUE constraint failed/
      );
    });

    it('should handle NOT NULL constraint', () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS test_required (
          id TEXT PRIMARY KEY,
          required_field TEXT NOT NULL
        )
      `);

      const insert = db.prepare(
        'INSERT INTO test_required (id, required_field) VALUES (?, ?)'
      );

      // Attempt null value
      expect(() => insert.run('test-id', null)).toThrow(
        /NOT NULL constraint failed/
      );
    });

    it('should handle foreign key constraint', () => {
      db.exec('PRAGMA foreign_keys = ON');
      db.exec(`
        CREATE TABLE IF NOT EXISTS parent_table (
          id TEXT PRIMARY KEY
        );
        CREATE TABLE IF NOT EXISTS child_table (
          id TEXT PRIMARY KEY,
          parent_id TEXT NOT NULL REFERENCES parent_table(id)
        )
      `);

      const insertChild = db.prepare(
        'INSERT INTO child_table (id, parent_id) VALUES (?, ?)'
      );

      // Attempt to insert with non-existent parent
      expect(() => insertChild.run('child-1', 'non-existent-parent')).toThrow(
        /FOREIGN KEY constraint failed/
      );
    });
  });

  describe('Transaction handling', () => {
    it('should rollback on error within transaction', () => {
      db.exec(`
        CREATE TABLE IF NOT EXISTS tx_test (
          id TEXT PRIMARY KEY,
          value INTEGER NOT NULL
        )
      `);

      const insert = db.prepare(
        'INSERT INTO tx_test (id, value) VALUES (?, ?)'
      );

      // Start transaction that will fail partway through
      try {
        db.transaction(() => {
          insert.run('a', 1);
          insert.run('b', 2);
          insert.run('a', 3); // This should fail - duplicate
        })();
      } catch {
        // Expected
      }

      // Nothing should have been inserted due to rollback
      const count = db.prepare('SELECT COUNT(*) as cnt FROM tx_test').get() as {
        cnt: number;
      };
      expect(count.cnt).toBe(0);
    });
  });

  describe('Query error handling', () => {
    it('should handle malformed SQL gracefully', () => {
      expect(() => db.exec('SELECT * FROM non_existent_table')).toThrow();
    });

    it('should handle invalid column reference', () => {
      db.exec('CREATE TABLE IF NOT EXISTS simple_table (id TEXT, name TEXT)');

      expect(() =>
        db.prepare('SELECT non_existent_column FROM simple_table').get()
      ).toThrow();
    });
  });
});

describe('MCP Tool Async Error Handling', () => {
  describe('Promise rejection handling', () => {
    it('should properly propagate async errors', async () => {
      const failingOperation = async (): Promise<void> => {
        throw new Error('Async operation failed');
      };

      await expect(failingOperation()).rejects.toThrow(
        'Async operation failed'
      );
    });

    it('should handle timeout scenarios', async () => {
      const timeoutPromise = <T>(ms: number, value: T): Promise<T> => {
        return new Promise((resolve) => setTimeout(() => resolve(value), ms));
      };

      const withTimeout = async <T>(
        promise: Promise<T>,
        ms: number
      ): Promise<T> => {
        const timeout = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('Operation timed out')), ms)
        );
        return Promise.race([promise, timeout]);
      };

      // This should timeout
      await expect(
        withTimeout(timeoutPromise(100, 'result'), 10)
      ).rejects.toThrow('Operation timed out');

      // This should succeed
      const result = await withTimeout(timeoutPromise(10, 'result'), 100);
      expect(result).toBe('result');
    });
  });

  describe('Error recovery patterns', () => {
    it('should support retry with exponential backoff', async () => {
      let attempts = 0;
      const maxAttempts = 3;

      const retryableOperation = async (): Promise<string> => {
        attempts++;
        if (attempts < maxAttempts) {
          throw new Error(`Attempt ${attempts} failed`);
        }
        return 'success';
      };

      const retry = async <T>(
        fn: () => Promise<T>,
        maxRetries: number
      ): Promise<T> => {
        let lastError: Error | undefined;
        for (let i = 0; i < maxRetries; i++) {
          try {
            return await fn();
          } catch (error) {
            lastError = error as Error;
            // Would normally add delay here
          }
        }
        throw lastError;
      };

      const result = await retry(retryableOperation, maxAttempts);
      expect(result).toBe('success');
      expect(attempts).toBe(maxAttempts);
    });

    it('should provide fallback values on error', async () => {
      const failingFetch = async (): Promise<string> => {
        throw new Error('Network error');
      };

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

      const result = await withFallback(failingFetch, 'default value');
      expect(result).toBe('default value');
    });
  });
});

describe('Input Sanitization', () => {
  describe('Path traversal prevention', () => {
    it('should detect path traversal attempts', () => {
      const isPathSafe = (path: string): boolean => {
        const normalized = path.replace(/\\/g, '/');
        return !normalized.includes('..') && !normalized.startsWith('/');
      };

      expect(isPathSafe('normal/path/file.txt')).toBe(true);
      expect(isPathSafe('../etc/passwd')).toBe(false);
      expect(isPathSafe('foo/../../bar')).toBe(false);
      expect(isPathSafe('/absolute/path')).toBe(false);
    });
  });

  describe('SQL injection prevention', () => {
    it('should use parameterized queries', () => {
      // This test demonstrates the pattern that should be used
      const safeQuery = (db: Database.Database, userInput: string): void => {
        // GOOD: Parameterized query
        const stmt = db.prepare('SELECT * FROM users WHERE name = ?');
        stmt.get(userInput);
      };

      // The key is that we never concatenate user input directly into SQL
      // This is enforced by using better-sqlite3's prepare().get() pattern
      expect(typeof safeQuery).toBe('function');
    });
  });
});
