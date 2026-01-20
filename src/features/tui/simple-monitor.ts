/**
 * Simple text-based swarm monitor for terminal compatibility
 * Fallback for terminals that can't handle blessed TUI
 */

import { SwarmRegistry } from '../../integrations/ralph/monitoring/swarm-registry.js';
import { execSync } from 'child_process';
// Simple monitor for terminal compatibility

export class SimpleSwarmMonitor {
  private refreshInterval: NodeJS.Timeout | null = null;

  /**
   * Start simple text-based monitoring
   */
  start(): void {
    console.log('🦾 Ralph Swarm Monitor (Text Mode)');
    console.log('=====================================');
    console.log('');
    console.log('Press Ctrl+C to quit');
    console.log('');

    // Show initial status
    this.displayStatus();

    // Set up refresh interval
    this.refreshInterval = setInterval(() => {
      this.displayStatus();
    }, 5000);

    // Handle graceful shutdown
    process.on('SIGINT', () => {
      this.stop();
      process.exit(0);
    });
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.refreshInterval) {
      clearInterval(this.refreshInterval);
    }
    console.log('\n👋 Swarm monitoring stopped');
  }

  /**
   * Display current status
   */
  private displayStatus(): void {
    const timestamp = new Date().toLocaleTimeString();

    console.log(`\n⏰ ${timestamp} - Swarm Status Update`);
    console.log('─'.repeat(50));

    try {
      // Check registry
      const registry = SwarmRegistry.getInstance();
      const activeSwarms = registry.listActiveSwarms();
      const stats = registry.getStatistics();

      console.log(
        `📊 Registry Stats: ${stats.activeSwarms} active, ${stats.totalSwarms} total`
      );

      if (activeSwarms.length > 0) {
        console.log('\n🦾 Active Swarms:');
        for (const swarm of activeSwarms) {
          const uptime = this.formatDuration(Date.now() - swarm.startTime);
          console.log(
            `   • ${swarm.id.substring(0, 8)}: ${swarm.status} (${uptime})`
          );
        }
      } else {
        console.log('❌ No active swarms in registry');
      }

      // Check for external processes
      try {
        const ralphProcesses = execSync(
          'ps aux | grep "ralph" | grep -v grep',
          { encoding: 'utf8' }
        );
        if (ralphProcesses.trim()) {
          console.log('\n🔍 External Ralph Processes:');
          const processLines = ralphProcesses
            .split('\n')
            .filter((line) => line.trim());
          processLines.slice(0, 3).forEach((line) => {
            const parts = line.split(/\s+/);
            console.log(
              `   PID ${parts[1]}: ${parts.slice(10).join(' ').slice(0, 50)}...`
            );
          });
          if (processLines.length > 3) {
            console.log(`   ... and ${processLines.length - 3} more processes`);
          }
        }
      } catch {
        // No external processes
      }

      // Show recent commits
      try {
        const recentCommits = execSync(
          'git log --oneline --since="1 hour ago" --pretty=format:"%h %an %s" | head -3',
          { encoding: 'utf8', cwd: process.cwd() }
        );

        if (recentCommits.trim()) {
          console.log('\n📝 Recent Commits:');
          recentCommits
            .split('\n')
            .filter((line) => line.trim())
            .forEach((line) => {
              console.log(`   ${line}`);
            });
        }
      } catch {
        // No git or commits
      }
    } catch (error: unknown) {
      console.log(`❌ Status error: ${(error as Error).message}`);
    }
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
}

export default SimpleSwarmMonitor;
