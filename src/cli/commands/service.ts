/**
 * Service command for StackMemory
 * Manages OS-level service installation for the guardian daemon
 *
 * The guardian service monitors ~/.stackmemory/sessions/ for active sessions
 * and starts context sync when activity is detected.
 */

import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import * as fs from 'fs/promises';
import * as path from 'path';
import { spawn, execSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { SystemError, ErrorCode } from '../../core/errors/index.js';

interface ServiceConfig {
  platform: 'darwin' | 'linux' | 'unsupported';
  serviceDir: string;
  serviceName: string;
  serviceFile: string;
  logDir: string;
}

function getServiceConfig(): ServiceConfig {
  const home = process.env.HOME || '';
  const platform = process.platform;

  if (platform === 'darwin') {
    return {
      platform: 'darwin',
      serviceDir: path.join(home, 'Library', 'LaunchAgents'),
      serviceName: 'com.stackmemory.guardian',
      serviceFile: path.join(
        home,
        'Library',
        'LaunchAgents',
        'com.stackmemory.guardian.plist'
      ),
      logDir: path.join(home, '.stackmemory', 'logs'),
    };
  } else if (platform === 'linux') {
    return {
      platform: 'linux',
      serviceDir: path.join(home, '.config', 'systemd', 'user'),
      serviceName: 'stackmemory-guardian',
      serviceFile: path.join(
        home,
        '.config',
        'systemd',
        'user',
        'stackmemory-guardian.service'
      ),
      logDir: path.join(home, '.stackmemory', 'logs'),
    };
  }

  return {
    platform: 'unsupported',
    serviceDir: '',
    serviceName: '',
    serviceFile: '',
    logDir: path.join(home, '.stackmemory', 'logs'),
  };
}

function _getStackMemoryBinPath(): string {
  const localBin = path.join(process.cwd(), 'dist', 'cli', 'index.js');
  if (existsSync(localBin)) {
    return localBin;
  }
  const globalBin = path.join(
    process.env.HOME || '',
    '.stackmemory',
    'bin',
    'stackmemory'
  );
  if (existsSync(globalBin)) {
    return globalBin;
  }
  return 'npx stackmemory';
}
void _getStackMemoryBinPath;

function getNodePath(): string {
  try {
    const nodePath = execSync('which node', { encoding: 'utf-8' }).trim();
    return nodePath;
  } catch {
    return '/usr/local/bin/node';
  }
}

function generateMacOSPlist(config: ServiceConfig): string {
  const home = process.env.HOME || '';
  const nodePath = getNodePath();
  const guardianScript = path.join(home, '.stackmemory', 'guardian.js');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>${config.serviceName}</string>

    <key>ProgramArguments</key>
    <array>
        <string>${nodePath}</string>
        <string>${guardianScript}</string>
    </array>

    <key>RunAtLoad</key>
    <true/>

    <key>KeepAlive</key>
    <dict>
        <key>SuccessfulExit</key>
        <false/>
    </dict>

    <key>WorkingDirectory</key>
    <string>${home}/.stackmemory</string>

    <key>StandardOutPath</key>
    <string>${config.logDir}/guardian.log</string>

    <key>StandardErrorPath</key>
    <string>${config.logDir}/guardian.error.log</string>

    <key>EnvironmentVariables</key>
    <dict>
        <key>HOME</key>
        <string>${home}</string>
        <key>PATH</key>
        <string>/usr/local/bin:/usr/bin:/bin</string>
    </dict>

    <key>ThrottleInterval</key>
    <integer>30</integer>
</dict>
</plist>`;
}

function generateLinuxSystemdService(config: ServiceConfig): string {
  const home = process.env.HOME || '';
  const nodePath = getNodePath();
  const guardianScript = path.join(home, '.stackmemory', 'guardian.js');

  return `[Unit]
Description=StackMemory Guardian Service
Documentation=https://github.com/stackmemoryai/stackmemory
After=network.target

[Service]
Type=simple
ExecStart=${nodePath} ${guardianScript}
Restart=on-failure
RestartSec=30
WorkingDirectory=${home}/.stackmemory

Environment=HOME=${home}
Environment=PATH=/usr/local/bin:/usr/bin:/bin

StandardOutput=append:${config.logDir}/guardian.log
StandardError=append:${config.logDir}/guardian.error.log

[Install]
WantedBy=default.target`;
}

function generateGuardianScript(): string {
  return `#!/usr/bin/env node
/**
 * StackMemory Guardian Service
 * Monitors ~/.stackmemory/sessions/ for active sessions
 * and manages context sync accordingly.
 */

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

const HOME = process.env.HOME || '';
const SESSIONS_DIR = path.join(HOME, '.stackmemory', 'sessions');
const STATE_FILE = path.join(HOME, '.stackmemory', 'guardian.state');
const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

class Guardian {
  constructor() {
    this.syncProcess = null;
    this.lastActivityTime = Date.now();
    this.activeSessions = new Set();
    this.checkInterval = null;
  }

  log(message, level = 'INFO') {
    const timestamp = new Date().toISOString();
    console.log('[' + timestamp + '] [' + level + '] ' + message);
  }

  async getActiveSessions() {
    const sessions = new Set();

    try {
      if (!fs.existsSync(SESSIONS_DIR)) {
        return sessions;
      }

      const files = fs.readdirSync(SESSIONS_DIR);

      for (const file of files) {
        if (!file.endsWith('.json')) continue;

        const filePath = path.join(SESSIONS_DIR, file);
        try {
          const content = fs.readFileSync(filePath, 'utf8');
          const session = JSON.parse(content);

          // Check if session is active (updated within last 5 minutes)
          const lastUpdate = new Date(session.lastActiveAt || session.startedAt).getTime();
          const fiveMinutesAgo = Date.now() - (5 * 60 * 1000);

          if (session.state === 'active' && lastUpdate > fiveMinutesAgo) {
            sessions.add(session.sessionId);
          }
        } catch (err) {
          // Skip invalid session files
        }
      }
    } catch (err) {
      this.log('Error reading sessions: ' + err.message, 'ERROR');
    }

    return sessions;
  }

  startContextSync() {
    if (this.syncProcess) {
      this.log('Context sync already running');
      return;
    }

    this.log('Starting context sync...');

    // Find stackmemory binary
    const stackmemoryPaths = [
      path.join(HOME, '.stackmemory', 'bin', 'stackmemory'),
      'npx'
    ];

    let binPath = null;
    for (const p of stackmemoryPaths) {
      if (p === 'npx' || fs.existsSync(p)) {
        binPath = p;
        break;
      }
    }

    if (!binPath) {
      this.log('Cannot find stackmemory binary', 'ERROR');
      return;
    }

    const args = binPath === 'npx'
      ? ['stackmemory', 'monitor', '--daemon']
      : ['monitor', '--daemon'];

    this.syncProcess = spawn(binPath, args, {
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe']
    });

    this.syncProcess.stdout.on('data', (data) => {
      this.log('sync: ' + data.toString().trim());
    });

    this.syncProcess.stderr.on('data', (data) => {
      this.log('sync error: ' + data.toString().trim(), 'WARN');
    });

    this.syncProcess.on('exit', (code) => {
      this.log('Context sync exited with code: ' + code);
      this.syncProcess = null;
    });

    this.log('Context sync started');
  }

  stopContextSync() {
    if (!this.syncProcess) {
      return;
    }

    this.log('Stopping context sync...');

    try {
      this.syncProcess.kill('SIGTERM');
      this.syncProcess = null;
      this.log('Context sync stopped');
    } catch (err) {
      this.log('Error stopping sync: ' + err.message, 'ERROR');
    }
  }

  saveState() {
    const state = {
      lastCheck: new Date().toISOString(),
      activeSessions: Array.from(this.activeSessions),
      syncRunning: this.syncProcess !== null,
      lastActivity: new Date(this.lastActivityTime).toISOString()
    };

    try {
      fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
    } catch (err) {
      this.log('Error saving state: ' + err.message, 'ERROR');
    }
  }

  async check() {
    const currentSessions = await this.getActiveSessions();
    const hadActivity = currentSessions.size > 0;

    if (hadActivity) {
      this.lastActivityTime = Date.now();
    }

    // Detect session changes
    const newSessions = [...currentSessions].filter(s => !this.activeSessions.has(s));
    const closedSessions = [...this.activeSessions].filter(s => !currentSessions.has(s));

    if (newSessions.length > 0) {
      this.log('New sessions detected: ' + newSessions.join(', '));
      if (!this.syncProcess) {
        this.startContextSync();
      }
    }

    if (closedSessions.length > 0) {
      this.log('Sessions closed: ' + closedSessions.join(', '));
    }

    this.activeSessions = currentSessions;

    // Check idle timeout
    const idleTime = Date.now() - this.lastActivityTime;
    if (this.syncProcess && currentSessions.size === 0 && idleTime > IDLE_TIMEOUT_MS) {
      this.log('No activity for 30 minutes, stopping sync');
      this.stopContextSync();
    }

    this.saveState();
  }

  async start() {
    this.log('StackMemory Guardian starting...');
    this.log('Monitoring: ' + SESSIONS_DIR);

    // Ensure directories exist
    const dirs = [
      SESSIONS_DIR,
      path.join(HOME, '.stackmemory', 'logs')
    ];

    for (const dir of dirs) {
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }

    // Initial check
    await this.check();

    // Start monitoring loop (every 30 seconds)
    this.checkInterval = setInterval(() => this.check(), 30 * 1000);

    this.log('Guardian started successfully');

    // Handle shutdown signals
    process.on('SIGTERM', () => this.stop());
    process.on('SIGINT', () => this.stop());
  }

  stop() {
    this.log('Guardian stopping...');

    if (this.checkInterval) {
      clearInterval(this.checkInterval);
    }

    this.stopContextSync();

    // Clean up state file
    try {
      if (fs.existsSync(STATE_FILE)) {
        fs.unlinkSync(STATE_FILE);
      }
    } catch (err) {
      // Ignore
    }

    this.log('Guardian stopped');
    process.exit(0);
  }
}

const guardian = new Guardian();
guardian.start().catch(err => {
  console.error('Guardian failed to start:', err);
  process.exit(1);
});
`;
}

async function installService(
  config: ServiceConfig,
  spinner: ora.Ora
): Promise<void> {
  const home = process.env.HOME || '';

  // Create directories
  await fs.mkdir(config.serviceDir, { recursive: true });
  await fs.mkdir(config.logDir, { recursive: true });

  // Write guardian script
  const guardianPath = path.join(home, '.stackmemory', 'guardian.js');
  await fs.writeFile(guardianPath, generateGuardianScript(), 'utf-8');
  await fs.chmod(guardianPath, 0o755);

  if (config.platform === 'darwin') {
    // Write launchd plist
    const plistContent = generateMacOSPlist(config);
    await fs.writeFile(config.serviceFile, plistContent, 'utf-8');

    spinner.text = 'Loading service...';

    // Load the service
    try {
      execSync(`launchctl load -w "${config.serviceFile}"`, { stdio: 'pipe' });
    } catch {
      // Service might already be loaded, try unload first
      try {
        execSync(`launchctl unload "${config.serviceFile}"`, { stdio: 'pipe' });
        execSync(`launchctl load -w "${config.serviceFile}"`, {
          stdio: 'pipe',
        });
      } catch {
        throw new SystemError(
          'Failed to load launchd service',
          ErrorCode.SERVICE_UNAVAILABLE,
          { platform: 'darwin', serviceFile: config.serviceFile }
        );
      }
    }

    spinner.succeed(chalk.green('Guardian service installed and started'));
    console.log(chalk.gray(`Service file: ${config.serviceFile}`));
    console.log(chalk.gray(`Guardian script: ${guardianPath}`));
    console.log(chalk.gray(`Logs: ${config.logDir}/guardian.log`));
  } else if (config.platform === 'linux') {
    // Write systemd service
    const serviceContent = generateLinuxSystemdService(config);
    await fs.writeFile(config.serviceFile, serviceContent, 'utf-8');

    spinner.text = 'Enabling service...';

    // Reload systemd and enable service
    try {
      execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
      execSync(`systemctl --user enable ${config.serviceName}`, {
        stdio: 'pipe',
      });
      execSync(`systemctl --user start ${config.serviceName}`, {
        stdio: 'pipe',
      });
    } catch {
      throw new SystemError(
        'Failed to enable systemd service. Make sure systemd user session is available.',
        ErrorCode.SERVICE_UNAVAILABLE,
        { platform: 'linux', serviceName: config.serviceName }
      );
    }

    spinner.succeed(chalk.green('Guardian service installed and started'));
    console.log(chalk.gray(`Service file: ${config.serviceFile}`));
    console.log(chalk.gray(`Guardian script: ${guardianPath}`));
    console.log(chalk.gray(`Logs: ${config.logDir}/guardian.log`));
  }
}

async function uninstallService(
  config: ServiceConfig,
  spinner: ora.Ora
): Promise<void> {
  const home = process.env.HOME || '';
  const guardianPath = path.join(home, '.stackmemory', 'guardian.js');

  if (config.platform === 'darwin') {
    spinner.text = 'Unloading service...';

    try {
      execSync(`launchctl unload "${config.serviceFile}"`, { stdio: 'pipe' });
    } catch {
      // Service might not be loaded
    }

    // Remove plist file
    try {
      await fs.unlink(config.serviceFile);
    } catch {
      // File might not exist
    }

    // Remove guardian script
    try {
      await fs.unlink(guardianPath);
    } catch {
      // File might not exist
    }

    spinner.succeed(chalk.green('Guardian service uninstalled'));
  } else if (config.platform === 'linux') {
    spinner.text = 'Stopping service...';

    try {
      execSync(`systemctl --user stop ${config.serviceName}`, {
        stdio: 'pipe',
      });
      execSync(`systemctl --user disable ${config.serviceName}`, {
        stdio: 'pipe',
      });
    } catch {
      // Service might not be running
    }

    // Remove service file
    try {
      await fs.unlink(config.serviceFile);
    } catch {
      // File might not exist
    }

    // Remove guardian script
    try {
      await fs.unlink(guardianPath);
    } catch {
      // File might not exist
    }

    // Reload systemd
    try {
      execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
    } catch {
      // Ignore
    }

    spinner.succeed(chalk.green('Guardian service uninstalled'));
  }
}

async function showServiceStatus(config: ServiceConfig): Promise<void> {
  const home = process.env.HOME || '';
  const stateFile = path.join(home, '.stackmemory', 'guardian.state');

  console.log(chalk.bold('\nStackMemory Guardian Service Status\n'));

  if (config.platform === 'unsupported') {
    console.log(chalk.red('Platform not supported for service installation'));
    console.log(
      chalk.gray('Supported platforms: macOS (launchd), Linux (systemd)')
    );
    return;
  }

  // Check if service file exists
  if (!existsSync(config.serviceFile)) {
    console.log(chalk.yellow('Service not installed'));
    console.log(chalk.gray('Install with: stackmemory service install'));
    return;
  }

  let isRunning = false;
  let serviceOutput = '';

  if (config.platform === 'darwin') {
    try {
      serviceOutput = execSync(`launchctl list | grep ${config.serviceName}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      isRunning = serviceOutput.includes(config.serviceName);
    } catch {
      isRunning = false;
    }
  } else if (config.platform === 'linux') {
    try {
      serviceOutput = execSync(
        `systemctl --user is-active ${config.serviceName}`,
        { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'pipe'] }
      ).trim();
      isRunning = serviceOutput === 'active';
    } catch {
      isRunning = false;
    }
  }

  if (isRunning) {
    console.log(chalk.green('Status: Running'));
  } else {
    console.log(chalk.yellow('Status: Stopped'));
  }

  console.log(chalk.gray(`Platform: ${config.platform}`));
  console.log(chalk.gray(`Service: ${config.serviceName}`));
  console.log(chalk.gray(`Config: ${config.serviceFile}`));

  // Try to read guardian state
  if (existsSync(stateFile)) {
    try {
      const state = JSON.parse(readFileSync(stateFile, 'utf-8'));
      console.log(chalk.bold('\nGuardian State:'));
      console.log(`  Last check: ${state.lastCheck}`);
      console.log(`  Active sessions: ${state.activeSessions?.length || 0}`);
      console.log(`  Sync running: ${state.syncRunning ? 'Yes' : 'No'}`);
      console.log(`  Last activity: ${state.lastActivity}`);
    } catch {
      // Invalid state file
    }
  }
}

