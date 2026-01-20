/**
 * Real-time TUI for monitoring Ralph Swarm operations
 * Tracks commits, status, agents, and lines edited per agent
 */

import blessed from 'blessed';
import { logger } from '../../core/monitoring/logger.js';
import { SwarmCoordinator } from '../../integrations/ralph/swarm/swarm-coordinator.js';
import { SwarmDashboard } from '../../integrations/ralph/monitoring/swarm-dashboard.js';
import { SwarmRegistry } from '../../integrations/ralph/monitoring/swarm-registry.js';
import { execSync } from 'child_process';

export interface SwarmCommitMetrics {
  agentId: string;
  role: string;
  commits: Array<{
    hash: string;
    message: string;
    timestamp: number;
    linesAdded: number;
    linesDeleted: number;
    filesChanged: number;
  }>;
  totalCommits: number;
  totalLinesAdded: number;
  totalLinesDeleted: number;
  lastActivity: number;
}

export interface SwarmStatus {
  swarmId: string;
  status: 'active' | 'idle' | 'completed' | 'error';
  startTime: number;
  uptime: number;
  agents: Array<{
    id: string;
    role: string;
    status: string;
    currentTask?: string;
    iteration: number;
    lastActivity: number;
  }>;
  performance: {
    throughput: number;
    efficiency: number;
    totalTasks: number;
    completedTasks: number;
  };
}

export class SwarmTUI {
  private screen: blessed.Widgets.Screen;
  private commitsTable: blessed.Widgets.TableElement;
  private statusBox: blessed.Widgets.BoxElement;
  private agentsTable: blessed.Widgets.TableElement;
  private metricsBox: blessed.Widgets.BoxElement;
  private logBox: blessed.Widgets.LogElement;
  
  private swarmCoordinator: SwarmCoordinator | null = null;
  private swarmDashboard: SwarmDashboard | null = null;
  private refreshInterval: NodeJS.Timeout | null = null;
  private commitMetrics: Map<string, SwarmCommitMetrics> = new Map();
  
  constructor() {
    this.screen = blessed.screen({
      smartCSR: true,
      title: 'Ralph Swarm Monitor'
    });
    
    this.createUI();
    this.setupKeyHandlers();
    
    logger.info('SwarmTUI initialized');
  }

  private createUI(): void {
    // Main layout container
    const container = blessed.box({
      parent: this.screen,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%',
      style: {
        bg: 'black'
      }
    });

    // Title bar
    blessed.box({
      parent: container,
      top: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: '🦾 Ralph Swarm Monitor - Real-time Swarm Operations',
      style: {
        bg: 'blue',
        fg: 'white',
        bold: true
      },
      border: {
        type: 'line'
      }
    });

    // Status box (top right)
    this.statusBox = blessed.box({
      parent: container,
      top: 3,
      left: '50%',
      width: '50%',
      height: 8,
      label: ' Swarm Status ',
      content: 'No active swarm',
      style: {
        bg: 'black',
        fg: 'white'
      },
      border: {
        type: 'line',
        fg: 'cyan'
      }
    });

    // Metrics box (top left)
    this.metricsBox = blessed.box({
      parent: container,
      top: 3,
      left: 0,
      width: '50%',
      height: 8,
      label: ' Performance Metrics ',
      content: 'Waiting for data...',
      style: {
        bg: 'black',
        fg: 'white'
      },
      border: {
        type: 'line',
        fg: 'green'
      }
    });

    // Agents table (middle left)
    this.agentsTable = blessed.table({
      parent: container,
      top: 11,
      left: 0,
      width: '50%',
      height: 12,
      label: ' Active Agents ',
      style: {
        bg: 'black',
        fg: 'white',
        header: {
          bg: 'blue',
          fg: 'white',
          bold: true
        },
        cell: {
          selected: {
            bg: 'blue',
            fg: 'white'
          }
        }
      },
      border: {
        type: 'line',
        fg: 'yellow'
      },
      data: [
        ['Role', 'Status', 'Iteration', 'Task', 'Last Active']
      ]
    });

    // Commits table (middle right)
    this.commitsTable = blessed.table({
      parent: container,
      top: 11,
      left: '50%',
      width: '50%',
      height: 12,
      label: ' Recent Commits ',
      style: {
        bg: 'black',
        fg: 'white',
        header: {
          bg: 'blue',
          fg: 'white',
          bold: true
        },
        cell: {
          selected: {
            bg: 'blue',
            fg: 'white'
          }
        }
      },
      border: {
        type: 'line',
        fg: 'magenta'
      },
      data: [
        ['Agent', 'Message', 'Lines +/-', 'Time']
      ]
    });

    // Log output (bottom)
    this.logBox = blessed.log({
      parent: container,
      top: 23,
      left: 0,
      width: '100%',
      height: '100%-23',
      label: ' Swarm Logs ',
      style: {
        bg: 'black',
        fg: 'white'
      },
      border: {
        type: 'line',
        fg: 'white'
      },
      scrollable: true,
      alwaysScroll: true,
      mouse: true
    });

    // Help text
    blessed.box({
      parent: container,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 1,
      content: 'Press q to quit, r to refresh, s to start swarm, t to stop swarm',
      style: {
        bg: 'white',
        fg: 'black'
      }
    });
  }

