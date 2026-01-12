#!/usr/bin/env node

/**
 * Security Secrets Scanner Skill
 * Detects and fixes hardcoded secrets in code files
 */

import { execSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { glob } from 'glob';

interface SecretPattern {
  pattern: RegExp;
  name: string;
  envVar: string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  { pattern: /lin_api_[a-zA-Z0-9]{40}/, name: 'Linear API Key', envVar: 'LINEAR_API_KEY' },
  { pattern: /lin_oauth_[a-zA-Z0-9]{64}/, name: 'Linear OAuth Token', envVar: 'LINEAR_OAUTH_TOKEN' },
  { pattern: /sk-[a-zA-Z0-9]{48}/, name: 'OpenAI API Key', envVar: 'OPENAI_API_KEY' },
  { pattern: /npm_[a-zA-Z0-9]{36}/, name: 'NPM Token', envVar: 'NPM_TOKEN' },
  { pattern: /ghp_[a-zA-Z0-9]{36}/, name: 'GitHub Token', envVar: 'GITHUB_TOKEN' },
  { pattern: /ghs_[a-zA-Z0-9]{36}/, name: 'GitHub Secret', envVar: 'GITHUB_SECRET' },
  { pattern: /pk_live_[a-zA-Z0-9]{24,}/, name: 'Stripe Live Key', envVar: 'STRIPE_LIVE_KEY' },
  { pattern: /sk_live_[a-zA-Z0-9]{24,}/, name: 'Stripe Secret Key', envVar: 'STRIPE_SECRET_KEY' },
];

export class SecuritySecretsScanner {
  private detectedSecrets: Map<string, Set<string>> = new Map();

  /**
   * Scan files for hardcoded secrets
   */
  async scanForSecrets(patterns: string[] = ['**/*.js', '**/*.ts', '**/*.jsx', '**/*.tsx', '**/*.sh']): Promise<void> {
    console.log('🔍 Scanning for hardcoded secrets...\n');

    for (const pattern of patterns) {
      const files = await glob(pattern, { 
        ignore: ['node_modules/**', 'dist/**', 'build/**', '.git/**'] 
      });

      for (const file of files) {
        await this.scanFile(file);
      }
    }

    this.reportFindings();
  }

  /**
   * Scan a single file for secrets
   */
  private async scanFile(filePath: string): Promise<void> {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    lines.forEach((line, index) => {
      for (const secretPattern of SECRET_PATTERNS) {
        if (secretPattern.pattern.test(line)) {
          if (!this.detectedSecrets.has(filePath)) {
            this.detectedSecrets.set(filePath, new Set());
          }
          this.detectedSecrets.get(filePath)!.add(
            `Line ${index + 1}: ${secretPattern.name} detected (use ${secretPattern.envVar})`
          );
        }
      }
    });
  }

  /**
   * Report findings
   */
  private reportFindings(): void {
    if (this.detectedSecrets.size === 0) {
      console.log('✅ No hardcoded secrets detected!\n');
      return;
    }

    console.log(`⚠️  Found hardcoded secrets in ${this.detectedSecrets.size} files:\n`);
    
    for (const [file, secrets] of this.detectedSecrets) {
      console.log(`📄 ${file}:`);
      for (const secret of secrets) {
        console.log(`   ${secret}`);
      }
      console.log();
    }

    console.log('📝 How to fix:');
    console.log('1. Replace hardcoded values with process.env.VARIABLE_NAME');
    console.log('2. Add "import \'dotenv/config\'" at the top of the file');
    console.log('3. Add the actual values to your .env file');
    console.log('4. Never commit .env files to git\n');
  }

  /**
   * Auto-fix secrets in files
   */
  async autoFix(): Promise<void> {
    console.log('🔧 Auto-fixing hardcoded secrets...\n');

    for (const [filePath, _] of this.detectedSecrets) {
      let content = fs.readFileSync(filePath, 'utf-8');
      let modified = false;

      // Add dotenv import if it's a JS/TS file and doesn't have it
      if ((filePath.endsWith('.js') || filePath.endsWith('.ts')) && 
          !content.includes('dotenv/config') && 
          !content.includes('require(\'dotenv\')')) {
        
        // Add after shebang if present, otherwise at the top
        if (content.startsWith('#!/')) {
          const firstNewline = content.indexOf('\n');
          content = content.slice(0, firstNewline + 1) + 
                   '\nimport \'dotenv/config\';\n' + 
                   content.slice(firstNewline + 1);
        } else {
          content = 'import \'dotenv/config\';\n\n' + content;
        }
        modified = true;
      }

      // Replace secrets with environment variables
      for (const pattern of SECRET_PATTERNS) {
        const regex = new RegExp(`(['"\`])(${pattern.pattern.source})(['"\`])`, 'g');
        const replacement = `process.env.${pattern.envVar}`;
        
        if (regex.test(content)) {
          content = content.replace(regex, replacement);
          modified = true;

          // Add error checking after the variable definition
          const varPattern = new RegExp(`const\\s+(\\w+)\\s*=\\s*process\\.env\\.${pattern.envVar}`);
          const match = content.match(varPattern);
          if (match) {
            const varName = match[1];
            const checkCode = `\nif (!${varName}) {\n` +
              `  console.error('❌ ${pattern.envVar} environment variable not set');\n` +
              `  console.log('Please set ${pattern.envVar} in your .env file or export it in your shell');\n` +
              `  process.exit(1);\n}\n`;
            
            // Insert after the variable declaration
            const insertPos = content.indexOf(match[0]) + match[0].length;
            content = content.slice(0, insertPos) + checkCode + content.slice(insertPos);
          }
        }
      }

      if (modified) {
        fs.writeFileSync(filePath, content);
        console.log(`✅ Fixed ${filePath}`);
      }
    }

    console.log('\n📋 Next steps:');
    console.log('1. Review the changes');
    console.log('2. Add actual values to .env file');
    console.log('3. Test that everything still works');
    console.log('4. Commit the fixes\n');
  }

  /**
   * Check git history for secrets
   */
  async checkGitHistory(): Promise<void> {
    console.log('🔍 Checking git history for secrets...\n');

    try {
      for (const pattern of SECRET_PATTERNS) {
        const command = `git log -p --all -G"${pattern.pattern.source}" --format="%H %s" | head -20`;
        const result = execSync(command, { encoding: 'utf-8', stdio: 'pipe' }).trim();
        
        if (result) {
          console.log(`⚠️  Found ${pattern.name} in git history:`);
          console.log(result.split('\n').slice(0, 3).join('\n'));
          console.log('...\n');
        }
      }

      console.log('📝 To clean git history:');
      console.log('1. Use BFG Repo-Cleaner: bfg --replace-text passwords.txt');
      console.log('2. Or interactive rebase: git rebase -i <commit>');
      console.log('3. Or allow via GitHub: Check push error for allow URLs\n');
    } catch (error) {
      console.log('Could not check git history');
    }
  }

  /**
   * Generate pre-commit hook
   */
  generatePreCommitHook(): void {
    const hookContent = `#!/bin/sh
# Pre-commit hook to check for hardcoded secrets

echo "🔍 Checking for hardcoded secrets..."

# Patterns to check
patterns=(
  "lin_api_[a-zA-Z0-9]{40}"
  "lin_oauth_[a-zA-Z0-9]{64}"
  "sk-[a-zA-Z0-9]{48}"
  "npm_[a-zA-Z0-9]{36}"
  "ghp_[a-zA-Z0-9]{36}"
  "pk_live_[a-zA-Z0-9]{24,}"
  "sk_live_[a-zA-Z0-9]{24,}"
)

# Check staged files
for pattern in "\${patterns[@]}"; do
  if git diff --staged --no-color | grep -E "$pattern"; then
    echo "❌ Found hardcoded secret matching: $pattern"
    echo "Please use environment variables instead!"
    exit 1
  fi
done

echo "✅ No hardcoded secrets detected"
exit 0
`;

    const hookPath = '.git/hooks/pre-commit';
    fs.writeFileSync(hookPath, hookContent);
    fs.chmodSync(hookPath, '755');
    
    console.log('✅ Generated pre-commit hook at .git/hooks/pre-commit');
    console.log('This will prevent committing hardcoded secrets in the future.\n');
  }
}

// CLI usage
import { fileURLToPath } from 'url';
import { dirname } from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

if (import.meta.url === `file://${process.argv[1]}`) {
  const scanner = new SecuritySecretsScanner();
  const command = process.argv[2];

  (async () => {
    switch (command) {
      case 'scan':
        await scanner.scanForSecrets();
        break;
      case 'fix':
        await scanner.scanForSecrets();
        await scanner.autoFix();
        break;
      case 'history':
        await scanner.checkGitHistory();
        break;
      case 'hook':
        scanner.generatePreCommitHook();
        break;
      default:
        console.log('Usage: security-secrets-scanner [scan|fix|history|hook]');
        console.log('  scan    - Scan for hardcoded secrets');
        console.log('  fix     - Auto-fix hardcoded secrets');
        console.log('  history - Check git history for secrets');
        console.log('  hook    - Generate pre-commit hook');
    }
  })();
}