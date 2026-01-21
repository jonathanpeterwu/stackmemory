#!/usr/bin/env npx tsx

/**
 * Simple Ralph Swarm Demo - Minimal database dependencies
 * Demonstrates basic swarm coordination without complex SessionManager setup
 */

import 'dotenv/config';
import { SwarmCoordinator } from '../src/integrations/ralph/swarm/swarm-coordinator.js';
import { SwarmRegistry } from '../src/integrations/ralph/monitoring/swarm-registry.js';
import { logger } from '../src/core/monitoring/logger.js';

async function runSimpleSwarm() {
  try {
    console.log('🦾 Starting Simple Ralph Swarm Demo...');

    // Initialize registry
    const registry = SwarmRegistry.getInstance();

    // Create a basic swarm coordinator without complex dependencies
    const coordinator = new SwarmCoordinator({
      maxAgents: 2,
      timeout: 30000,
      enableGitWorkflow: false, // Disable git workflow to avoid branch conflicts
      enableStackMemoryBridge: false, // Disable StackMemory integration temporarily
    });

    // Initialize coordinator
    await coordinator.initialize();

    console.log('✅ Swarm coordinator initialized');

    // Define a simple task
    const task = {
      id: 'simple-demo-task',
      description:
        'Demonstrate basic swarm functionality without database dependencies',
      type: 'demonstration' as const,
      priority: 'medium' as const,
      estimatedDuration: 30000,
      requirements: [
        'Show swarm initialization',
        'Demonstrate agent coordination',
        'Validate basic functionality',
      ],
    };

    console.log('📋 Task defined:', task.description);

    // Register the swarm
    const swarmId = registry.registerSwarm(
      coordinator,
      'Simple Demo Swarm - No Database Dependencies'
    );

    console.log('🆔 Swarm registered:', swarmId);

    // Launch with minimal configuration
    const result = await coordinator.launchSwarm(
      task.description,
      [
        {
          role: 'developer',
          specialization: 'basic-functionality',
        },
      ],
      {
        enableRalphBridge: false, // Disable Ralph bridge to avoid database issues
        enableGitWorkflow: false, // Already disabled in coordinator init
      }
    );

    console.log('🚀 Swarm launched successfully!');
    console.log('📊 Result:', {
      swarmId: result.swarmId,
      agentCount: result.agents?.length || 0,
      status: result.status,
    });

    // Show registry status
    const activeSwarms = registry.listActiveSwarms();
    console.log('📈 Active swarms:', activeSwarms.length);

    // Simulate some work
    console.log('⏳ Simulating swarm work for 5 seconds...');
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // Stop the swarm
    console.log('🛑 Stopping swarm...');
    await coordinator.stopSwarm();

    console.log('');
    console.log('🎉 Simple swarm demo completed successfully!');
    console.log('');
    console.log('✅ Demonstrated:');
    console.log('   - Basic swarm coordinator initialization');
    console.log('   - Swarm registry management');
    console.log('   - Agent configuration without database dependencies');
    console.log('   - Simple task execution workflow');
    console.log('');
    console.log('🔧 This approach bypasses:');
    console.log('   - Complex SessionManager database setup');
    console.log('   - StackMemory FrameManager initialization');
    console.log('   - Git workflow branch conflicts');
    console.log('   - Ralph-StackMemory bridge complications');
  } catch (error: unknown) {
    console.error('❌ Simple swarm demo failed:', (error as Error).message);
    logger.error('Simple swarm demo error', error as Error);
    process.exit(1);
  }
}

// Run the demo
runSimpleSwarm();
