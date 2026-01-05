#!/usr/bin/env node
/**
 * StackMemory TUI Dashboard
 * Interactive monitoring interface for sessions, tasks, frames, and integrations
 */

import 'dotenv/config';
import blessed from 'blessed';
import contrib from 'blessed-contrib';
import { EventEmitter } from 'events';
import { terminalCompat } from './terminal-compat.js';
import { SessionMonitor } from './components/session-monitor.js';
import { TaskBoard } from './components/task-board.js';
import { FrameVisualizer } from './components/frame-visualizer.js';
import { SubagentFleet } from './components/subagent-fleet.js';
import { PRTracker } from './components/pr-tracker.js';
import { AnalyticsPanel } from './components/analytics-panel.js';
import { DataService } from './services/data-service.js';
import { WebSocketClient } from './services/websocket-client.js';
import type { DashboardConfig, SessionData, TaskData } from './types.js';

// Configure terminal environment before creating any blessed elements
terminalCompat.configureEnvironment();

export class StackMemoryTUI extends EventEmitter {
  private screen: blessed.Widgets.Screen;
  private grid: any;
  private components: Map<string, any>;
  private dataService: DataService;
  private wsClient: WebSocketClient;
  private config: DashboardConfig;
  private refreshInterval: NodeJS.Timeout | null = null;

  constructor(config: DashboardConfig = {}) {
    super();
    this.config = {
      refreshInterval: 1000,
      wsUrl: 'ws://localhost:8080',
      theme: 'dark',
      ...config,
    };

    this.components = new Map();
    this.dataService = new DataService();
    this.wsClient = new WebSocketClient(this.config.wsUrl);
    this.screen = this.createScreen();
    this.grid = this.createGrid();
    this.initializeComponents();
    this.setupEventHandlers();
  }

  private createScreen(): blessed.Widgets.Screen {
    // Get terminal-specific configuration
    const blessedConfig = terminalCompat.getBlessedConfig();

    const screen = blessed.screen({
      ...blessedConfig,
      autoPadding: true,
    });

    // Add header
    const header = blessed.box({
      parent: screen,
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: '{center}🚀 StackMemory TUI Dashboard v1.0.0{/center}',
      tags: true,
      style: {
        fg: 'white',
        bg: 'blue',
        bold: true,
      },
    });

    return screen;
  }

  private createGrid(): any {
    // Create a 12x12 grid for flexible layout
    const grid = new contrib.grid({
      rows: 12,
      cols: 12,
      screen: this.screen,
    });

    return grid;
  }

  private initializeComponents(): void {
    // Session Monitor (Top Left - 6x4)
    const sessionMonitor = new SessionMonitor(
      this.grid.set(0, 0, 4, 6, blessed.box, {
        label: '📊 Sessions',
        border: { type: 'line' },
        style: { border: { fg: 'cyan' } },
      })
    );
    this.components.set('sessions', sessionMonitor);

    // Task Board - Linear Integration (Top Right - 6x4)
    const taskBoard = new TaskBoard(
      this.grid.set(0, 6, 4, 6, blessed.box, {
        label: '📋 Linear Tasks',
        border: { type: 'line' },
        style: { border: { fg: 'green' } },
      })
    );
    this.components.set('tasks', taskBoard);

    // Frame Visualizer (Middle Left - 6x4)
    // Create a box container first, then add the tree inside
    const frameContainer = this.grid.set(4, 0, 4, 6, blessed.box, {
      label: '🗂️ Frame Storage',
      border: { type: 'line' },
      style: { border: { fg: 'yellow' } },
    });

    const frameTree = contrib.tree({
      parent: frameContainer,
      top: 0,
      left: 0,
      width: '100%-2',
      height: '100%-2',
      style: {
        text: 'green',
        selected: {
          bg: 'yellow',
          fg: 'black',
        },
      },
      template: {
        lines: true,
      },
      label: '',
    });

    const frameViz = new FrameVisualizer(frameTree);
    this.components.set('frames', frameViz);

    // Subagent Fleet (Middle Right - 6x4)
    const subagentFleet = new SubagentFleet(
      this.grid.set(4, 6, 4, 6, blessed.box, {
        label: '🤖 Subagent Fleet',
        border: { type: 'line' },
        style: { border: { fg: 'magenta' } },
      })
    );
    this.components.set('subagents', subagentFleet);

    // PR/Issue Tracker (Bottom Left - 6x2)
    const prTracker = new PRTracker(
      this.grid.set(8, 0, 2, 6, blessed.list, {
        label: '🔀 PR/Issues',
        border: { type: 'line' },
        style: { border: { fg: 'red' } },
        scrollable: true,
        mouse: true,
      })
    );
    this.components.set('prs', prTracker);

    // Analytics Panel (Bottom Right - 6x2)
    const analytics = new AnalyticsPanel(
      this.grid.set(8, 6, 2, 6, contrib.line, {
        label: '📈 Analytics',
        border: { type: 'line' },
        style: {
          border: { fg: 'white' },
          line: 'yellow',
          text: 'green',
          baseline: 'black',
        },
        showLegend: true,
        wholeNumbersOnly: false,
      })
    );
    this.components.set('analytics', analytics);

    // Status Bar (Bottom - 12x2)
    const statusBar = blessed.box({
      parent: this.screen,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 2,
      tags: true,
      style: {
        fg: 'white',
        bg: 'black',
      },
    });
    this.components.set('status', statusBar);

    this.updateStatusBar('Ready');
  }

