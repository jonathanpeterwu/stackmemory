import esbuild from 'esbuild';

// Build configuration
const buildConfig = {
  entryPoints: ['src/**/*.ts'],
  outdir: 'dist',
  platform: 'node',
  target: 'node20',
  format: 'esm',
  sourcemap: true,
  allowOverwrite: true,
  logLevel: 'info',
  preserveSymlinks: false,
  splitting: false,
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