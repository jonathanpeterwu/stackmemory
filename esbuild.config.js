import esbuild from 'esbuild';

import { glob } from 'glob';

// Get all TypeScript files except tests
const entryPoints = glob.sync('src/**/*.ts', {
  ignore: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**'],
});

// ESM polyfill for __dirname and __filename
const esmBanner = `import { fileURLToPath as __fileURLToPath } from 'url';
import { dirname as __pathDirname } from 'path';
const __filename = __fileURLToPath(import.meta.url);
const __dirname = __pathDirname(__filename);`;

// Build configuration
const buildConfig = {
  entryPoints,
  outdir: 'dist',
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  allowOverwrite: true,
  logLevel: 'info',
  preserveSymlinks: false,
  splitting: false,
  banner: {
    js: esmBanner,
  },
};

// Build function
async function build() {
  try {
    await esbuild.build(buildConfig);
    console.log('✅ Build completed successfully');
  } catch (error) {
    console.error('❌ Build failed:', error);
    process.exit(1);
  }
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  build();
}

export { buildConfig, build };
