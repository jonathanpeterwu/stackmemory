#!/usr/bin/env node

import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { fileURLToPath } from 'url';

class RalphLoop {
  constructor(options = {}) {
    this.baseDir = options.baseDir || '.ralph';
    this.maxIterations = options.maxIterations || 50;
    this.verbose = options.verbose || false;
    
    this.paths = {
      task: path.join(this.baseDir, 'task.md'),
      criteria: path.join(this.baseDir, 'completion-criteria.md'),
      iteration: path.join(this.baseDir, 'iteration.txt'),
      feedback: path.join(this.baseDir, 'feedback.txt'),
      state: path.join(this.baseDir, 'state.json'),
      complete: path.join(this.baseDir, 'work-complete.txt'),
      progress: path.join(this.baseDir, 'progress.jsonl'),
      history: path.join(this.baseDir, 'history')
    };
  }

  async initialize(task, criteria) {
    // Create directory structure
    fs.mkdirSync(this.baseDir, { recursive: true });
    fs.mkdirSync(this.paths.history, { recursive: true });
    
    // Initialize files
    fs.writeFileSync(this.paths.task, task);
    fs.writeFileSync(this.paths.criteria, criteria);
    fs.writeFileSync(this.paths.iteration, '0');
    fs.writeFileSync(this.paths.feedback, '');
    
    // Initial state
    const state = {
      startTime: Date.now(),
      task: task.substring(0, 100),
      status: 'initialized'
    };
    fs.writeFileSync(this.paths.state, JSON.stringify(state, null, 2));
    
    this.log('Ralph Loop initialized');
  }

  async runWorkerIteration() {
    const iteration = this.getCurrentIteration();
    const task = fs.readFileSync(this.paths.task, 'utf8');
    const feedback = this.getFeedback();
    
    this.log(`Worker iteration ${iteration} starting...`);
    
    // Step 1: Analyze current state (fresh context)
    const analysis = await this.analyzeCurrentState();
    
    // Step 2: Plan based on task and feedback
    const plan = await this.createPlan(task, feedback, analysis);
    
    // Step 3: Execute changes
    const changes = await this.executeChanges(plan);
    
    // Step 4: Validate changes
    const validation = await this.validateChanges();
    
    // Step 5: Save iteration artifacts
    await this.saveIterationArtifacts(iteration, {
      analysis,
      plan,
      changes,
      validation
    });
    
    // Step 6: Commit changes
    this.commitChanges(iteration, plan.summary);
    
    return {
      iteration,
      changes: changes.length,
      validation
    };
  }

  async runReviewerIteration() {
    const iteration = this.getCurrentIteration();
    const task = fs.readFileSync(this.paths.task, 'utf8');
    const criteria = fs.readFileSync(this.paths.criteria, 'utf8');
    
    this.log(`Reviewer iteration ${iteration} evaluating...`);
    
    // Fresh evaluation of current state
    const evaluation = await this.evaluateAgainstCriteria(criteria);
    
    if (evaluation.complete) {
      fs.writeFileSync(this.paths.complete, 'true');
      this.log('Task completed successfully!');
      return { complete: true };
    }
    
    // Generate feedback for next iteration
    const feedback = this.generateFeedback(evaluation);
    fs.writeFileSync(this.paths.feedback, feedback);
    
    // Increment iteration
    this.incrementIteration();
    
    return {
      complete: false,
      feedback: feedback.substring(0, 200)
    };
  }

  async analyzeCurrentState() {
    // Simulate fresh analysis of codebase
    const files = this.scanRelevantFiles();
    const tests = this.getTestStatus();
    const lastCommit = this.getLastCommit();
    
    return {
      filesCount: files.length,
      testsPass: tests.passing,
      testsFail: tests.failing,
      lastChange: lastCommit
    };
  }

  async createPlan(_task, feedback, _analysis) {
    // In real implementation, this would use an LLM
    // Here we simulate planning based on feedback
    const needsWork = feedback.includes('failing') || 
                      feedback.includes('incomplete') ||
                      feedback === '';
    
    return {
      summary: `Iteration work based on: ${feedback.substring(0, 50)}`,
      steps: needsWork ? ['Fix issues', 'Add features', 'Update tests'] : ['Polish'],
      priority: needsWork ? 'high' : 'low'
    };
  }

  async executeChanges(plan) {
    // Simulate making code changes
    const changes = [];
    
    for (const step of plan.steps) {
      changes.push({
        step,
        timestamp: Date.now(),
        result: 'simulated'
      });
    }
    
    return changes;
  }

  async validateChanges() {
    // Run tests and checks
    try {
      const testResult = this.runTests();
      const lintResult = this.runLint();
      
      return {
        testsPass: testResult.passing > 0,
        lintClean: lintResult.clean,
        errors: [...testResult.errors, ...lintResult.errors]
      };
    } catch (error) {
      return {
        testsPass: false,
        lintClean: false,
        errors: [error.message]
      };
    }
  }

  async evaluateAgainstCriteria(criteria) {
    // Parse criteria and check each
    const criteriaLines = criteria.split('\n').filter(l => l.trim().startsWith('-'));
    const results = {};
    
    for (const criterion of criteriaLines) {
      const key = criterion.replace('-', '').trim().substring(0, 20);
      // Simulate checking (in reality would analyze code)
      results[key] = Math.random() > 0.3; // 70% chance of meeting each criterion
    }
    
    const complete = Object.values(results).every(v => v === true);
    
    return {
      complete,
      criteria: results,
      unmet: Object.entries(results)
        .filter(([_, v]) => !v)
        .map(([k]) => k)
    };
  }

