#!/usr/bin/env tsx

/**
 * Comprehensive Duplicate Check Script
 * Scans all tasks in memory and checks for duplicates in Linear
 */

import { LinearClient } from '../dist/integrations/linear/client.js';
import { LinearDuplicateDetector } from '../dist/integrations/linear/sync-enhanced.js';
import { LinearAuthManager } from '../dist/integrations/linear/auth.js';
import { join } from 'path';
import { existsSync, writeFileSync, readFileSync } from 'fs';
import chalk from 'chalk';
import ora from 'ora';
import Table from 'cli-table3';

interface DuplicateReport {
  taskId: string;
  taskTitle: string;
  duplicates: Array<{
    linearId: string;
    identifier: string;
    title: string;
    similarity: number;
    url: string;
  }>;
  recommendation: 'merge' | 'skip' | 'review';
}

class DuplicateChecker {
  private linearClient: LinearClient;
  private duplicateDetector: LinearDuplicateDetector;
  private authManager: LinearAuthManager;
  private projectRoot: string;
  private report: DuplicateReport[] = [];

  constructor() {
    this.projectRoot = process.cwd();
  }

  async initialize(): Promise<void> {
    // Check database
    const dbPath = join(this.projectRoot, '.stackmemory', 'context.db');
    if (!existsSync(dbPath)) {
      throw new Error(
        'StackMemory not initialized. Run "stackmemory init" first.'
      );
    }

    // Initialize Linear auth - check env var first
    const envApiKey = process.env.LINEAR_API_KEY;

    if (envApiKey) {
      // Use environment variable API key
      this.linearClient = new LinearClient({
        apiKey: envApiKey,
        useBearer: false,
      });
    } else {
      // Try OAuth auth
      this.authManager = new LinearAuthManager(this.projectRoot);
      const token = await this.authManager.getValidToken();

      if (!token) {
        throw new Error(
          'Linear not authenticated. Set LINEAR_API_KEY env var or run "stackmemory linear auth".'
        );
      }

      // Check if using OAuth by looking for refresh token
      const tokens = this.authManager.loadTokens();
      const isOAuth = !!(tokens && tokens.refreshToken);

      this.linearClient = new LinearClient({
        apiKey: token,
        useBearer: isOAuth,
        onUnauthorized: isOAuth
          ? async () => {
              const refreshed = await this.authManager.refreshAccessToken();
              return refreshed.accessToken;
            }
          : undefined,
      });
    }

    // Initialize duplicate detector
    this.duplicateDetector = new LinearDuplicateDetector(this.linearClient);
  }

