#!/usr/bin/env node

/**
 * Security Analysis Script for StackMemory CLI/API
 * Analyzes code for input validation and security vulnerabilities
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, extname } from 'path';

const SECURITY_ISSUES = {
  CRITICAL: [],
  HIGH: [],
  MEDIUM: [],
  LOW: []
};

// Color helpers
const red = (str) => `\x1b[31m${str}\x1b[0m`;
const yellow = (str) => `\x1b[33m${str}\x1b[0m`;
const green = (str) => `\x1b[32m${str}\x1b[0m`;
const blue = (str) => `\x1b[34m${str}\x1b[0m`;

// Security patterns to check
const SECURITY_PATTERNS = {
  SQL_INJECTION: {
    patterns: [
      /\.prepare\s*\(\s*[`"'].*\$\{.*\}.*[`"']\s*\)/g,
      /\.prepare\s*\(\s*[`"'].*\+.*[`"']\s*\)/g,
      /\.exec\s*\(\s*[^`"'].*\)/g,
      /WHERE.*LIKE\s*\?/gi
    ],
    severity: 'HIGH',
    description: 'Potential SQL injection vulnerability'
  },
  COMMAND_INJECTION: {
    patterns: [
      /exec\s*\(.*\$\{.*\}/g,
      /execSync\s*\(.*\$\{.*\}/g,
      /spawn\s*\(.*,\s*\[.*\$\{.*\}/g,
      /child_process.*exec/g
    ],
    severity: 'CRITICAL',
    description: 'Potential command injection vulnerability'
  },
  PATH_TRAVERSAL: {
    patterns: [
      /\.\.\//g,
      /join\s*\(.*process\.cwd\(\).*,.*[^'"]\)/g,
      /readFileSync\s*\([^'"].*\)/g
    ],
    severity: 'HIGH',
    description: 'Potential path traversal vulnerability'
  },
  NO_INPUT_VALIDATION: {
    patterns: [
      /parseInt\s*\(.*\)\s*(?!.*isNaN)/g,
      /JSON\.parse\s*\(.*\)\s*(?!.*try)/g,
      /\.action\s*\(\s*async.*\{[\s\S]*?(?!validate|check|verify)[\s\S]*?\}\)/g
    ],
    severity: 'MEDIUM',
    description: 'Missing input validation'
  },
  HARDCODED_SECRETS: {
    patterns: [
      /api[_-]?key\s*[:=]\s*["'][^"']+["']/gi,
      /secret\s*[:=]\s*["'][^"']+["']/gi,
      /token\s*[:=]\s*["'][^"']+["']/gi,
      /password\s*[:=]\s*["'][^"']+["']/gi
    ],
    severity: 'CRITICAL',
    description: 'Hardcoded secrets detected'
  },
  UNSAFE_REGEX: {
    patterns: [
      /new RegExp\s*\(/g,
      /\/\.\*.*\.\*\//g
    ],
    severity: 'LOW',
    description: 'Potentially unsafe regular expression'
  }
};

// Validation patterns found
const VALIDATION_PATTERNS = {
  INPUT_SANITIZATION: [
    /\.replace\s*\(\/\[.*\]\/g/,
    /\.trim\(\)/,
    /\.slice\(0,\s*\d+\)/,
    /validator\./
  ],
  ERROR_HANDLING: [
    /try\s*\{[\s\S]*?\}\s*catch/,
    /\.catch\s*\(/,
    /if\s*\(!.*\)\s*\{[\s\S]*?throw/,
    /if\s*\(!.*\)\s*\{[\s\S]*?process\.exit/
  ],
  TYPE_CHECKING: [
    /typeof.*===\s*['"]string['"]/,
    /instanceof/,
    /isNaN\s*\(/,
    /Number\.isInteger/
  ],
  BOUNDS_CHECKING: [
    /if\s*\(.*[<>]=?\s*\d+/,
    /Math\.(min|max)\s*\(/,
    /\.slice\(0,\s*\d+\)/
  ],
  SQL_PARAMETERIZATION: [
    /\.prepare\s*\([\s\S]*?\?\s*[\s\S]*?\)/,
    /\.all\s*\(.*\)/,
    /\.run\s*\(.*\)/
  ]
};

// Analyze a file
function analyzeFile(filePath) {
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');
  const fileName = filePath.replace(process.cwd() + '/', '');
  const issues = [];
  const validations = [];
  
  // Check for security patterns
  for (const [name, config] of Object.entries(SECURITY_PATTERNS)) {
    for (const pattern of config.patterns) {
      const matches = content.matchAll(pattern);
      for (const match of matches) {
        const lineNum = content.substring(0, match.index).split('\n').length;
        const line = lines[lineNum - 1]?.trim() || '';
        
        // Skip if it's in a comment
        if (line.startsWith('//') || line.startsWith('*')) continue;
        
        issues.push({
          file: fileName,
          line: lineNum,
          type: name,
          severity: config.severity,
          description: config.description,
          code: line.substring(0, 80)
        });
      }
    }
  }
  
  // Check for validation patterns
  for (const [type, patterns] of Object.entries(VALIDATION_PATTERNS)) {
    for (const pattern of patterns) {
      if (pattern.test(content)) {
        validations.push({
          file: fileName,
          type: type,
          found: true
        });
      }
    }
  }
  
  return { issues, validations };
}

// Recursively find TypeScript files
function findFiles(dir, files = []) {
  const items = readdirSync(dir);
  
  for (const item of items) {
    const fullPath = join(dir, item);
    const stat = statSync(fullPath);
    
    if (stat.isDirectory()) {
      if (!item.includes('node_modules') && !item.startsWith('.')) {
        findFiles(fullPath, files);
      }
    } else if (extname(item) === '.ts' || extname(item) === '.js') {
      files.push(fullPath);
    }
  }
  
  return files;
}

// Main analysis
function main() {
  console.log(blue('\n🔍 StackMemory CLI/API Security Analysis\n'));
  
  const srcDir = join(process.cwd(), 'src');
  const cliFiles = findFiles(join(srcDir, 'cli'));
  const apiFiles = findFiles(join(srcDir, 'features', 'analytics', 'api'));
  const allFiles = [...cliFiles, ...apiFiles];
  
  console.log(`Analyzing ${allFiles.length} files...\n`);
  
  const allIssues = [];
  const allValidations = new Map();
  
  for (const file of allFiles) {
    const { issues, validations } = analyzeFile(file);
    allIssues.push(...issues);
    
    for (const validation of validations) {
      const key = `${validation.file}:${validation.type}`;
      allValidations.set(key, validation);
    }
  }
  
  // Group issues by severity
  for (const issue of allIssues) {
    SECURITY_ISSUES[issue.severity].push(issue);
  }
  
  // Report findings
  console.log(red('🚨 CRITICAL Issues:'), SECURITY_ISSUES.CRITICAL.length);
  for (const issue of SECURITY_ISSUES.CRITICAL) {
    console.log(`  ${issue.file}:${issue.line}`);
    console.log(`    ${issue.description}`);
    console.log(`    ${yellow(issue.code)}`);
  }
  
  console.log(yellow('\n⚠️  HIGH Priority Issues:'), SECURITY_ISSUES.HIGH.length);
  for (const issue of SECURITY_ISSUES.HIGH.slice(0, 10)) {
    console.log(`  ${issue.file}:${issue.line}`);
    console.log(`    ${issue.description}`);
  }
  
  console.log(blue('\n🔵 MEDIUM Priority Issues:'), SECURITY_ISSUES.MEDIUM.length);
  console.log(green('🟢 LOW Priority Issues:'), SECURITY_ISSUES.LOW.length);
  
  // Report validation mechanisms found
  console.log(green('\n✅ Validation Mechanisms Found:'));
  const validationTypes = {};
  for (const validation of allValidations.values()) {
    validationTypes[validation.type] = (validationTypes[validation.type] || 0) + 1;
  }
  
  for (const [type, count] of Object.entries(validationTypes)) {
    console.log(`  ${type}: ${count} occurrences`);
  }
  
  // Specific CLI command analysis
  console.log(blue('\n📋 CLI Command Analysis:'));
  const commands = [
    'init', 'status', 'linear', 'search', 'projects', 'config',
    'analytics', 'tasks', 'context', 'session'
  ];
  
  for (const cmd of commands) {
    const cmdFile = allFiles.find(f => f.includes(`commands/${cmd}.ts`));
    if (cmdFile) {
      const content = readFileSync(cmdFile, 'utf8');
      const hasValidation = /validate|check|verify|isValid|sanitize/i.test(content);
      const hasErrorHandling = /try\s*\{|\.catch\(|error\s*:/i.test(content);
      const usesParams = /\.prepare\s*\([\s\S]*?\?/.test(content);
      
      console.log(`  ${cmd}:`);
      console.log(`    Input validation: ${hasValidation ? green('✓') : red('✗')}`);
      console.log(`    Error handling: ${hasErrorHandling ? green('✓') : red('✗')}`);
      console.log(`    SQL parameterized: ${usesParams ? green('✓') : yellow('⚠')}`);
    }
  }
  
  // Summary and recommendations
  console.log(blue('\n📊 Summary:'));
  const total = allIssues.length;
  const critical = SECURITY_ISSUES.CRITICAL.length;
  const high = SECURITY_ISSUES.HIGH.length;
  
  if (critical > 0) {
    console.log(red(`  ❌ ${critical} CRITICAL issues require immediate attention`));
  }
  if (high > 0) {
    console.log(yellow(`  ⚠️  ${high} HIGH priority issues should be fixed soon`));
  }
  
  console.log(blue('\n🔧 Recommendations:'));
  console.log('  1. Add input validation for all CLI arguments');
  console.log('  2. Use parameterized queries for all SQL operations');
  console.log('  3. Sanitize file paths to prevent traversal attacks');
  console.log('  4. Implement rate limiting for API endpoints');
  console.log('  5. Add comprehensive error handling');
  console.log('  6. Use environment variables for all sensitive data');
  console.log('  7. Implement proper authentication checks');
  console.log('  8. Add input length limits to prevent DoS');
  
  process.exit(critical > 0 ? 1 : 0);
}

main();