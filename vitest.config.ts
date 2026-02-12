import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    testTimeout: 30000,
    hookTimeout: 30000,
    include: ['**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}'],
    sequence: {
      // Run CLI integration tests sequentially to avoid execSync resource contention
      sequenceFiles: true,
    },
    poolOptions: {
      forks: {
        // Limit parallelism to prevent CLI integration test timeouts
        maxForks: 6,
      },
    },
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
  },
});
