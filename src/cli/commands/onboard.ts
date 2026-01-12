#!/usr/bin/env node
/**
 * StackMemory Onboarding CLI
 * Interactive setup for new StackMemory installations
 */

import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync } from 'fs';
import { execSync } from 'child_process';
import { WorktreeManager } from '../../core/worktree/worktree-manager.js';
import { ProjectManager } from '../../core/projects/project-manager.js';
import { logger } from '../../core/monitoring/logger.js';

interface OnboardingConfig {
  setupType: 'basic' | 'advanced';
  enableWorktrees: boolean;
  worktreeIsolation: boolean;
  enableProjects: boolean;
  scanProjects: boolean;
  enableLinear: boolean;
  linearApiKey?: string;
  enableAnalytics: boolean;
  defaultContextPath: string;
}

export function registerOnboardingCommand(program: Command): void {
  program
    .command('onboard')
    .alias('setup')
    .description('Interactive setup for StackMemory')
    .option('--reset', 'Reset all configurations and start fresh')
    .action(async (options) => {
      console.log(chalk.cyan('\n🚀 Welcome to StackMemory Setup!\n'));

      // Check if already configured
      const configPath = join(homedir(), '.stackmemory');
      if (existsSync(configPath) && !options.reset) {
        const { proceed } = await inquirer.prompt([
          {
            type: 'confirm',
            name: 'proceed',
            message:
              'StackMemory is already configured. Do you want to reconfigure?',
            default: false,
          },
        ]);

        if (!proceed) {
          console.log(chalk.yellow('\nSetup cancelled.'));
          return;
        }
      }

      try {
        const config = await runOnboarding();
        await applyConfiguration(config);

        console.log(
          chalk.green('\n✅ StackMemory setup completed successfully!\n')
        );
        showNextSteps(config);
      } catch (error: unknown) {
        logger.error('Onboarding failed', error as Error);
        console.error(
          chalk.red('\n❌ Setup failed:'),
          (error as Error).message
        );
        process.exit(1);
      }
    });
}

