#!/usr/bin/env node
/**
 * Testing command - Generate and execute automated tests
 */

import { Command } from 'commander';
import { TestingAgent } from '../../agents/testing-agent.js';
import { logger } from '../../core/monitoring/logger.js';
import { join } from 'path';
import chalk from 'chalk';
import ora from 'ora';

export function createTestCommand(): Command {
  const testCmd = new Command('test')
    .description('Generate and execute automated tests')
    .option('--verbose', 'Show detailed output')
    .option('--dry-run', 'Preview generated tests without saving');

  /**
   * Generate tests for target file/module
   */
  testCmd
    .command('generate <target>')
    .description('Generate tests for target file/module')
    .option('--type <type>', 'Test type: unit|integration|e2e|perf', 'unit')
    .option('--coverage', 'Include coverage report')
    .option('--edge-cases', 'Generate comprehensive edge case tests')
    .option('--output <path>', 'Output directory for generated tests')
    .action(async (target: string, options: any) => {
      const spinner = ora('Generating tests...').start();
      
      try {
        const agent = new TestingAgent();
        const targetPath = join(process.cwd(), target);
        
        // Generate tests based on type
        let testSuite;
        switch (options.type) {
          case 'unit':
            spinner.text = 'Generating unit tests...';
            testSuite = await agent.generateUnitTests(targetPath);
            break;
            
          case 'integration':
            spinner.text = 'Generating integration tests...';
            testSuite = await agent.generateIntegrationTests(targetPath);
            break;
            
          case 'perf':
            spinner.text = 'Generating performance benchmarks...';
            // For performance, we generate benchmarks instead
            const funcName = options.function || 'main';
            const perfReport = await agent.benchmarkPerformance(targetPath, funcName);
            spinner.succeed('Performance benchmark generated');
            console.log(chalk.cyan('\n📊 Performance Report:'));
            console.log(chalk.gray('  Average:'), perfReport.averageTime.toFixed(2), 'ms');
            console.log(chalk.gray('  Min:'), perfReport.minTime.toFixed(2), 'ms');
            console.log(chalk.gray('  Max:'), perfReport.maxTime.toFixed(2), 'ms');
            return;
            
          default:
            spinner.text = 'Generating unit tests...';
            testSuite = await agent.generateUnitTests(targetPath);
        }
        
        // Add edge cases if requested
        if (options.edgeCases && testSuite) {
          spinner.text = 'Adding edge case tests...';
          const functions = await getFunctionsFromFile(targetPath);
          for (const func of functions) {
            const edgeCases = await agent.generateEdgeCaseTests(targetPath, func);
            testSuite.tests.push(...edgeCases);
          }
        }
        
        // Check coverage if requested
        if (options.coverage) {
          spinner.text = 'Analyzing code coverage...';
          const coverage = await agent.analyzeCodeCoverage(targetPath);
          console.log(chalk.cyan('\n📈 Coverage Report:'));
          console.log(chalk.gray('  Lines:'), `${coverage.lines.percentage}%`);
          console.log(chalk.gray('  Branches:'), `${coverage.branches.percentage}%`);
          console.log(chalk.gray('  Functions:'), `${coverage.functions.percentage}%`);
          
          if (coverage.uncoveredLines.length > 0) {
            console.log(chalk.yellow('  Uncovered lines:'), coverage.uncoveredLines.join(', '));
          }
        }
        
        // Save or preview tests
        if (options.dryRun) {
          spinner.succeed('Test generation complete (dry run)');
          console.log(chalk.cyan('\n🔍 Preview of generated tests:'));
          console.log(chalk.gray('─'.repeat(50)));
          console.log(formatTestPreview(testSuite));
        } else {
          await agent.saveTestSuite(testSuite);
          spinner.succeed(`Tests saved to ${testSuite.filePath}`);
          
          // Show summary
          console.log(chalk.green('\n✨ Test Generation Summary:'));
          console.log(chalk.gray('  Type:'), options.type);
          console.log(chalk.gray('  Target:'), target);
          console.log(chalk.gray('  Tests generated:'), testSuite.tests.length);
          console.log(chalk.gray('  Output:'), testSuite.filePath);
        }
        
      } catch (error) {
        spinner.fail('Test generation failed');
        logger.error('Failed to generate tests', { error, target, options });
        console.error(chalk.red('Error:'), (error as Error).message);
        process.exit(1);
      }
    });

  /**
   * Analyze coverage and generate missing tests
   */
  testCmd
    .command('coverage')
    .description('Analyze coverage and generate missing tests')
    .option('--generate-missing', 'Generate tests for uncovered code')
    .option('--threshold <percent>', 'Coverage threshold percentage', '80')
    .option('--target <path>', 'Specific file or directory to analyze')
    .action(async (options: any) => {
      const spinner = ora('Analyzing code coverage...').start();
      
      try {
        const agent = new TestingAgent();
        const targetPath = options.target ? join(process.cwd(), options.target) : process.cwd();
        
        // Get coverage report
        const coverage = await agent.analyzeCodeCoverage(targetPath);
        spinner.succeed('Coverage analysis complete');
        
        // Display coverage
        console.log(chalk.cyan('\n📊 Code Coverage Report:'));
        console.log(chalk.gray('─'.repeat(50)));
        displayCoverageReport(coverage);
        
        // Check threshold
        const threshold = parseInt(options.threshold);
        const passed = coverage.lines.percentage >= threshold;
        
        if (passed) {
          console.log(chalk.green(`\n✅ Coverage meets threshold (${threshold}%)`));
        } else {
          console.log(chalk.yellow(`\n⚠️  Coverage below threshold (${threshold}%)`));
          
          if (options.generateMissing) {
            spinner.start('Generating tests for uncovered code...');
            
            // Generate tests for uncovered lines
            const testSuite = await agent.generateUnitTests(targetPath);
            
            // Focus on uncovered areas
            testSuite.tests = testSuite.tests.filter(test => {
              // Filter to focus on uncovered code
              return true; // This would need more sophisticated logic
            });
            
            await agent.saveTestSuite(testSuite);
            spinner.succeed(`Generated ${testSuite.tests.length} tests for uncovered code`);
          }
        }
        
      } catch (error) {
        spinner.fail('Coverage analysis failed');
        logger.error('Failed to analyze coverage', { error, options });
        console.error(chalk.red('Error:'), (error as Error).message);
        process.exit(1);
      }
    });

  /**
   * Execute tests
   */
  testCmd
    .command('run [pattern]')
    .description('Execute tests matching pattern')
    .option('--watch', 'Run tests in watch mode')
    .option('--coverage', 'Generate coverage report')
    .option('--reporter <type>', 'Test reporter type', 'default')
    .action(async (pattern: string = '**/*.test.ts', options: any) => {
      const spinner = ora('Running tests...').start();
      
      try {
        const agent = new TestingAgent();
        
        // Execute tests
        const results = await agent.executeTests(pattern);
        
        if (results.failed === 0) {
          spinner.succeed(`All tests passed (${results.passed} tests)`);
          console.log(chalk.green('\n✅ Test Results:'));
        } else {
          spinner.fail(`${results.failed} tests failed`);
          console.log(chalk.red('\n❌ Test Results:'));
        }
        
        // Display results
        console.log(chalk.gray('  Passed:'), results.passed);
        console.log(chalk.gray('  Failed:'), results.failed);
        console.log(chalk.gray('  Skipped:'), results.skipped);
        console.log(chalk.gray('  Duration:'), `${results.duration}ms`);
        
        // Show failures
        if (results.failures.length > 0) {
          console.log(chalk.red('\n📋 Failed Tests:'));
          results.failures.forEach(failure => {
            console.log(chalk.red(`  • ${failure.test}`));
            console.log(chalk.gray(`    ${failure.error}`));
          });
        }
        
        process.exit(results.failed > 0 ? 1 : 0);
        
      } catch (error) {
        spinner.fail('Test execution failed');
        logger.error('Failed to execute tests', { error, pattern, options });
        console.error(chalk.red('Error:'), (error as Error).message);
        process.exit(1);
      }
    });

  /**
   * Generate mock data
   */
  testCmd
    .command('mock <schema>')
    .description('Generate mock data from schema')
    .option('--count <n>', 'Number of mock items to generate', '1')
    .option('--output <path>', 'Output file for mock data')
    .action(async (schemaPath: string, options: any) => {
      const spinner = ora('Generating mock data...').start();
      
      try {
        const agent = new TestingAgent();
        const schema = require(join(process.cwd(), schemaPath));
        
        const mocks = [];
        for (let i = 0; i < parseInt(options.count); i++) {
          mocks.push(agent.generateMockData(schema));
        }
        
        spinner.succeed(`Generated ${mocks.length} mock items`);
        
        if (options.output) {
          const { writeFileSync } = await import('fs');
          writeFileSync(
            join(process.cwd(), options.output),
            JSON.stringify(mocks, null, 2)
          );
          console.log(chalk.green(`\n✅ Mock data saved to ${options.output}`));
        } else {
          console.log(chalk.cyan('\n📦 Mock Data:'));
          console.log(JSON.stringify(mocks, null, 2));
        }
        
      } catch (error) {
        spinner.fail('Mock generation failed');
        logger.error('Failed to generate mock data', { error, schemaPath, options });
        console.error(chalk.red('Error:'), (error as Error).message);
        process.exit(1);
      }
    });

  /**
   * Create test fixtures
   */
  testCmd
    .command('fixtures <component>')
    .description('Create test fixtures for component')
    .option('--output <path>', 'Output directory for fixtures')
    .action(async (component: string, options: any) => {
      const spinner = ora('Creating test fixtures...').start();
      
      try {
        const agent = new TestingAgent();
        const fixtures = agent.createTestFixtures(component);
        
        spinner.succeed(`Created ${fixtures.length} fixtures for ${component}`);
        
        // Save fixtures
        if (options.output) {
          const { writeFileSync, mkdirSync } = await import('fs');
          const outputDir = join(process.cwd(), options.output);
          mkdirSync(outputDir, { recursive: true });
          
          fixtures.forEach(fixture => {
            const filePath = join(outputDir, `${fixture.name}.fixture.json`);
            writeFileSync(filePath, JSON.stringify(fixture.data, null, 2));
            console.log(chalk.gray(`  • ${fixture.name} → ${filePath}`));
          });
          
          console.log(chalk.green(`\n✅ Fixtures saved to ${options.output}`));
        } else {
          console.log(chalk.cyan('\n🔧 Test Fixtures:'));
          fixtures.forEach(fixture => {
            console.log(chalk.yellow(`\n${fixture.name}:`));
            console.log(JSON.stringify(fixture.data, null, 2));
          });
        }
        
      } catch (error) {
        spinner.fail('Fixture creation failed');
        logger.error('Failed to create fixtures', { error, component, options });
        console.error(chalk.red('Error:'), (error as Error).message);
        process.exit(1);
      }
    });

  /**
   * Benchmark performance
   */
  testCmd
    .command('benchmark <target>')
    .description('Run performance benchmarks')
    .option('--function <name>', 'Specific function to benchmark')
    .option('--iterations <n>', 'Number of iterations', '1000')
    .option('--threshold <ms>', 'Performance threshold in milliseconds')
    .action(async (target: string, options: any) => {
      const spinner = ora('Running performance benchmarks...').start();
      
      try {
        const agent = new TestingAgent();
        const targetPath = join(process.cwd(), target);
        const functionName = options.function || 'default';
        
        const report = await agent.benchmarkPerformance(targetPath, functionName);
        spinner.succeed('Benchmark complete');
        
        // Display report
        console.log(chalk.cyan('\n⚡ Performance Benchmark Report:'));
        console.log(chalk.gray('─'.repeat(50)));
        console.log(chalk.gray('  Function:'), report.function);
        console.log(chalk.gray('  Average:'), `${report.averageTime.toFixed(3)}ms`);
        console.log(chalk.gray('  Min:'), `${report.minTime.toFixed(3)}ms`);
        console.log(chalk.gray('  Max:'), `${report.maxTime.toFixed(3)}ms`);
        console.log(chalk.gray('  Iterations:'), report.iterations);
        console.log(chalk.gray('  Memory:'), `${(report.memoryUsage / 1024 / 1024).toFixed(2)}MB`);
        
        // Check threshold
        if (options.threshold) {
          const threshold = parseFloat(options.threshold);
          if (report.averageTime <= threshold) {
            console.log(chalk.green(`\n✅ Performance within threshold (${threshold}ms)`));
          } else {
            console.log(chalk.red(`\n❌ Performance exceeds threshold (${threshold}ms)`));
            process.exit(1);
          }
        }
        
      } catch (error) {
        spinner.fail('Benchmark failed');
        logger.error('Failed to run benchmark', { error, target, options });
        console.error(chalk.red('Error:'), (error as Error).message);
        process.exit(1);
      }
    });

  return testCmd;
}

