#!/usr/bin/env node

/**
 * Security Testing Script for StackMemory CLI/API
 * Tests input validation and security vulnerabilities
 */

import { spawn, execSync } from 'child_process';
import { existsSync, mkdirSync, rmSync } from 'fs';
import { join } from 'path';

const TEST_DIR = '/tmp/stackmemory-security-test';
const TESTS_PASSED = [];
const TESTS_FAILED = [];

// Color output helpers
const red = (str) => `\x1b[31m${str}\x1b[0m`;
const green = (str) => `\x1b[32m${str}\x1b[0m`;
const yellow = (str) => `\x1b[33m${str}\x1b[0m`;
const blue = (str) => `\x1b[34m${str}\x1b[0m`;

// Test runner
async function runTest(name, testFn) {
  process.stdout.write(`Testing ${name}... `);
  try {
    await testFn();
    TESTS_PASSED.push(name);
    console.log(green('✓ PASSED'));
    return true;
  } catch (error) {
    TESTS_FAILED.push({ name, error: error.message });
    console.log(red('✗ FAILED'));
    console.log(`  ${yellow(error.message)}`);
    return false;
  }
}

// Execute CLI command safely
function execCLI(args, options = {}) {
  try {
    const result = execSync(`npx stackmemory ${args}`, {
      cwd: TEST_DIR,
      encoding: 'utf8',
      stdio: 'pipe',
      ...options
    });
    return { success: true, output: result };
  } catch (error) {
    return { 
      success: false, 
      output: error.stdout || '',
      error: error.stderr || error.message 
    };
  }
}

// Setup test environment
function setupTestEnv() {
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
  mkdirSync(TEST_DIR, { recursive: true });
  process.chdir(TEST_DIR);
  
  // Initialize StackMemory
  execSync('npx stackmemory init', { cwd: TEST_DIR, stdio: 'ignore' });
}

