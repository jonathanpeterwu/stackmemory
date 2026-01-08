/**
 * Session Monitor Component
 * Displays active sessions with auto-tagging based on work context
 */

import blessed from 'blessed';
import { EventEmitter } from 'events';
import type { SessionData, SessionMetrics } from '../types.js';

export class SessionMonitor extends EventEmitter {
  private container: blessed.Widgets.BoxElement;
  private sessionList: blessed.Widgets.ListElement;
  private sessions: Map<string, SessionData>;
  private selectedSession: string | null = null;

  constructor(container: blessed.Widgets.BoxElement) {
    super();
    this.container = container;
    this.sessions = new Map();
    this.initializeUI();
  }

  private initializeUI(): void {
    // Session list with auto-tagged names
    this.sessionList = blessed.list({
      parent: this.container,
      top: 0,
      left: 0,
      width: '100%',
      height: '100%-3',
      style: {
        selected: {
          bg: 'blue',
          fg: 'white',
          bold: true
        },
        item: {
          fg: 'cyan'
        }
      },
      mouse: true,
      keys: true,
      vi: true,
      scrollable: true,
      tags: true
    });

    // Summary footer
    const footer = blessed.box({
      parent: this.container,
      bottom: 0,
      left: 0,
      width: '100%',
      height: 3,
      content: 'Active: 0 | Idle: 0 | Total: 0',
      tags: true,
      style: {
        fg: 'white',
        bg: 'black'
      }
    });

    this.sessionList.on('select', (item, index) => {
      const sessionId = Array.from(this.sessions.keys())[index];
      this.selectSession(sessionId);
    });
  }

  /**
   * Auto-tag session based on work context
   */
  private autoTagSession(session: SessionData): string {
    const tags: string[] = [];
    
    // Analyze recent activities for context
    if (session.recentActivities) {
      // File-based tagging
      const files = session.recentActivities
        .filter((a: any) => a.type === 'file_edit')
        .map((a: any) => a.data?.path || '');
      
      if (files.some(f => f.includes('test'))) tags.push('testing');
      if (files.some(f => f.includes('.tsx') || f.includes('.jsx'))) tags.push('frontend');
      if (files.some(f => f.includes('api') || f.includes('server'))) tags.push('backend');
      if (files.some(f => f.includes('db') || f.includes('migration'))) tags.push('database');
      
      // Command-based tagging
      const commands = session.recentActivities
        .filter((a: any) => a.type === 'command')
        .map((a: any) => a.data?.command || '');
      
      if (commands.some(c => c.includes('npm test') || c.includes('jest'))) tags.push('testing');
      if (commands.some(c => c.includes('git'))) tags.push('git-ops');
      if (commands.some(c => c.includes('deploy'))) tags.push('deployment');
      if (commands.some(c => c.includes('debug'))) tags.push('debugging');
    }

    // Task-based tagging from Linear
    if (session.linearTask) {
      tags.push(`linear:${session.linearTask.identifier}`);
      if (session.linearTask.labels) {
        tags.push(...session.linearTask.labels.map((l: any) => l.toLowerCase()));
      }
    }

    // Branch-based tagging
    if (session.gitBranch) {
      const branch = session.gitBranch;
      if (branch.includes('feature/')) tags.push('feature');
      if (branch.includes('fix/') || branch.includes('bugfix/')) tags.push('bugfix');
      if (branch.includes('refactor/')) tags.push('refactor');
      if (branch.includes('docs/')) tags.push('documentation');
    }

    // AI agent type tagging
    if (session.agentType) {
      tags.push(`agent:${session.agentType}`);
    }

    return tags.length > 0 ? tags.join(' • ') : 'general';
  }

  /**
   * Generate session display name with context
   */
  private generateSessionName(session: SessionData): string {
    const autoTags = this.autoTagSession(session);
    const timestamp = new Date(session.startTime).toLocaleTimeString();
    
    // Create descriptive name based on primary activity
    let primaryActivity = 'Session';
    
    if (session.linearTask) {
      primaryActivity = session.linearTask.title || session.linearTask.identifier;
    } else if (session.gitBranch && session.gitBranch !== 'main' && session.gitBranch !== 'master') {
      primaryActivity = session.gitBranch.split('/').pop() || session.gitBranch;
    } else if (session.primaryFile) {
      primaryActivity = session.primaryFile.split('/').pop() || 'Code';
    }

    return `${primaryActivity} [${autoTags}] - ${timestamp}`;
  }

  /**
   * Format session item for display
   */
  private formatSessionItem(session: SessionData): string {
    const status = this.getSessionStatus(session);
    const statusIcon = this.getStatusIcon(status);
    const name = this.generateSessionName(session);
    const metrics = this.getSessionMetrics(session);
    
    const contextUsage = Math.round(session.contextUsage * 100);
    const contextColor = contextUsage > 80 ? 'red' : contextUsage > 60 ? 'yellow' : 'green';
    
    return `${statusIcon} ${name}\n` +
           `   {gray-fg}Tokens: ${metrics.tokens} | Context: {${contextColor}-fg}${contextUsage}%{/} | Duration: ${metrics.duration}{/}`;
  }

