/**
 * Testing Agent - Automated Test Generation and Execution
 * Analyzes code to generate comprehensive test suites
 */

import * as ts from 'typescript';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, join, basename } from 'path';
import { execSync } from 'child_process';
import { glob } from 'glob';
import { logger } from '../core/monitoring/logger.js';

interface TestCase {
  name: string;
  description: string;
  setup?: string;
  action: string;
  assertion: string;
  cleanup?: string;
  isAsync?: boolean;
}

interface TestSuite {
  filePath: string;
  targetPath: string;
  describe: string;
  imports: string[];
  beforeEach?: string;
  afterEach?: string;
  tests: TestCase[];
}

interface CoverageReport {
  filePath: string;
  lines: { total: number; covered: number; percentage: number };
  branches: { total: number; covered: number; percentage: number };
  functions: { total: number; covered: number; percentage: number };
  uncoveredLines: number[];
}

interface TestResults {
  passed: number;
  failed: number;
  skipped: number;
  duration: number;
  failures: Array<{ test: string; error: string }>;
}

interface MockData {
  name: string;
  type: string;
  value: unknown;
  implementation?: string;
}

interface Fixture {
  name: string;
  data: unknown;
  setup?: string;
  teardown?: string;
}

interface PerfReport {
  function: string;
  averageTime: number;
  minTime: number;
  maxTime: number;
  iterations: number;
  memoryUsage: number;
}

export class TestingAgent {
  private readonly projectRoot: string;
  private readonly testDir: string;
  private readonly mockDir: string;
  private readonly fixtureDir: string;

  constructor(projectRoot = process.cwd()) {
    this.projectRoot = projectRoot;
    this.testDir = join(projectRoot, 'src', '__tests__');
    this.mockDir = join(projectRoot, 'src', '__mocks__');
    this.fixtureDir = join(projectRoot, 'src', '__fixtures__');
  }

  /**
   * Analyze code coverage from existing reports
   */
  public async analyzeCodeCoverage(
    targetPath: string
  ): Promise<CoverageReport> {
    const coveragePath = join(
      this.projectRoot,
      'coverage',
      'coverage-final.json'
    );

    if (!existsSync(coveragePath)) {
      // Run coverage first
      try {
        execSync('npm run test -- --coverage --silent', {
          cwd: this.projectRoot,
          stdio: 'pipe',
        });
      } catch (error) {
        logger.warn('Coverage generation failed', { error });
      }
    }

    // Parse coverage report
    if (existsSync(coveragePath)) {
      const coverage = JSON.parse(
        readFileSync(coveragePath, 'utf-8')
      ) as Record<string, unknown>;
      const fileCoverage =
        (coverage[targetPath] as Record<string, unknown>) || {};

      return {
        filePath: targetPath,
        lines: this.calculateCoverage(
          (fileCoverage.s as Record<string, number>) || {}
        ),
        branches: this.calculateCoverage(
          (fileCoverage.b as Record<string, number>) || {}
        ),
        functions: this.calculateCoverage(
          (fileCoverage.f as Record<string, number>) || {}
        ),
        uncoveredLines: this.findUncoveredLines(
          (fileCoverage.statementMap as Record<string, unknown>) || {},
          (fileCoverage.s as Record<string, number>) || {}
        ),
      };
    }

    // Default report if no coverage data
    return {
      filePath: targetPath,
      lines: { total: 0, covered: 0, percentage: 0 },
      branches: { total: 0, covered: 0, percentage: 0 },
      functions: { total: 0, covered: 0, percentage: 0 },
      uncoveredLines: [],
    };
  }

  /**
   * Generate unit tests for a function or module
   */
  public async generateUnitTests(targetPath: string): Promise<TestSuite> {
    const sourceCode = readFileSync(targetPath, 'utf-8');
    const sourceFile = ts.createSourceFile(
      targetPath,
      sourceCode,
      ts.ScriptTarget.Latest,
      true
    );

    const functions = this.extractFunctions(sourceFile);
    const classes = this.extractClasses(sourceFile);
    const tests: TestCase[] = [];

    // Generate tests for functions
    for (const func of functions) {
      tests.push(...this.generateFunctionTests(func));
    }

    // Generate tests for classes
    for (const cls of classes) {
      tests.push(...this.generateClassTests(cls));
    }

    // Create test suite
    const testSuite: TestSuite = {
      filePath: this.getTestPath(targetPath),
      targetPath,
      describe: this.getModuleName(targetPath),
      imports: this.generateImports(targetPath, sourceFile),
      beforeEach: this.generateBeforeEach(classes),
      afterEach: this.generateAfterEach(classes),
      tests,
    };

    return testSuite;
  }

