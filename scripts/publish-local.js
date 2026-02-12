#!/usr/bin/env node
/**
 * Local NPM Publishing Script with Token
 * Usage: node scripts/publish-local.js
 *
 * Requires NPM_TOKEN in environment or .env file
 */

import { execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import chalk from 'chalk';

// Load .env file if it exists
const envPath = join(process.cwd(), '.env');
if (existsSync(envPath)) {
  const envContent = readFileSync(envPath, 'utf-8');
  envContent.split('\n').forEach((line) => {
    const [key, value] = line.split('=');
    if (key && value && !process.env[key]) {
      process.env[key.trim()] = value.trim();
    }
  });
}

// Check for NPM token
const npmToken = process.env.NPM_TOKEN;
if (!npmToken) {
  console.error(chalk.red('❌ NPM_TOKEN not found'));
  console.log(chalk.yellow('Please set NPM_TOKEN environment variable:'));
  console.log(chalk.gray('  export NPM_TOKEN=npm_xxx...'));
  console.log(chalk.gray('  Or create a .env file with NPM_TOKEN=npm_xxx...'));
  console.log();
  console.log(chalk.yellow('Get your token from:'));
  console.log(
    chalk.blue('  https://www.npmjs.com/settings/YOUR_USERNAME/tokens')
  );
  process.exit(1);
}

// Create .npmrc with token
const npmrcContent = `//registry.npmjs.org/:_authToken=${npmToken}
registry=https://registry.npmjs.org/
access=public
`;

console.log(chalk.green('📝 Setting up NPM authentication...'));
execSync(`echo "${npmrcContent}" > ~/.npmrc`);

try {
  // Check current version
  console.log(chalk.yellow('📦 Current package info:'));
  execSync('npm view @stackmemoryai/stackmemory version', { stdio: 'inherit' });

  // Build
  console.log(chalk.yellow('\n🔨 Building package...'));
  execSync('npm run build', { stdio: 'inherit' });

  // Verify dist artifacts
  console.log(chalk.yellow('\n🔍 Verifying dist artifacts...'));
  execSync('npm run verify:dist', { stdio: 'inherit' });

  // Run pre-publish quality gate (tests + benchmarks + lint)
  console.log(
    chalk.yellow(
      '\n🧪 Running pre-publish checks (tests + benchmarks + loops + lint)...'
    )
  );
  execSync('npm run test:pre-publish', { stdio: 'inherit' });

  // Publish
  console.log(chalk.yellow('\n🚀 Publishing to NPM...'));
  execSync('npm publish --access public', { stdio: 'inherit' });

  console.log(chalk.green('\n✅ Successfully published to NPM!'));

  // Show new version
  console.log(chalk.yellow('\n📦 New package info:'));
  execSync('npm view @stackmemoryai/stackmemory version', { stdio: 'inherit' });
} catch (error) {
  console.error(chalk.red('\n❌ Publishing failed:'), error.message);
  process.exit(1);
} finally {
  // Clean up .npmrc (optional, for security)
  console.log(chalk.gray('\n🧹 Cleaning up credentials...'));
  execSync('rm ~/.npmrc 2>/dev/null || true');
}
