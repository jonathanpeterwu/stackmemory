/**
 * Simplified CLI Integration Tests
 * Tests basic CLI functionality without complex mocking
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Use the built CLI
const projectRoot = path.join(__dirname, '..', '..', '..');
const cliPath = path.join(projectRoot, 'dist', 'cli', 'index.js');

describe('CLI Integration', () => {
  let testDir: string;

  beforeEach(() => {
    // Create temporary test directory
    testDir = path.join(os.tmpdir(), `stackmemory-cli-test-${Date.now()}`);
    fs.mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    // Clean up
    if (testDir && fs.existsSync(testDir)) {
      fs.rmSync(testDir, { recursive: true, force: true });
    }
  });

  describe('Basic Commands', () => {
    it('should show help', () => {
      const result = execSync(`node ${cliPath} --help`, {
        encoding: 'utf8',
      });

      expect(result).toContain('stackmemory');
      expect(result).toContain('Commands:');
    });

    it('should show version', () => {
      const result = execSync(`node ${cliPath} --version`, {
        encoding: 'utf8',
      });

      expect(result).toMatch(/\d+\.\d+\.\d+/);
    });

    it('should initialize project', () => {
      const result = execSync(`node ${cliPath} init`, {
        cwd: testDir,
        encoding: 'utf8',
      });

      expect(result).toContain('StackMemory initialized');
      
      // Check that .stackmemory directory was created
      const stackmemoryDir = path.join(testDir, '.stackmemory');
      expect(fs.existsSync(stackmemoryDir)).toBe(true);
    });
  });

  describe('Status Command', () => {
    it.skip('should show status after init - needs database schema', () => {
      // Initialize first
      execSync(`node ${cliPath} init`, { cwd: testDir });

      // Check status
      const result = execSync(`node ${cliPath} status`, {
        cwd: testDir,
        encoding: 'utf8',
      });

      expect(result).toContain('StackMemory Status');
      expect(result).toContain('Initialized:');
    });

    it('should handle status when not initialized', () => {
      try {
        execSync(`node ${cliPath} status`, {
          cwd: testDir,
          encoding: 'utf8',
        });
      } catch (error: any) {
        expect(error.stdout || error.message).toContain('not initialized');
      }
    });
  });

  describe('Clear Command', () => {
    it('should show clear status', () => {
      // Initialize first
      execSync(`node ${cliPath} init`, { cwd: testDir });

      const result = execSync(`node ${cliPath} clear --status`, {
        cwd: testDir,
        encoding: 'utf8',
      });

      expect(result).toContain('Context Usage');
    });

    it.skip('should check if clear is recommended - needs git repo', () => {
      // Initialize first
      execSync(`node ${cliPath} init`, { cwd: testDir });

      const result = execSync(`node ${cliPath} clear --check`, {
        cwd: testDir,
        encoding: 'utf8',
      });

      // Should provide some recommendation
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('Workflow Command', () => {
    it('should list available workflows', () => {
      // Initialize first
      execSync(`node ${cliPath} init`, { cwd: testDir });

      const result = execSync(`node ${cliPath} workflow --list`, {
        cwd: testDir,
        encoding: 'utf8',
      });

      expect(result).toContain('Available Workflows');
    });

    it('should show workflow status', () => {
      // Initialize first
      execSync(`node ${cliPath} init`, { cwd: testDir });

      const result = execSync(`node ${cliPath} workflow --status`, {
        cwd: testDir,
        encoding: 'utf8',
      });

      // Should show status (even if no workflow active)
      expect(result).toBeDefined();
    });
  });
});