async function showServiceLogs(
  config: ServiceConfig,
  lines: number
): Promise<void> {
  console.log(
    chalk.bold(`\nStackMemory Guardian Logs (last ${lines} lines)\n`)
  );

  const logFile = path.join(config.logDir, 'guardian.log');

  if (!existsSync(logFile)) {
    console.log(chalk.yellow('No logs found'));
    console.log(chalk.gray(`Expected at: ${logFile}`));
    return;
  }

  try {
    const content = readFileSync(logFile, 'utf-8');
    const logLines = content.split('\n').filter(Boolean);
    const lastLines = logLines.slice(-lines);

    lastLines.forEach((line) => {
      if (line.includes('[ERROR]')) {
        console.log(chalk.red(line));
      } else if (line.includes('[WARN]')) {
        console.log(chalk.yellow(line));
      } else {
        console.log(chalk.gray(line));
      }
    });

    console.log(chalk.gray(`\nFull log: ${logFile}`));
  } catch (err) {
    console.log(chalk.red(`Failed to read logs: ${(err as Error).message}`));
  }
}

/**
 * Install service silently (for use by init --daemon)
 * Returns true on success, false on failure
 */
export async function installServiceSilent(): Promise<boolean> {
  try {
    const config = getServiceConfig();

    if (config.platform === 'unsupported') {
      return false;
    }

    const home = process.env.HOME || '';

    // Create directories
    await fs.mkdir(config.serviceDir, { recursive: true });
    await fs.mkdir(config.logDir, { recursive: true });

    // Write guardian script
    const guardianPath = path.join(home, '.stackmemory', 'guardian.js');
    await fs.writeFile(guardianPath, generateGuardianScript(), 'utf-8');
    await fs.chmod(guardianPath, 0o755);

    if (config.platform === 'darwin') {
      const plistContent = generateMacOSPlist(config);
      await fs.writeFile(config.serviceFile, plistContent, 'utf-8');

      try {
        execSync(`launchctl load -w "${config.serviceFile}"`, {
          stdio: 'pipe',
        });
      } catch {
        try {
          execSync(`launchctl unload "${config.serviceFile}"`, {
            stdio: 'pipe',
          });
          execSync(`launchctl load -w "${config.serviceFile}"`, {
            stdio: 'pipe',
          });
        } catch {
          return false;
        }
      }
      return true;
    } else if (config.platform === 'linux') {
      const serviceContent = generateLinuxSystemdService(config);
      await fs.writeFile(config.serviceFile, serviceContent, 'utf-8');

      try {
        execSync('systemctl --user daemon-reload', { stdio: 'pipe' });
        execSync(`systemctl --user enable ${config.serviceName}`, {
          stdio: 'pipe',
        });
        execSync(`systemctl --user start ${config.serviceName}`, {
          stdio: 'pipe',
        });
      } catch {
        return false;
      }
      return true;
    }

    return false;
  } catch {
    return false;
  }
}

