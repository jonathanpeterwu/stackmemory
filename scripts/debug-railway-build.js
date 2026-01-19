#!/usr/bin/env node

/**
 * Debug Railway build issues
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

console.log('🔍 Railway Build Debugger');
console.log('========================\n');

// Check for server files
const serverDir = path.join(__dirname, '..', 'dist', 'servers', 'railway');
const srcDir = path.join(__dirname, '..', 'src', 'servers', 'railway');

console.log('📁 Checking dist/servers/railway:');
if (fs.existsSync(serverDir)) {
  const files = fs.readdirSync(serverDir);
  files.forEach(file => {
    const stats = fs.statSync(path.join(serverDir, file));
    console.log(`  - ${file} (${stats.size} bytes, modified: ${stats.mtime.toISOString()})`);
    
    // Check for minimal server references
    if (file === 'index.js') {
      const content = fs.readFileSync(path.join(serverDir, file), 'utf-8');
      if (content.includes('Minimal')) {
        console.log(`    ⚠️  Contains "Minimal" references`);
      }
      if (content.includes('/auth/signup')) {
        console.log(`    ✅ Contains auth endpoints`);
      }
    }
  });
} else {
  console.log('  ❌ Directory does not exist');
}

console.log('\n📁 Checking src/servers/railway:');
if (fs.existsSync(srcDir)) {
  const files = fs.readdirSync(srcDir);
  files.forEach(file => {
    const stats = fs.statSync(path.join(srcDir, file));
    console.log(`  - ${file} (${stats.size} bytes)`);
  });
} else {
  console.log('  ❌ Directory does not exist');
}

// Check package.json scripts
console.log('\n📦 Package.json start scripts:');
const packageJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
Object.entries(packageJson.scripts).forEach(([key, value]) => {
  if (key.includes('start')) {
    console.log(`  ${key}: ${value}`);
  }
});

// Check Dockerfile
console.log('\n🐳 Dockerfile CMD:');
const dockerfile = fs.readFileSync(path.join(__dirname, '..', 'Dockerfile'), 'utf-8');
const cmdMatch = dockerfile.match(/CMD\s+\[.*\]/g);
if (cmdMatch) {
  cmdMatch.forEach(cmd => {
    console.log(`  ${cmd}`);
  });
}

// Check Railway config
console.log('\n🚂 Railway.json:');
const railwayConfig = path.join(__dirname, '..', 'railway.json');
if (fs.existsSync(railwayConfig)) {
  const config = JSON.parse(fs.readFileSync(railwayConfig, 'utf-8'));
  console.log(JSON.stringify(config, null, 2));
} else {
  console.log('  ❌ railway.json not found');
}

console.log('\n💡 Recommendations:');
console.log('1. Railway may be using a cached build layer');
console.log('2. Try changing the base image in Dockerfile to force rebuild');
console.log('3. Check Railway dashboard for any override settings');
console.log('4. Consider contacting Railway support about cache issues');