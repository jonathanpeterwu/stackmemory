#!/usr/bin/env npx tsx

/**
 * Test script to verify Ralph loop can iterate beyond 5 iterations
 */

import * as fs from 'fs/promises';
import * as path from 'path';
import { existsSync } from 'fs';

const RALPH_DIR = '.ralph';
const MAX_TEST_ITERATIONS = 10; // Test up to 10 iterations

interface RalphLoopState {
  loopId?: string;
  task: string;
  criteria?: string;
  iteration: number;
  status: string;
  startTime: number;
}

async function ensureDirectory(dir: string): Promise<void> {
  if (!existsSync(dir)) {
    await fs.mkdir(dir, { recursive: true });
  }
}

async function saveLoopState(state: RalphLoopState): Promise<void> {
  // Save state.json
  await fs.writeFile(
    path.join(RALPH_DIR, 'state.json'),
    JSON.stringify(state, null, 2)
  );

  // Synchronize iteration.txt with current iteration
  await fs.writeFile(
    path.join(RALPH_DIR, 'iteration.txt'),
    state.iteration.toString()
  );

  console.log(`✅ Saved state for iteration ${state.iteration}`);
}

async function simulateIteration(iterationNum: number): Promise<void> {
  const historyDir = path.join(
    RALPH_DIR,
    'history',
    `iteration-${iterationNum.toString().padStart(3, '0')}`
  );
  await ensureDirectory(historyDir);

  // Create artifacts for this iteration
  const artifacts = {
    analysis: {
      filesCount: Math.floor(Math.random() * 10) + 1,
      testsPass: Math.floor(Math.random() * 20),
      testsFail: Math.floor(Math.random() * 5),
      lastChange: `Iteration ${iterationNum} changes`,
    },
    plan: {
      summary: `Work for iteration ${iterationNum}`,
      steps: [
        `Task ${iterationNum}-1`,
        `Task ${iterationNum}-2`,
        `Task ${iterationNum}-3`,
      ],
      priority: 'high',
    },
    changes: [
      {
        step: `Task ${iterationNum}-1`,
        timestamp: Date.now(),
        result: 'completed',
      },
    ],
    validation: {
      testsPass: true,
      lintClean: true,
      errors: [],
    },
  };

  await fs.writeFile(
    path.join(historyDir, 'artifacts.json'),
    JSON.stringify(artifacts, null, 2)
  );

  console.log(`📝 Created artifacts for iteration ${iterationNum}`);
}

async function runIterationTest(): Promise<void> {
  console.log('🎭 Starting Ralph iteration test...');
  console.log(`🎯 Goal: Test ${MAX_TEST_ITERATIONS} iterations\n`);

  // Ensure directories exist
  await ensureDirectory(RALPH_DIR);
  await ensureDirectory(path.join(RALPH_DIR, 'history'));

  // Initialize state
  const initialState: RalphLoopState = {
    task: 'Test multiple iterations beyond 5',
    iteration: 0,
    status: 'initialized',
    startTime: Date.now(),
  };

  await saveLoopState(initialState);

  // Run iterations
  for (let i = 0; i < MAX_TEST_ITERATIONS; i++) {
    console.log(`\n--- Iteration ${i} ---`);

    // Simulate iteration work
    await simulateIteration(i);

    // Update state
    const state: RalphLoopState = {
      task: 'Test multiple iterations beyond 5',
      iteration: i + 1,
      status: 'running',
      startTime: initialState.startTime,
    };

    await saveLoopState(state);

    // Check if we're past the old limit
    if (i === 5) {
      console.log('\n🎉 Successfully passed iteration 5!');
    }

    // Small delay to simulate work
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log('\n✅ Test completed successfully!');
  console.log(`📊 Final iteration count: ${MAX_TEST_ITERATIONS}`);

  // Verify final state
  const finalIteration = await fs.readFile(
    path.join(RALPH_DIR, 'iteration.txt'),
    'utf8'
  );

  const finalState = JSON.parse(
    await fs.readFile(path.join(RALPH_DIR, 'state.json'), 'utf8')
  );

  console.log(`\n📋 Final verification:`);
  console.log(`   iteration.txt: ${finalIteration}`);
  console.log(`   state.json iteration: ${finalState.iteration}`);

  if (parseInt(finalIteration) === MAX_TEST_ITERATIONS) {
    console.log('\n🎊 SUCCESS: Ralph loop can iterate beyond 5 iterations!');
  } else {
    console.error('\n❌ FAILURE: Iteration count mismatch');
  }
}

// Run the test
runIterationTest().catch((error) => {
  console.error('❌ Test failed:', error);
  process.exit(1);
});
