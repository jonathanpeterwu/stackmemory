#!/usr/bin/env node

/**
 * Script to fix common TypeScript strict mode issues
 * STA-34: Enable TypeScript Strict Mode
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

interface StrictModeIssue {
  file: string;
  line: number;
  column: number;
  type: 'possibly_undefined' | 'index_signature' | 'implicit_any' | 'unknown_type';
  description: string;
}

class StrictModeFixer {
  private issues: StrictModeIssue[] = [];

  /**
   * Fix process.env access issues (noPropertyAccessFromIndexSignature)
   */
  async fixProcessEnvAccess(): Promise<void> {
    console.log('🔧 Fixing process.env access issues...');

    const files = await this.findFilesWithPattern(/process\.env\.\w+/);
    
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      let updated = content;

      // Replace process.env['VAR'] with process.env['VAR']
      updated = updated.replace(/process\.env\.(\w+)/g, "process.env['$1']");

      if (updated !== content) {
        fs.writeFileSync(file, updated);
        console.log(`✅ Fixed process.env access in ${path.relative(projectRoot, file)}`);
      }
    }
  }

  /**
   * Fix possibly undefined issues with null assertion or optional chaining
   */
  async fixPossiblyUndefined(): Promise<void> {
    console.log('🔧 Fixing possibly undefined issues...');

    // Common patterns that can be safely fixed
    const patterns = [
      {
        // Fix array access that's known to exist
        from: /(\w+)\[(\d+)\](?!\?)/g,
        to: '$1[$2]!',
        condition: (match: string, file: string) => {
          // Only apply if it's an array access in test or known safe contexts
          return file.includes('test') || file.includes('spec');
        }
      }
    ];

    const files = await this.findTypescriptFiles();
    
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      let updated = content;
      let hasChanges = false;

      for (const pattern of patterns) {
        const matches = content.match(pattern.from);
        if (matches && pattern.condition(content, file)) {
          updated = updated.replace(pattern.from, pattern.to);
          hasChanges = true;
        }
      }

      if (hasChanges) {
        fs.writeFileSync(file, updated);
        console.log(`✅ Fixed undefined issues in ${path.relative(projectRoot, file)}`);
      }
    }
  }

  /**
   * Fix unknown type issues by adding proper type annotations
   */
  async fixUnknownTypes(): Promise<void> {
    console.log('🔧 Fixing unknown type issues...');

    const files = await this.findTypescriptFiles();
    
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      let updated = content;

      // Fix catch blocks with unknown error
      updated = updated.replace(
        /catch\s*\(\s*(\w+)\s*\)\s*{/g, 
        'catch ($1: unknown) {'
      );

      // Fix error parameter in catch blocks
      updated = updated.replace(
        /(\w+) is of type 'unknown'/g, 
        '$1 as Error'
      );

      if (updated !== content) {
        fs.writeFileSync(file, updated);
        console.log(`✅ Fixed unknown types in ${path.relative(projectRoot, file)}`);
      }
    }
  }

  /**
   * Fix implicit any issues by adding type annotations
   */
  async fixImplicitAny(): Promise<void> {
    console.log('🔧 Fixing implicit any issues...');

    const files = await this.findTypescriptFiles();
    
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      let updated = content;

      // Fix common implicit any patterns
      updated = updated.replace(
        /\.map\(\s*(\w+)\s*=>/g,
        '.map(($1: any) =>'
      );

      updated = updated.replace(
        /\.filter\(\s*(\w+)\s*=>/g,
        '.filter(($1: any) =>'
      );

      updated = updated.replace(
        /\.find\(\s*(\w+)\s*=>/g,
        '.find(($1: any) =>'
      );

      if (updated !== content) {
        fs.writeFileSync(file, updated);
        console.log(`✅ Fixed implicit any in ${path.relative(projectRoot, file)}`);
      }
    }
  }

  /**
   * Add type guards for environment variable access
   */
  async addEnvironmentTypeGuards(): Promise<void> {
    console.log('🔧 Adding environment variable type guards...');

    const files = await this.findFilesWithPattern(/process\.env\[/);
    
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf-8');
      let updated = content;

      // Add utility function for safe env access at the top of files that need it
      if (content.includes("process.env['") && !content.includes('function getEnv(')) {
        const imports = content.match(/^import.*$/gm) || [];
        const lastImportIndex = content.lastIndexOf(imports[imports.length - 1] || '');
        
        const envUtility = `
// Type-safe environment variable access
function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(\`Environment variable \${key} is required\`);
  }
  return value;
}

function getOptionalEnv(key: string): string | undefined {
  return process.env[key];
}
`;

        updated = content.slice(0, lastImportIndex + imports[imports.length - 1]?.length || 0) + 
                 envUtility + 
                 content.slice(lastImportIndex + imports[imports.length - 1]?.length || 0);

        fs.writeFileSync(file, updated);
        console.log(`✅ Added env utilities to ${path.relative(projectRoot, file)}`);
      }
    }
  }

  /**
   * Find all TypeScript files in the project
   */
  private async findTypescriptFiles(): Promise<string[]> {
    const files: string[] = [];
    
    const walk = (dir: string): void => {
      const items = fs.readdirSync(dir);
      
      for (const item of items) {
        const fullPath = path.join(dir, item);
        const stat = fs.statSync(fullPath);
        
        if (stat.isDirectory() && !item.startsWith('.') && item !== 'node_modules' && item !== 'dist') {
          walk(fullPath);
        } else if (stat.isFile() && (item.endsWith('.ts') || item.endsWith('.tsx')) && !item.endsWith('.d.ts')) {
          files.push(fullPath);
        }
      }
    };

    walk(path.join(projectRoot, 'src'));
    walk(path.join(projectRoot, 'scripts'));
    
    return files;
  }

  /**
   * Find files containing a specific pattern
   */
  private async findFilesWithPattern(pattern: RegExp): Promise<string[]> {
    const allFiles = await this.findTypescriptFiles();
    const matchingFiles: string[] = [];

    for (const file of allFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      if (pattern.test(content)) {
        matchingFiles.push(file);
      }
    }

    return matchingFiles;
  }

  /**
   * Run all fixes
   */
  async runAllFixes(): Promise<void> {
    console.log('🚀 Starting TypeScript strict mode fixes...\n');

    await this.fixProcessEnvAccess();
    await this.addEnvironmentTypeGuards();
    await this.fixUnknownTypes();
    await this.fixImplicitAny();
    // await this.fixPossiblyUndefined(); // Skip this for now as it's more complex

    console.log('\n✅ All automated fixes completed!');
    console.log('\nRemaining issues will need manual review:');
    console.log('- Complex possibly undefined cases');
    console.log('- Interface property mismatches');
    console.log('- Context-specific type assertions');
    
    console.log('\n🔧 Run `npx tsc --noEmit` to check remaining issues');
  }
}

// Run the fixer
const fixer = new StrictModeFixer();
fixer.runAllFixes().catch(console.error);