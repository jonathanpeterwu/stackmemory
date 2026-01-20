#!/usr/bin/env node

/**
 * Simple Ralph CLI Functionality Test
 */

import { execSync } from 'child_process';
import fs from 'fs';

console.log('🎭 Testing Ralph CLI Commands');
console.log('=' .repeat(40));

const tests = [
  {
    name: 'Ralph Help Command',
    command: 'node dist/cli/index.js ralph --help',
    expectOutput: 'Ralph Wiggum Loop integration'
  },
  {
    name: 'Ralph Init Command',
    command: 'node dist/cli/index.js ralph init "Test task" --criteria "Tests pass,Code works"',
    expectFiles: ['.ralph/task.md']
  },
  {
    name: 'Ralph Status Command',
    command: 'node dist/cli/index.js ralph status',
    expectOutput: 'Ralph Loop Status'
  },
  {
    name: 'Ralph Debug Command', 
    command: 'node dist/cli/index.js ralph debug',
    expectOutput: 'Ralph Loop Debug'
  }
];

let passed = 0;
let failed = 0;

for (const test of tests) {
  try {
    console.log(`Testing: ${test.name}...`);
    
    const result = execSync(test.command, { 
      encoding: 'utf8',
      stdio: 'pipe',
      timeout: 30000
    });

    let testPassed = true;
    
    if (test.expectOutput && !result.includes(test.expectOutput)) {
      console.log(`  ❌ Expected output "${test.expectOutput}" not found`);
      testPassed = false;
    }
    
    if (test.expectFiles) {
      for (const file of test.expectFiles) {
        if (!fs.existsSync(file)) {
          console.log(`  ❌ Expected file "${file}" not created`);
          testPassed = false;
        }
      }
    }
    
    if (testPassed) {
      console.log(`  ✅ ${test.name} passed`);
      passed++;
    } else {
      failed++;
    }
    
    console.log(`  Output: ${result.substring(0, 150)}...`);
    
  } catch (error) {
    console.log(`  ❌ ${test.name} failed: ${error.message}`);
    failed++;
  }
  
  console.log('');
}

console.log(`Results: ${passed} passed, ${failed} failed`);
console.log(`Success rate: ${Math.round((passed / (passed + failed)) * 100)}%`);

// Clean up
if (fs.existsSync('.ralph')) {
  fs.rmSync('.ralph', { recursive: true, force: true });
}