  private setupKeyHandlers(): void {
    this.screen.key(['escape', 'q', 'C-c'], () => {
      this.cleanup();
      process.exit(0);
    });

    this.screen.key(['r'], () => {
      this.refreshData();
      this.logBox.log('Manual refresh triggered');
    });

    this.screen.key(['s'], () => {
      this.logBox.log('Start swarm command - feature coming soon');
    });

    this.screen.key(['t'], () => {
      this.logBox.log('Stop swarm command - feature coming soon');
    });
  }

  /**
   * Initialize swarm monitoring
   */
  async initialize(swarmCoordinator?: SwarmCoordinator, swarmId?: string): Promise<void> {
    try {
      // Connect to existing swarm if ID provided
      if (swarmId) {
        const registry = SwarmRegistry.getInstance();
        const swarm = registry.getSwarm(swarmId);
        if (swarm) {
          this.swarmCoordinator = swarm.coordinator;
          this.logBox.log(`Connected to swarm: ${swarmId}`);
        } else {
          this.logBox.log(`Swarm not found: ${swarmId}`);
        }
      } else if (swarmCoordinator) {
        this.swarmCoordinator = swarmCoordinator;
      } else {
        // Auto-detect active swarms
        const registry = SwarmRegistry.getInstance();
        const activeSwarms = registry.listActiveSwarms();
        if (activeSwarms.length > 0) {
          this.swarmCoordinator = activeSwarms[0].coordinator;
          this.logBox.log(`Auto-connected to swarm: ${activeSwarms[0].id}`);
        }
      }

      if (this.swarmCoordinator) {
        this.swarmDashboard = new SwarmDashboard(this.swarmCoordinator);
        this.swarmDashboard.startMonitoring(2000); // 2 second refresh
        
        // Listen to swarm events
        this.swarmDashboard.on('metricsUpdated', (metrics) => {
          this.updateUI(metrics);
        });
      }

      // Start refresh interval
      this.refreshInterval = setInterval(() => {
        this.refreshData();
      }, 3000);

      this.logBox.log('SwarmTUI monitoring initialized');
    } catch (error: unknown) {
      logger.error('Failed to initialize SwarmTUI', error as Error);
      this.logBox.log(`Error: ${(error as Error).message}`);
    }
  }

  /**
   * Start the TUI display
   */
  start(): void {
    this.screen.render();
    this.logBox.log('Ralph Swarm Monitor started');
    this.logBox.log('Monitoring for active swarms...');
  }

  /**
   * Refresh all data
   */
  private async refreshData(): Promise<void> {
    try {
      // Update commit metrics
      await this.updateCommitMetrics();
      
      // Update swarm status if coordinator available
      if (this.swarmCoordinator) {
        const status = this.getSwarmStatus();
        this.updateStatusDisplay(status);
      } else {
        // Try to detect active swarms
        await this.detectActiveSwarms();
      }
      
      this.screen.render();
    } catch (error: unknown) {
      logger.error('Failed to refresh TUI data', error as Error);
      this.logBox.log(`Refresh error: ${(error as Error).message}`);
    }
  }