  /**
   * Generate integration tests for a module
   */
  public async generateIntegrationTests(
    modulePath: string
  ): Promise<TestSuite> {
    const moduleFiles = glob.sync(join(modulePath, '**/*.ts'), {
      ignore: ['**/*.test.ts', '**/*.spec.ts', '**/node_modules/**'],
    });

    const tests: TestCase[] = [];
    const dependencies = new Set<string>();

    // Analyze module interactions
    for (const file of moduleFiles) {
      const sourceCode = readFileSync(file, 'utf-8');
      const sourceFile = ts.createSourceFile(
        file,
        sourceCode,
        ts.ScriptTarget.Latest,
        true
      );

      // Find external dependencies
      this.findDependencies(sourceFile, dependencies);
    }

    // Generate integration test cases
    tests.push(
      ...this.generateModuleIntegrationTests(
        modulePath,
        Array.from(dependencies)
      )
    );

    const testSuite: TestSuite = {
      filePath: this.getIntegrationTestPath(modulePath),
      targetPath: modulePath,
      describe: `${basename(modulePath)} Integration`,
      imports: this.generateIntegrationImports(modulePath, dependencies),
      beforeEach: this.generateIntegrationSetup(dependencies),
      afterEach: this.generateIntegrationCleanup(),
      tests,
    };

    return testSuite;
  }

  /**
   * Generate edge case tests for a function
   */
  public async generateEdgeCaseTests(
    targetPath: string,
    functionName: string
  ): Promise<TestCase[]> {
    const sourceCode = readFileSync(targetPath, 'utf-8');
    const sourceFile = ts.createSourceFile(
      targetPath,
      sourceCode,
      ts.ScriptTarget.Latest,
      true
    );

    const func = this.findFunction(sourceFile, functionName);
    if (!func) {
      throw new Error(`Function ${functionName} not found in ${targetPath}`);
    }

    return this.generateFunctionEdgeCases(func);
  }

  /**
   * Execute tests and return results
   */
  public async executeTests(pattern: string): Promise<TestResults> {
    try {
      const output = execSync(`npm run test -- ${pattern} --reporter=json`, {
        cwd: this.projectRoot,
        encoding: 'utf-8',
        stdio: 'pipe',
      });

      const results = JSON.parse(output) as Record<string, unknown>;
      return {
        passed: (results.numPassedTests as number) || 0,
        failed: (results.numFailedTests as number) || 0,
        skipped: (results.numPendingTests as number) || 0,
        duration: (results.duration as number) || 0,
        failures: this.extractFailures(results),
      };
    } catch (error: unknown) {
      // Parse error output
      return {
        passed: 0,
        failed: 1,
        skipped: 0,
        duration: 0,
        failures: [{ test: 'Test execution', error: (error as Error).message }],
      };
    }
  }

  /**
   * Generate mock data for testing
   */
  public generateMockData(schema: Record<string, unknown>): MockData {
    const mockType = this.inferTypeFromSchema(schema);
    const mockValue = this.generateMockValue(mockType, schema);

    return {
      name: (schema.name as string) || 'mockData',
      type: mockType,
      value: mockValue,
      implementation: this.generateMockImplementation(schema),
    };
  }

  /**
   * Create test fixtures
   */
  public createTestFixtures(componentName: string): Fixture[] {
    const fixtures: Fixture[] = [];

    // Generate common fixtures
    fixtures.push({
      name: `${componentName}DefaultProps`,
      data: this.generateDefaultProps(),
      setup: this.generateFixtureSetup(componentName),
      teardown: this.generateFixtureTeardown(componentName),
    });

    fixtures.push({
      name: `${componentName}EdgeCaseProps`,
      data: this.generateEdgeCaseProps(),
    });

    fixtures.push({
      name: `${componentName}TestData`,
      data: this.generateTestData(),
    });

    return fixtures;
  }