  async runFullScan(): Promise<void> {
    console.log(chalk.cyan('\n🔍 Starting Comprehensive Duplicate Check\n'));

    // Get all tasks from memory
    const spinner = ora('Loading tasks from memory...').start();

    // Read tasks from JSONL file
    const tasksFile = join(this.projectRoot, '.stackmemory', 'tasks.jsonl');
    const tasksData = existsSync(tasksFile)
      ? readFileSync(tasksFile, 'utf8')
          .split('\n')
          .filter((line) => line.trim())
      : [];
    const tasks = tasksData.map((line) => JSON.parse(line));

    spinner.succeed(`Loaded ${tasks.length} tasks from memory`);

    // Get default team ID
    spinner.start('Connecting to Linear...');
    const teams = await this.linearClient.getTeams();
    const defaultTeamId = teams[0]?.id;
    spinner.succeed(`Connected to Linear (Team: ${teams[0]?.name})`);

    // Progress tracking
    let checked = 0;
    let duplicatesFound = 0;
    const startTime = Date.now();

    console.log(
      chalk.yellow(`\n📊 Checking ${tasks.length} tasks for duplicates...\n`)
    );

    // Check each task for duplicates
    for (const task of tasks) {
      checked++;

      // Update progress
      const progress = Math.round((checked / tasks.length) * 100);
      spinner.start(
        `[${progress}%] Checking: ${task.title.substring(0, 50)}...`
      );

      try {
        // Skip if task already has Linear ID mapped
        if (task.external_refs?.linear_id) {
          spinner.info(
            `[${progress}%] Skipped (already mapped): ${task.title.substring(0, 40)}...`
          );
          continue;
        }

        // Check for duplicates
        const duplicateCheck = await this.duplicateDetector.checkForDuplicate(
          task.title,
          defaultTeamId
        );

        if (duplicateCheck.isDuplicate && duplicateCheck.existingIssue) {
          duplicatesFound++;

          // Add to report
          this.report.push({
            taskId: task.id,
            taskTitle: task.title,
            duplicates: [
              {
                linearId: duplicateCheck.existingIssue.id,
                identifier: duplicateCheck.existingIssue.identifier,
                title: duplicateCheck.existingIssue.title,
                similarity: duplicateCheck.similarity || 0,
                url: duplicateCheck.existingIssue.url,
              },
            ],
            recommendation:
              (duplicateCheck.similarity ?? 0) > 0.95
                ? 'merge'
                : (duplicateCheck.similarity ?? 0) > 0.85
                  ? 'review'
                  : 'skip',
          });

          spinner.warn(
            `[${progress}%] DUPLICATE FOUND: "${task.title.substring(0, 30)}..." → ${duplicateCheck.existingIssue.identifier} (${Math.round((duplicateCheck.similarity || 0) * 100)}% match)`
          );
        } else {
          spinner.succeed(
            `[${progress}%] No duplicates: ${task.title.substring(0, 40)}...`
          );
        }

        // Rate limiting delay
        await this.delay(100);
      } catch (error: unknown) {
        spinner.fail(
          `[${progress}%] Error checking task: ${(error as Error).message}`
        );
      }
    }

    const duration = Math.round((Date.now() - startTime) / 1000);

    console.log(chalk.green(`\n✅ Duplicate check completed in ${duration}s`));
    console.log(chalk.cyan(`\n📈 Summary:`));
    console.log(`  • Total tasks checked: ${checked}`);
    console.log(`  • Duplicates found: ${duplicatesFound}`);
    console.log(
      `  • Check rate: ${Math.round(checked / duration)} tasks/second`
    );
  }

  displayReport(): void {
    if (this.report.length === 0) {
      console.log(
        chalk.green('\n✨ No duplicates found! Your tasks are unique.\n')
      );
      return;
    }

    console.log(
      chalk.yellow(`\n⚠️  Found ${this.report.length} potential duplicates:\n`)
    );

    // Group by recommendation
    const mergeItems = this.report.filter((r) => r.recommendation === 'merge');
    const reviewItems = this.report.filter(
      (r) => r.recommendation === 'review'
    );
    const skipItems = this.report.filter((r) => r.recommendation === 'skip');

    // Display high confidence duplicates (merge)
    if (mergeItems.length > 0) {
      console.log(
        chalk.red(
          '🔴 High Confidence Duplicates (>95% match) - Recommend Merge:\n'
        )
      );
      const table = new Table({
        head: ['Local Task', 'Linear Issue', 'Match %', 'URL'],
        style: { head: ['red'] },
        colWidths: [40, 15, 10, 50],
      });

      mergeItems.forEach((item) => {
        item.duplicates.forEach((dup) => {
          table.push([
            item.taskTitle.substring(0, 38),
            dup.identifier,
            `${Math.round(dup.similarity * 100)}%`,
            dup.url.substring(0, 48),
          ]);
        });
      });

      console.log(table.toString());
    }

    // Display medium confidence duplicates (review)
    if (reviewItems.length > 0) {
      console.log(
        chalk.yellow(
          '\n🟡 Medium Confidence Duplicates (85-95% match) - Recommend Review:\n'
        )
      );
      const table = new Table({
        head: ['Local Task', 'Linear Issue', 'Match %', 'Linear Title'],
        style: { head: ['yellow'] },
        colWidths: [35, 15, 10, 40],
      });

      reviewItems.forEach((item) => {
        item.duplicates.forEach((dup) => {
          table.push([
            item.taskTitle.substring(0, 33),
            dup.identifier,
            `${Math.round(dup.similarity * 100)}%`,
            dup.title.substring(0, 38),
          ]);
        });
      });

      console.log(table.toString());
    }

    // Display low confidence (skip)
    if (skipItems.length > 0) {
      console.log(
        chalk.gray(
          `\n🔵 Low Confidence Matches (<85%) - ${skipItems.length} items (not shown)\n`
        )
      );
    }
  }

