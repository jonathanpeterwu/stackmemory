/**
 * Integration tests for database functionality
 * Uses real SQLite in-memory database instead of mocks
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import Database from 'better-sqlite3';
import { SQLiteAdapter } from '../../core/database/sqlite-adapter.js';
import { ConnectionPool } from '../../core/database/connection-pool.js';
import { QueryRouter } from '../../core/database/query-router.js';
import { ContextRetriever } from '../../core/retrieval/context-retriever.js';
import * as os from 'os';
import * as path from 'path';
import * as fs from 'fs';

describe('Database Integration Tests', () => {
  let testDb: Database.Database;
  let adapter: SQLiteAdapter;
  let testDir: string;

  beforeEach(async () => {
    // Create a temporary directory for test database
    testDir = path.join(os.tmpdir(), `stackmemory-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
    
    // Create SQLite adapter with proper configuration
    const dbPath = path.join(testDir, 'test.db');
    adapter = new SQLiteAdapter('test-project', {
      dbPath: dbPath,
      maxConnections: 1,
      busyTimeout: 5000,
    });
    
    // Initialize the database
    await adapter.connect();
    await adapter.initializeSchema();
    
    // Get the database instance for cleanup
    testDb = (adapter as any).db;
  });

  afterEach(async () => {
    // Properly disconnect the adapter
    if (adapter) {
      await adapter.disconnect();
    }
    
    // Clean up test directory
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('SQLite Adapter', () => {
    it('should create and retrieve frames', async () => {
      // Create a frame
      const frameId = await adapter.createFrame({
        parent_frame_id: null,
        project_id: 'test-project',
        run_id: 'test-run',
        type: 'operation',
        name: 'Test Operation',
        state: 'active',
        depth: 0,
      });

      expect(frameId).toBeDefined();

      // Retrieve the frame
      const frame = await adapter.getFrame(frameId);
      expect(frame).toBeDefined();
      expect(frame?.name).toBe('Test Operation');
      expect(frame?.type).toBe('operation');
    });

    it('should search frames by text', async () => {
      // Create test frames
      await adapter.createFrame({
        parent_frame_id: null,
        project_id: 'test-project',
        run_id: 'test-run',
        type: 'operation',
        name: 'Database Connection',
        state: 'completed',
        depth: 0,
        digest_text: 'Successfully connected to PostgreSQL database',
      });

      await adapter.createFrame({
        parent_frame_id: null,
        project_id: 'test-project',
        run_id: 'test-run',
        type: 'error',
        name: 'Connection Error',
        state: 'error',
        depth: 0,
        digest_text: 'Failed to connect to database: timeout',
      });

      // Search for frames
      const results = await adapter.search({
        query: 'database',
        searchType: 'text',
        limit: 10,
      });

      expect(results.length).toBeGreaterThan(0);
      expect(results.some(r => r.name.includes('Database'))).toBe(true);
    });

    it('should handle frame updates', async () => {
      const frameId = await adapter.createFrame({
        parent_frame_id: null,
        project_id: 'test-project',
        run_id: 'test-run',
        type: 'operation',
        name: 'Test Operation',
        state: 'active',
        depth: 0,
      });

      // Update frame state
      await adapter.updateFrame(frameId, { state: 'completed' });
      
      const frame = await adapter.getFrame(frameId);
      expect(frame?.state).toBe('completed');
    });
  });

  describe('Query Router', () => {
    it('should route queries to appropriate tiers', async () => {
      const router = new QueryRouter();
      
      // Register a tier with proper config
      router.registerTier({
        name: 'sqlite',
        adapter,
        priority: 100,
        config: {
          maxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
          preferredOperations: ['read', 'write'],
          supportedFeatures: ['full_text'],
          routingRules: [],
        },
      });

      // Execute a query
      const result = await router.route(
        'test-query',
        { queryType: 'read' },
        async (tier) => {
          return 'success';
        }
      );

      expect(result).toBe('success');
    });
  });

  describe('Context Retriever', () => {
    it('should retrieve relevant contexts', async () => {
      // Create test data
      await adapter.createFrame({
        parent_frame_id: null,
        project_id: 'test-project',
        run_id: 'test-run',
        type: 'operation',
        name: 'User Authentication',
        state: 'completed',
        depth: 0,
        digest_text: 'Implemented JWT authentication for user login',
      });

      await adapter.createFrame({
        parent_frame_id: null,
        project_id: 'test-project',
        run_id: 'test-run',
        type: 'operation',
        name: 'Database Setup',
        state: 'completed',
        depth: 0,
        digest_text: 'Configured PostgreSQL connection pool',
      });

      // Create retriever
      const retriever = new ContextRetriever(adapter);

      // Search for authentication contexts
      const result = await retriever.retrieveContext({
        text: 'authentication',
        maxResults: 5,
      });

      expect(result.contexts.length).toBeGreaterThan(0);
      expect(result.contexts[0].frame.name).toContain('Authentication');
    });

    it('should handle empty queries gracefully', async () => {
      const retriever = new ContextRetriever(adapter);
      
      const result = await retriever.retrieveContext({
        text: '',
        maxResults: 10,
      });

      expect(result.contexts.length).toBe(0);
      expect(result.totalMatches).toBe(0);
    });
  });
});