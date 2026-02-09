/**
 * Tests for ProjectRegistryManager and project registry in SQLiteAdapter
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { SQLiteAdapter } from '../../database/sqlite-adapter.js';
import { ProjectRegistryManager } from '../project-registry.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('ProjectRegistryManager', () => {
  let adapter: SQLiteAdapter;
  let registry: ProjectRegistryManager;
  let tmpDir: string;
  let dbPath: string;

  beforeEach(async () => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'stackmemory-registry-'));
    dbPath = path.join(tmpDir, 'test.db');
    adapter = new SQLiteAdapter('test-project', { dbPath });
    await adapter.connect();
    await adapter.initializeSchema();
    registry = new ProjectRegistryManager(adapter);
  });

  afterEach(async () => {
    await adapter.disconnect();
    try {
      fs.rmSync(tmpDir, { recursive: true });
    } catch {
      // cleanup best-effort
    }
  });

  it('should register a project and list it', async () => {
    await registry.register('my-app', '/home/user/my-app', 'My App');

    const projects = await registry.list();
    expect(projects).toHaveLength(1);
    expect(projects[0].projectId).toBe('my-app');
    expect(projects[0].repoPath).toBe('/home/user/my-app');
    expect(projects[0].displayName).toBe('My App');
    expect(projects[0].dbPath).toBe('/home/user/my-app/.stackmemory/memory.db');
    expect(projects[0].isActive).toBe(false);
    expect(projects[0].createdAt).toBeGreaterThan(0);
    expect(projects[0].lastAccessed).toBeGreaterThan(0);
  });

  it('should switch active project', async () => {
    await registry.register('app-a', '/home/user/app-a');
    await registry.register('app-b', '/home/user/app-b');

    const switched = await registry.switchTo('app-b');
    expect(switched).toBe(true);

    const active = await registry.getActive();
    expect(active).not.toBeNull();
    expect(active!.projectId).toBe('app-b');
    expect(active!.isActive).toBe(true);

    // Switch to the other
    await registry.switchTo('app-a');
    const newActive = await registry.getActive();
    expect(newActive!.projectId).toBe('app-a');

    // Verify app-b is no longer active
    const projects = await registry.list();
    const appB = projects.find((p) => p.projectId === 'app-b');
    expect(appB!.isActive).toBe(false);
  });

  it('should return false when switching to non-existent project', async () => {
    const result = await registry.switchTo('no-such-project');
    expect(result).toBe(false);
  });

  it('should remove a project', async () => {
    await registry.register('to-remove', '/tmp/to-remove');
    expect(await registry.remove('to-remove')).toBe(true);

    const projects = await registry.list();
    expect(projects).toHaveLength(0);
  });

  it('should return false when removing non-existent project', async () => {
    const result = await registry.remove('does-not-exist');
    expect(result).toBe(false);
  });

  it('should return null when no active project is set', async () => {
    const active = await registry.getActive();
    expect(active).toBeNull();
  });

  it('should auto-detect and register from cwd', async () => {
    const cwd = '/home/user/projects/cool-app';
    const projectId = await registry.detectAndRegister(cwd);
    expect(projectId).toBe('cool-app');

    const projects = await registry.list();
    expect(projects).toHaveLength(1);
    expect(projects[0].repoPath).toBe(cwd);
  });

  it('should reuse existing project on re-detect', async () => {
    const cwd = '/home/user/projects/cool-app';
    await registry.detectAndRegister(cwd);

    // Small delay to ensure timestamp differs
    await new Promise((r) => setTimeout(r, 10));

    const projectId = await registry.detectAndRegister(cwd);
    expect(projectId).toBe('cool-app');

    // Should not duplicate
    const projects = await registry.list();
    expect(projects).toHaveLength(1);
  });

  it('should update last_accessed on touch', async () => {
    await registry.register('touch-test', '/tmp/touch-test');
    const before = (await registry.list())[0].lastAccessed;

    // Small delay
    await new Promise((r) => setTimeout(r, 15));
    await adapter.touchProject('touch-test');

    const after = (await registry.list())[0].lastAccessed;
    expect(after).toBeGreaterThan(before);
  });

  it('should support multiple projects coexisting', async () => {
    await registry.register('proj-1', '/home/user/proj-1', 'Project One');
    await registry.register('proj-2', '/home/user/proj-2', 'Project Two');
    await registry.register('proj-3', '/home/user/proj-3');

    const projects = await registry.list();
    expect(projects).toHaveLength(3);

    const ids = projects.map((p) => p.projectId);
    expect(ids).toContain('proj-1');
    expect(ids).toContain('proj-2');
    expect(ids).toContain('proj-3');

    // Switch active to proj-2
    await registry.switchTo('proj-2');
    const active = await registry.getActive();
    expect(active!.projectId).toBe('proj-2');

    // Remove proj-1
    await registry.remove('proj-1');
    const remaining = await registry.list();
    expect(remaining).toHaveLength(2);
    expect(remaining.find((p) => p.projectId === 'proj-1')).toBeUndefined();
  });

  describe('scoped search', () => {
    it('should return only matching project frames with projectId filter', async () => {
      // Insert frames for two different projects
      await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'proj-alpha',
        type: 'task',
        name: 'alpha authentication flow',
        digest_text: 'user login for alpha',
      });
      await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'proj-beta',
        type: 'task',
        name: 'beta authentication flow',
        digest_text: 'user login for beta',
      });
      await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'proj-alpha',
        type: 'task',
        name: 'alpha database setup',
        digest_text: 'schema creation for alpha',
      });

      // Search without projectId filter — should return all matching
      const allResults = await adapter.search({
        query: 'authentication',
      });
      expect(allResults.length).toBe(2);

      // Search with projectId filter — should return only alpha
      const scopedResults = await adapter.search({
        query: 'authentication',
        projectId: 'proj-alpha',
      });
      expect(scopedResults.length).toBe(1);
      expect(scopedResults[0].project_id).toBe('proj-alpha');
      expect(scopedResults[0].name).toBe('alpha authentication flow');

      // Search beta project
      const betaResults = await adapter.search({
        query: 'authentication',
        projectId: 'proj-beta',
      });
      expect(betaResults.length).toBe(1);
      expect(betaResults[0].project_id).toBe('proj-beta');
    });

    it('should return empty when projectId filter matches no frames', async () => {
      await adapter.createFrame({
        run_id: 'run-1',
        project_id: 'proj-alpha',
        type: 'task',
        name: 'alpha task',
        digest_text: 'some content',
      });

      const results = await adapter.search({
        query: 'alpha',
        projectId: 'nonexistent-project',
      });
      expect(results.length).toBe(0);
    });
  });
});
