#!/usr/bin/env tsx
/**
 * Test script to verify swarm orchestration fixes
 */

import { SwarmCoordinator } from '../src/integrations/ralph/swarm/swarm-coordinator.js';
import { RalphStackMemoryBridge } from '../src/integrations/ralph/bridge/ralph-stackmemory-bridge.js';
import { GitWorkflowManager } from '../src/integrations/ralph/swarm/git-workflow-manager.js';
import { Agent, SwarmTask } from '../src/integrations/ralph/types.js';
import { v4 as uuidv4 } from 'uuid';

async function testDatabaseOptionalFix() {
  console.log('\n1. Testing database optional fix...');

  try {
    // Test 1: Create bridge WITHOUT database requirement
    const bridgeWithoutDb = new RalphStackMemoryBridge({
      useStackMemory: false, // This should prevent database error
    });

    await bridgeWithoutDb.initialize({
      task: 'Test task without database',
      criteria: 'Test criteria',
    });

    console.log(
      '✅ Bridge initialized successfully without database requirement'
    );
  } catch (error: any) {
    console.error(
      '❌ Failed to initialize bridge without database:',
      error.message
    );
    return false;
  }

  return true;
}

async function testGitBranchConflictFix() {
  console.log('\n2. Testing git branch conflict fix...');

  const gitManager = new GitWorkflowManager({
    enableGitWorkflow: true,
    branchStrategy: 'agent',
  });

  const mockAgent: Agent = {
    id: uuidv4(),
    role: 'developer',
    status: 'active',
    capabilities: ['coding'],
    workingDirectory: '.swarm/test',
    currentTask: null,
    performance: {
      tasksCompleted: 0,
      successRate: 1.0,
      averageTaskTime: 0,
      driftDetected: false,
      lastFreshStart: Date.now(),
    },
    coordination: {
      communicationStyle: 'collaborative',
      conflictResolution: 'defer_to_expertise',
      collaborationPreferences: [],
    },
  };

  const mockTask: SwarmTask = {
    id: uuidv4(),
    type: 'implementation',
    title: 'implement-core-feature',
    description: 'Test task',
    priority: 1,
    estimatedEffort: 'medium',
    requiredRoles: ['developer'],
    dependencies: [],
    acceptanceCriteria: ['Test passes'],
  };

  try {
    // Initialize workflow twice with same agent/task (should handle existing branch)
    await gitManager.initializeAgentWorkflow(mockAgent, mockTask);
    console.log('✅ First branch initialization successful');

    // Try again with same task (should handle existing branch gracefully)
    await gitManager.initializeAgentWorkflow(mockAgent, mockTask);
    console.log(
      '✅ Second branch initialization handled existing branch gracefully'
    );
  } catch (error: any) {
    console.error('❌ Git branch conflict handling failed:', error.message);
    return false;
  }

  return true;
}

async function testStopSwarmMethod() {
  console.log('\n3. Testing stopSwarm method...');

  const coordinator = new SwarmCoordinator({
    maxAgents: 5,
    coordinationInterval: 30000,
  });

  try {
    // Initialize coordinator (minimal setup for testing)
    // Note: We're just testing the method exists and runs without errors

    // Verify stopSwarm method exists
    if (typeof coordinator.stopSwarm !== 'function') {
      console.error('❌ stopSwarm method does not exist');
      return false;
    }

    // Call stopSwarm (should handle empty state gracefully)
    await coordinator.stopSwarm();
    console.log('✅ stopSwarm method executed successfully');
  } catch (error: any) {
    console.error('❌ stopSwarm method failed:', error.message);
    return false;
  }

  return true;
}

async function main() {
  console.log('Testing Swarm Orchestration Fixes');
  console.log('==================================');

  let allTestsPassed = true;

  // Test 1: Database optional fix
  const test1 = await testDatabaseOptionalFix();
  allTestsPassed = allTestsPassed && test1;

  // Test 2: Git branch conflict fix
  const test2 = await testGitBranchConflictFix();
  allTestsPassed = allTestsPassed && test2;

  // Test 3: stopSwarm method
  const test3 = await testStopSwarmMethod();
  allTestsPassed = allTestsPassed && test3;

  // Summary
  console.log('\n==================================');
  if (allTestsPassed) {
    console.log('✅ All tests passed! Fixes are working correctly.');
    process.exit(0);
  } else {
    console.log('❌ Some tests failed. Please review the fixes.');
    process.exit(1);
  }
}

// Run tests
main().catch((error) => {
  console.error('Test script error:', error);
  process.exit(1);
});
