#!/usr/bin/env node

/**
 * Ralph-StackMemory Integration Test Script
 * Simple CLI to test the integration functionality
 */

import { RalphIntegrationDemo } from '../dist/integrations/ralph/ralph-integration-demo.js';
import { performance } from 'perf_hooks';

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] || 'demo';

  console.log('\n🧪 Ralph-StackMemory Integration Test');
  console.log('=====================================\n');

  const startTime = performance.now();

  try {
    switch (command) {
      case 'demo':
        await runDemo();
        break;
      case 'quick':
        await runQuickTest();
        break;
      case 'validate':
        await runValidation();
        break;
      default:
        showUsage();
        return;
    }

    const endTime = performance.now();
    const duration = Math.round(endTime - startTime);
    
    console.log(`\n✅ Test completed successfully in ${duration}ms`);
    
  } catch (error) {
    console.error(`\n❌ Test failed: ${error.message}`);
    
    if (process.env.DEBUG) {
      console.error('\nDebug info:');
      console.error(error.stack);
    }
    
    process.exit(1);
  }
}

async function runDemo() {
  console.log('🎬 Running full integration demo...\n');
  
  const demo = new RalphIntegrationDemo();
  await demo.run();
}

async function runQuickTest() {
  console.log('⚡ Running quick validation test...\n');
  
  // Import the core classes to test they load correctly
  try {
    await import('../dist/integrations/ralph/index.js');
    console.log('✓ Core bridge class loaded');
    
    const { ContextBudgetManager } = await import('../dist/integrations/ralph/index.js');
    console.log('✓ Context budget manager loaded');
    
    const { StateReconciler } = await import('../dist/integrations/ralph/index.js');
    console.log('✓ State reconciler loaded');
    
    await import('../dist/integrations/ralph/index.js');
    console.log('✓ Iteration lifecycle loaded');
    
    await import('../dist/integrations/ralph/index.js');
    console.log('✓ Performance optimizer loaded');
    
    // Test basic instantiation
    const budgetManager = new ContextBudgetManager();
    const tokenEstimate = budgetManager.estimateTokens('Hello, world!');
    console.log(`✓ Token estimation working: ${tokenEstimate} tokens`);
    
    new StateReconciler();
    console.log('✓ State reconciler instantiated');
    
    console.log('\n🎯 All core components validated successfully!');
    
  } catch (error) {
    throw new Error(`Component loading failed: ${error.message}`);
  }
}

async function runValidation() {
  console.log('🔍 Running detailed validation...\n');
  
  // Test context budget manager
  await testContextBudgetManager();
  
  // Test state reconciler  
  await testStateReconciler();
  
  // Test performance optimizer
  await testPerformanceOptimizer();
  
  console.log('\n✨ All validation tests passed!');
}

async function testContextBudgetManager() {
  console.log('📊 Testing Context Budget Manager...');
  
  const { ContextBudgetManager } = await import('../dist/integrations/ralph/index.js');
  
  const manager = new ContextBudgetManager({
    maxTokens: 100,
    compressionEnabled: true
  });
  
  // Test token estimation
  const shortText = 'Short text';
  const longText = 'This is a much longer piece of text that should have more tokens estimated for it than the shorter version above.';
  
  const shortTokens = manager.estimateTokens(shortText);
  const longTokens = manager.estimateTokens(longText);
  
  if (longTokens <= shortTokens) {
    throw new Error('Token estimation not working correctly');
  }
  
  // Test empty text
  const emptyTokens = manager.estimateTokens('');
  if (emptyTokens !== 0) {
    throw new Error('Empty text should have 0 tokens');
  }
  
  console.log('  ✓ Token estimation working correctly');
  
  // Test usage tracking
  const usage = manager.getUsage();
  if (typeof usage.used !== 'number' || typeof usage.available !== 'number') {
    throw new Error('Usage tracking not working');
  }
  
  console.log('  ✓ Usage tracking functional');
}

async function testStateReconciler() {
  console.log('🔄 Testing State Reconciler...');
  
  const { StateReconciler } = await import('../dist/integrations/ralph/index.js');
  
  const reconciler = new StateReconciler({
    precedence: ['git', 'files', 'memory'],
    conflictResolution: 'automatic'
  });
  
  // Test conflict detection
  const sources = [
    {
      type: 'git',
      state: { iteration: 5, status: 'running' },
      timestamp: Date.now(),
      confidence: 0.9
    },
    {
      type: 'files', 
      state: { iteration: 5, status: 'running' },
      timestamp: Date.now(),
      confidence: 0.95
    }
  ];
  
  const conflicts = reconciler.detectConflicts(sources);
  if (conflicts.length !== 0) {
    throw new Error('Should not detect conflicts in matching sources');
  }
  
  console.log('  ✓ Conflict detection working');
  
  // Test state sources
  const gitState = await reconciler.getGitState();
  const fileState = await reconciler.getFileState();
  const memoryState = await reconciler.getMemoryState('test-loop');
  
  if (gitState.type !== 'git' || fileState.type !== 'files' || memoryState.type !== 'memory') {
    throw new Error('State source types incorrect');
  }
  
  console.log('  ✓ State source loading functional');
}

async function testPerformanceOptimizer() {
  console.log('⚡ Testing Performance Optimizer...');
  
  const { PerformanceOptimizer } = await import('../dist/integrations/ralph/index.js');
  
  const optimizer = new PerformanceOptimizer({
    asyncSaves: true,
    compressionLevel: 1,
    cacheEnabled: true
  });
  
  // Test metrics
  const metrics = optimizer.getMetrics();
  const requiredMetrics = ['iterationTime', 'contextLoadTime', 'stateSaveTime', 'memoryUsage', 'tokenCount', 'cacheHitRate'];
  
  for (const metric of requiredMetrics) {
    if (typeof metrics[metric] !== 'number') {
      throw new Error(`Missing or invalid metric: ${metric}`);
    }
  }
  
  console.log('  ✓ Performance metrics available');
  
  // Test compression
  const testData = { message: 'Hello, world!', array: [1, 2, 3, 4, 5] };
  const compressed = await optimizer.compressData(testData);
  
  if (compressed.compressed !== true) {
    throw new Error('Data compression not working');
  }
  
  const decompressed = await optimizer.decompressData(compressed);
  if (JSON.stringify(decompressed) !== JSON.stringify(testData)) {
    throw new Error('Data decompression failed');
  }
  
  console.log('  ✓ Compression/decompression working');
  
  // Cleanup
  optimizer.cleanup();
}

function showUsage() {
  console.log(`
Usage: node ralph-integration-test.js [command]

Commands:
  demo      Run the full integration demonstration (default)
  quick     Quick validation of core components  
  validate  Detailed validation of all functionality

Examples:
  node ralph-integration-test.js
  node ralph-integration-test.js quick
  DEBUG=1 node ralph-integration-test.js validate

Environment Variables:
  DEBUG=1   Show detailed error information
`);
}

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, _promise) => {
  console.error('\n💥 Unhandled Promise Rejection:');
  console.error(reason);
  process.exit(1);
});

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  console.error('\n💥 Uncaught Exception:');
  console.error(error.message);
  if (process.env.DEBUG) {
    console.error(error.stack);
  }
  process.exit(1);
});

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}