  /**
   * Update commit metrics for all agents
   */
  private async updateCommitMetrics(): Promise<void> {
    try {
      // Get recent commits from git log
      const gitLog = execSync(
        'git log --oneline --since="1 hour ago" --pretty=format:"%H|%an|%s|%ct" --numstat',
        { encoding: 'utf8', cwd: process.cwd() }
      );

      const commits = this.parseGitCommits(gitLog);
      this.updateCommitsTable(commits);
      
    } catch (error: unknown) {
      // Git might fail if no commits, that's okay
      this.logBox.log('No recent commits found');
    }
  }

  /**
   * Parse git log output into commit data
   */
  private parseGitCommits(gitLog: string): Array<{
    hash: string;
    agent: string;
    message: string;
    timestamp: number;
    linesAdded: number;
    linesDeleted: number;
  }> {
    const commits = [];
    const lines = gitLog.split('\n').filter(Boolean);
    
    let currentCommit: any = null;
    
    for (const line of lines) {
      if (line.includes('|')) {
        // Commit info line
        const [hash, author, message, timestamp] = line.split('|');
        currentCommit = {
          hash: hash.substring(0, 8),
          agent: this.extractAgentFromAuthor(author),
          message: message.substring(0, 50),
          timestamp: parseInt(timestamp),
          linesAdded: 0,
          linesDeleted: 0
        };
      } else if (currentCommit && line.match(/^\d+\s+\d+/)) {
        // Stat line (added/deleted)
        const [added, deleted] = line.split('\t')[0].split(' ');
        currentCommit.linesAdded += parseInt(added) || 0;
        currentCommit.linesDeleted += parseInt(deleted) || 0;
        
        commits.push({ ...currentCommit });
        currentCommit = null;
      }
    }
    
    return commits.slice(0, 10); // Show last 10 commits
  }

  /**
   * Extract agent info from git author
   */
  private extractAgentFromAuthor(author: string): string {
    // Look for [agent_role] pattern in commit author or message
    const agentMatch = author.match(/\[(\w+)\]/);
    if (agentMatch) {
      return agentMatch[1];
    }
    
    // Fallback to checking if author contains known agent roles
    const roles = ['developer', 'tester', 'optimizer', 'documenter', 'architect'];
    for (const role of roles) {
      if (author.toLowerCase().includes(role)) {
        return role;
      }
    }
    
    return 'user';
  }

  /**
   * Update commits table display
   */
  private updateCommitsTable(commits: any[]): void {
    const tableData = [
      ['Agent', 'Message', 'Lines +/-', 'Time']
    ];

    for (const commit of commits) {
      const timeAgo = this.formatTimeAgo(commit.timestamp * 1000);
      const linesChange = `+${commit.linesAdded}/-${commit.linesDeleted}`;
      
      tableData.push([
        commit.agent,
        commit.message,
        linesChange,
        timeAgo
      ]);
    }

    this.commitsTable.setData(tableData);
  }

  /**
   * Get current swarm status
   */
  private getSwarmStatus(): SwarmStatus | null {
    if (!this.swarmCoordinator) return null;

    const usage = this.swarmCoordinator.getResourceUsage();
    const swarmState = (this.swarmCoordinator as any).swarmState;
    
    if (!swarmState) return null;

    return {
      swarmId: swarmState.id,
      status: swarmState.status,
      startTime: swarmState.startTime,
      uptime: Date.now() - swarmState.startTime,
      agents: usage.activeAgents ? Array.from((this.swarmCoordinator as any).activeAgents?.values() || []).map((agent: any) => ({
        id: agent.id,
        role: agent.role,
        status: agent.status,
        currentTask: agent.currentTask,
        iteration: agent.performance?.tasksCompleted || 0,
        lastActivity: agent.performance?.lastFreshStart || Date.now()
      })) : [],
      performance: {
        throughput: swarmState.performance?.throughput || 0,
        efficiency: swarmState.performance?.efficiency || 0,
        totalTasks: swarmState.totalTaskCount || 0,
        completedTasks: swarmState.completedTaskCount || 0
      }
    };
  }

