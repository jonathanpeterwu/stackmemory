#!/usr/bin/env node

/**
 * claude-sm: Claude wrapper with StackMemory and worktree integration
 * Automatically manages context persistence and instance isolation
 */

import { config as loadDotenv } from 'dotenv';
loadDotenv({ override: true });

import { spawn, execSync, execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { program } from 'commander';
import { v4 as uuidv4 } from 'uuid';
import chalk from 'chalk';
import { initializeTracing, trace } from '../core/trace/index.js';
import {
  generateSessionSummary,
  formatSummaryMessage,
  SessionContext,
} from '../hooks/session-summary.js';
import { sendNotification } from '../hooks/sms-notify.js';

// __filename and __dirname are provided by esbuild banner for ESM compatibility

interface ClaudeSMConfig {
  defaultWorktree: boolean;
  defaultSandbox: boolean;
  defaultChrome: boolean;
  defaultTracing: boolean;
  defaultRemote: boolean;
  defaultNotifyOnDone: boolean;
  defaultWhatsApp: boolean;
}

interface ClaudeConfig {
  instanceId: string;
  worktreePath?: string;
  useSandbox: boolean;
  useChrome: boolean;
  useWorktree: boolean;
  useRemote: boolean;
  notifyOnDone: boolean;
  useWhatsApp: boolean;
  contextEnabled: boolean;
  branch?: string;
  task?: string;
  tracingEnabled: boolean;
  verboseTracing: boolean;
  claudeBin?: string;
  sessionStartTime: number;
}

const DEFAULT_SM_CONFIG: ClaudeSMConfig = {
  defaultWorktree: false,
  defaultSandbox: false,
  defaultChrome: false,
  defaultTracing: true,
  defaultRemote: false,
  defaultNotifyOnDone: true,
  defaultWhatsApp: false,
};

function getConfigPath(): string {
  return path.join(os.homedir(), '.stackmemory', 'claude-sm.json');
}

function loadSMConfig(): ClaudeSMConfig {
  try {
    const configPath = getConfigPath();
    if (fs.existsSync(configPath)) {
      const content = fs.readFileSync(configPath, 'utf8');
      return { ...DEFAULT_SM_CONFIG, ...JSON.parse(content) };
    }
  } catch {
    // Ignore errors, use defaults
  }
  return { ...DEFAULT_SM_CONFIG };
}

function saveSMConfig(config: ClaudeSMConfig): void {
  const configPath = getConfigPath();
  const dir = path.dirname(configPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
}

class ClaudeSM {
  private config: ClaudeConfig;
  private stackmemoryPath: string;
  private worktreeScriptPath: string;
  private claudeConfigDir: string;
  private smConfig: ClaudeSMConfig;

  constructor() {
    // Load persistent defaults
    this.smConfig = loadSMConfig();

    this.config = {
      instanceId: this.generateInstanceId(),
      useSandbox: this.smConfig.defaultSandbox,
      useChrome: this.smConfig.defaultChrome,
      useWorktree: this.smConfig.defaultWorktree,
      useRemote: this.smConfig.defaultRemote,
      notifyOnDone: this.smConfig.defaultNotifyOnDone,
      useWhatsApp: this.smConfig.defaultWhatsApp,
      contextEnabled: true,
      tracingEnabled: this.smConfig.defaultTracing,
      verboseTracing: false,
      sessionStartTime: Date.now(),
    };

    this.stackmemoryPath = this.findStackMemory();
    this.worktreeScriptPath = path.join(
      __dirname,
      '../../scripts/claude-worktree-manager.sh'
    );
    this.claudeConfigDir = path.join(os.homedir(), '.claude');

    // Ensure config directory exists
    if (!fs.existsSync(this.claudeConfigDir)) {
      fs.mkdirSync(this.claudeConfigDir, { recursive: true });
    }
  }

  private generateInstanceId(): string {
    return uuidv4().substring(0, 8);
  }

  private findStackMemory(): string {
    // Check multiple possible locations
    const possiblePaths = [
      path.join(os.homedir(), '.stackmemory', 'bin', 'stackmemory'),
      '/usr/local/bin/stackmemory',
      '/opt/homebrew/bin/stackmemory',
      'stackmemory', // Rely on PATH
    ];

    for (const smPath of possiblePaths) {
      try {
        execFileSync('which', [smPath], { stdio: 'ignore' });
        return smPath;
      } catch {
        // Continue searching
      }
    }

    return 'stackmemory'; // Fallback to PATH
  }

  private isGitRepo(): boolean {
    try {
      execSync('git rev-parse --git-dir', { stdio: 'ignore' });
      return true;
    } catch {
      return false;
    }
  }

  private getCurrentBranch(): string {
    try {
      return execSync('git rev-parse --abbrev-ref HEAD', {
        encoding: 'utf8',
      }).trim();
    } catch {
      return 'main';
    }
  }

  private hasUncommittedChanges(): boolean {
    try {
      const status = execSync('git status --porcelain', { encoding: 'utf8' });
      return status.length > 0;
    } catch {
      return false;
    }
  }

  private resolveClaudeBin(): string | null {
    // 1) CLI-specified
    if (this.config.claudeBin && this.config.claudeBin.trim()) {
      return this.config.claudeBin.trim();
    }
    // 2) Env override
    const envBin = process.env['CLAUDE_BIN'];
    if (envBin && envBin.trim()) return envBin.trim();
    // 3) PATH detection
    try {
      execSync('which claude', { stdio: 'ignore' });
      return 'claude';
    } catch {}
    return null;
  }

  private setupWorktree(): string | null {
    if (!this.config.useWorktree || !this.isGitRepo()) {
      return null;
    }

    console.log(chalk.blue('🌳 Setting up isolated worktree...'));

    const timestamp = new Date()
      .toISOString()
      .replace(/[:.]/g, '-')
      .substring(0, 19);
    const branch =
      this.config.branch ||
      `claude-${this.config.task || 'work'}-${timestamp}-${this.config.instanceId}`;
    const repoName = path.basename(process.cwd());
    const worktreePath = path.join(
      path.dirname(process.cwd()),
      `${repoName}--${branch}`
    );

    try {
      // Create worktree
      const flags = [];
      if (this.config.useSandbox) flags.push('--sandbox');
      if (this.config.useChrome) flags.push('--chrome');

      const cmd = `git worktree add -b "${branch}" "${worktreePath}"`;
      execSync(cmd, { stdio: 'inherit' });

      console.log(chalk.green(`✅ Worktree created: ${worktreePath}`));
      console.log(chalk.gray(`   Branch: ${branch}`));

      // Save worktree config
      const configPath = path.join(worktreePath, '.claude-instance.json');
      const configData = {
        instanceId: this.config.instanceId,
        worktreePath,
        branch,
        task: this.config.task,
        sandboxEnabled: this.config.useSandbox,
        chromeEnabled: this.config.useChrome,
        created: new Date().toISOString(),
        parentRepo: process.cwd(),
      };
      fs.writeFileSync(configPath, JSON.stringify(configData, null, 2));

      // Copy environment files
      const envFiles = ['.env', '.env.local', '.mise.toml', '.tool-versions'];
      for (const file of envFiles) {
        const srcPath = path.join(process.cwd(), file);
        if (fs.existsSync(srcPath)) {
          fs.copyFileSync(srcPath, path.join(worktreePath, file));
        }
      }

      return worktreePath;
    } catch (err: unknown) {
      console.error(chalk.red('❌ Failed to create worktree:'), err);
      return null;
    }
  }

  private saveContext(
    message: string,
    metadata: Record<string, unknown> = {}
  ): void {
    if (!this.config.contextEnabled) return;

    try {
      const contextData = {
        message,
        metadata: {
          ...metadata,
          instanceId: this.config.instanceId,
          worktree: this.config.worktreePath,
          timestamp: new Date().toISOString(),
        },
      };

      const cmd = `${this.stackmemoryPath} context save --json '${JSON.stringify(contextData)}'`;
      execSync(cmd, { stdio: 'ignore' });
    } catch {
      // Silently fail - don't interrupt Claude
    }
  }

  private loadContext(): void {
    if (!this.config.contextEnabled) return;

    try {
      console.log(chalk.blue('📚 Loading previous context...'));

      // Use 'context show' command which outputs the current context stack
      const cmd = `${this.stackmemoryPath} context show`;
      const output = execSync(cmd, {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'pipe'], // Capture stderr to suppress errors
      });

      // Check if we got meaningful output (not empty or just headers)
      const lines = output
        .trim()
        .split('\n')
        .filter((l) => l.trim());
      if (lines.length > 3) {
        // Has content beyond headers
        console.log(chalk.gray('Context stack loaded'));
      }
    } catch {
      // Silently continue - context loading is optional
    }
  }

  private detectMultipleInstances(): boolean {
    try {
      const lockDir = path.join(process.cwd(), '.claude-worktree-locks');
      if (!fs.existsSync(lockDir)) return false;

      const locks = fs.readdirSync(lockDir).filter((f) => f.endsWith('.lock'));
      const activeLocks = locks.filter((lockFile) => {
        const lockPath = path.join(lockDir, lockFile);
        const lockData = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
        const lockAge = Date.now() - new Date(lockData.created).getTime();
        return lockAge < 24 * 60 * 60 * 1000; // Less than 24 hours old
      });

      return activeLocks.length > 0;
    } catch {
      return false;
    }
  }

  private suggestWorktreeMode(): void {
    if (this.hasUncommittedChanges()) {
      console.log(chalk.yellow('⚠️  Uncommitted changes detected'));
      console.log(
        chalk.gray('   Consider using --worktree to work in isolation')
      );
    }

    if (this.detectMultipleInstances()) {
      console.log(chalk.yellow('⚠️  Other Claude instances detected'));
      console.log(
        chalk.gray('   Using --worktree is recommended to avoid conflicts')
      );
    }
  }

  private async startWhatsAppServices(): Promise<void> {
    const WEBHOOK_PORT = 3456;

    console.log(chalk.cyan('Starting WhatsApp services...'));

    // Check if webhook is already running
    const webhookRunning = await fetch(
      `http://localhost:${WEBHOOK_PORT}/health`
    )
      .then((r) => r.ok)
      .catch(() => false);

    if (!webhookRunning) {
      // Start webhook in background
      const webhookPath = path.join(__dirname, '../hooks/sms-webhook.js');
      const webhookProcess = spawn('node', [webhookPath], {
        detached: true,
        stdio: 'ignore',
        env: { ...process.env, SMS_WEBHOOK_PORT: String(WEBHOOK_PORT) },
      });
      webhookProcess.unref();
      console.log(
        chalk.gray(`  Webhook server starting on port ${WEBHOOK_PORT}`)
      );
    } else {
      console.log(
        chalk.gray(`  Webhook already running on port ${WEBHOOK_PORT}`)
      );
    }

    // Check if ngrok is running
    const ngrokRunning = await fetch('http://localhost:4040/api/tunnels')
      .then((r) => r.ok)
      .catch(() => false);

    if (!ngrokRunning) {
      // Start ngrok in background
      const ngrokProcess = spawn('ngrok', ['http', String(WEBHOOK_PORT)], {
        detached: true,
        stdio: 'ignore',
      });
      ngrokProcess.unref();
      console.log(chalk.gray('  ngrok tunnel starting...'));

      // Wait for ngrok to start and get URL
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }

    // Get and display ngrok URL
    try {
      const tunnels = await fetch('http://localhost:4040/api/tunnels').then(
        (r) => r.json() as Promise<{ tunnels: Array<{ public_url: string }> }>
      );
      const publicUrl = tunnels?.tunnels?.[0]?.public_url;
      if (publicUrl) {
        // Save URL for other processes
        const configDir = path.join(os.homedir(), '.stackmemory');
        const configPath = path.join(configDir, 'ngrok-url.txt');
        if (!fs.existsSync(configDir)) {
          fs.mkdirSync(configDir, { recursive: true });
        }
        fs.writeFileSync(configPath, publicUrl);
        console.log(
          chalk.green(`  WhatsApp webhook: ${publicUrl}/sms/incoming`)
        );
      }
    } catch {
      console.log(
        chalk.yellow('  Waiting for ngrok... URL will be available shortly')
      );
    }
  }

  private async sendDoneNotification(exitCode: number | null): Promise<void> {
    try {
      const context: SessionContext = {
        instanceId: this.config.instanceId,
        exitCode,
        sessionStartTime: this.config.sessionStartTime,
        worktreePath: this.config.worktreePath,
        branch: this.config.branch,
        task: this.config.task,
      };

      const summary = await generateSessionSummary(context);
      const message = formatSummaryMessage(summary, this.config.instanceId);

      console.log(chalk.cyan('\nSending session summary via WhatsApp...'));

      // Build options from suggestions for interactive response (always min 2)
      let options = summary.suggestions.slice(0, 4).map((s) => ({
        key: s.key,
        label: s.label,
        action: s.action,
      }));

      // Ensure minimum 2 options
      if (options.length < 2) {
        const defaults = [
          { key: '1', label: 'Start new session', action: 'claude-sm' },
          {
            key: '2',
            label: 'View logs',
            action: 'tail -30 ~/.claude/logs/*.log',
          },
        ];
        options = defaults.slice(0, 2 - options.length).concat(options);
        options.forEach((o, i) => (o.key = String(i + 1)));
      }

      const result = await sendNotification({
        type: 'task_complete',
        title: `Claude Session ${this.config.instanceId}`,
        message,
        prompt: {
          type: 'options',
          options,
        },
      });

      if (result.success) {
        console.log(chalk.green('Notification sent successfully'));
      } else {
        console.log(
          chalk.yellow(`Notification not sent: ${result.error || 'unknown'}`)
        );
      }
    } catch (error) {
      console.log(
        chalk.yellow(
          `Could not send notification: ${error instanceof Error ? error.message : 'unknown'}`
        )
      );
    }
  }

  public async run(args: string[]): Promise<void> {
    // Parse arguments
    const claudeArgs: string[] = [];
    let i = 0;

    while (i < args.length) {
      const arg = args[i];

      switch (arg) {
        case '--worktree':
        case '-w':
          this.config.useWorktree = true;
          break;
        case '--no-worktree':
        case '-W':
          this.config.useWorktree = false;
          break;
        case '--remote':
        case '-r':
          this.config.useRemote = true;
          break;
        case '--no-remote':
          this.config.useRemote = false;
          break;
        case '--notify-done':
        case '-n':
          this.config.notifyOnDone = true;
          break;
        case '--no-notify-done':
          this.config.notifyOnDone = false;
          break;
        case '--whatsapp':
          this.config.useWhatsApp = true;
          this.config.notifyOnDone = true; // Auto-enable notifications
          break;
        case '--no-whatsapp':
          this.config.useWhatsApp = false;
          break;
        case '--sandbox':
        case '-s':
          this.config.useSandbox = true;
          claudeArgs.push('--sandbox');
          break;
        case '--chrome':
        case '-c':
          this.config.useChrome = true;
          claudeArgs.push('--chrome');
          break;
        case '--no-context':
          this.config.contextEnabled = false;
          break;
        case '--no-trace':
          this.config.tracingEnabled = false;
          break;
        case '--verbose-trace':
          this.config.verboseTracing = true;
          break;
        case '--branch':
        case '-b':
          i++;
          this.config.branch = args[i];
          break;
        case '--task':
        case '-t':
          i++;
          this.config.task = args[i];
          break;
        case '--claude-bin':
          i++;
          this.config.claudeBin = args[i];
          process.env['CLAUDE_BIN'] = this.config.claudeBin;
          break;
        case '--auto':
        case '-a':
          // Auto mode: detect and apply best settings
          if (this.isGitRepo()) {
            this.config.useWorktree =
              this.hasUncommittedChanges() || this.detectMultipleInstances();
          }
          break;
        default:
          claudeArgs.push(arg);
      }
      i++;
    }

    // Initialize tracing system if enabled
    if (this.config.tracingEnabled) {
      // Set up environment for tracing
      process.env['DEBUG_TRACE'] = 'true';
      process.env['STACKMEMORY_DEBUG'] = 'true';
      process.env['TRACE_OUTPUT'] = 'file'; // Write to file to not clutter Claude output
      process.env['TRACE_MASK_SENSITIVE'] = 'true'; // Always mask sensitive data

      if (this.config.verboseTracing) {
        process.env['TRACE_VERBOSITY'] = 'full';
        process.env['TRACE_PARAMS'] = 'true';
        process.env['TRACE_RESULTS'] = 'true';
        process.env['TRACE_MEMORY'] = 'true';
      } else {
        process.env['TRACE_VERBOSITY'] = 'summary';
        process.env['TRACE_PARAMS'] = 'true';
        process.env['TRACE_RESULTS'] = 'false';
      }

      // Initialize the tracing system
      initializeTracing();

      // Start tracing this Claude session
      trace.command(
        'claude-sm',
        {
          instanceId: this.config.instanceId,
          worktree: this.config.useWorktree,
          sandbox: this.config.useSandbox,
          task: this.config.task,
        },
        async () => {
          // Session tracing will wrap the entire Claude execution
        }
      );
    }

    // Show header
    console.log(chalk.blue('╔════════════════════════════════════════╗'));
    console.log(chalk.blue('║     Claude + StackMemory + Worktree   ║'));
    console.log(chalk.blue('╚════════════════════════════════════════╝'));
    console.log();

    // Check Git repo status
    if (this.isGitRepo()) {
      const branch = this.getCurrentBranch();
      console.log(chalk.gray(`📍 Current branch: ${branch}`));

      if (!this.config.useWorktree) {
        this.suggestWorktreeMode();
      }
    }

    // Setup worktree if requested
    if (this.config.useWorktree) {
      const worktreePath = this.setupWorktree();
      if (worktreePath) {
        this.config.worktreePath = worktreePath;
        process.chdir(worktreePath);

        // Save context about worktree creation
        this.saveContext('Created worktree for Claude instance', {
          action: 'worktree_created',
          path: worktreePath,
          branch: this.config.branch,
        });
      }
    }

    // Load previous context
    this.loadContext();

    // Setup environment
    process.env['CLAUDE_INSTANCE_ID'] = this.config.instanceId;
    if (this.config.worktreePath) {
      process.env['CLAUDE_WORKTREE_PATH'] = this.config.worktreePath;
    }
    if (this.config.useRemote) {
      process.env['CLAUDE_REMOTE'] = '1';
    }

    console.log(chalk.gray(`🤖 Instance ID: ${this.config.instanceId}`));
    console.log(chalk.gray(`📁 Working in: ${process.cwd()}`));

    if (this.config.useSandbox) {
      console.log(chalk.yellow('🔒 Sandbox mode enabled'));
    }
    if (this.config.useRemote) {
      console.log(
        chalk.cyan('📱 Remote mode: WhatsApp notifications for all questions')
      );
    }
    if (this.config.useChrome) {
      console.log(chalk.yellow('🌐 Chrome automation enabled'));
    }
    if (this.config.tracingEnabled) {
      console.log(
        chalk.gray(`🔍 Debug tracing enabled (logs to ~/.stackmemory/traces/)`)
      );
      if (this.config.verboseTracing) {
        console.log(
          chalk.gray(`   Verbose mode: capturing all execution details`)
        );
      }
    }

    // Start WhatsApp services if enabled
    if (this.config.useWhatsApp) {
      console.log(
        chalk.cyan('📱 WhatsApp mode: notifications + webhook enabled')
      );
      await this.startWhatsAppServices();
    }

    console.log();
    console.log(chalk.gray('Starting Claude...'));
    console.log(chalk.gray('─'.repeat(42)));

    const claudeBin = this.resolveClaudeBin();
    if (!claudeBin) {
      console.error(chalk.red('❌ Claude CLI not found.'));
      console.log(
        chalk.gray(
          '   Install Claude CLI or set an override:\n' +
            '     export CLAUDE_BIN=/path/to/claude\n' +
            '     claude-sm --help\n\n' +
            '   Ensure PATH includes npm global bin (npm bin -g).'
        )
      );
      process.exit(1);
      return;
    }

    // Launch Claude
    const claude = spawn(claudeBin, claudeArgs, {
      stdio: 'inherit',
      env: process.env,
    });

    claude.on('error', (err: NodeJS.ErrnoException) => {
      console.error(chalk.red('❌ Failed to launch Claude CLI.'));
      if (err.code === 'ENOENT') {
        console.error(
          chalk.gray('   Not found. Set CLAUDE_BIN or install claude on PATH.')
        );
      } else if (err.code === 'EPERM' || err.code === 'EACCES') {
        console.error(
          chalk.gray(
            '   Permission/sandbox issue. Try outside a sandbox or set CLAUDE_BIN.'
          )
        );
      } else {
        console.error(chalk.gray(`   ${err.message}`));
      }
      process.exit(1);
    });

    // Handle exit
    claude.on('exit', async (code) => {
      // Save final context
      this.saveContext('Claude session ended', {
        action: 'session_end',
        exitCode: code,
      });

      // End tracing and show summary if enabled
      if (this.config.tracingEnabled) {
        const summary = trace.getExecutionSummary();
        console.log();
        console.log(chalk.gray('─'.repeat(42)));
        console.log(chalk.blue('Debug Trace Summary:'));
        console.log(chalk.gray(summary));
      }

      // Send notification when done (if enabled)
      if (this.config.notifyOnDone || this.config.useRemote) {
        await this.sendDoneNotification(code);
      }

      // Offer to clean up worktree
      if (this.config.worktreePath) {
        console.log();
        console.log(chalk.gray('─'.repeat(42)));
        console.log(chalk.blue('Session ended in worktree:'));
        console.log(chalk.gray(`  ${this.config.worktreePath}`));
        console.log();
        console.log(chalk.gray('To remove worktree: gd_claude'));
        console.log(chalk.gray('To merge to main: cwm'));
      }

      process.exit(code || 0);
    });

    // Handle signals
    process.on('SIGINT', () => {
      this.saveContext('Claude session interrupted', {
        action: 'session_interrupt',
      });
      claude.kill('SIGINT');
    });

    process.on('SIGTERM', () => {
      this.saveContext('Claude session terminated', {
        action: 'session_terminate',
      });
      claude.kill('SIGTERM');
    });
  }
}

// CLI interface
program
  .name('claude-sm')
  .description('Claude with StackMemory context and worktree isolation')
  .version('1.0.0');

// Config subcommand
const configCmd = program
  .command('config')
  .description('Manage claude-sm defaults');

configCmd
  .command('show')
  .description('Show current default settings')
  .action(() => {
    const config = loadSMConfig();
    console.log(chalk.blue('claude-sm defaults:'));
    console.log(
      `  defaultWorktree: ${config.defaultWorktree ? chalk.green('true') : chalk.gray('false')}`
    );
    console.log(
      `  defaultSandbox:  ${config.defaultSandbox ? chalk.green('true') : chalk.gray('false')}`
    );
    console.log(
      `  defaultChrome:   ${config.defaultChrome ? chalk.green('true') : chalk.gray('false')}`
    );
    console.log(
      `  defaultTracing:  ${config.defaultTracing ? chalk.green('true') : chalk.gray('false')}`
    );
    console.log(
      `  defaultRemote:   ${config.defaultRemote ? chalk.green('true') : chalk.gray('false')}`
    );
    console.log(
      `  defaultNotifyOnDone: ${config.defaultNotifyOnDone ? chalk.green('true') : chalk.gray('false')}`
    );
    console.log(
      `  defaultWhatsApp: ${config.defaultWhatsApp ? chalk.green('true') : chalk.gray('false')}`
    );
    console.log(chalk.gray(`\nConfig: ${getConfigPath()}`));
  });

configCmd
  .command('set <key> <value>')
  .description('Set a default (e.g., set worktree true)')
  .action((key: string, value: string) => {
    const config = loadSMConfig();
    const boolValue = value === 'true' || value === '1' || value === 'on';

    const keyMap: Record<string, keyof ClaudeSMConfig> = {
      worktree: 'defaultWorktree',
      sandbox: 'defaultSandbox',
      chrome: 'defaultChrome',
      tracing: 'defaultTracing',
      remote: 'defaultRemote',
      'notify-done': 'defaultNotifyOnDone',
      notifyondone: 'defaultNotifyOnDone',
      whatsapp: 'defaultWhatsApp',
    };

    const configKey = keyMap[key];
    if (!configKey) {
      console.log(chalk.red(`Unknown key: ${key}`));
      console.log(
        chalk.gray(
          'Valid keys: worktree, sandbox, chrome, tracing, remote, notify-done, whatsapp'
        )
      );
      process.exit(1);
    }

    config[configKey] = boolValue;
    saveSMConfig(config);
    console.log(chalk.green(`Set ${key} = ${boolValue}`));
  });

configCmd
  .command('worktree-on')
  .description('Enable worktree mode by default')
  .action(() => {
    const config = loadSMConfig();
    config.defaultWorktree = true;
    saveSMConfig(config);
    console.log(chalk.green('Worktree mode enabled by default'));
  });

configCmd
  .command('worktree-off')
  .description('Disable worktree mode by default')
  .action(() => {
    const config = loadSMConfig();
    config.defaultWorktree = false;
    saveSMConfig(config);
    console.log(chalk.green('Worktree mode disabled by default'));
  });

configCmd
  .command('remote-on')
  .description('Enable remote mode by default (WhatsApp for all questions)')
  .action(() => {
    const config = loadSMConfig();
    config.defaultRemote = true;
    saveSMConfig(config);
    console.log(chalk.green('Remote mode enabled by default'));
  });

configCmd
  .command('remote-off')
  .description('Disable remote mode by default')
  .action(() => {
    const config = loadSMConfig();
    config.defaultRemote = false;
    saveSMConfig(config);
    console.log(chalk.green('Remote mode disabled by default'));
  });

configCmd
  .command('notify-done-on')
  .description('Enable WhatsApp notification when session ends (default)')
  .action(() => {
    const config = loadSMConfig();
    config.defaultNotifyOnDone = true;
    saveSMConfig(config);
    console.log(chalk.green('Notify-on-done enabled by default'));
  });

configCmd
  .command('notify-done-off')
  .description('Disable notification when session ends')
  .action(() => {
    const config = loadSMConfig();
    config.defaultNotifyOnDone = false;
    saveSMConfig(config);
    console.log(chalk.green('Notify-on-done disabled by default'));
  });

configCmd
  .command('whatsapp-on')
  .description('Enable WhatsApp mode by default (auto-starts webhook + ngrok)')
  .action(() => {
    const config = loadSMConfig();
    config.defaultWhatsApp = true;
    config.defaultNotifyOnDone = true; // Also enable notifications
    saveSMConfig(config);
    console.log(chalk.green('WhatsApp mode enabled by default'));
    console.log(chalk.gray('Sessions will auto-start webhook and ngrok'));
  });

configCmd
  .command('whatsapp-off')
  .description('Disable WhatsApp mode by default')
  .action(() => {
    const config = loadSMConfig();
    config.defaultWhatsApp = false;
    saveSMConfig(config);
    console.log(chalk.green('WhatsApp mode disabled by default'));
  });

// Main command (default action when no subcommand)
program
  .option('-w, --worktree', 'Create isolated worktree for this instance')
  .option('-W, --no-worktree', 'Disable worktree (override default)')
  .option('-r, --remote', 'Enable remote mode (WhatsApp for all questions)')
  .option('--no-remote', 'Disable remote mode (override default)')
  .option('-n, --notify-done', 'Send WhatsApp notification when session ends')
  .option('--no-notify-done', 'Disable notification when session ends')
  .option(
    '--whatsapp',
    'Enable WhatsApp mode (auto-start webhook + ngrok + notifications)'
  )
  .option('--no-whatsapp', 'Disable WhatsApp mode (override default)')
  .option('-s, --sandbox', 'Enable sandbox mode (file/network restrictions)')
  .option('-c, --chrome', 'Enable Chrome automation')
  .option('-a, --auto', 'Automatically detect and apply best settings')
  .option('-b, --branch <name>', 'Specify branch name for worktree')
  .option('-t, --task <desc>', 'Task description for context')
  .option('--claude-bin <path>', 'Path to claude CLI (or use CLAUDE_BIN)')
  .option('--no-context', 'Disable StackMemory context integration')
  .option('--no-trace', 'Disable debug tracing (enabled by default)')
  .option('--verbose-trace', 'Enable verbose debug tracing with full details')
  .helpOption('-h, --help', 'Display help')
  .allowUnknownOption(true)
  .action(async (_options) => {
    const claudeSM = new ClaudeSM();
    const args = process.argv.slice(2);
    await claudeSM.run(args);
  });

// Handle direct execution
// ESM-safe CLI entry
program.parse(process.argv);
