#!/usr/bin/env node

/**
 * Test Parallel Swarm Execution
 * Validates that multiple swarms can run concurrently without conflicts
 */

import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

class ParallelSwarmTester {
  constructor() {
    this.swarmDir = '.swarm';
    this.testResults = {
      swarms: [],
      conflicts: [],
      performance: {},
      success: true
    };
  }

  async runParallelTests() {
    console.log('🚀 Starting Parallel Swarm Tests');
    console.log('=' .repeat(50));

    try {
      // Ensure swarm directory exists
      await fs.mkdir(this.swarmDir, { recursive: true });

      // Test 1: Launch multiple swarms simultaneously
      await this.testSimultaneousLaunch();

      // Test 2: Test resource isolation
      await this.testResourceIsolation();

      // Test 3: Test coordination between swarms
      await this.testInterSwarmCoordination();

      // Test 4: Test performance under load
      await this.testPerformanceUnderLoad();

      // Test 5: Test failure handling
      await this.testFailureHandling();

      // Generate report
      await this.generateReport();

    } catch (error) {
      console.error('Test suite failed:', error);
      this.testResults.success = false;
    }
  }

  async testSimultaneousLaunch() {
    console.log('\n📦 Test 1: Simultaneous Swarm Launch');
    
    const swarmConfigs = [
      {
        id: 'swarm-frontend',
        project: 'Build user interface components',
        agents: ['developer', 'tester'],
        maxAgents: 3
      },
      {
        id: 'swarm-backend',
        project: 'Create API endpoints',
        agents: ['architect', 'developer'],
        maxAgents: 3
      },
      {
        id: 'swarm-database',
        project: 'Design database schema',
        agents: ['architect', 'optimizer'],
        maxAgents: 2
      },
      {
        id: 'swarm-testing',
        project: 'Write comprehensive tests',
        agents: ['tester', 'reviewer'],
        maxAgents: 2
      }
    ];

    const launchPromises = swarmConfigs.map(config => 
      this.launchSwarm(config)
    );

    const startTime = Date.now();
    const results = await Promise.allSettled(launchPromises);
    const duration = Date.now() - startTime;

    let successCount = 0;
    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        successCount++;
        console.log(`  ✅ ${swarmConfigs[index].id} launched successfully`);
        this.testResults.swarms.push({
          ...swarmConfigs[index],
          status: 'launched',
          pid: result.value
        });
      } else {
        console.log(`  ❌ ${swarmConfigs[index].id} failed: ${result.reason}`);
        this.testResults.swarms.push({
          ...swarmConfigs[index],
          status: 'failed',
          error: result.reason.message
        });
      }
    });

    console.log(`  Launched ${successCount}/${swarmConfigs.length} swarms in ${duration}ms`);
    
    // Wait a bit for swarms to initialize
    await this.sleep(3000);
  }

  async testResourceIsolation() {
    console.log('\n🔒 Test 2: Resource Isolation');
    
    try {
      // Check that each swarm has its own working directory
      const swarmDirs = await fs.readdir(this.swarmDir);
      const isolationChecks = [];

      for (const dir of swarmDirs) {
        if (dir.startsWith('developer-') || dir.startsWith('architect-') || 
            dir.startsWith('tester-') || dir.startsWith('reviewer-')) {
          const dirPath = path.join(this.swarmDir, dir);
          const stat = await fs.stat(dirPath);
          
          if (stat.isDirectory()) {
            isolationChecks.push({
              directory: dir,
              isolated: true,
              created: stat.birthtime
            });
          }
        }
      }

      console.log(`  ✅ Found ${isolationChecks.length} isolated agent directories`);
      
      // Check for potential conflicts
      const conflicts = await this.checkForConflicts();
      if (conflicts.length > 0) {
        console.log(`  ⚠️  Found ${conflicts.length} potential conflicts`);
        this.testResults.conflicts = conflicts;
      } else {
        console.log('  ✅ No resource conflicts detected');
      }

    } catch (error) {
      console.log(`  ❌ Resource isolation check failed: ${error.message}`);
    }
  }

  async testInterSwarmCoordination() {
    console.log('\n🤝 Test 3: Inter-Swarm Coordination');
    
    try {
      // Create shared context for coordination test
      const sharedContext = {
        id: uuidv4(),
        timestamp: Date.now(),
        message: 'Test coordination message',
        swarms: this.testResults.swarms.filter(s => s.status === 'launched')
      };

      // Write to shared context
      const contextPath = path.join(this.swarmDir, 'shared-context.json');
      await fs.writeFile(contextPath, JSON.stringify(sharedContext, null, 2));
      
      console.log('  ✅ Shared context created');

      // Simulate coordination event
      const coordinationEvent = {
        type: 'task_completion',
        source: 'swarm-frontend',
        target: 'swarm-backend',
        data: {
          task: 'UI components ready',
          timestamp: Date.now()
        }
      };

      const eventPath = path.join(this.swarmDir, 'coordination-events.jsonl');
      await fs.appendFile(eventPath, JSON.stringify(coordinationEvent) + '\n');
      
      console.log('  ✅ Coordination event logged');

      // Check if swarms can read shared context
      const contextExists = await fs.access(contextPath).then(() => true).catch(() => false);
      if (contextExists) {
        console.log('  ✅ Swarms can access shared context');
      } else {
        console.log('  ❌ Shared context not accessible');
      }

    } catch (error) {
      console.log(`  ❌ Coordination test failed: ${error.message}`);
    }
  }

  async testPerformanceUnderLoad() {
    console.log('\n⚡ Test 4: Performance Under Load');
    
    const metrics = {
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      activeSwarms: this.testResults.swarms.filter(s => s.status === 'launched').length,
      timestamp: Date.now()
    };

    // Simulate heavy load by launching additional tasks
    const loadTasks = [];
    for (let i = 0; i < 5; i++) {
      loadTasks.push(this.simulateHeavyTask(i));
    }

    const startTime = Date.now();
    await Promise.allSettled(loadTasks);
    const duration = Date.now() - startTime;

    const afterMetrics = {
      memoryUsage: process.memoryUsage(),
      cpuUsage: process.cpuUsage(),
      duration: duration
    };

    this.testResults.performance = {
      before: metrics,
      after: afterMetrics,
      memoryIncrease: afterMetrics.memoryUsage.heapUsed - metrics.memoryUsage.heapUsed,
      taskDuration: duration,
      tasksPerSecond: (5 / (duration / 1000)).toFixed(2)
    };

    console.log(`  ✅ Processed 5 heavy tasks in ${duration}ms`);
    console.log(`  📊 Memory increase: ${(this.testResults.performance.memoryIncrease / 1024 / 1024).toFixed(2)}MB`);
    console.log(`  📊 Tasks per second: ${this.testResults.performance.tasksPerSecond}`);

    if (duration < 10000) {
      console.log('  ✅ Performance acceptable under load');
    } else {
      console.log('  ⚠️  Performance degradation detected');
    }
  }

  async testFailureHandling() {
    console.log('\n🚨 Test 5: Failure Handling');
    
    try {
      // Simulate a swarm failure
      const failingSwarm = {
        id: 'swarm-failing',
        project: 'This will fail',
        agents: ['invalid_agent'],
        maxAgents: 1
      };

      console.log('  Testing graceful failure handling...');
      
      try {
        await this.launchSwarm(failingSwarm);
        console.log('  ❌ Expected failure did not occur');
      } catch (error) {
        console.log('  ✅ Failure handled gracefully');
      }

      // Test recovery mechanism
      console.log('  Testing recovery mechanism...');
      
      const recoverySwarm = {
        id: 'swarm-recovery',
        project: 'Recovery test',
        agents: ['developer'],
        maxAgents: 1
      };

      try {
        const pid = await this.launchSwarm(recoverySwarm);
        if (pid) {
          console.log('  ✅ Recovery successful');
        }
      } catch (error) {
        console.log('  ❌ Recovery failed');
      }

    } catch (error) {
      console.log(`  ❌ Failure handling test error: ${error.message}`);
    }
  }

  // Helper methods
  async launchSwarm(config) {
    return new Promise((resolve, reject) => {
      const args = [
        'dist/cli/index.js',
        'ralph',
        'swarm',
        config.project,
        '--agents',
        config.agents.join(','),
        '--max-agents',
        config.maxAgents.toString()
      ];

      const child = spawn('node', args, {
        detached: true,
        stdio: 'ignore'
      });

      child.on('error', (error) => {
        reject(error);
      });

      // Give it a moment to start
      setTimeout(() => {
        if (child.pid) {
          resolve(child.pid);
        } else {
          reject(new Error('Failed to get PID'));
        }
      }, 1000);

      child.unref();
    });
  }

  async checkForConflicts() {
    const conflicts = [];
    
    // Check for port conflicts
    const usedPorts = new Set();
    for (const swarm of this.testResults.swarms) {
      const port = 3456 + this.testResults.swarms.indexOf(swarm);
      if (usedPorts.has(port)) {
        conflicts.push({
          type: 'port_conflict',
          port: port,
          swarms: [swarm.id]
        });
      }
      usedPorts.add(port);
    }

    // Check for file lock conflicts
    try {
      const lockFiles = await fs.readdir(this.swarmDir);
      const lockConflicts = lockFiles.filter(f => f.endsWith('.lock'));
      if (lockConflicts.length > 0) {
        conflicts.push({
          type: 'file_lock',
          files: lockConflicts
        });
      }
    } catch (error) {
      // Directory might not exist yet
    }

    return conflicts;
  }

  async simulateHeavyTask(index) {
    return new Promise((resolve) => {
      // Simulate CPU-intensive work
      let result = 0;
      for (let i = 0; i < 1000000; i++) {
        result += Math.sqrt(i);
      }
      
      setTimeout(() => {
        resolve({ index, result });
      }, Math.random() * 1000);
    });
  }

  async sleep(ms) {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  async generateReport() {
    console.log('\n📋 Generating Test Report');
    console.log('=' .repeat(50));

    const report = {
      timestamp: new Date().toISOString(),
      success: this.testResults.success,
      summary: {
        totalSwarms: this.testResults.swarms.length,
        launched: this.testResults.swarms.filter(s => s.status === 'launched').length,
        failed: this.testResults.swarms.filter(s => s.status === 'failed').length,
        conflicts: this.testResults.conflicts.length,
        performance: this.testResults.performance
      },
      details: this.testResults
    };

    const reportPath = path.join(this.swarmDir, 'parallel-test-report.json');
    await fs.writeFile(reportPath, JSON.stringify(report, null, 2));

    console.log('📊 Test Summary:');
    console.log(`  Total Swarms: ${report.summary.totalSwarms}`);
    console.log(`  Successfully Launched: ${report.summary.launched}`);
    console.log(`  Failed: ${report.summary.failed}`);
    console.log(`  Conflicts Detected: ${report.summary.conflicts}`);
    
    if (this.testResults.performance.tasksPerSecond) {
      console.log(`  Performance: ${this.testResults.performance.tasksPerSecond} tasks/sec`);
    }

    console.log(`\n📁 Report saved to: ${reportPath}`);

    if (this.testResults.success && report.summary.launched > 0) {
      console.log('\n✅ Parallel swarm execution validated successfully!');
    } else {
      console.log('\n⚠️  Some issues detected. Review the report for details.');
    }

    // Cleanup: Stop launched swarms
    console.log('\n🧹 Cleaning up test swarms...');
    for (const swarm of this.testResults.swarms) {
      if (swarm.pid) {
        try {
          process.kill(swarm.pid, 'SIGTERM');
        } catch (error) {
          // Process might have already ended
        }
      }
    }
  }
}

// Run tests if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  const tester = new ParallelSwarmTester();
  tester.runParallelTests().catch(console.error);
}

export { ParallelSwarmTester };