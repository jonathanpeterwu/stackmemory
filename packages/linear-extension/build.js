import * as esbuild from 'esbuild';
import { copyFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function build() {
  // Ensure dist directory exists
  const distDir = join(__dirname, 'dist');
  if (!existsSync(distDir)) {
    mkdirSync(distDir, { recursive: true });
  }

  // Build background script
  await esbuild.build({
    entryPoints: [join(__dirname, 'src/background.ts')],
    bundle: true,
    outfile: join(distDir, 'background.js'),
    format: 'esm',
    platform: 'browser',
    target: 'chrome120',
  });

  // Build popup script
  await esbuild.build({
    entryPoints: [join(__dirname, 'src/popup/popup.ts')],
    bundle: true,
    outfile: join(distDir, 'popup.js'),
    format: 'esm',
    platform: 'browser',
    target: 'chrome120',
  });

  // Copy static files
  const popupDir = join(__dirname, 'popup');
  if (!existsSync(popupDir)) {
    mkdirSync(popupDir, { recursive: true });
  }

  copyFileSync(
    join(__dirname, 'src/popup/popup.html'),
    join(popupDir, 'popup.html')
  );
  copyFileSync(
    join(__dirname, 'src/popup/popup.css'),
    join(popupDir, 'popup.css')
  );

  console.log('Build complete!');
}

build().catch((err) => {
  console.error(err);
  process.exit(1);
});
