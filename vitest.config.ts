import { defineConfig } from 'vitest/config';

// E2E files — must be sequential (execSync, process.cwd/argv mutation)
const e2eFiles = [
  'src/cli/commands/__tests__/integration.test.ts',
  'src/__tests__/integration/cli-integration.test.ts',
  'src/cli/__tests__/index.test.ts',
];

// Slow files — individually slow (real subagent API calls)
const slowFiles = [
  'src/integrations/claude-code/__tests__/task-coordinator.test.ts',
  'src/integrations/claude-code/__tests__/agent-bridge.test.ts',
];

// Live API files — skip unless LIVE_TEST env is set
const liveFiles = [
  'src/core/extensions/__tests__/openrouter-integration.test.ts',
  'src/integrations/mcp/handlers/__tests__/delegate-openrouter.test.ts',
];

// Benchmark files — only run with BENCH=1
const benchmarkFiles = ['src/core/database/__tests__/search-benchmark.test.ts'];

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    exclude: [
      'node_modules',
      'dist',
      '.idea',
      '.git',
      '.cache',
      '.opencode',
      'external',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'dist/',
        '**/*.test.ts',
        '**/*.spec.ts',
        '**/tests/**',
        '**/__tests__/**',
        '**/browser-test.ts',
        '**/setup-*.ts',
        '**/scripts/**',
      ],
      thresholds: {
        statements: 25,
        branches: 20,
        functions: 30,
        lines: 25,
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          include: ['src/**/*.{test,spec}.{ts,tsx}'],
          exclude: [
            ...e2eFiles,
            ...slowFiles,
            ...liveFiles,
            ...benchmarkFiles,
            'node_modules',
            'dist',
          ],
          pool: 'forks',
          maxWorkers: 10,
          testTimeout: 30000,
          hookTimeout: 30000,
        },
      },
      {
        extends: true,
        test: {
          name: 'integration',
          include: [...e2eFiles, ...slowFiles],
          pool: 'forks',
          maxWorkers: 3,
          fileParallelism: false,
          testTimeout: 60000,
          hookTimeout: 60000,
        },
      },
      {
        extends: true,
        test: {
          name: 'live',
          include: [...liveFiles],
          pool: 'forks',
          maxWorkers: 1,
          testTimeout: 30000,
          env: { LIVE_TEST: '1' },
        },
      },
      {
        extends: true,
        test: {
          name: 'bench',
          include: [...benchmarkFiles],
          pool: 'forks',
          maxWorkers: 1,
          testTimeout: 600000,
          hookTimeout: 60000,
        },
      },
    ],
  },
});
