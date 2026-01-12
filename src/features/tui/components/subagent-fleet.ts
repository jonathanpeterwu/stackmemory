/**
 * Subagent Fleet Component
 * Monitors and displays status of all active subagents
 */

import blessed from 'blessed';
import { EventEmitter } from 'events';
import type { SubagentData } from '../types.js';

export class SubagentFleet extends EventEmitter {
  private container: blessed.Widgets.BoxElement;
  private agentList: blessed.Widgets.ListElement;
  private statsBox: blessed.Widgets.BoxElement;
  private agents: Map<string, SubagentData>;
  private selectedAgent: string | null = null;

  constructor(container: blessed.Widgets.BoxElement) {
    super();
    this.container = container;
    this.agents = new Map();
    this.initializeUI();
  }

  private initializeUI(): void {
    // Agent list (left side)
    this.agentList = blessed.list({
      parent: this.container,
      top: 0,
      left: 0,
      width: '60%',
      height: '100%-3',
      style: {
        selected: {
          bg: 'magenta',
          fg: 'white',
          bold: true,
        },
        item: {
          fg: 'white',
        },
      },
      mouse: true,
      keys: true,
      vi: true,
      scrollable: true,
      tags: true,
    });

    // Stats panel (right side)
    this.statsBox = blessed.box({
      parent: this.container,
      top: 0,
      right: 0,
      width: '40%',
      height: '100%-3',
      content: this.getFleetStats(),
      tags: true,
      scrollable: true,
      style: {
        fg: 'white',
      },
    });

    // Fleet summary footer
    const footer = blessed.box({
      parent: this.container,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: 'Fleet: 0 agents | Active: 0 | Idle: 0',
      tags: true,
      style: {
        fg: 'white',
        bg: 'black',
      },
    });

    this.agentList.on('select', (item, index) => {
      const agentId = Array.from(this.agents.keys())[index];
      this.selectAgent(agentId);
    });

    // Keyboard shortcuts
    this.setupKeyboardShortcuts();
  }

  private setupKeyboardShortcuts(): void {
    this.container.key(['t'], () => {
      if (this.selectedAgent) {
        this.terminateAgent(this.selectedAgent);
      }
    });

    this.container.key(['r'], () => {
      if (this.selectedAgent) {
        this.restartAgent(this.selectedAgent);
      }
    });

    this.container.key(['l'], () => {
      if (this.selectedAgent) {
        this.showAgentLogs(this.selectedAgent);
      }
    });
  }

  /**
   * Format agent item for display
   */
  private formatAgentItem(agent: SubagentData): string {
    const status = this.getStatusIcon(agent.status);
    const type = this.getAgentTypeIcon(agent.type);
    const successRate = Math.round(agent.successRate * 100);
    const rateColor =
      successRate >= 90 ? 'green' : successRate >= 70 ? 'yellow' : 'red';

    let item = `${status} ${type} ${agent.type} (${agent.id.substring(0, 8)})\n`;

    if (agent.currentTask) {
      const progress = Math.round(agent.currentTask.progress * 100);
      const elapsed = this.formatDuration(
        Date.now() - agent.currentTask.startTime
      );
      item += `   {cyan-fg}▶ ${agent.currentTask.description.substring(0, 30)}...{/}\n`;
      item += `   Progress: ${this.createProgressBar(agent.currentTask.progress)} ${progress}% (${elapsed})`;
    } else {
      item += `   Completed: ${agent.tasksCompleted} | Failed: ${agent.tasksFailed}\n`;
      item += `   Success Rate: {${rateColor}-fg}${successRate}%{/} | Avg Time: ${this.formatDuration(agent.averageTime)}`;
    }

    // Resource usage indicators
    if (agent.cpuUsage !== undefined || agent.memoryUsage !== undefined) {
      item += '\n   ';
      if (agent.cpuUsage !== undefined) {
        const cpuColor =
          agent.cpuUsage > 80
            ? 'red'
            : agent.cpuUsage > 50
              ? 'yellow'
              : 'green';
        item += `CPU: {${cpuColor}-fg}${Math.round(agent.cpuUsage)}%{/} `;
      }
      if (agent.memoryUsage !== undefined) {
        const memColor =
          agent.memoryUsage > 80
            ? 'red'
            : agent.memoryUsage > 50
              ? 'yellow'
              : 'green';
        item += `MEM: {${memColor}-fg}${Math.round(agent.memoryUsage)}%{/} `;
      }
      if (agent.tokenUsage !== undefined) {
        item += `Tokens: ${this.formatTokens(agent.tokenUsage)}`;
      }
    }

    // Error indicator
    if (agent.lastError) {
      const errorAge = this.formatDuration(
        Date.now() - agent.lastError.timestamp
      );
      item += `\n   {red-fg}⚠ Error ${errorAge} ago: ${agent.lastError.message.substring(0, 40)}{/}`;
    }

    return item;
  }