// Security Tests
const securityTests = {
  // SQL Injection Tests
  async testSQLInjection() {
    const payloads = [
      "'; DROP TABLE frames; --",
      "1' OR '1'='1",
      "1; DELETE FROM tasks WHERE 1=1; --",
      "' UNION SELECT * FROM frames --",
      "1' AND (SELECT * FROM (SELECT(SLEEP(5)))a)--"
    ];
    
    for (const payload of payloads) {
      const result = execCLI(`search "${payload}"`);
      if (!result.success && result.error?.includes('DROP TABLE')) {
        throw new Error(`SQL injection vulnerability detected with payload: ${payload}`);
      }
    }
  },

  // Command Injection Tests
  async testCommandInjection() {
    const payloads = [
      '$(whoami)',
      '`id`',
      '; ls -la',
      '| cat /etc/passwd',
      '&& rm -rf /',
      '\n/bin/sh',
      '"; cat ~/.ssh/id_rsa; echo "'
    ];
    
    for (const payload of payloads) {
      const result = execCLI(`linear update "${payload}"`);
      // Check if command was executed
      if (result.output?.includes('root') || result.output?.includes('uid=')) {
        throw new Error(`Command injection vulnerability with payload: ${payload}`);
      }
    }
  },

  // Path Traversal Tests
  async testPathTraversal() {
    const payloads = [
      '../../../etc/passwd',
      '..\\..\\..\\windows\\system32\\config\\sam',
      'file:///etc/passwd',
      '....//....//....//etc/passwd',
      '%2e%2e%2f%2e%2e%2f%2e%2e%2fetc%2fpasswd'
    ];
    
    for (const payload of payloads) {
      // Test with project commands
      const result = execCLI(`projects add "${payload}"`);
      if (result.output?.includes('root:') || result.output?.includes('Administrator:')) {
        throw new Error(`Path traversal vulnerability with payload: ${payload}`);
      }
    }
  },

  // Invalid Input Handling
  async testInvalidInputs() {
    const tests = [
      { cmd: 'linear sync --direction invalid', shouldFail: true },
      { cmd: 'linear config --set-interval -1', shouldFail: true },
      { cmd: 'linear config --set-quiet-start 25', shouldFail: true },
      { cmd: 'analytics --port abc', shouldFail: true },
      { cmd: 'search --limit notanumber', shouldFail: true }
    ];
    
    for (const test of tests) {
      const result = execCLI(test.cmd);
      if (test.shouldFail && result.success) {
        throw new Error(`Invalid input accepted: ${test.cmd}`);
      }
    }
  },

  // Buffer Overflow Tests
  async testBufferOverflow() {
    const largeString = 'A'.repeat(1000000); // 1MB string
    const veryLargeString = 'B'.repeat(10000000); // 10MB string
    
    // Test with large inputs
    const result1 = execCLI(`search "${largeString}"`);
    const result2 = execCLI(`linear create --title "${veryLargeString}"`);
    
    // Should handle gracefully without crashing
    if (result1.error?.includes('Segmentation fault') || 
        result2.error?.includes('Segmentation fault')) {
      throw new Error('Buffer overflow vulnerability detected');
    }
  },

  // YAML/JSON Injection
  async testYAMLInjection() {
    const payloads = [
      '!!python/object/apply:os.system ["ls"]',
      '{"__proto__": {"isAdmin": true}}',
      '{"constructor": {"prototype": {"isAdmin": true}}}',
      '{ "$gt": "" }',
      '{"$where": "sleep(1000)"}'
    ];
    
    for (const payload of payloads) {
      const result = execCLI(`config --import '${payload}'`);
      if (result.output?.includes('isAdmin') || 
          result.output?.includes('bin') ||
          result.output?.includes('etc')) {
        throw new Error(`YAML/JSON injection vulnerability with payload: ${payload}`);
      }
    }
  },

  // Environment Variable Injection
  async testEnvVarInjection() {
    const payloads = [
      '$HOME',
      '${PATH}',
      '$(printenv)',
      '%USERPROFILE%'
    ];
    
    for (const payload of payloads) {
      const result = execCLI(`linear setup --client-id "${payload}"`);
      if (result.output?.includes('/home/') || 
          result.output?.includes('/usr/') ||
          result.output?.includes('Users')) {
        throw new Error(`Environment variable injection with payload: ${payload}`);
      }
    }
  },

  // Integer Overflow Tests
  async testIntegerOverflow() {
    const tests = [
      { cmd: 'search --limit 999999999999999999999', field: 'limit' },
      { cmd: 'analytics --port 999999999', field: 'port' },
      { cmd: 'linear config --set-interval 2147483648', field: 'interval' }
    ];
    
    for (const test of tests) {
      const result = execCLI(test.cmd);
      // Should validate numeric ranges
      if (!result.error && result.success) {
        throw new Error(`Integer overflow not handled for ${test.field}`);
      }
    }
  },

  // XSS in Terminal Output
  async testXSSInTerminal() {
    const payloads = [
      '\x1b[31mRED\x1b[0m\x1b]0;HIJACKED\x07',
      '<script>alert(1)</script>',
      '\r\nInjected line',
      '\x1b[2J\x1b[H' // Clear screen escape
    ];
    
    for (const payload of payloads) {
      const result = execCLI(`search "${payload}"`);
      // Output should be sanitized
      if (result.output?.includes('\x1b]0;') || 
          result.output?.includes('\x1b[2J')) {
        throw new Error('Terminal escape sequences not sanitized');
      }
    }
  },

  // Authentication Bypass Tests
  async testAuthBypass() {
    // Test accessing Linear commands without auth
    const commands = [
      'linear sync',
      'linear list',
      'linear update TEST-123'
    ];
    
    // Unset LINEAR_API_KEY for test
    delete process.env.LINEAR_API_KEY;
    
    for (const cmd of commands) {
      const result = execCLI(cmd);
      // Should require authentication
      if (result.success && !result.output?.includes('not configured')) {
        throw new Error(`Authentication bypass for: ${cmd}`);
      }
    }
  }
};

// Main test runner
async function main() {
  console.log(blue('\n🔒 StackMemory CLI/API Security Testing\n'));
  console.log('Setting up test environment...\n');
  
  setupTestEnv();
  
  // Run all security tests
  for (const [name, testFn] of Object.entries(securityTests)) {
    await runTest(name, testFn);
  }
  
  // Summary
  console.log(blue('\n📊 Test Summary\n'));
  console.log(green(`✓ Passed: ${TESTS_PASSED.length}`));
  console.log(red(`✗ Failed: ${TESTS_FAILED.length}`));
  
  if (TESTS_FAILED.length > 0) {
    console.log(red('\n❌ Failed Tests:'));
    TESTS_FAILED.forEach(({ name, error }) => {
      console.log(`  - ${name}: ${error}`);
    });
  }
  
  // Cleanup
  if (existsSync(TEST_DIR)) {
    rmSync(TEST_DIR, { recursive: true, force: true });
  }
  
  process.exit(TESTS_FAILED.length > 0 ? 1 : 0);
}

// Run tests
main().catch(console.error);