  private setupEventHandlers(): void {
    // Keyboard shortcuts
    this.screen.key(['q', 'C-c'], () => {
      this.cleanup();
      process.exit(0);
    });

    this.screen.key(['r', 'C-r'], () => {
      this.refresh();
    });

    this.screen.key(['tab'], () => {
      this.focusNext();
    });

    this.screen.key(['S-tab'], () => {
      this.focusPrevious();
    });

    // View switching
    this.screen.key(['1'], () => this.showView('sessions'));
    this.screen.key(['2'], () => this.showView('tasks'));
    this.screen.key(['3'], () => this.showView('frames'));
    this.screen.key(['4'], () => this.showView('subagents'));
    this.screen.key(['5'], () => this.showView('prs'));
    this.screen.key(['6'], () => this.showView('analytics'));

    // WebSocket events
    this.wsClient.on('session:update', (data: SessionData) => {
      this.components.get('sessions')?.update(data);
    });

    this.wsClient.on('task:update', (data: TaskData) => {
      this.components.get('tasks')?.update(data);
    });

    this.wsClient.on('frame:update', (data) => {
      this.components.get('frames')?.update(data);
    });

    this.wsClient.on('agent:status', (data) => {
      this.components.get('subagents')?.update(data);
    });

    this.wsClient.on('pr:update', (data) => {
      this.components.get('prs')?.update(data);
    });

    // Data service events
    this.dataService.on('data:ready', () => {
      this.updateAll();
    });

    this.dataService.on('error', (error) => {
      this.showError(error.message);
    });
  }

  private async updateAll(): Promise<void> {
    try {
      // Fetch latest data
      const [sessions, tasks, frames, agents, prs, issues, analytics] =
        await Promise.all([
          this.dataService.getSessions(),
          this.dataService.getTasks(),
          this.dataService.getFrames(),
          this.dataService.getAgents(),
          this.dataService.getPRs(),
          this.dataService.getIssues(),
          this.dataService.getAnalytics(),
        ]);

      // Update components
      this.components.get('sessions')?.update(sessions);
      this.components.get('tasks')?.update(tasks);
      this.components.get('frames')?.update(frames);
      this.components.get('subagents')?.update(agents);
      // PR/Issue tracker expects an object with prs/issues
      this.components.get('prs')?.update({ prs, issues });
      this.components.get('analytics')?.update(analytics);

      this.updateStatusBar(`Last updated: ${new Date().toLocaleTimeString()}`);
      this.screen.render();
    } catch (error) {
      this.showError(`Update failed: ${error.message}`);
    }
  }

  private refresh(): void {
    this.updateStatusBar('Refreshing...');
    this.updateAll();
  }

  private focusNext(): void {
    const components = Array.from(this.components.values());
    const currentIndex = components.findIndex((c) => c.hasFocus?.());
    const nextIndex = (currentIndex + 1) % components.length;
    components[nextIndex]?.focus?.();
    this.screen.render();
  }

  private focusPrevious(): void {
    const components = Array.from(this.components.values());
    const currentIndex = components.findIndex((c) => c.hasFocus?.());
    const prevIndex =
      currentIndex <= 0 ? components.length - 1 : currentIndex - 1;
    components[prevIndex]?.focus?.();
    this.screen.render();
  }

  private showView(viewName: string): void {
    const component = this.components.get(viewName);
    if (component) {
      component.focus?.();
      component.show?.();
      this.updateStatusBar(`Viewing: ${viewName}`);
      this.screen.render();
    }
  }

  private updateStatusBar(message: string): void {
    const statusBar = this.components.get('status');
    if (statusBar) {
      const shortcuts =
        '{yellow-fg}[q]{/} Quit | {yellow-fg}[r]{/} Refresh | {yellow-fg}[Tab]{/} Navigate | {yellow-fg}[1-6]{/} Views';
      statusBar.setContent(`{bold}${message}{/} | ${shortcuts}`);
      this.screen.render();
    }
  }

