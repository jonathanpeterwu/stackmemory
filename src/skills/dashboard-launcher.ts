/**
 * Dashboard Launcher Skill
 * Automatically launches the StackMemory web dashboard on new sessions
 */

import { exec, type ChildProcess } from 'child_process';
import { promisify } from 'util';
import { existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../core/monitoring/logger.js';

const execAsync = promisify(exec);

export interface DashboardLauncherConfig {
  autoLaunch: boolean;
  webPort: number;
  serverPort: number;
  openBrowser: boolean;
  mode: 'tui' | 'web' | 'both';
}

export class DashboardLauncherSkill {
  private config: DashboardLauncherConfig;
  private serverProcess: ChildProcess | null = null;
  private webProcess: ChildProcess | null = null;

  constructor(config?: Partial<DashboardLauncherConfig>) {
    this.config = {
      autoLaunch: true,
      webPort: 3000,
      serverPort: 8080,
      openBrowser: true,
      mode: 'web',
      ...config,
    };
  }

  /**
   * Check if the dashboard server is running
   */
  async isServerRunning(): Promise<boolean> {
    try {
      const response = await fetch(
        `http://localhost:${this.config.serverPort}/api/health`
      );
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Check if the web dashboard is running
   */
  async isWebRunning(): Promise<boolean> {
    try {
      const response = await fetch(`http://localhost:${this.config.webPort}`);
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Launch the dashboard server
   */
  async launchServer(): Promise<void> {
    if (await this.isServerRunning()) {
      logger.info('Dashboard server already running');
      return;
    }

    logger.info('Starting dashboard server...');

    try {
      // Build the server first
      await execAsync('npm run build');

      // Start the server in background
      const { spawn } = await import('child_process');
      this.serverProcess = spawn(
        'node',
        ['dist/features/web/server/index.js'],
        {
          detached: true,
          stdio: 'ignore',
          env: {
            ...process.env,
            WS_PORT: String(this.config.serverPort),
          },
        }
      );

      this.serverProcess.unref();

      // Wait for server to start
      let attempts = 0;
      while (attempts < 10) {
        if (await this.isServerRunning()) {
          logger.info(
            `Dashboard server started on port ${this.config.serverPort}`
          );
          return;
        }
        await new Promise((r) => setTimeout(r, 1000));
        attempts++;
      }

      throw new Error('Server failed to start');
    } catch (error: unknown) {
      logger.error('Failed to launch dashboard server:', error);
      throw error;
    }
  }

  /**
   * Launch the web dashboard
   */
  async launchWeb(): Promise<void> {
    if (await this.isWebRunning()) {
      logger.info('Web dashboard already running');
      if (this.config.openBrowser) {
        await this.openInBrowser();
      }
      return;
    }

    logger.info('Starting web dashboard...');

    try {
      // Check if Next.js app exists
      const webPath = join(process.cwd(), 'src/features/web/client');
      if (!existsSync(webPath)) {
        logger.warn('Web dashboard not found. Run setup first.');
        return;
      }

      // Start Next.js dev server
      const { spawn } = await import('child_process');
      this.webProcess = spawn('npm', ['run', 'dev'], {
        cwd: webPath,
        detached: true,
        stdio: 'ignore',
        env: {
          ...process.env,
          PORT: String(this.config.webPort),
          NEXT_PUBLIC_WS_URL: `http://localhost:${this.config.serverPort}`,
        },
      });

      this.webProcess.unref();

      // Wait for web to start
      let attempts = 0;
      while (attempts < 15) {
        if (await this.isWebRunning()) {
          logger.info(`Web dashboard started on port ${this.config.webPort}`);
          if (this.config.openBrowser) {
            await this.openInBrowser();
          }
          return;
        }
        await new Promise((r) => setTimeout(r, 2000));
        attempts++;
      }

      throw new Error('Web dashboard failed to start');
    } catch (error: unknown) {
      logger.error('Failed to launch web dashboard:', error);
      throw error;
    }
  }

  /**
   * Launch the TUI dashboard
   */
  async launchTUI(): Promise<void> {
    logger.info('Launching TUI dashboard...');

    try {
      const { spawn } = await import('child_process');
      spawn('node', ['dist/features/tui/index.js'], {
        stdio: 'inherit',
      });
    } catch (error: unknown) {
      logger.error('Failed to launch TUI:', error);
      throw error;
    }
  }

  /**
   * Open dashboard in browser
   */
  async openInBrowser(): Promise<void> {
    const url = `http://localhost:${this.config.webPort}`;
    const platform = process.platform;

    try {
      let command: string;
      if (platform === 'darwin') {
        command = `open ${url}`;
      } else if (platform === 'win32') {
        command = `start ${url}`;
      } else {
        command = `xdg-open ${url}`;
      }

      await execAsync(command);
      logger.info(`Opened dashboard in browser: ${url}`);
    } catch (error: unknown) {
      logger.warn('Failed to open browser:', error);
    }
  }

  /**
   * Launch dashboard based on configuration
   */
  async launch(): Promise<void> {
    if (!this.config.autoLaunch) {
      logger.info('Dashboard auto-launch disabled');
      return;
    }

    try {
      // Always start the server for web mode
      if (this.config.mode === 'web' || this.config.mode === 'both') {
        await this.launchServer();
        await this.launchWeb();
      }

      // Launch TUI if requested
      if (this.config.mode === 'tui' || this.config.mode === 'both') {
        await this.launchTUI();
      }

      logger.info('Dashboard launched successfully');
    } catch (error: unknown) {
      logger.error('Dashboard launch failed:', error);
    }
  }

  /**
   * Stop all dashboard processes
   */
  async stop(): Promise<void> {
    if (this.serverProcess) {
      this.serverProcess.kill();
      this.serverProcess = null;
    }

    if (this.webProcess) {
      this.webProcess.kill();
      this.webProcess = null;
    }

    logger.info('Dashboard processes stopped');
  }
}

// Export singleton instance for Claude integration
export const dashboardLauncher = new DashboardLauncherSkill();