  /**
   * Benchmark performance of a function
   */
  public async benchmarkPerformance(
    targetPath: string,
    functionName: string
  ): Promise<PerfReport> {
    const benchmarkCode = this.generateBenchmarkCode(targetPath, functionName);
    const benchmarkFile = join(
      this.testDir,
      'benchmarks',
      `${functionName}.bench.ts`
    );

    // Ensure directory exists
    const benchDir = dirname(benchmarkFile);
    if (!existsSync(benchDir)) {
      mkdirSync(benchDir, { recursive: true });
    }

    // Write benchmark file
    writeFileSync(benchmarkFile, benchmarkCode);

    // Run benchmark
    try {
      const output = execSync(
        `npx vitest bench ${benchmarkFile} --reporter=json`,
        {
          cwd: this.projectRoot,
          encoding: 'utf-8',
          stdio: 'pipe',
        }
      );

      const results = JSON.parse(output) as Record<string, unknown>;
      return this.parseBenchmarkResults(results, functionName);
    } catch (error) {
      logger.error('Benchmark failed', { error });
      return {
        function: functionName,
        averageTime: 0,
        minTime: 0,
        maxTime: 0,
        iterations: 0,
        memoryUsage: 0,
      };
    }
  }

  /**
   * Save generated test suite to file
   */
  public async saveTestSuite(suite: TestSuite): Promise<void> {
    const testCode = this.generateTestCode(suite);
    const testDir = dirname(suite.filePath);

    // Ensure directory exists
    if (!existsSync(testDir)) {
      mkdirSync(testDir, { recursive: true });
    }

    writeFileSync(suite.filePath, testCode);
    logger.info('Test suite saved', { path: suite.filePath });
  }

  // Private helper methods

  private extractFunctions(
    sourceFile: ts.SourceFile
  ): ts.FunctionDeclaration[] {
    const functions: ts.FunctionDeclaration[] = [];

    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name) {
        functions.push(node);
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return functions;
  }

