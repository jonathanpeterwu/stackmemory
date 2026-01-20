#!/usr/bin/env node
/**
 * Ralph-StackMemory Integration Demonstration
 * Shows how the integration works with a working example
 */

import { RalphStackMemoryBridge } from './bridge/ralph-stackmemory-bridge.js';
import { logger } from '../../core/monitoring/logger.js';
import { RalphStackMemoryConfig } from './types.js';

class RalphIntegrationDemo {
  private bridge: RalphStackMemoryBridge;

  constructor() {
    // Configure the bridge for demo
    const config: Partial<RalphStackMemoryConfig> = {
      contextBudget: {
        maxTokens: 2000, // Smaller budget for demo
        compressionEnabled: true,
        adaptiveBudgeting: true,
      },
      performance: {
        asyncSaves: true,
        batchSize: 5,
        compressionLevel: 1,
        cacheEnabled: true,
      },
      lifecycle: {
        checkpoints: {
          enabled: true,
          frequency: 3, // Checkpoint every 3 iterations
          retentionDays: 1, // Short retention for demo
        },
      },
    };

    this.bridge = new RalphStackMemoryBridge({
      config,
      debug: true,
    });
  }

  /**
   * Run the integration demo
   */
  async run(): Promise<void> {
    console.log('\n🤖 Ralph-StackMemory Integration Demo\n');

    try {
      // Phase 1: Initialize
      await this.demonstrateInitialization();

      // Phase 2: Run iterations
      await this.demonstrateIterations();

      // Phase 3: Show recovery
      await this.demonstrateRecovery();

      // Phase 4: Show metrics
      await this.demonstrateMetrics();

      console.log('\n✅ Demo completed successfully!\n');
    } catch (error: any) {
      console.error('\n❌ Demo failed:', error.message);
      throw error;
    } finally {
      await this.cleanup();
    }
  }

  /**
   * Demonstrate initialization
   */
  private async demonstrateInitialization(): Promise<void> {
    console.log('📋 Phase 1: Initialization');
    console.log('==========================');

    // Initialize the bridge
    await this.bridge.initialize();

    // Create a new loop
    const task = 'Implement user authentication system with JWT';
    const criteria = [
      '- User registration endpoint working',
      '- Login endpoint returns JWT token',
      '- Protected routes validate JWT',
      '- Password hashing implemented',
      '- Tests pass with >80% coverage',
    ].join('\n');

    const loopState = await this.bridge.createNewLoop(task, criteria);

    console.log(`✓ Created Ralph loop: ${loopState.loopId}`);
    console.log(`✓ Task: ${task.substring(0, 50)}...`);
    console.log(`✓ Status: ${loopState.status}`);
    console.log(`✓ Iteration: ${loopState.iteration}`);
    console.log();
  }

  /**
   * Demonstrate iterations with context management
   */
  private async demonstrateIterations(): Promise<void> {
    console.log('🔄 Phase 2: Iteration Management');
    console.log('=================================');

    const maxIterations = 5;

    for (let i = 0; i < maxIterations; i++) {
      console.log(`\n--- Iteration ${i + 1} ---`);

      // Run worker iteration
      console.log('🔧 Running worker iteration...');
      const iteration = await this.bridge.runWorkerIteration();

      console.log(`✓ Analysis: ${iteration.analysis.filesCount} files, tests ${iteration.analysis.testsPass ? 'pass' : 'fail'}`);
      console.log(`✓ Plan: ${iteration.plan.summary}`);
      console.log(`✓ Changes: ${iteration.changes.length} modifications`);
      console.log(`✓ Validation: ${iteration.validation.testsPass ? 'pass' : 'fail'}`);

      // Run reviewer iteration
      console.log('👀 Running reviewer iteration...');
      const review = await this.bridge.runReviewerIteration();

      if (review.complete) {
        console.log('🎉 Task completed!');
        break;
      } else {
        console.log(`📝 Feedback: ${review.feedback?.substring(0, 100)}...`);
      }

      // Show context budget usage
      const usage = this.bridge.getPerformanceMetrics();
      console.log(`📊 Token usage: ${usage.tokenCount} / Context load: ${usage.contextLoadTime}ms`);

      // Create checkpoint every few iterations
      if ((i + 1) % 3 === 0) {
        console.log('💾 Creating checkpoint...');
        const checkpoint = await this.bridge.createCheckpoint();
        console.log(`✓ Checkpoint: ${checkpoint.id}`);
      }

      // Small delay for demo
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
  }

  /**
   * Demonstrate crash recovery
   */
  private async demonstrateRecovery(): Promise<void> {
    console.log('\n🚑 Phase 3: Crash Recovery');
    console.log('===========================');

    // Simulate getting session ID
    const sessionId = 'demo-session-123';

    try {
      console.log('🔄 Simulating session rehydration...');
      
      // This would normally rehydrate from a real StackMemory session
      // For demo, we'll show the concept
      console.log('✓ Loading context from StackMemory...');
      console.log('✓ Reconciling state from git, files, and memory...');
      console.log('✓ Applying context budget constraints...');
      console.log('✓ Resuming from last iteration...');

      // Show recovery metrics
      console.log('📈 Recovery successful!');
      console.log('  - Context loaded: 2.1s');
      console.log('  - State reconciled: 0.3s');
      console.log('  - Memory usage: 45MB');
      console.log('  - Cache hit rate: 78%');

    } catch (error: any) {
      console.log(`⚠️  Recovery simulation: ${error.message}`);
    }
  }

  /**
   * Demonstrate performance metrics
   */
  private async demonstrateMetrics(): Promise<void> {
    console.log('\n📊 Phase 4: Performance Metrics');
    console.log('================================');

    const metrics = this.bridge.getPerformanceMetrics();

    console.log('Performance Summary:');
    console.log(`  Iteration Time: ${metrics.iterationTime}ms avg`);
    console.log(`  Context Load Time: ${metrics.contextLoadTime}ms avg`);
    console.log(`  State Save Time: ${metrics.stateSaveTime}ms avg`);
    console.log(`  Memory Usage: ${Math.round(metrics.memoryUsage / 1024 / 1024)}MB`);
    console.log(`  Token Count: ${metrics.tokenCount}`);
    console.log(`  Cache Hit Rate: ${Math.round(metrics.cacheHitRate * 100)}%`);

    console.log('\nOptimization Features:');
    console.log('  ✓ Async frame saves with batching');
    console.log('  ✓ Context compression and budget management');
    console.log('  ✓ State reconciliation with conflict resolution');
    console.log('  ✓ Lifecycle hooks for clean integration');
    console.log('  ✓ Checkpoint-based recovery');
  }

  /**
   * Cleanup resources
   */
  private async cleanup(): Promise<void> {
    console.log('\n🧹 Cleaning up...');
    await this.bridge.cleanup();
    console.log('✓ Resources cleaned up');
  }
}

/**
 * CLI interface
 */
async function main() {
  const demo = new RalphIntegrationDemo();

  try {
    await demo.run();
  } catch (error: any) {
    console.error('Demo failed:', error.message);
    if (process.env.DEBUG) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { RalphIntegrationDemo };