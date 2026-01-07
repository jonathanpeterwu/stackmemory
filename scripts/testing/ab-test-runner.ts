#!/usr/bin/env node
import { MetricsCollector } from './collect-metrics.js';
import { spawn } from 'child_process';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface TestScenario {
  id: string;
  name: string;
  type: 'feature_dev' | 'bug_fix' | 'refactor' | 'complex_debug';
  description: string;
  steps: WorkflowStep[];
  expectedDuration: number; // minutes
  contextBreaks: ContextBreak[];
  complexity: 'low' | 'medium' | 'high' | 'very_high';
}

export interface WorkflowStep {
  action: string;
  command?: string;
  expectedOutput?: string;
  requiresContext?: boolean;
}

export interface ContextBreak {
  afterStep: number;
  duration: number; // minutes
  type: 'session_end' | 'interruption' | 'team_handoff';
}

export interface TestRun {
  id: string;
  scenario: TestScenario;
  variant: 'with_stackmemory' | 'without_stackmemory';
  startTime: Date;
  endTime?: Date;
  metrics: any;
  recordings: ToolCallRecording[];
  success: boolean;
  errors: string[];
}

export interface ToolCallRecording {
  timestamp: Date;
  tool: string;
  parameters: any;
  result: any;
  duration: number;
}

export class ABTestRunner {
  private collector: MetricsCollector;
  private scenarios: Map<string, TestScenario> = new Map();
  private runs: TestRun[] = [];
  private stackMemoryEnabled: boolean = false;

  constructor() {
    this.collector = new MetricsCollector();
    this.loadScenarios();
  }

  private loadScenarios(): void {
    // Define test scenarios
    const scenarios: TestScenario[] = [
      {
        id: 'multi_session_feature',
        name: 'E-commerce checkout flow',
        type: 'feature_dev',
        description:
          'Implement a complete checkout flow with payment integration',
        complexity: 'high',
        expectedDuration: 180,
        steps: [
          {
            action: 'Design checkout flow architecture',
            requiresContext: false,
          },
          { action: 'Implement cart validation', requiresContext: true },
          { action: 'Add payment gateway integration', requiresContext: true },
          { action: 'Create checkout UI components', requiresContext: true },
          { action: 'Add order confirmation', requiresContext: true },
          { action: 'Write integration tests', requiresContext: true },
        ],
        contextBreaks: [
          { afterStep: 2, duration: 480, type: 'session_end' }, // Overnight
          { afterStep: 4, duration: 60, type: 'interruption' }, // Lunch break
        ],
      },
      {
        id: 'complex_debugging',
        name: 'Performance issue in production',
        type: 'complex_debug',
        description:
          'Debug and fix a memory leak causing performance degradation',
        complexity: 'high',
        expectedDuration: 120,
        steps: [
          { action: 'Analyze performance metrics', requiresContext: false },
          { action: 'Profile memory usage', requiresContext: true },
          { action: 'Identify memory leak source', requiresContext: true },
          { action: 'Implement fix', requiresContext: true },
          { action: 'Verify fix with tests', requiresContext: true },
        ],
        contextBreaks: [{ afterStep: 3, duration: 30, type: 'team_handoff' }],
      },
      {
        id: 'large_refactoring',
        name: 'Migrate authentication system',
        type: 'refactor',
        description: 'Refactor from session-based to JWT authentication',
        complexity: 'very_high',
        expectedDuration: 360,
        steps: [
          {
            action: 'Analyze current auth implementation',
            requiresContext: false,
          },
          { action: 'Design JWT architecture', requiresContext: true },
          { action: 'Implement JWT service', requiresContext: true },
          { action: 'Migrate user sessions', requiresContext: true },
          { action: 'Update API endpoints', requiresContext: true },
          { action: 'Migrate frontend auth', requiresContext: true },
          { action: 'Add refresh token logic', requiresContext: true },
          { action: 'Update tests', requiresContext: true },
          { action: 'Performance testing', requiresContext: true },
        ],
        contextBreaks: [
          { afterStep: 2, duration: 480, type: 'session_end' },
          { afterStep: 4, duration: 480, type: 'session_end' },
          { afterStep: 6, duration: 60, type: 'interruption' },
          { afterStep: 7, duration: 480, type: 'session_end' },
        ],
      },
      {
        id: 'rapid_bug_fixes',
        name: 'Fix 5 related bugs',
        type: 'bug_fix',
        description: 'Fix multiple related bugs in the user registration flow',
        complexity: 'medium',
        expectedDuration: 90,
        steps: [
          { action: 'Fix email validation bug', requiresContext: false },
          { action: 'Fix password strength checker', requiresContext: true },
          { action: 'Fix duplicate user check', requiresContext: true },
          { action: 'Fix confirmation email sending', requiresContext: true },
          { action: 'Fix redirect after registration', requiresContext: true },
        ],
        contextBreaks: [
          { afterStep: 1, duration: 15, type: 'interruption' },
          { afterStep: 2, duration: 15, type: 'interruption' },
          { afterStep: 3, duration: 15, type: 'interruption' },
          { afterStep: 4, duration: 15, type: 'interruption' },
        ],
      },
    ];

    scenarios.forEach((scenario) => {
      this.scenarios.set(scenario.id, scenario);
    });
  }