  generateFeedback(evaluation) {
    if (evaluation.unmet.length === 0) {
      return 'All criteria met';
    }
    
    return `Still need to address:\n${evaluation.unmet.map(c => `- ${c}`).join('\n')}`;
  }

  async saveIterationArtifacts(iteration, artifacts) {
    const iterDir = path.join(this.paths.history, `iteration-${String(iteration).padStart(3, '0')}`);
    fs.mkdirSync(iterDir, { recursive: true });
    
    fs.writeFileSync(
      path.join(iterDir, 'artifacts.json'),
      JSON.stringify(artifacts, null, 2)
    );
    
    // Log progress
    const progress = {
      iteration,
      timestamp: Date.now(),
      changes: artifacts.changes.length,
      validation: artifacts.validation.testsPass,
      errors: artifacts.validation.errors.length
    };
    
    fs.appendFileSync(this.paths.progress, JSON.stringify(progress) + '\n');
  }

  commitChanges(iteration, summary) {
    try {
      execSync('git add -A', { stdio: 'pipe' });
      execSync(`git commit -m "Ralph iteration ${iteration}: ${summary}" --allow-empty`, { stdio: 'pipe' });
      this.log(`Committed iteration ${iteration}`);
    } catch (error) {
      this.log(`Commit failed: ${error.message}`);
    }
  }

  scanRelevantFiles() {
    // Simulate file scanning
    return ['index.js', 'auth.js', 'test.js'];
  }

  getTestStatus() {
    try {
      execSync('npm test', { stdio: 'pipe' });
      return { passing: 5, failing: 0 };
    } catch {
      return { passing: 3, failing: 2 };
    }
  }

  runTests() {
    const status = this.getTestStatus();
    return {
      passing: status.passing,
      failing: status.failing,
      errors: status.failing > 0 ? ['Some tests failed'] : []
    };
  }

  runLint() {
    try {
      execSync('npm run lint', { stdio: 'pipe' });
      return { clean: true, errors: [] };
    } catch {
      return { clean: false, errors: ['Lint issues found'] };
    }
  }

  getLastCommit() {
    try {
      return execSync('git log -1 --oneline', { encoding: 'utf8' }).trim();
    } catch {
      return 'No commits yet';
    }
  }

  getCurrentIteration() {
    try {
      return parseInt(fs.readFileSync(this.paths.iteration, 'utf8'));
    } catch {
      return 0;
    }
  }

  incrementIteration() {
    const current = this.getCurrentIteration();
    fs.writeFileSync(this.paths.iteration, String(current + 1));
  }

  getFeedback() {
    try {
      return fs.readFileSync(this.paths.feedback, 'utf8');
    } catch {
      return '';
    }
  }

  isComplete() {
    return fs.existsSync(this.paths.complete);
  }

  log(message) {
    if (this.verbose) {
      console.log(`[Ralph] ${message}`);
    }
  }

  async run() {
    while (!this.isComplete()) {
      const iteration = this.getCurrentIteration();
      
      if (iteration >= this.maxIterations) {
        console.log('Max iterations reached!');
        break;
      }
      
      // Worker phase
      await this.runWorkerIteration();
      
      // Reviewer phase
      const review = await this.runReviewerIteration();
      
      if (review.complete) {
        console.log('Task completed!');
        break;
      }
      
      // Brief pause between iterations
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    
    // Final summary
    this.printSummary();
  }

  printSummary() {
    const iterations = this.getCurrentIteration();
    const progress = fs.readFileSync(this.paths.progress, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map(line => JSON.parse(line));
    
    console.log('\n=== Ralph Loop Summary ===');
    console.log(`Total iterations: ${iterations}`);
    console.log(`Total changes: ${progress.reduce((sum, p) => sum + p.changes, 0)}`);
    console.log(`Final status: ${this.isComplete() ? 'COMPLETE' : 'INCOMPLETE'}`);
  }
}

// CLI Interface
async function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  
  if (command === 'init') {
    const task = args[1] || 'Implement a feature';
    const criteria = args[2] || '- Tests pass\n- Code works\n- No errors';
    
    const loop = new RalphLoop({ verbose: true });
    await loop.initialize(task, criteria);
    console.log('Ralph Loop initialized. Run with: node ralph-loop-implementation.js run');
    
  } else if (command === 'run') {
    const loop = new RalphLoop({ verbose: true });
    
    if (!fs.existsSync(loop.paths.task)) {
      console.error('No task found. Initialize first with: node ralph-loop-implementation.js init');
      process.exit(1);
    }
    
    await loop.run();
    
  } else if (command === 'status') {
    const loop = new RalphLoop();
    const iteration = loop.getCurrentIteration();
    const complete = loop.isComplete();
    const feedback = loop.getFeedback();
    
    console.log(`Iteration: ${iteration}`);
    console.log(`Status: ${complete ? 'COMPLETE' : 'IN PROGRESS'}`);
    console.log(`Last feedback: ${feedback.substring(0, 100)}`);
    
  } else {
    console.log(`
Ralph Loop Implementation

Usage:
  node ralph-loop-implementation.js init [task] [criteria]  - Initialize a new loop
  node ralph-loop-implementation.js run                     - Run the loop
  node ralph-loop-implementation.js status                  - Check current status

Example:
  node ralph-loop-implementation.js init "Add login feature" "- Tests pass\\n- JWT works\\n- Error handling"
  node ralph-loop-implementation.js run
    `);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}

export { RalphLoop };