async function runOnboarding(): Promise<OnboardingConfig> {
  // Basic or Advanced Setup
  const { setupType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'setupType',
      message: 'Choose your setup type:',
      choices: [
        { name: 'Basic (Recommended for most users)', value: 'basic' },
        { name: 'Advanced (Full customization)', value: 'advanced' },
      ],
      default: 'basic',
    },
  ]);

  let config: OnboardingConfig = {
    setupType,
    enableWorktrees: false,
    worktreeIsolation: true,
    enableProjects: true,
    scanProjects: false,
    enableLinear: false,
    enableAnalytics: true,
    defaultContextPath: join(homedir(), '.stackmemory'),
  };

  if (setupType === 'basic') {
    // Basic setup with sensible defaults
    const basicAnswers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'enableWorktrees',
        message:
          'Enable Git worktree support? (Recommended for multi-branch workflows)',
        default: false,
      },
      {
        type: 'confirm',
        name: 'scanProjects',
        message: 'Scan and organize your existing projects?',
        default: true,
      },
      {
        type: 'confirm',
        name: 'enableLinear',
        message: 'Connect to Linear for task management?',
        default: false,
      },
    ]);

    config = { ...config, ...basicAnswers };

    if (basicAnswers.enableLinear) {
      const { linearApiKey } = await inquirer.prompt([
        {
          type: 'password',
          name: 'linearApiKey',
          message: 'Enter your Linear API key:',
          validate: (input: string) =>
            input.length > 0 || 'API key is required',
        },
      ]);
      config.linearApiKey = linearApiKey;
    }
  } else {
    // Advanced setup with all options
    const advancedAnswers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'enableWorktrees',
        message: 'Enable Git worktree support?',
        default: false,
      },
    ]);

    if (advancedAnswers.enableWorktrees) {
      const worktreeAnswers = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'worktreeIsolation',
          message: 'Isolate contexts between worktrees? (Recommended)',
          default: true,
        },
        {
          type: 'confirm',
          name: 'autoDetect',
          message: 'Auto-detect worktrees when switching directories?',
          default: true,
        },
        {
          type: 'confirm',
          name: 'shareGlobal',
          message: 'Share global context across worktrees?',
          default: false,
        },
        {
          type: 'number',
          name: 'syncInterval',
          message: 'Context sync interval in minutes (0 to disable):',
          default: 15,
          validate: (input: number) => input >= 0 || 'Must be 0 or positive',
        },
      ]);

      config = { ...config, ...advancedAnswers, ...worktreeAnswers };
    }

    const projectAnswers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'enableProjects',
        message: 'Enable automatic project management?',
        default: true,
      },
    ]);

    if (projectAnswers.enableProjects) {
      const projectDetailAnswers: any = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'scanProjects',
          message: 'Scan for existing projects now?',
          default: true,
        },
        {
          type: 'checkbox',
          name: 'scanPaths',
          message: 'Select directories to scan:',
          choices: [
            { name: '~/Dev', value: join(homedir(), 'Dev'), checked: true },
            { name: '~/dev', value: join(homedir(), 'dev'), checked: true },
            {
              name: '~/Projects',
              value: join(homedir(), 'Projects'),
              checked: true,
            },
            {
              name: '~/projects',
              value: join(homedir(), 'projects'),
              checked: true,
            },
            { name: '~/Work', value: join(homedir(), 'Work'), checked: false },
            { name: '~/code', value: join(homedir(), 'code'), checked: true },
            {
              name: '~/Documents/GitHub',
              value: join(homedir(), 'Documents/GitHub'),
              checked: false,
            },
          ],
          when: (): boolean => projectDetailAnswers.scanProjects,
        },
      ]);

      config = { ...config, ...projectAnswers, ...projectDetailAnswers };
    }

    const integrationAnswers = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'enableLinear',
        message: 'Enable Linear integration?',
        default: false,
      },
      {
        type: 'password',
        name: 'linearApiKey',
        message: 'Linear API key:',
        when: (answers: any) => answers.enableLinear,
        validate: (input: string) => input.length > 0 || 'API key is required',
      },
      {
        type: 'confirm',
        name: 'enableAnalytics',
        message: 'Enable usage analytics? (Local only)',
        default: true,
      },
      {
        type: 'input',
        name: 'defaultContextPath',
        message: 'Default context storage path:',
        default: join(homedir(), '.stackmemory'),
        validate: (input: string) => input.length > 0 || 'Path is required',
      },
    ]);

    config = { ...config, ...integrationAnswers };
  }

  return config;
}

