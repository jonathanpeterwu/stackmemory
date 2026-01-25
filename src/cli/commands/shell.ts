/**
 * Shell Integration CLI Command
 * Install Sweep-powered completions for zsh/bash
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import {
  existsSync,
  readFileSync,
  writeFileSync,
  mkdirSync,
  copyFileSync,
  chmodSync,
  appendFileSync,
} from 'fs';
import { join } from 'path';

// __filename and __dirname are provided by esbuild banner for ESM compatibility

function getShellType(): 'zsh' | 'bash' | 'unknown' {
  const shell = process.env.SHELL || '';
  if (shell.includes('zsh')) return 'zsh';
  if (shell.includes('bash')) return 'bash';
  return 'unknown';
}

function getShellRcFile(): string {
  const home = process.env.HOME || '';
  const shell = getShellType();

  if (shell === 'zsh') {
    return join(home, '.zshrc');
  } else if (shell === 'bash') {
    const bashrc = join(home, '.bashrc');
    const profile = join(home, '.bash_profile');
    return existsSync(bashrc) ? bashrc : profile;
  }

  return join(home, '.profile');
}

function findTemplateFile(filename: string): string | null {
  const locations = [
    join(process.cwd(), 'templates', 'shell', filename),
    join(
      process.cwd(),
      'node_modules',
      '@stackmemoryai',
      'stackmemory',
      'templates',
      'shell',
      filename
    ),
    join(dirname(dirname(dirname(__dirname))), 'templates', 'shell', filename),
  ];

  for (const loc of locations) {
    if (existsSync(loc)) {
      return loc;
    }
  }
  return null;
}

export function createShellCommand(): Command {
  const cmd = new Command('shell')
    .description('Shell integration for Sweep-powered completions')
    .addHelpText(
      'after',
      `
Examples:
  stackmemory shell install    Install shell completions
  stackmemory shell status     Check installation status
  stackmemory shell uninstall  Remove shell integration

After installation:
  - Ctrl+]      Request suggestion
  - Shift+Tab   Accept suggestion
  - sweep_status  Check status
  - sweep_toggle  Enable/disable
`
    );

  cmd
    .command('install')
    .description('Install Sweep-powered shell completions')
    .option('--shell <type>', 'Shell type (zsh or bash)', getShellType())
    .action(async (options) => {
      const spinner = ora('Installing shell integration...').start();

      const home = process.env.HOME || '';
      const shellDir = join(home, '.stackmemory', 'shell');
      const shell = options.shell as 'zsh' | 'bash';

      if (shell === 'unknown') {
        spinner.fail(chalk.red('Could not detect shell type'));
        console.log(chalk.gray('Use --shell zsh or --shell bash'));
        process.exit(1);
      }

      try {
        mkdirSync(shellDir, { recursive: true });

        const zshSource = findTemplateFile('sweep-complete.zsh');
        const suggestSource = findTemplateFile('sweep-suggest.js');

        if (!zshSource || !suggestSource) {
          spinner.fail(chalk.red('Template files not found'));
          console.log(chalk.gray('Ensure stackmemory is installed correctly'));
          process.exit(1);
        }

        const zshDest = join(shellDir, 'sweep-complete.zsh');
        const suggestDest = join(shellDir, 'sweep-suggest.js');

        copyFileSync(zshSource, zshDest);
        copyFileSync(suggestSource, suggestDest);
        chmodSync(suggestDest, '755');

        spinner.text = 'Updating shell configuration...';

        const rcFile = getShellRcFile();
        const sourceCmd =
          shell === 'zsh'
            ? `source "${zshDest}"`
            : `source "${shellDir}/sweep-complete.bash"`;

        const marker = '# StackMemory Sweep Completion';

        if (existsSync(rcFile)) {
          const content = readFileSync(rcFile, 'utf-8');

          if (content.includes(marker)) {
            spinner.succeed(chalk.green('Shell integration already installed'));
            console.log(
              chalk.gray('Restart your shell or run: source ' + rcFile)
            );
            return;
          }

          const addition = `
${marker}
if [[ -f "${zshDest}" ]]; then
    ${sourceCmd}
fi
`;
          appendFileSync(rcFile, addition);
        } else {
          writeFileSync(
            rcFile,
            `${marker}\nif [[ -f "${zshDest}" ]]; then\n    ${sourceCmd}\nfi\n`
          );
        }

        spinner.succeed(chalk.green('Shell integration installed'));
        console.log('');
        console.log(chalk.bold('Files installed:'));
        console.log(chalk.gray(`  ${zshDest}`));
        console.log(chalk.gray(`  ${suggestDest}`));
        console.log('');
        console.log(chalk.bold('To activate:'));
        console.log(`  source ${rcFile}`);
        console.log('  OR restart your terminal');
        console.log('');
        console.log(chalk.bold('Usage:'));
        console.log('  Ctrl+]      Request suggestion');
        console.log('  Shift+Tab   Accept suggestion');
        console.log('  sweep_status  Check status');
        console.log('  sweep_toggle  Enable/disable');
      } catch (error) {
        spinner.fail(chalk.red('Installation failed'));
        console.log(chalk.gray((error as Error).message));
        process.exit(1);
      }
    });

  cmd
    .command('status')
    .description('Check shell integration status')
    .action(() => {
      const home = process.env.HOME || '';
      const shellDir = join(home, '.stackmemory', 'shell');
      const zshFile = join(shellDir, 'sweep-complete.zsh');
      const suggestFile = join(shellDir, 'sweep-suggest.js');
      const rcFile = getShellRcFile();

      console.log(chalk.bold('\nShell Integration Status\n'));

      console.log(`Shell: ${chalk.cyan(getShellType())}`);
      console.log(`RC file: ${chalk.gray(rcFile)}`);
      console.log('');

      const zshInstalled = existsSync(zshFile);
      const suggestInstalled = existsSync(suggestFile);

      console.log(
        `Completion script: ${zshInstalled ? chalk.green('Installed') : chalk.yellow('Not installed')}`
      );
      console.log(
        `Suggest script: ${suggestInstalled ? chalk.green('Installed') : chalk.yellow('Not installed')}`
      );

      if (existsSync(rcFile)) {
        const content = readFileSync(rcFile, 'utf-8');
        const configured = content.includes('StackMemory Sweep Completion');
        console.log(
          `RC configured: ${configured ? chalk.green('Yes') : chalk.yellow('No')}`
        );
      } else {
        console.log(`RC configured: ${chalk.yellow('No RC file')}`);
      }

      const sweepState = join(home, '.stackmemory', 'sweep-state.json');
      if (existsSync(sweepState)) {
        try {
          const state = JSON.parse(readFileSync(sweepState, 'utf-8'));
          console.log('');
          console.log(chalk.bold('Sweep Context:'));
          console.log(
            chalk.gray(`  Recent diffs: ${state.recentDiffs?.length || 0}`)
          );
          if (state.lastPrediction) {
            const age = Date.now() - state.lastPrediction.timestamp;
            const ageStr =
              age < 60000
                ? `${Math.round(age / 1000)}s ago`
                : `${Math.round(age / 60000)}m ago`;
            console.log(chalk.gray(`  Last prediction: ${ageStr}`));
          }
        } catch {
          // Ignore
        }
      }

      if (!zshInstalled || !suggestInstalled) {
        console.log('');
        console.log(chalk.bold('To install: stackmemory shell install'));
      }
    });

  cmd
    .command('uninstall')
    .description('Remove shell integration')
    .action(() => {
      const rcFile = getShellRcFile();

      if (existsSync(rcFile)) {
        let content = readFileSync(rcFile, 'utf-8');

        const marker = '# StackMemory Sweep Completion';
        const markerIndex = content.indexOf(marker);

        if (markerIndex !== -1) {
          const endPattern = /\nfi\n/;
          const afterMarker = content.slice(markerIndex);
          const endMatch = afterMarker.match(endPattern);

          if (endMatch && endMatch.index !== undefined) {
            const endIndex = markerIndex + endMatch.index + endMatch[0].length;
            content = content.slice(0, markerIndex) + content.slice(endIndex);
            writeFileSync(rcFile, content);
            console.log(
              chalk.green('Shell integration removed from ' + rcFile)
            );
          }
        } else {
          console.log(chalk.yellow('No shell integration found in ' + rcFile));
        }
      }

      console.log(
        chalk.gray('\nRestart your shell to complete uninstallation')
      );
    });

  cmd.action(() => {
    const home = process.env.HOME || '';
    const zshFile = join(home, '.stackmemory', 'shell', 'sweep-complete.zsh');
    const installed = existsSync(zshFile);

    console.log(chalk.bold('\nStackMemory Shell Integration\n'));
    console.log(
      `Status: ${installed ? chalk.green('Installed') : chalk.yellow('Not installed')}`
    );

    if (!installed) {
      console.log('');
      console.log(chalk.bold('Install with:'));
      console.log('  stackmemory shell install');
    } else {
      console.log('');
      console.log(chalk.bold('Commands:'));
      console.log('  stackmemory shell status     Check status');
      console.log('  stackmemory shell uninstall  Remove integration');
    }
  });

  return cmd;
}

export default createShellCommand();