  private getSessionStatus(session: SessionData): 'active' | 'idle' | 'completed' | 'error' {
    if (session.error) return 'error';
    if (session.completed) return 'completed';
    
    const now = Date.now();
    const lastActivity = session.lastActivity || session.startTime;
    const idleTime = now - lastActivity;
    
    if (idleTime > 5 * 60 * 1000) return 'idle'; // 5 minutes
    return 'active';
  }

  private getStatusIcon(status: string): string {
    switch (status) {
      case 'active': return '{green-fg}●{/}';
      case 'idle': return '{yellow-fg}●{/}';
      case 'completed': return '{gray-fg}●{/}';
      case 'error': return '{red-fg}●{/}';
      default: return '{white-fg}○{/}';
    }
  }

  private getSessionMetrics(session: SessionData): SessionMetrics {
    const now = Date.now();
    const duration = now - session.startTime;
    
    const hours = Math.floor(duration / (1000 * 60 * 60));
    const minutes = Math.floor((duration % (1000 * 60 * 60)) / (1000 * 60));
    
    return {
      tokens: session.totalTokens || 0,
      duration: hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`,
      filesEdited: session.filesEdited?.length || 0,
      commandsRun: session.commandsRun || 0,
      errorsEncountered: session.errors?.length || 0
    };
  }

  public update(sessions: SessionData[]): void {
    // Update session map
    this.sessions.clear();
    sessions.forEach(session => {
      this.sessions.set(session.id, session);
    });

    // Update list display
    const items = sessions.map((session: any) => this.formatSessionItem(session));
    this.sessionList.setItems(items);

    // Update footer statistics
    const active = sessions.filter((s: any) => this.getSessionStatus(s) === 'active').length;
    const idle = sessions.filter((s: any) => this.getSessionStatus(s) === 'idle').length;
    const total = sessions.length;
    
    const footer = this.container.children[1] as blessed.Widgets.BoxElement;
    if (footer) {
      footer.setContent(
        `{bold}Active:{/} {green-fg}${active}{/} | ` +
        `{bold}Idle:{/} {yellow-fg}${idle}{/} | ` +
        `{bold}Total:{/} ${total}`
      );
    }

    this.container.screen.render();
  }

  private selectSession(sessionId: string): void {
    this.selectedSession = sessionId;
    const session = this.sessions.get(sessionId);
    if (session) {
      this.emit('session:selected', session);
      this.showSessionDetails(session);
    }
  }

  private showSessionDetails(session: SessionData): void {
    const details = blessed.box({
      parent: this.container.screen,
      top: 'center',
      left: 'center',
      width: '80%',
      height: '80%',
      content: this.formatSessionDetails(session),
      tags: true,
      border: {
        type: 'line'
      },
      style: {
        border: {
          fg: 'cyan'
        }
      },
      scrollable: true,
      keys: true,
      vi: true,
      mouse: true,
      hidden: false,
      label: ` Session: ${this.generateSessionName(session)} `
    });

    details.key(['escape', 'q'], () => {
      details.destroy();
      this.container.screen.render();
    });

    details.focus();
    this.container.screen.render();
  }

  private formatSessionDetails(session: SessionData): string {
    const metrics = this.getSessionMetrics(session);
    const status = this.getSessionStatus(session);
    const tags = this.autoTagSession(session);
    
    let details = `{bold}Session ID:{/} ${session.id}\n`;
    details += `{bold}Status:{/} ${status}\n`;
    details += `{bold}Tags:{/} ${tags}\n`;
    details += `{bold}Started:{/} ${new Date(session.startTime).toLocaleString()}\n`;
    
    if (session.lastActivity) {
      details += `{bold}Last Activity:{/} ${new Date(session.lastActivity).toLocaleString()}\n`;
    }
    
    details += `\n{bold}Metrics:{/}\n`;
    details += `  Tokens Used: ${metrics.tokens}\n`;
    details += `  Context Usage: ${Math.round(session.contextUsage * 100)}%\n`;
    details += `  Duration: ${metrics.duration}\n`;
    details += `  Files Edited: ${metrics.filesEdited}\n`;
    details += `  Commands Run: ${metrics.commandsRun}\n`;
    details += `  Errors: ${metrics.errorsEncountered}\n`;
    
    if (session.linearTask) {
      details += `\n{bold}Linear Task:{/}\n`;
      details += `  ID: ${session.linearTask.identifier}\n`;
      details += `  Title: ${session.linearTask.title}\n`;
      details += `  State: ${session.linearTask.state}\n`;
    }
    
    if (session.gitBranch) {
      details += `\n{bold}Git:{/}\n`;
      details += `  Branch: ${session.gitBranch}\n`;
      if (session.lastCommit) {
        details += `  Last Commit: ${session.lastCommit}\n`;
      }
    }
    
    if (session.recentActivities && session.recentActivities.length > 0) {
      details += `\n{bold}Recent Activities:{/}\n`;
      session.recentActivities.slice(-10).forEach(activity => {
        details += `  ${new Date(activity.timestamp).toLocaleTimeString()} - ${activity.type}: ${activity.description}\n`;
      });
    }
    
    return details;
  }

  public focus(): void {
    this.sessionList.focus();
  }

  public hasFocus(): boolean {
    return this.sessionList === this.container.screen.focused;
  }
}