  private showError(message: string): void {
    const msg = blessed.message({
      parent: this.screen,
      border: 'line',
      height: 'shrink',
      width: 'half',
      top: 'center',
      left: 'center',
      label: '{red-fg}Error{/}',
      tags: true,
      hidden: true,
    });

    msg.display(message, () => {
      msg.destroy();
      this.screen.render();
    });
  }

  public async start(): Promise<void> {
    try {
      // Show terminal compatibility info
      const termInfo = terminalCompat.getTerminalInfo();
      const warnings = terminalCompat.getWarnings();

      if (warnings.length > 0) {
        console.log('⚠️  Terminal Compatibility Warnings:');
        warnings.forEach((w) => console.log(`   • ${w}`));
        console.log('');

        // Give user time to read warnings
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }

      // Show terminal capabilities in debug mode
      if (process.env.DEBUG || process.env.TUI_DEBUG) {
        console.log('🔍 Terminal Capabilities:');
        console.log(`   ${terminalCompat.getCapabilitiesString()}`);
        console.log('');
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }

      // Connect WebSocket (but don't fail if it can't connect)
      try {
        await this.wsClient.connect();
      } catch (wsError) {
        console.log('⚠️  Running in offline mode (no WebSocket connection)');
      }

      // Initialize data service
      await this.dataService.initialize();

      // Start auto-refresh
      if (this.config.refreshInterval > 0) {
        this.refreshInterval = setInterval(() => {
          this.updateAll().catch((error) => {
            // Silent error handling for refresh failures
            if (process.env.DEBUG) {
              console.error('Update error:', error);
            }
          });
        }, this.config.refreshInterval);
      }

      // Initial data load
      await this.updateAll();

      // Render screen
      this.screen.render();
    } catch (error) {
      console.error('\n❌ TUI startup error:', error);
      if (error instanceof Error) {
        console.error('Error details:', error.message);
        if (process.env.DEBUG) {
          console.error('Stack trace:', error.stack);
        }
      }
      throw error;
    }
  }

  public cleanup(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    this.wsClient.disconnect();
    this.dataService.cleanup();
  }
}

// CLI entry point
// Check if this file is being run directly
const isMainModule =
  typeof process !== 'undefined' &&
  process.argv &&
  process.argv[1] &&
  (import.meta.url === `file://${process.argv[1]}` ||
    process.argv[1].endsWith('/index.js'));

if (isMainModule) {
  // Check terminal compatibility first
  if (!terminalCompat.isCompatible()) {
    console.error('❌ Terminal is not compatible with TUI mode');
    console.error(
      '   Please use the dashboard command instead: stackmemory dashboard --watch'
    );
    process.exit(1);
  }

  // Handle uncaught errors gracefully
  process.on('uncaughtException', (error) => {
    console.error('\n❌ TUI Error:', error.message || error);
    console.error('Error type:', error.constructor.name);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    console.error(
      '\n💡 Try the simpler dashboard instead: stackmemory dashboard --watch'
    );
    process.exit(1);
  });

  process.on('unhandledRejection', (reason, promise) => {
    console.error('\n❌ Unhandled promise rejection at:', promise);
    console.error('Reason:', reason);
    if (reason instanceof Error) {
      console.error('Stack trace:', reason.stack);
    }
    console.error(
      '\n💡 Try the simpler dashboard instead: stackmemory dashboard --watch'
    );
    process.exit(1);
  });

  let tui;
  try {
    tui = new StackMemoryTUI({
      refreshInterval: 2000,
      wsUrl: process.env.STACKMEMORY_WS_URL || 'ws://localhost:8080',
    });
  } catch (constructorError) {
    console.error(
      '\n❌ Failed to create TUI:',
      constructorError.message || constructorError
    );
    if (constructorError.stack) {
      console.error('Stack trace:', constructorError.stack);
    }
    console.error(
      '\n💡 Try the simpler dashboard instead: stackmemory dashboard --watch'
    );
    process.exit(1);
  }

  tui.start().catch((error) => {
    console.error('\n❌ Failed to start TUI:', error.message || error);
    if (error.stack) {
      console.error('Stack trace:', error.stack);
    }
    console.error(
      '\n💡 Try the simpler dashboard instead: stackmemory dashboard --watch'
    );
    process.exit(1);
  });

  process.on('SIGINT', () => {
    tui.cleanup();
    process.exit(0);
  });
}