  async initialize(): Promise<void> {
    await this.collector.initialize();
  }

  async enableStackMemory(): Promise<void> {
    console.log('Enabling StackMemory...');
    this.stackMemoryEnabled = true;

    // Start StackMemory daemon if not running
    try {
      await this.executeCommand('stackmemory-daemon status');
    } catch {
      await this.executeCommand('stackmemory-daemon start');
    }
  }

  async disableStackMemory(): Promise<void> {
    console.log('Disabling StackMemory...');
    this.stackMemoryEnabled = false;

    // Stop StackMemory daemon
    try {
      await this.executeCommand('stackmemory-daemon stop');
    } catch {
      // Ignore if already stopped
    }
  }

  private executeCommand(command: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, { shell: true });
      let output = '';
      let error = '';

      child.stdout.on('data', (data) => {
        output += data.toString();
      });

      child.stderr.on('data', (data) => {
        error += data.toString();
      });

      child.on('close', (code) => {
        if (code === 0) {
          resolve(output);
        } else {
          reject(new Error(error || `Command failed with code ${code}`));
        }
      });
    });
  }

  async runScenario(
    scenarioId: string,
    variant: 'with_stackmemory' | 'without_stackmemory'
  ): Promise<TestRun> {
    const scenario = this.scenarios.get(scenarioId);
    if (!scenario) {
      throw new Error(`Scenario ${scenarioId} not found`);
    }

    console.log(`\nRunning scenario: ${scenario.name} (${variant})`);
    console.log(`Expected duration: ${scenario.expectedDuration} minutes`);
    console.log(`Complexity: ${scenario.complexity}`);
    console.log(`Context breaks: ${scenario.contextBreaks.length}`);

    // Enable/disable StackMemory based on variant
    if (variant === 'with_stackmemory') {
      await this.enableStackMemory();
    } else {
      await this.disableStackMemory();
    }

    const runId = `${scenarioId}-${variant}-${Date.now()}`;
    const sessionId = await this.collector.startSession(variant);

    const run: TestRun = {
      id: runId,
      scenario,
      variant,
      startTime: new Date(),
      metrics: {},
      recordings: [],
      success: false,
      errors: [],
    };

    try {
      // Execute scenario steps
      for (let i = 0; i < scenario.steps.length; i++) {
        const step = scenario.steps[i];
        console.log(`\nStep ${i + 1}/${scenario.steps.length}: ${step.action}`);

        // Simulate step execution
        await this.executeStep(step, sessionId, run);

        // Check for context break
        const contextBreak = scenario.contextBreaks.find(
          (cb) => cb.afterStep === i + 1
        );
        if (contextBreak) {
          console.log(
            `\nContext break: ${contextBreak.type} for ${contextBreak.duration} minutes`
          );
          await this.simulateContextBreak(contextBreak, sessionId);
        }
      }

      run.success = true;
    } catch (error: any) {
      console.error(`Scenario failed: ${error.message}`);
      run.errors.push(error.message);
      this.collector.trackError(sessionId, error);
    }

    // Collect final metrics
    run.endTime = new Date();
    run.metrics = await this.collector.endSession(sessionId);

    // Save run results
    this.runs.push(run);
    await this.saveRun(run);

    return run;
  }

  private async executeStep(
    step: WorkflowStep,
    sessionId: string,
    run: TestRun
  ): Promise<void> {
    const startTime = Date.now();

    // Track tool call
    this.collector.trackToolCall(sessionId, 'execute_step');

    // If step requires context and we're testing with StackMemory
    if (step.requiresContext && this.stackMemoryEnabled) {
      const contextTime =
        await this.collector.measureContextReestablishment(sessionId);
      console.log(`  Context retrieved in ${(contextTime / 1000).toFixed(2)}s`);
    }

    // Simulate step execution with command if provided
    if (step.command) {
      try {
        const output = await this.executeCommand(step.command);

        // Record tool call
        run.recordings.push({
          timestamp: new Date(),
          tool: 'command',
          parameters: { command: step.command },
          result: output,
          duration: Date.now() - startTime,
        });
      } catch (error: any) {
        this.collector.trackError(sessionId, error);
        throw error;
      }
    } else {
      // Simulate work being done
      await this.simulateWork(2000 + Math.random() * 3000);
    }

    // Randomly simulate decisions and frame creation
    if (Math.random() > 0.5) {
      this.collector.trackFrameCreation(sessionId, `frame-${Date.now()}`);
    }

    if (Math.random() > 0.7) {
      this.collector.trackDecision(sessionId, `Decision for ${step.action}`);
    }

    console.log(
      `  Step completed in ${((Date.now() - startTime) / 1000).toFixed(2)}s`
    );
  }

  private async simulateContextBreak(
    contextBreak: ContextBreak,
    sessionId: string
  ): Promise<void> {
    // Simulate time passing
    console.log(`  Simulating ${contextBreak.duration} minute break...`);

    if (contextBreak.type === 'session_end' && this.stackMemoryEnabled) {
      // Simulate session end with StackMemory
      this.collector.trackFrameClosure(sessionId, 'session-frame', true);
    }

    // In real testing, we would actually wait or simulate the time passing
    await this.simulateWork(1000);

    // After break, measure context reestablishment
    if (this.stackMemoryEnabled) {
      const reestablishTime =
        await this.collector.measureContextReestablishment(sessionId);
      console.log(
        `  Context reestablished in ${(reestablishTime / 1000).toFixed(2)}s`
      );
    } else {
      // Without StackMemory, simulate manual context reestablishment
      console.log(`  Manual context reestablishment required (est. 5 minutes)`);
      this.collector.trackRework(sessionId);
    }
  }

  private simulateWork(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async runAllScenarios(): Promise<void> {
    console.log('='.repeat(60));
    console.log('Starting A/B Test Suite');
    console.log('='.repeat(60));

    for (const scenario of this.scenarios.values()) {
      // Run without StackMemory
      await this.runScenario(scenario.id, 'without_stackmemory');

      // Run with StackMemory
      await this.runScenario(scenario.id, 'with_stackmemory');
    }

    await this.generateComparison();
  }

  async generateComparison(): Promise<void> {
    const withStackMemory = this.runs.filter(
      (r) => r.variant === 'with_stackmemory'
    );
    const withoutStackMemory = this.runs.filter(
      (r) => r.variant === 'without_stackmemory'
    );

    console.log('\n' + '='.repeat(60));
    console.log('A/B Test Results Summary');
    console.log('='.repeat(60));

    for (const scenario of this.scenarios.values()) {
      const withRun = withStackMemory.find(
        (r) => r.scenario.id === scenario.id
      );
      const withoutRun = withoutStackMemory.find(
        (r) => r.scenario.id === scenario.id
      );

      if (withRun && withoutRun) {
        console.log(`\n${scenario.name}:`);
        console.log(
          `  Without StackMemory: ${((withoutRun.metrics.completionTime || 0) / 1000 / 60).toFixed(2)} min`
        );
        console.log(
          `  With StackMemory: ${((withRun.metrics.completionTime || 0) / 1000 / 60).toFixed(2)} min`
        );

        const improvement =
          ((withoutRun.metrics.completionTime -
            withRun.metrics.completionTime) /
            withoutRun.metrics.completionTime) *
          100;
        console.log(`  Improvement: ${improvement.toFixed(1)}%`);
      }
    }

    // Generate detailed report
    await this.collector.generateReport('./test-results/ab-test-report.md');
  }

  private async saveRun(run: TestRun): Promise<void> {
    const outputDir = './test-results/runs';
    await fs.mkdir(outputDir, { recursive: true });

    const filename = path.join(outputDir, `${run.id}.json`);
    await fs.writeFile(filename, JSON.stringify(run, null, 2));

    console.log(`Run saved to: ${filename}`);
  }

  async runSpecificScenario(scenarioId: string): Promise<void> {
    if (!this.scenarios.has(scenarioId)) {
      console.error(`Scenario '${scenarioId}' not found`);
      console.log('Available scenarios:');
      for (const [id, scenario] of this.scenarios) {
        console.log(`  - ${id}: ${scenario.name}`);
      }
      return;
    }

    // Run both variants
    await this.runScenario(scenarioId, 'without_stackmemory');
    await this.runScenario(scenarioId, 'with_stackmemory');

    await this.generateComparison();
  }
}

// CLI interface
if (import.meta.url === `file://${process.argv[1]}`) {
  const runner = new ABTestRunner();

  async function main() {
    await runner.initialize();

    const command = process.argv[2];
    const scenarioId = process.argv[3];

    switch (command) {
      case 'all':
        await runner.runAllScenarios();
        break;

      case 'scenario':
        if (!scenarioId) {
          console.error('Please specify a scenario ID');
          process.exit(1);
        }
        await runner.runSpecificScenario(scenarioId);
        break;

      case 'list':
        console.log('Available scenarios:');
        console.log('  - multi_session_feature: E-commerce checkout flow');
        console.log('  - complex_debugging: Performance issue in production');
        console.log('  - large_refactoring: Migrate authentication system');
        console.log('  - rapid_bug_fixes: Fix 5 related bugs');
        break;

      default:
        console.log(
          'Usage: ab-test-runner.ts [all|scenario|list] [scenario-id]'
        );
        console.log('');
        console.log('Commands:');
        console.log('  all      - Run all test scenarios');
        console.log('  scenario - Run a specific scenario');
        console.log('  list     - List available scenarios');
    }

    process.exit(0);
  }

  main().catch(console.error);
}