  /**
   * Update status display
   */
  private updateStatusDisplay(status: SwarmStatus | null): void {
    if (!status) {
      this.statusBox.setContent('No active swarm detected');
      this.agentsTable.setData([['Role', 'Status', 'Iteration', 'Task', 'Last Active']]);
      this.metricsBox.setContent('Waiting for swarm data...');
      return;
    }

    // Update status box
    const uptimeStr = this.formatDuration(status.uptime);
    const statusContent = `Swarm: ${status.swarmId.substring(0, 8)}
Status: ${status.status.toUpperCase()}
Uptime: ${uptimeStr}
Agents: ${status.agents.length}`;
    
    this.statusBox.setContent(statusContent);

    // Update agents table
    const agentData = [['Role', 'Status', 'Iteration', 'Task', 'Last Active']];
    for (const agent of status.agents) {
      const lastActivity = this.formatTimeAgo(agent.lastActivity);
      const task = agent.currentTask ? agent.currentTask.substring(0, 20) : 'idle';
      
      agentData.push([
        agent.role,
        agent.status,
        agent.iteration.toString(),
        task,
        lastActivity
      ]);
    }
    this.agentsTable.setData(agentData);

    // Update metrics box
    const metricsContent = `Throughput: ${status.performance.throughput.toFixed(2)} tasks/min
Efficiency: ${(status.performance.efficiency * 100).toFixed(1)}%
Tasks: ${status.performance.completedTasks}/${status.performance.totalTasks}
Success Rate: ${status.performance.efficiency > 0 ? (status.performance.efficiency * 100).toFixed(1) : 'N/A'}%`;
    
    this.metricsBox.setContent(metricsContent);
  }

  /**
   * Update UI with metrics from dashboard
   */
  private updateUI(metrics: any): void {
    this.logBox.log(`Metrics updated: ${metrics.status} - ${metrics.activeAgents} agents`);
  }

  /**
   * Detect active swarms in the system
   */
  private async detectActiveSwarms(): Promise<void> {
    try {
      const registry = SwarmRegistry.getInstance();
      const activeSwarms = registry.listActiveSwarms();
      const stats = registry.getStatistics();
      
      if (activeSwarms.length > 0) {
        let statusContent = `Available Swarms (${activeSwarms.length}):\n`;
        for (const swarm of activeSwarms.slice(0, 3)) {
          const uptime = this.formatDuration(Date.now() - swarm.startTime);
          statusContent += `• ${swarm.id.substring(0, 8)}: ${swarm.status} (${uptime})\n`;
        }
        if (activeSwarms.length > 3) {
          statusContent += `... and ${activeSwarms.length - 3} more`;
        }
        this.statusBox.setContent(statusContent);
        this.logBox.log(`Found ${activeSwarms.length} active swarms in registry`);
      } else {
        // Check for Ralph processes as fallback
        const ralphProcesses = execSync('ps aux | grep "ralph" | grep -v grep', { encoding: 'utf8' });
        
        if (ralphProcesses.trim()) {
          this.logBox.log('Detected Ralph processes running');
          this.statusBox.setContent('External Ralph processes detected\n(Use swarm coordinator for full monitoring)');
        } else {
          this.statusBox.setContent(`No active swarms detected
Total swarms: ${stats.totalSwarms}
Completed: ${stats.completedSwarms}

Run: stackmemory ralph swarm <task>`);
        }
      }
    } catch {
      // No processes found, that's fine
    }
  }

  /**
   * Format time ago string
   */
  private formatTimeAgo(timestamp: number): string {
    const diff = Date.now() - timestamp;
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ago`;
    if (hours > 0) return `${hours}h ago`;
    if (minutes > 0) return `${minutes}m ago`;
    return 'just now';
  }

  /**
   * Format duration string
   */
  private formatDuration(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) return `${hours}h ${minutes % 60}m`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
  }

  /**
   * Cleanup resources
   */
  private cleanup(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    
    if (this.swarmDashboard) {
      this.swarmDashboard.stopMonitoring();
    }
    
    logger.info('SwarmTUI cleaned up');
  }
}

export default SwarmTUI;