  private extractClasses(sourceFile: ts.SourceFile): ts.ClassDeclaration[] {
    const classes: ts.ClassDeclaration[] = [];

    const visit = (node: ts.Node) => {
      if (ts.isClassDeclaration(node) && node.name) {
        classes.push(node);
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return classes;
  }

  private generateFunctionTests(func: ts.FunctionDeclaration): TestCase[] {
    const tests: TestCase[] = [];
    const funcName = func.name?.getText() || 'unknown';

    // Happy path test
    tests.push({
      name: `should execute ${funcName} successfully with valid input`,
      description: `Test normal execution of ${funcName}`,
      action: `const result = ${funcName}();`,
      assertion: 'expect(result).toBeDefined();',
    });

    return tests;
  }

  private generateClassTests(cls: ts.ClassDeclaration): TestCase[] {
    const tests: TestCase[] = [];
    const className = cls.name?.getText() || 'UnknownClass';

    // Constructor test
    tests.push({
      name: `should create instance of ${className}`,
      description: `Test ${className} instantiation`,
      action: `const instance = new ${className}()`,
      assertion: `expect(instance).toBeInstanceOf(${className})`,
    });

    return tests;
  }

  private generateFunctionEdgeCases(_func: ts.FunctionDeclaration): TestCase[] {
    return [];
  }

  private generateTestCode(suite: TestSuite): string {
    const imports = suite.imports.join('\n');
    const tests = suite.tests
      .map((test) => this.formatTestCase(test))
      .join('\n\n  ');

    return `/**
 * Generated test suite for ${suite.targetPath}
 * Generated by TestingAgent
 */

${imports}

describe('${suite.describe}', () => {
${suite.beforeEach ? `  beforeEach(() => {\n    ${suite.beforeEach}\n  });\n` : ''}
${suite.afterEach ? `  afterEach(() => {\n    ${suite.afterEach}\n  });\n` : ''}
  ${tests}
});
`;
  }

  private formatTestCase(test: TestCase): string {
    return `it('${test.name}', () => {
${test.setup ? `    // Arrange\n    ${test.setup}\n` : ''}
    // Act
    ${test.action}

    // Assert
    ${test.assertion}
${test.cleanup ? `\n    // Cleanup\n    ${test.cleanup}` : ''}
  })`;
  }

  private generateImports(
    targetPath: string,
    sourceFile: ts.SourceFile
  ): string[] {
    const imports: string[] = [
      `import { describe, it, expect, beforeEach, afterEach } from 'vitest';`,
    ];

    // Import the module being tested
    const relativePath = this.getRelativePath(
      this.getTestPath(targetPath),
      targetPath
    );
    const exportedNames = this.getExportedNames(sourceFile);
    if (exportedNames.length > 0) {
      imports.push(
        `import { ${exportedNames.join(', ')} } from '${relativePath}';`
      );
    }

    return imports;
  }

  private getExportedNames(sourceFile: ts.SourceFile): string[] {
    const exports: string[] = [];

    const visit = (node: ts.Node) => {
      if (
        ts.isFunctionDeclaration(node) &&
        node.name &&
        this.isExported(node)
      ) {
        exports.push(node.name.getText());
      }
      if (ts.isClassDeclaration(node) && node.name && this.isExported(node)) {
        exports.push(node.name.getText());
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
    return exports;
  }

  private isExported(node: ts.Node): boolean {
    return (
      node.modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) ||
      false
    );
  }

  private getTestPath(targetPath: string): string {
    const relativePath = targetPath.replace(this.projectRoot, '');
    const pathParts = relativePath.split('/');
    const fileName = pathParts.pop();
    const testFileName = fileName?.replace('.ts', '.test.ts');

    return join(
      this.projectRoot,
      'src',
      '__tests__',
      ...pathParts.slice(2),
      testFileName || ''
    );
  }

  private getIntegrationTestPath(modulePath: string): string {
    const moduleName = basename(modulePath);
    return join(
      this.testDir,
      'integration',
      `${moduleName}.integration.test.ts`
    );
  }

  private getModuleName(targetPath: string): string {
    const fileName = basename(targetPath);
    return fileName.replace(/\.(ts|js)$/, '');
  }

  private getRelativePath(from: string, to: string): string {
    const fromParts = from.split('/');
    const toParts = to.split('/');

    // Find common base
    let i = 0;
    while (
      i < fromParts.length &&
      i < toParts.length &&
      fromParts[i] === toParts[i]
    ) {
      i++;
    }

    // Generate relative path
    const upCount = fromParts.length - i - 1;
    const ups = Array(upCount).fill('..');
    const downs = toParts.slice(i);

    const relativePath = [...ups, ...downs].join('/');
    return relativePath.replace(/\.ts$/, '.js');
  }

  private calculateCoverage(coverageData: Record<string, number>): {
    total: number;
    covered: number;
    percentage: number;
  } {
    const values = Object.values(coverageData);
    const total = values.length;
    const covered = values.filter((v) => v > 0).length;
    const percentage = total > 0 ? (covered / total) * 100 : 0;

    return { total, covered, percentage: Math.round(percentage) };
  }

  private findUncoveredLines(
    statementMap: Record<string, unknown>,
    statements: Record<string, number>
  ): number[] {
    const uncovered: number[] = [];

    Object.entries(statements).forEach(([key, value]) => {
      if (value === 0 && statementMap[key]) {
        const loc = (statementMap[key] as { start: { line: number } }).start;
        uncovered.push(loc.line);
      }
    });

    return uncovered;
  }

  private extractFailures(
    results: Record<string, unknown>
  ): Array<{ test: string; error: string }> {
    const failures: Array<{ test: string; error: string }> = [];

    if (results.testResults) {
      const testResults = results.testResults as Array<{
        assertionResults?: Array<{
          status: string;
          title: string;
          failureMessages?: string[];
        }>;
      }>;
      testResults.forEach((suite) => {
        suite.assertionResults?.forEach((test) => {
          if (test.status === 'failed') {
            failures.push({
              test: test.title,
              error: test.failureMessages?.join('\n') || 'Unknown error',
            });
          }
        });
      });
    }

    return failures;
  }

  // Mock and fixture generation helpers
  private generateMockImplementation(schema: Record<string, unknown>): string {
    return `export const mock${(schema.name as string) || 'Data'} = {
  ${this.generateMockProperties(schema)}
};`;
  }

  private generateMockProperties(schema: Record<string, unknown>): string {
    if (!schema.properties) return '';

    const properties = schema.properties as Record<string, { type: string }>;
    return Object.entries(properties)
      .map(([key, value]) => {
        return `${key}: ${this.generateMockValue(value.type, value)}`;
      })
      .join(',\n  ');
  }

  private generateMockValue(type: string, _schema: unknown): string {
    switch (type) {
      case 'string':
        return `'mock-value'`;
      case 'number':
        return `${Math.floor(Math.random() * 100)}`;
      case 'boolean':
        return 'true';
      case 'array':
        return '[]';
      case 'object':
        return '{}';
      default:
        return 'null';
    }
  }

  private inferTypeFromSchema(schema: unknown): string {
    if (typeof schema === 'object' && schema !== null && 'type' in schema) {
      return (schema as { type: string }).type;
    }
    if (Array.isArray(schema)) return 'array';
    if (typeof schema === 'object') return 'object';
    return typeof schema;
  }

  private findDependencies(
    sourceFile: ts.SourceFile,
    dependencies: Set<string>
  ): void {
    const visit = (node: ts.Node) => {
      if (ts.isImportDeclaration(node)) {
        const moduleSpecifier = node.moduleSpecifier;
        if (ts.isStringLiteral(moduleSpecifier)) {
          dependencies.add(moduleSpecifier.text);
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  private generateModuleIntegrationTests(
    modulePath: string,
    _dependencies: string[]
  ): TestCase[] {
    const tests: TestCase[] = [];
    const moduleName = basename(modulePath);

    tests.push({
      name: `should initialize ${moduleName} module`,
      description: `Test module initialization`,
      action: `const module = await import('${modulePath}');`,
      assertion: `expect(module).toBeDefined();`,
      isAsync: true,
    });

    return tests;
  }

  private generateIntegrationImports(
    modulePath: string,
    dependencies: Set<string>
  ): string[] {
    const imports = [
      `import { describe, it, expect, beforeEach, afterEach } from 'vitest';`,
    ];

    // Add dependency imports
    dependencies.forEach((dep) => {
      if (!dep.startsWith('.')) {
        const importName = dep.replace(/[^a-zA-Z]/g, '');
        imports.push(`import * as ${importName} from '${dep}';`);
      }
    });

    return imports;
  }

  private generateIntegrationSetup(_dependencies: Set<string>): string {
    return 'const testContext = {};';
  }

  private generateIntegrationCleanup(): string {
    return '// Reset any global state';
  }

  private generateBeforeEach(
    classes: ts.ClassDeclaration[]
  ): string | undefined {
    if (classes.length === 0) return undefined;
    return '// Setup test environment';
  }

  private generateAfterEach(
    classes: ts.ClassDeclaration[]
  ): string | undefined {
    if (classes.length === 0) return undefined;
    return '// Cleanup test environment';
  }

  private findFunction(
    sourceFile: ts.SourceFile,
    functionName: string
  ): ts.FunctionDeclaration | undefined {
    let result: ts.FunctionDeclaration | undefined;

    const visit = (node: ts.Node) => {
      if (
        ts.isFunctionDeclaration(node) &&
        node.name?.getText() === functionName
      ) {
        result = node;
      }
      if (!result) {
        ts.forEachChild(node, visit);
      }
    };

    visit(sourceFile);
    return result;
  }

  private generateDefaultProps(): Record<string, unknown> {
    return {
      id: 'test-id',
      className: 'test-class',
      children: 'Test Content',
    };
  }

  private generateEdgeCaseProps(): Record<string, unknown> {
    return {
      id: '',
      className: null,
      children: undefined,
    };
  }

  private generateTestData(): Record<string, unknown> {
    return {
      items: [
        { id: 1, name: 'Item 1' },
        { id: 2, name: 'Item 2' },
      ],
      config: {
        enabled: true,
        limit: 10,
      },
    };
  }

  private generateFixtureSetup(componentName: string): string {
    return `// Setup ${componentName} fixture`;
  }

  private generateFixtureTeardown(componentName: string): string {
    return `// Teardown ${componentName} fixture`;
  }

  private generateBenchmarkCode(
    targetPath: string,
    functionName: string
  ): string {
    return `import { bench, describe } from 'vitest';
import { ${functionName} } from '${targetPath}';

describe('${functionName} performance', () => {
  bench('${functionName} execution time', () => {
    ${functionName}();
  });
});`;
  }

  private parseBenchmarkResults(
    results: Record<string, unknown>,
    functionName: string
  ): PerfReport {
    return {
      function: functionName,
      averageTime: (results.mean as number) || 0,
      minTime: (results.min as number) || 0,
      maxTime: (results.max as number) || 0,
      iterations: (results.samples as number) || 0,
      memoryUsage: (results.memory as number) || 0,
    };
  }
}