  private getStatusIcon(status: string): string {
    switch (status) {
      case 'active':
        return '{green-fg}●{/}';
      case 'idle':
        return '{cyan-fg}●{/}';
      case 'error':
        return '{red-fg}●{/}';
      case 'completed':
        return '{gray-fg}●{/}';
      default:
        return '{white-fg}○{/}';
    }
  }

  private getAgentTypeIcon(type: string): string {
    const icons: Record<string, string> = {
      analyzer: '🔍',
      builder: '🔨',
      debugger: '🐛',
      tester: '🧪',
      reviewer: '👁️',
      refactorer: '♻️',
      documenter: '📝',
      security: '🔒',
      performance: '⚡',
      general: '🤖',
    };
    return icons[type.toLowerCase()] || '🤖';
  }

  private createProgressBar(progress: number): string {
    const width = 10;
    const filled = Math.round(progress * width);
    const empty = width - filled;

    const color =
      progress >= 0.8 ? 'green' : progress >= 0.5 ? 'yellow' : 'cyan';
    return `{${color}-fg}${'█'.repeat(filled)}{/}{gray-fg}${'░'.repeat(empty)}{/}`;
  }

  private formatDuration(ms: number): string {
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3600000) return `${Math.round(ms / 60000)}m`;
    return `${Math.round(ms / 3600000)}h`;
  }

  private formatTokens(tokens: number): string {
    if (tokens < 1000) return `${tokens}`;
    if (tokens < 1000000) return `${(tokens / 1000).toFixed(1)}K`;
    return `${(tokens / 1000000).toFixed(1)}M`;
  }

  /**
   * Generate fleet statistics
   */
  private getFleetStats(): string {
    const agents = Array.from(this.agents.values());

    if (agents.length === 0) {
      return '{gray-fg}No agents active{/}';
    }

    // Calculate statistics
    const stats = {
      total: agents.length,
      active: agents.filter((a: any) => a.status === 'active').length,
      idle: agents.filter((a: any) => a.status === 'idle').length,
      error: agents.filter((a: any) => a.status === 'error').length,
      totalTasks: agents.reduce(
        (sum, a) => sum + a.tasksCompleted + a.tasksFailed,
        0
      ),
      successfulTasks: agents.reduce((sum, a) => sum + a.tasksCompleted, 0),
      failedTasks: agents.reduce((sum, a) => sum + a.tasksFailed, 0),
      avgSuccessRate:
        agents.reduce((sum, a) => sum + a.successRate, 0) / agents.length,
      totalTokens: agents.reduce((sum, a) => sum + (a.tokenUsage || 0), 0),
      avgCpu:
        agents.reduce((sum, a) => sum + (a.cpuUsage || 0), 0) / agents.length,
      avgMemory:
        agents.reduce((sum, a) => sum + (a.memoryUsage || 0), 0) /
        agents.length,
    };

    // Group by type
    const typeGroups = new Map<string, number>();
    agents.forEach((agent) => {
      typeGroups.set(agent.type, (typeGroups.get(agent.type) || 0) + 1);
    });

    let output = '{bold}Fleet Statistics{/}\n\n';

    output += '{bold}Status:{/}\n';
    output += `  Total: ${stats.total}\n`;
    output += `  Active: {green-fg}${stats.active}{/}\n`;
    output += `  Idle: {cyan-fg}${stats.idle}{/}\n`;
    output += `  Error: {red-fg}${stats.error}{/}\n`;

    output += '\n{bold}Performance:{/}\n';
    output += `  Tasks: ${stats.successfulTasks}/${stats.totalTasks}\n`;
    const rateColor =
      stats.avgSuccessRate >= 0.9
        ? 'green'
        : stats.avgSuccessRate >= 0.7
          ? 'yellow'
          : 'red';
    output += `  Success: {${rateColor}-fg}${Math.round(stats.avgSuccessRate * 100)}%{/}\n`;
    output += `  Tokens: ${this.formatTokens(stats.totalTokens)}\n`;

    output += '\n{bold}Resources:{/}\n';
    const cpuColor =
      stats.avgCpu > 80 ? 'red' : stats.avgCpu > 50 ? 'yellow' : 'green';
    const memColor =
      stats.avgMemory > 80 ? 'red' : stats.avgMemory > 50 ? 'yellow' : 'green';
    output += `  CPU: {${cpuColor}-fg}${Math.round(stats.avgCpu)}%{/}\n`;
    output += `  Memory: {${memColor}-fg}${Math.round(stats.avgMemory)}%{/}\n`;

    output += '\n{bold}Types:{/}\n';
    Array.from(typeGroups.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([type, count]) => {
        const icon = this.getAgentTypeIcon(type);
        output += `  ${icon} ${type}: ${count}\n`;
      });

    return output;
  }

  public update(agents: SubagentData[]): void {
    // Update agent map
    this.agents.clear();
    agents.forEach((agent) => {
      this.agents.set(agent.id, agent);
    });

    // Update list display
    const items = agents.map((agent: any) => this.formatAgentItem(agent));
    this.agentList.setItems(items);

    // Update stats panel
    this.statsBox.setContent(this.getFleetStats());

    // Update footer
    const active = agents.filter((a: any) => a.status === 'active').length;
    const idle = agents.filter((a: any) => a.status === 'idle').length;
    const total = agents.length;

    const footer = this.container.children[2] as blessed.Widgets.BoxElement;
    if (footer) {
      footer.setContent(
        `{bold}Fleet:{/} ${total} agents | ` +
          `{bold}Active:{/} {green-fg}${active}{/} | ` +
          `{bold}Idle:{/} {cyan-fg}${idle}{/}`
      );
    }

    this.container.screen.render();
  }

  private selectAgent(agentId: string): void {
    this.selectedAgent = agentId;
    const agent = this.agents.get(agentId);
    if (agent) {
      this.emit('agent:selected', agent);
      this.showAgentDetails(agent);
    }
  }

  private showAgentDetails(agent: SubagentData): void {
    const details = blessed.box({
      parent: this.container.screen,
      top: 'center',
      left: 'center',
      width: '70%',
      height: '70%',
      content: this.formatAgentDetails(agent),
      tags: true,
      border: {
        type: 'line',
      },
      style: {
        border: {
          fg: 'magenta',
        },
      },
      scrollable: true,
      keys: true,
      vi: true,
      mouse: true,
      hidden: false,
      label: ` Agent: ${agent.type} (${agent.id}) `,
    });

    details.key(['escape', 'q'], () => {
      details.destroy();
      this.container.screen.render();
    });

    details.focus();
    this.container.screen.render();
  }

  private formatAgentDetails(agent: SubagentData): string {
    let details = `{bold}Agent ID:{/} ${agent.id}\n`;
    details += `{bold}Type:{/} ${this.getAgentTypeIcon(agent.type)} ${agent.type}\n`;
    details += `{bold}Status:{/} ${this.getStatusIcon(agent.status)} ${agent.status}\n`;

    if (agent.currentTask) {
      details += `\n{bold}Current Task:{/}\n`;
      details += `  ID: ${agent.currentTask.id}\n`;
      details += `  Description: ${agent.currentTask.description}\n`;
      details += `  Progress: ${Math.round(agent.currentTask.progress * 100)}%\n`;
      details += `  Started: ${new Date(agent.currentTask.startTime).toLocaleString()}\n`;
      details += `  Elapsed: ${this.formatDuration(Date.now() - agent.currentTask.startTime)}\n`;
    }

    details += `\n{bold}Performance Metrics:{/}\n`;
    details += `  Tasks Completed: ${agent.tasksCompleted}\n`;
    details += `  Tasks Failed: ${agent.tasksFailed}\n`;
    details += `  Success Rate: ${Math.round(agent.successRate * 100)}%\n`;
    details += `  Average Time: ${this.formatDuration(agent.averageTime)}\n`;

    if (
      agent.cpuUsage !== undefined ||
      agent.memoryUsage !== undefined ||
      agent.tokenUsage !== undefined
    ) {
      details += `\n{bold}Resource Usage:{/}\n`;
      if (agent.cpuUsage !== undefined) {
        details += `  CPU: ${Math.round(agent.cpuUsage)}%\n`;
      }
      if (agent.memoryUsage !== undefined) {
        details += `  Memory: ${Math.round(agent.memoryUsage)}%\n`;
      }
      if (agent.tokenUsage !== undefined) {
        details += `  Tokens: ${this.formatTokens(agent.tokenUsage)}\n`;
      }
    }

    if (agent.lastError) {
      details += `\n{bold}Last Error:{/}\n`;
      details += `  Message: ${agent.lastError.message}\n`;
      details += `  Time: ${new Date(agent.lastError.timestamp).toLocaleString()}\n`;
      details += `  Recoverable: ${agent.lastError.recoverable ? 'Yes' : 'No'}\n`;
    }

    details += `\n{gray-fg}[t] Terminate | [r] Restart | [l] View Logs{/}\n`;

    return details;
  }

  private terminateAgent(agentId: string): void {
    this.emit('agent:terminate', { agentId });
    // Optimistically update UI
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = 'completed';
      this.update(Array.from(this.agents.values()));
    }
  }

  private restartAgent(agentId: string): void {
    this.emit('agent:restart', { agentId });
    // Optimistically update UI
    const agent = this.agents.get(agentId);
    if (agent) {
      agent.status = 'idle';
      agent.lastError = undefined;
      this.update(Array.from(this.agents.values()));
    }
  }

  private showAgentLogs(agentId: string): void {
    this.emit('agent:logs', { agentId });
  }

  public focus(): void {
    this.agentList.focus();
  }

  public hasFocus(): boolean {
    return this.agentList === this.container.screen.focused;
  }
}