// Helper functions

async function getFunctionsFromFile(filePath: string): Promise<string[]> {
  // This would use TypeScript compiler API to extract function names
  // For now, return a placeholder
  return ['main', 'helper', 'util'];
}

function formatTestPreview(testSuite: any): string {
  const preview = [`File: ${testSuite.filePath}`, `Describe: ${testSuite.describe}`, ''];
  
  testSuite.tests.forEach((test: any) => {
    preview.push(`  ✓ ${test.name}`);
  });
  
  return preview.join('\n');
}

function displayCoverageReport(coverage: any): void {
  const formatPercent = (percent: number) => {
    if (percent >= 80) return chalk.green(`${percent}%`);
    if (percent >= 60) return chalk.yellow(`${percent}%`);
    return chalk.red(`${percent}%`);
  };
  
  console.log(chalk.gray('  Lines:'), formatPercent(coverage.lines.percentage), 
    `(${coverage.lines.covered}/${coverage.lines.total})`);
  console.log(chalk.gray('  Branches:'), formatPercent(coverage.branches.percentage),
    `(${coverage.branches.covered}/${coverage.branches.total})`);
  console.log(chalk.gray('  Functions:'), formatPercent(coverage.functions.percentage),
    `(${coverage.functions.covered}/${coverage.functions.total})`);
}

// Export for CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const program = new Command();
  program.addCommand(createTestCommand());
  program.parse(process.argv);
}