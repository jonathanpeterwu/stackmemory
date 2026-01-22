/**
 * Sweep command for StackMemory
 * Provides next-edit predictions using the Sweep 1.5B model
 *
 * Usage:
 *   stackmemory sweep setup          Install dependencies and optionally download model
 *   stackmemory sweep status         Check if Sweep addon is properly configured
 *   stackmemory sweep predict <file> Run prediction on a file
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
} from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

interface SweepStatus {
  installed: boolean;
  model_downloaded: boolean;
  python_path?: string;
  model_path?: string;
  error?: string;
}

interface SweepPredictResult {
  success: boolean;
  predicted_content?: string;
  file_path?: string;
  latency_ms?: number;
  tokens_generated?: number;
  error?: string;
  message?: string;
}

function findPythonScript(): string | null {
  const locations = [
    join(
      process.cwd(),
      'packages',
      'sweep-addon',
      'python',
      'sweep_predict.py'
    ),
    join(
      process.cwd(),
      'node_modules',
      '@stackmemoryai',
      'sweep-addon',
      'python',
      'sweep_predict.py'
    ),
    join(process.env.HOME || '', '.stackmemory', 'sweep', 'sweep_predict.py'),
  ];

  for (const loc of locations) {
    if (existsSync(loc)) {
      return loc;
    }
  }
  return null;
}

function findHookSource(): string | null {
  const locations = [
    join(process.cwd(), 'templates', 'claude-hooks', 'post-edit-sweep.js'),
    join(
      process.cwd(),
      'node_modules',
      '@stackmemoryai',
      'stackmemory',
      'templates',
      'claude-hooks',
      'post-edit-sweep.js'
    ),
    join(
      dirname(dirname(dirname(__dirname))),
      'templates',
      'claude-hooks',
      'post-edit-sweep.js'
    ),
  ];

  for (const loc of locations) {
    if (existsSync(loc)) {
      return loc;
    }
  }
  return null;
}

async function findPython(): Promise<string | null> {
  const candidates = ['python3', 'python'];

  for (const cmd of candidates) {
    try {
      execSync(`${cmd} --version`, { stdio: 'pipe' });
      return cmd;
    } catch {
      continue;
    }
  }
  return null;
}

async function checkSweepStatus(): Promise<SweepStatus> {
  const pythonPath = await findPython();
  if (!pythonPath) {
    return {
      installed: false,
      model_downloaded: false,
      error: 'Python not found. Install Python 3.10+',
    };
  }

  const scriptPath = findPythonScript();
  if (!scriptPath) {
    return {
      installed: false,
      model_downloaded: false,
      python_path: pythonPath,
      error: 'Sweep addon not installed. Run: stackmemory sweep setup',
    };
  }

  const homeDir = process.env.HOME || '';
  const modelPath = join(
    homeDir,
    '.stackmemory',
    'models',
    'sweep',
    'sweep-next-edit-1.5b.q8_0.v2.gguf'
  );
  const modelDownloaded = existsSync(modelPath);

  return {
    installed: true,
    model_downloaded: modelDownloaded,
    python_path: pythonPath,
    model_path: modelDownloaded ? modelPath : undefined,
  };
}

async function runPrediction(
  filePath: string,
  pythonPath: string,
  scriptPath: string
): Promise<SweepPredictResult> {
  if (!existsSync(filePath)) {
    return {
      success: false,
      error: 'file_not_found',
      message: `File not found: ${filePath}`,
    };
  }

  const currentContent = readFileSync(filePath, 'utf-8');

  const input = {
    file_path: filePath,
    current_content: currentContent,
  };

  return new Promise((resolve) => {
    const proc = spawn(pythonPath, [scriptPath], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => (stdout += data));
    proc.stderr.on('data', (data) => (stderr += data));

    proc.on('close', (code) => {
      try {
        if (stdout.trim()) {
          const result = JSON.parse(stdout.trim());
          resolve(result);
        } else if (code !== 0) {
          resolve({
            success: false,
            error: 'process_error',
            message: stderr || `Process exited with code ${code}`,
          });
        } else {
          resolve({
            success: false,
            error: 'no_output',
            message: 'No output from prediction script',
          });
        }
      } catch {
        resolve({
          success: false,
          error: 'parse_error',
          message: `Failed to parse output: ${stdout}`,
        });
      }
    });

    proc.on('error', (error) => {
      resolve({
        success: false,
        error: 'spawn_error',
        message: error.message,
      });
    });

    proc.stdin.write(JSON.stringify(input));
    proc.stdin.end();
  });
}

export function createSweepCommand(): Command {
  const cmd = new Command('sweep')
    .description(
      'Next-edit predictions using Sweep 1.5B model (optional addon)'
    )
    .addHelpText(
      'after',
      `
Examples:
  stackmemory sweep setup              Install Python dependencies
  stackmemory sweep setup --download   Also download the model (1.5GB)
  stackmemory sweep status             Check addon status
  stackmemory sweep predict src/app.ts Predict next edit for a file

Requirements:
  - Python 3.10+
  - pip packages: huggingface_hub, llama-cpp-python

The Sweep 1.5B model predicts what code changes you'll make next based on:
  - Current file content
  - Recent changes (diffs)
  - Context from other files

Model is downloaded from HuggingFace on first prediction (~1.5GB).
`
    );

  cmd
    .command('setup')
    .description('Install Python dependencies for Sweep addon')
    .option('--download', 'Also download the model now')
    .action(async (options) => {
      const spinner = ora('Checking Python...').start();

      const pythonPath = await findPython();
      if (!pythonPath) {
        spinner.fail(chalk.red('Python not found'));
        console.log(chalk.gray('Please install Python 3.10+'));
        process.exit(1);
      }

      spinner.text = 'Installing Python dependencies...';

      try {
        execSync(
          `${pythonPath} -m pip install --quiet huggingface_hub llama-cpp-python`,
          {
            stdio: 'pipe',
          }
        );
        spinner.succeed(chalk.green('Python dependencies installed'));
      } catch {
        spinner.fail(chalk.red('Failed to install dependencies'));
        console.log(
          chalk.gray(
            `Run: ${pythonPath} -m pip install huggingface_hub llama-cpp-python`
          )
        );
        process.exit(1);
      }

      if (options.download) {
        const downloadSpinner = ora('Downloading Sweep 1.5B model...').start();
        downloadSpinner.text = 'Downloading model from HuggingFace (~1.5GB)...';

        try {
          execSync(
            `${pythonPath} -c "
from huggingface_hub import hf_hub_download
import os
model_dir = os.path.expanduser('~/.stackmemory/models/sweep')
os.makedirs(model_dir, exist_ok=True)
hf_hub_download(
    repo_id='sweepai/sweep-next-edit-1.5B',
    filename='sweep-next-edit-1.5b.q8_0.v2.gguf',
    repo_type='model',
    local_dir=model_dir,
    local_dir_use_symlinks=False
)
"`,
            { stdio: 'pipe', timeout: 600000 }
          );
          downloadSpinner.succeed(chalk.green('Model downloaded'));
        } catch {
          downloadSpinner.fail(chalk.red('Model download failed'));
          console.log(chalk.gray('Model will be downloaded on first use'));
        }
      } else {
        console.log(
          chalk.gray('\nModel will be downloaded on first prediction (~1.5GB)')
        );
        console.log(chalk.gray('Or run: stackmemory sweep setup --download'));
      }

      console.log(chalk.bold('\nSetup complete!'));
    });

  cmd
    .command('status')
    .description('Check Sweep addon status')
    .action(async () => {
      console.log(chalk.bold('\nSweep 1.5B Addon Status\n'));

      const status = await checkSweepStatus();

      if (status.error) {
        console.log(chalk.red(`Error: ${status.error}`));
        console.log('');
      }

      console.log(
        `Python: ${status.python_path ? chalk.green(status.python_path) : chalk.red('Not found')}`
      );
      console.log(
        `Addon installed: ${status.installed ? chalk.green('Yes') : chalk.yellow('No')}`
      );
      console.log(
        `Model downloaded: ${status.model_downloaded ? chalk.green('Yes') : chalk.yellow('No (will download on first use)')}`
      );

      if (status.model_path) {
        console.log(chalk.gray(`Model path: ${status.model_path}`));
      }

      if (!status.installed) {
        console.log(chalk.bold('\nTo install:'));
        console.log('  stackmemory sweep setup');
      }
    });

  cmd
    .command('predict <file>')
    .description('Predict next edit for a file')
    .option('-o, --output <path>', 'Write prediction to file instead of stdout')
    .option('--json', 'Output raw JSON result')
    .action(async (file, options) => {
      const status = await checkSweepStatus();

      if (!status.installed) {
        console.error(chalk.red('Sweep addon not installed'));
        console.log(chalk.gray('Run: stackmemory sweep setup'));
        process.exit(1);
      }

      const scriptPath = findPythonScript();
      if (!scriptPath || !status.python_path) {
        console.error(chalk.red('Could not find Sweep prediction script'));
        process.exit(1);
      }

      const spinner = ora('Running prediction...').start();

      if (!status.model_downloaded) {
        spinner.text = 'Downloading model (first time only, ~1.5GB)...';
      }

      const result = await runPrediction(file, status.python_path, scriptPath);

      if (!result.success) {
        spinner.fail(
          chalk.red(`Prediction failed: ${result.message || result.error}`)
        );
        process.exit(1);
      }

      spinner.succeed(chalk.green('Prediction complete'));

      if (options.json) {
        console.log(JSON.stringify(result, null, 2));
        return;
      }

      console.log(chalk.bold('\nPredicted content:'));
      console.log(chalk.gray('─'.repeat(50)));
      console.log(result.predicted_content);
      console.log(chalk.gray('─'.repeat(50)));

      if (result.latency_ms) {
        console.log(chalk.gray(`Latency: ${result.latency_ms}ms`));
      }
      if (result.tokens_generated) {
        console.log(chalk.gray(`Tokens: ${result.tokens_generated}`));
      }

      if (options.output) {
        const { writeFileSync } = await import('fs');
        writeFileSync(options.output, result.predicted_content || '');
        console.log(chalk.green(`\nWritten to: ${options.output}`));
      }
    });

  const hookCmd = cmd
    .command('hook')
    .description('Manage Claude Code integration hook');

  hookCmd
    .command('install')
    .description('Install Sweep prediction hook for Claude Code')
    .action(async () => {
      const spinner = ora('Installing Sweep hook...').start();

      const homeDir = process.env.HOME || '';
      const hookDir = join(homeDir, '.claude', 'hooks');
      const sweepDir = join(homeDir, '.stackmemory', 'sweep');
      const hooksJsonPath = join(homeDir, '.claude', 'hooks.json');

      try {
        mkdirSync(hookDir, { recursive: true });
        mkdirSync(sweepDir, { recursive: true });

        const hookSource = findHookSource();
        if (!hookSource) {
          spinner.fail(chalk.red('Hook template not found'));
          console.log(
            chalk.gray('Ensure stackmemory is installed from the repository')
          );
          process.exit(1);
        }

        const hookDest = join(hookDir, 'post-edit-sweep.js');
        copyFileSync(hookSource, hookDest);
        chmodSync(hookDest, '755');

        const pythonScriptSource = findPythonScript();
        if (pythonScriptSource) {
          const pythonDest = join(sweepDir, 'sweep_predict.py');
          copyFileSync(pythonScriptSource, pythonDest);
        }

        if (existsSync(hooksJsonPath)) {
          const hooks = JSON.parse(readFileSync(hooksJsonPath, 'utf-8'));
          if (!hooks['post-tool-use']) {
            hooks['post-tool-use'] = hookDest;
            writeFileSync(hooksJsonPath, JSON.stringify(hooks, null, 2));
          } else if (!hooks['post-tool-use'].includes('sweep')) {
            spinner.warn(chalk.yellow('post-tool-use hook already configured'));
            console.log(chalk.gray(`Existing: ${hooks['post-tool-use']}`));
            console.log(chalk.gray(`Hook installed at: ${hookDest}`));
            console.log(
              chalk.gray('You may need to manually configure the hook chain')
            );
            return;
          }
        } else {
          const hooks = { 'post-tool-use': hookDest };
          writeFileSync(hooksJsonPath, JSON.stringify(hooks, null, 2));
        }

        spinner.succeed(chalk.green('Sweep hook installed'));
        console.log(chalk.gray(`Hook: ${hookDest}`));
        console.log(chalk.gray(`Config: ${hooksJsonPath}`));
        console.log('');
        console.log(chalk.bold('Usage:'));
        console.log('  Hook runs automatically after Edit/Write operations');
        console.log('  Predictions appear after 2+ edits in session');
        console.log('  Disable: export SWEEP_ENABLED=false');
      } catch (error) {
        spinner.fail(chalk.red('Installation failed'));
        console.log(chalk.gray((error as Error).message));
        process.exit(1);
      }
    });

  hookCmd
    .command('status')
    .description('Check hook installation status')
    .action(async () => {
      const homeDir = process.env.HOME || '';
      const hookPath = join(homeDir, '.claude', 'hooks', 'post-edit-sweep.js');
      const hooksJsonPath = join(homeDir, '.claude', 'hooks.json');
      const statePath = join(homeDir, '.stackmemory', 'sweep-state.json');

      console.log(chalk.bold('\nSweep Hook Status\n'));

      const hookInstalled = existsSync(hookPath);
      console.log(
        `Hook installed: ${hookInstalled ? chalk.green('Yes') : chalk.yellow('No')}`
      );

      if (existsSync(hooksJsonPath)) {
        const hooks = JSON.parse(readFileSync(hooksJsonPath, 'utf-8'));
        const configured =
          hooks['post-tool-use'] && hooks['post-tool-use'].includes('sweep');
        console.log(
          `Hook configured: ${configured ? chalk.green('Yes') : chalk.yellow('No')}`
        );
      } else {
        console.log(`Hook configured: ${chalk.yellow('No hooks.json')}`);
      }

      const enabled = process.env.SWEEP_ENABLED !== 'false';
      console.log(
        `Enabled: ${enabled ? chalk.green('Yes') : chalk.yellow('Disabled (SWEEP_ENABLED=false)')}`
      );

      if (existsSync(statePath)) {
        try {
          const state = JSON.parse(readFileSync(statePath, 'utf-8'));
          console.log(
            chalk.gray(
              `\nRecent diffs tracked: ${state.recentDiffs?.length || 0}`
            )
          );
          if (state.lastPrediction) {
            const age = Date.now() - state.lastPrediction.timestamp;
            const ageStr =
              age < 60000
                ? `${Math.round(age / 1000)}s ago`
                : `${Math.round(age / 60000)}m ago`;
            console.log(chalk.gray(`Last prediction: ${ageStr}`));
          }
        } catch {
          // Ignore parse errors
        }
      }

      if (!hookInstalled) {
        console.log(chalk.bold('\nTo install: stackmemory sweep hook install'));
      }
    });

  hookCmd
    .command('disable')
    .description('Disable the Sweep hook')
    .action(() => {
      console.log(chalk.bold('\nTo disable Sweep predictions:\n'));
      console.log('  Temporarily: export SWEEP_ENABLED=false');
      console.log('  Permanently: Add to ~/.zshrc or ~/.bashrc');
      console.log('');
      console.log('Or remove the hook:');
      console.log('  rm ~/.claude/hooks/post-edit-sweep.js');
    });

  hookCmd
    .command('clear')
    .description('Clear hook state (recent diffs and predictions)')
    .action(() => {
      const homeDir = process.env.HOME || '';
      const statePath = join(homeDir, '.stackmemory', 'sweep-state.json');

      if (existsSync(statePath)) {
        writeFileSync(
          statePath,
          JSON.stringify(
            {
              recentDiffs: [],
              lastPrediction: null,
              pendingPrediction: null,
              fileContents: {},
            },
            null,
            2
          )
        );
        console.log(chalk.green('Sweep state cleared'));
      } else {
        console.log(chalk.gray('No state file found'));
      }
    });

  cmd.action(async () => {
    const status = await checkSweepStatus();
    console.log(chalk.bold('\nSweep 1.5B Addon Status\n'));

    console.log(
      `Installed: ${status.installed ? chalk.green('Yes') : chalk.yellow('No')}`
    );
    console.log(
      `Model ready: ${status.model_downloaded ? chalk.green('Yes') : chalk.yellow('No')}`
    );

    if (!status.installed) {
      console.log(chalk.bold('\nRun: stackmemory sweep setup'));
    } else {
      console.log(chalk.bold('\nUsage: stackmemory sweep predict <file>'));
    }
  });

  return cmd;
}

export default createSweepCommand();