async function applyConfiguration(config: OnboardingConfig): Promise<void> {
  const configPath = join(homedir(), '.stackmemory');

  // Create base directory structure
  console.log(chalk.gray('\nCreating directory structure...'));
  const dirs = [
    configPath,
    join(configPath, 'contexts'),
    join(configPath, 'projects'),
    join(configPath, 'worktrees'),
    join(configPath, 'bin'),
    join(configPath, 'logs'),
    join(configPath, 'analytics'),
  ];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  // Configure git worktree support
  if (config.enableWorktrees) {
    console.log(chalk.gray('Configuring worktree support...'));
    const worktreeManager = WorktreeManager.getInstance();
    worktreeManager.saveConfig({
      enabled: true,
      autoDetect: true,
      isolateContexts: config.worktreeIsolation,
      shareGlobalContext: false,
      syncInterval: 15,
    });

    // Detect current worktrees
    const worktrees = worktreeManager.detectWorktrees();
    if (worktrees.length > 0) {
      console.log(chalk.green(`  ✓ Found ${worktrees.length} worktree(s)`));
      worktrees.forEach((wt) => {
        console.log(chalk.gray(`    - ${wt.branch} at ${wt.path}`));
      });
    }
  }

  // Scan and organize projects
  if (config.enableProjects && config.scanProjects) {
    console.log(chalk.gray('Scanning for projects...'));
    const projectManager = ProjectManager.getInstance();

    const scanPaths = (config as any).scanPaths || [
      join(homedir(), 'Dev'),
      join(homedir(), 'dev'),
      join(homedir(), 'Projects'),
      join(homedir(), 'projects'),
      join(homedir(), 'code'),
    ];

    await projectManager.scanAndCategorizeAllProjects(
      scanPaths.filter((p: string) => existsSync(p))
    );

    const projects = projectManager.getAllProjects();
    console.log(chalk.green(`  ✓ Found ${projects.length} project(s)`));

    // Show summary
    const byType: Record<string, number> = {};
    projects.forEach((p) => {
      byType[p.accountType] = (byType[p.accountType] || 0) + 1;
    });

    Object.entries(byType).forEach(([type, count]) => {
      console.log(chalk.gray(`    - ${type}: ${count} project(s)`));
    });
  }

  // Configure Linear integration
  if (config.enableLinear && config.linearApiKey) {
    console.log(chalk.gray('Configuring Linear integration...'));
    const linearConfig = {
      apiKey: config.linearApiKey,
      autoSync: true,
      syncInterval: 300000, // 5 minutes
    };

    writeFileSync(
      join(configPath, 'linear-config.json'),
      JSON.stringify(linearConfig, null, 2)
    );
    console.log(chalk.green('  ✓ Linear configured'));
  }

  // Save main configuration
  const mainConfig = {
    version: '1.0.0',
    setupCompleted: new Date().toISOString(),
    features: {
      worktrees: config.enableWorktrees,
      projects: config.enableProjects,
      linear: config.enableLinear,
      analytics: config.enableAnalytics,
    },
    paths: {
      default: config.defaultContextPath,
    },
  };

  writeFileSync(
    join(configPath, 'config.json'),
    JSON.stringify(mainConfig, null, 2)
  );

  // Create claude-sm symlink for easy access
  const binPath = '/usr/local/bin/claude-sm';
  const sourcePath = join(configPath, 'bin', 'stackmemory');

  try {
    // Create wrapper script
    const wrapperScript = `#!/bin/bash
# StackMemory CLI wrapper with worktree support
CURRENT_DIR=$(pwd)

# Auto-detect worktree if enabled
if [ -f ~/.stackmemory/worktree-config.json ]; then
  WORKTREE_ENABLED=$(grep '"enabled": true' ~/.stackmemory/worktree-config.json)
  if [ ! -z "$WORKTREE_ENABLED" ]; then
    # Check if we're in a git worktree
    if git worktree list &>/dev/null; then
      export SM_WORKTREE_PATH="$CURRENT_DIR"
    fi
  fi
fi

# Run StackMemory with context
exec stackmemory "$@"
`;

    writeFileSync(sourcePath, wrapperScript);
    execSync(`chmod +x ${sourcePath}`);

    // Create symlink if it doesn't exist
    if (!existsSync(binPath)) {
      execSync(`ln -s ${sourcePath} ${binPath}`);
      console.log(chalk.green('  ✓ Created claude-sm command'));
    }
  } catch (error: unknown) {
    console.log(
      chalk.yellow('  ⚠ Could not create claude-sm symlink (may need sudo)')
    );
  }
}

function showNextSteps(config: OnboardingConfig): void {
  console.log(chalk.cyan('🎉 Next Steps:\n'));

  console.log('1. Initialize StackMemory in your project:');
  console.log(chalk.gray('   cd your-project'));
  console.log(chalk.gray('   stackmemory init\n'));

  if (config.enableWorktrees) {
    console.log('2. Create a new worktree:');
    console.log(
      chalk.gray(
        '   git worktree add -b feature/new-feature ../project-feature'
      )
    );
    console.log(chalk.gray('   cd ../project-feature'));
    console.log(
      chalk.gray(
        '   stackmemory status  # Isolated context for this worktree\n'
      )
    );
  }

  console.log('3. Use with Claude:');
  console.log(chalk.gray('   claude-sm  # Or use stackmemory directly\n'));

  if (config.enableLinear) {
    console.log('4. Sync with Linear:');
    console.log(chalk.gray('   stackmemory linear sync\n'));
  }

  console.log('For more help:');
  console.log(chalk.gray('   stackmemory --help'));
  console.log(chalk.gray('   stackmemory projects --help'));
  if (config.enableWorktrees) {
    console.log(chalk.gray('   stackmemory worktree --help'));
  }
}