  async saveReport(): Promise<void> {
    if (this.report.length === 0) return;

    const reportPath = join(
      this.projectRoot,
      '.stackmemory',
      'duplicate-report.json'
    );
    const markdownPath = join(
      this.projectRoot,
      '.stackmemory',
      'duplicate-report.md'
    );

    // Save JSON report
    writeFileSync(reportPath, JSON.stringify(this.report, null, 2));

    // Generate markdown report
    let markdown = '# Linear Duplicate Check Report\n\n';
    markdown += `**Generated:** ${new Date().toLocaleString()}\n`;
    markdown += `**Total Duplicates Found:** ${this.report.length}\n\n`;

    // High confidence section
    const mergeItems = this.report.filter((r) => r.recommendation === 'merge');
    if (mergeItems.length > 0) {
      markdown += '## 🔴 High Confidence Duplicates (>95% match)\n\n';
      markdown += 'These should be merged:\n\n';
      mergeItems.forEach((item) => {
        item.duplicates.forEach((dup) => {
          markdown += `- **${item.taskTitle}**\n`;
          markdown += `  - Linear: [${dup.identifier}](${dup.url}) - ${Math.round(dup.similarity * 100)}% match\n`;
          markdown += `  - Action: MERGE\n\n`;
        });
      });
    }

    // Medium confidence section
    const reviewItems = this.report.filter(
      (r) => r.recommendation === 'review'
    );
    if (reviewItems.length > 0) {
      markdown += '## 🟡 Medium Confidence Duplicates (85-95% match)\n\n';
      markdown += 'These need manual review:\n\n';
      reviewItems.forEach((item) => {
        item.duplicates.forEach((dup) => {
          markdown += `- **${item.taskTitle}**\n`;
          markdown += `  - Linear: [${dup.identifier}](${dup.url}) - "${dup.title}"\n`;
          markdown += `  - Match: ${Math.round(dup.similarity * 100)}%\n`;
          markdown += `  - Action: REVIEW\n\n`;
        });
      });
    }

    // Save markdown
    writeFileSync(markdownPath, markdown);

    console.log(chalk.green(`\n📁 Reports saved:`));
    console.log(chalk.gray(`  • JSON: ${reportPath}`));
    console.log(chalk.gray(`  • Markdown: ${markdownPath}`));
  }

  async suggestActions(): Promise<void> {
    const mergeCount = this.report.filter(
      (r) => r.recommendation === 'merge'
    ).length;
    const reviewCount = this.report.filter(
      (r) => r.recommendation === 'review'
    ).length;

    if (mergeCount > 0 || reviewCount > 0) {
      console.log(chalk.cyan('\n💡 Recommended Actions:\n'));

      if (mergeCount > 0) {
        console.log(chalk.green('1. Auto-merge high confidence duplicates:'));
        console.log(
          chalk.gray(
            '   stackmemory linear sync --merge-strategy merge_content\n'
          )
        );
      }

      if (reviewCount > 0) {
        console.log(
          chalk.yellow('2. Review medium confidence duplicates manually:')
        );
        console.log(
          chalk.gray(
            '   Review the duplicate-report.md file and decide per case\n'
          )
        );
      }

      console.log(
        chalk.blue('3. Enable duplicate prevention for future syncs:')
      );
      console.log(
        chalk.gray(
          '   stackmemory linear sync --daemon --merge-strategy merge_content\n'
        )
      );
    }
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}

// Main execution
async function main() {
  const checker = new DuplicateChecker();

  try {
    // Initialize
    await checker.initialize();

    // Run full scan
    await checker.runFullScan();

    // Display report
    checker.displayReport();

    // Save reports
    await checker.saveReport();

    // Suggest actions
    await checker.suggestActions();

    process.exit(0);
  } catch (error: unknown) {
    console.error(chalk.red('\n❌ Error:'), (error as Error).message);
    process.exit(1);
  }
}

// Run if executed directly
main();
