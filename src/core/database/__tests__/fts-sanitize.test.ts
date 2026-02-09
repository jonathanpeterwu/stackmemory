/**
 * Tests for FTS5 query sanitization in SQLiteAdapter
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteAdapter } from '../sqlite-adapter.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('FTS5 Query Sanitization', () => {
  let adapter: SQLiteAdapter;
  let dbPath: string;

  beforeEach(async () => {
    const tmpDir = fs.mkdtempSync(
      path.join(os.tmpdir(), 'stackmemory-fts-san-')
    );
    dbPath = path.join(tmpDir, 'test.db');
    adapter = new SQLiteAdapter('test-project', { dbPath });
    await adapter.connect();
    await adapter.initializeSchema();
  });

  afterEach(async () => {
    await adapter.disconnect();
    try {
      fs.rmSync(path.dirname(dbPath), { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  // Access private method via bracket notation for testing
  function sanitize(query: string): string {
    return (adapter as any).sanitizeFtsQuery(query);
  }

  describe('sanitizeFtsQuery', () => {
    it('should wrap normal query terms in double quotes', () => {
      expect(sanitize('error module')).toBe('"error" "module"');
    });

    it('should handle a single word', () => {
      expect(sanitize('authentication')).toBe('"authentication"');
    });

    it('should strip special characters', () => {
      const result = sanitize('error "in" (module)');
      expect(result).toBe('"error" "in" "module"');
    });

    it('should remove FTS5 operators', () => {
      expect(sanitize('error AND debug')).toBe('"error" "debug"');
      expect(sanitize('error OR warning')).toBe('"error" "warning"');
      expect(sanitize('NOT error')).toBe('"error"');
      expect(sanitize('NEAR(error, debug)')).toBe('"error" "debug"');
    });

    it('should handle case-insensitive operators', () => {
      expect(sanitize('error and debug')).toBe('"error" "debug"');
      expect(sanitize('error Or warning')).toBe('"error" "warning"');
      expect(sanitize('not error')).toBe('"error"');
    });

    it('should return safe fallback for empty query', () => {
      expect(sanitize('')).toBe('""');
      expect(sanitize('   ')).toBe('""');
    });

    it('should return safe fallback for query with only special chars', () => {
      expect(sanitize('"()*~^')).toBe('""');
    });

    it('should add prefix wildcard when query ends with *', () => {
      expect(sanitize('auth*')).toBe('"auth"*');
    });

    it('should add prefix wildcard only to last term', () => {
      expect(sanitize('user auth*')).toBe('"user" "auth"*');
    });

    it('should not add prefix wildcard when * is not at end', () => {
      expect(sanitize('auth test')).toBe('"auth" "test"');
    });

    it('should strip brackets and braces', () => {
      expect(sanitize('error [in] {module}')).toBe('"error" "in" "module"');
    });
  });

  describe('integration: sanitized queries do not crash FTS5', () => {
    beforeEach(async () => {
      await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'test-project',
        type: 'task',
        name: 'authentication login flow',
        digest_text: 'handles user authentication and login',
      });
      await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'test-project',
        type: 'task',
        name: 'database error handler',
        digest_text: 'catches and logs database errors',
      });
    });

    it('should not crash on unbalanced quotes', async () => {
      const results = await adapter.search({ query: '"unbalanced' });
      expect(Array.isArray(results)).toBe(true);
    });

    it('should not crash on FTS5 operators in query', async () => {
      const results = await adapter.search({
        query: 'error AND NOT debug OR (test)',
      });
      expect(Array.isArray(results)).toBe(true);
    });

    it('should not crash on special characters', async () => {
      const results = await adapter.search({
        query: 'error "in" (module) [test]',
      });
      expect(Array.isArray(results)).toBe(true);
    });

    it('should still find results with sanitized queries', async () => {
      const results = await adapter.search({ query: 'authentication' });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].name).toBe('authentication login flow');
    });

    it('should find results with prefix search', async () => {
      const results = await adapter.search({ query: 'auth*' });
      expect(results.length).toBeGreaterThanOrEqual(1);
      expect(results[0].name).toBe('authentication login flow');
    });

    it('should return empty array for empty query', async () => {
      const results = await adapter.search({ query: '' });
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBe(0);
    });

    it('should handle query with only operators', async () => {
      const results = await adapter.search({ query: 'AND OR NOT' });
      expect(Array.isArray(results)).toBe(true);
    });
  });
});