export function createServiceCommand(): Command {
  const cmd = new Command('service')
    .description('Manage StackMemory guardian OS service (auto-start on login)')
    .addHelpText(
      'after',
      `
Examples:
  stackmemory service install     Install and start the guardian service
  stackmemory service uninstall   Remove the guardian service
  stackmemory service status      Show service status
  stackmemory service logs        Show recent service logs
  stackmemory service logs -n 50  Show last 50 log lines

The guardian service:
  - Monitors ~/.stackmemory/sessions/ for active sessions
  - Starts context sync when an active session is detected
  - Stops gracefully after 30 minutes of inactivity
  - Runs automatically on system login (opt-in)
`
    );

  cmd
    .command('install')
    .description('Install the guardian service (starts on login)')
    .action(async () => {
      const spinner = ora('Installing guardian service...').start();

      try {
        const config = getServiceConfig();

        if (config.platform === 'unsupported') {
          spinner.fail(chalk.red('Platform not supported'));
          console.log(
            chalk.gray('Supported: macOS (launchd), Linux (systemd)')
          );
          process.exit(1);
        }

        await installService(config, spinner);

        console.log(chalk.bold('\nGuardian service will:'));
        console.log('  - Start automatically on login');
        console.log('  - Monitor for active StackMemory sessions');
        console.log('  - Manage context sync based on activity');
        console.log('  - Stop gracefully after 30 min idle');
      } catch (err) {
        spinner.fail(
          chalk.red(`Installation failed: ${(err as Error).message}`)
        );
        process.exit(1);
      }
    });

  cmd
    .command('uninstall')
    .description('Remove the guardian service')
    .action(async () => {
      const spinner = ora('Uninstalling guardian service...').start();

      try {
        const config = getServiceConfig();

        if (config.platform === 'unsupported') {
          spinner.fail(chalk.red('Platform not supported'));
          process.exit(1);
        }

        await uninstallService(config, spinner);
      } catch (err) {
        spinner.fail(
          chalk.red(`Uninstallation failed: ${(err as Error).message}`)
        );
        process.exit(1);
      }
    });

  cmd
    .command('status')
    .description('Show guardian service status')
    .action(async () => {
      try {
        const config = getServiceConfig();
        await showServiceStatus(config);
      } catch (err) {
        console.error(
          chalk.red(`Status check failed: ${(err as Error).message}`)
        );
        process.exit(1);
      }
    });

  cmd
    .command('logs')
    .description('Show recent guardian service logs')
    .option('-n, --lines <number>', 'Number of log lines to show', '20')
    .option('-f, --follow', 'Follow log output (tail -f style)')
    .action(async (options) => {
      try {
        const config = getServiceConfig();
        const lines = parseInt(options.lines) || 20;

        if (options.follow) {
          // Use tail -f for live following
          const logFile = path.join(config.logDir, 'guardian.log');
          console.log(chalk.bold(`Following ${logFile} (Ctrl+C to stop)\n`));

          const tail = spawn('tail', ['-f', '-n', lines.toString(), logFile], {
            stdio: 'inherit',
          });

          process.on('SIGINT', () => {
            tail.kill();
            process.exit(0);
          });
        } else {
          await showServiceLogs(config, lines);
        }
      } catch (err) {
        console.error(
          chalk.red(`Failed to show logs: ${(err as Error).message}`)
        );
        process.exit(1);
      }
    });

  // Default action - show status
  cmd.action(async () => {
    try {
      const config = getServiceConfig();
      await showServiceStatus(config);
    } catch (err) {
      console.error(
        chalk.red(`Status check failed: ${(err as Error).message}`)
      );
      process.exit(1);
    }
  });

  return cmd;
}

export default createServiceCommand();
