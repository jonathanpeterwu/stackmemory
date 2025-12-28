/**
 * Session Management CLI Commands
 * Provides commands for managing StackMemory sessions
 */

import { Command } from 'commander';
import { sessionManager } from '../../core/session/index.js';
import { logger } from '../../core/monitoring/logger.js';
import chalk from 'chalk';

export function createSessionCommands(): Command {
  const sessionCommand = new Command('session')
    .description('Manage StackMemory sessions');

  sessionCommand
    .command('list')
    .description('List all sessions')
    .option('--project', 'Show only sessions for current project')
    .option('--active', 'Show only active sessions')
    .option('--all', 'Show all sessions including closed')
    .action(async (options) => {
      try {
        await sessionManager.initialize();
        
        const filter: any = {};
        if (options.project) {
          const projectHash = await getProjectHash();
          filter.projectId = projectHash;
        }
        if (options.active && !options.all) {
          filter.state = 'active';
        }

        const sessions = await sessionManager.listSessions(filter);
        
        if (sessions.length === 0) {
          console.log('No sessions found');
          return;
        }

        console.log(chalk.bold('\n📋 StackMemory Sessions:\n'));
        
        sessions.forEach(session => {
          const age = formatAge(Date.now() - session.lastActiveAt);
          const status = session.state === 'active' ? chalk.green('●') : 
                        session.state === 'suspended' ? chalk.yellow('●') : chalk.gray('●');
          
          console.log(`${status} ${chalk.bold(session.sessionId.slice(0, 8))}`);
          console.log(`  Project: ${session.projectId}`);
          if (session.branch) {
            console.log(`  Branch: ${session.branch}`);
          }
          console.log(`  State: ${session.state}`);
          console.log(`  Last active: ${age} ago`);
          console.log('');
        });

        console.log(chalk.gray(`Total: ${sessions.length} session(s)`));
      } catch (error) {
        logger.error('Failed to list sessions', error as Error);
        console.error('❌ Failed to list sessions:', (error as Error).message);
        process.exit(1);
      }
    });

  sessionCommand
    .command('current')
    .description('Show current session information')
    .action(async () => {
      try {
        await sessionManager.initialize();
        const session = sessionManager.getCurrentSession();
        
        if (!session) {
          console.log('No active session');
          return;
        }

        const duration = formatDuration(Date.now() - session.startedAt);
        
        console.log(chalk.bold('\n🔍 Current Session:\n'));
        console.log(`Session ID: ${chalk.cyan(session.sessionId)}`);
        console.log(`Run ID: ${session.runId}`);
        console.log(`Project: ${session.projectId}`);
        if (session.branch) {
          console.log(`Branch: ${session.branch}`);
        }
        console.log(`State: ${session.state}`);
        console.log(`Duration: ${duration}`);
        
        if (session.metadata.user) {
          console.log(`User: ${session.metadata.user}`);
        }
        if (session.metadata.tags && session.metadata.tags.length > 0) {
          console.log(`Tags: ${session.metadata.tags.join(', ')}`);
        }
      } catch (error) {
        logger.error('Failed to show current session', error as Error);
        console.error('❌ Failed to show current session:', (error as Error).message);
        process.exit(1);
      }
    });

  sessionCommand
    .command('switch <sessionId>')
    .description('Switch to a different session')
    .action(async (sessionId) => {
      try {
        await sessionManager.initialize();
        
        // Suspend current session
        const current = sessionManager.getCurrentSession();
        if (current) {
          await sessionManager.suspendSession();
          console.log(`Suspended session: ${current.sessionId.slice(0, 8)}`);
        }

        // Resume target session
        const session = await sessionManager.resumeSession(sessionId);
        console.log(chalk.green(`✅ Switched to session: ${session.sessionId.slice(0, 8)}`));
        console.log(`  Project: ${session.projectId}`);
        if (session.branch) {
          console.log(`  Branch: ${session.branch}`);
        }
      } catch (error) {
        logger.error('Failed to switch session', error as Error);
        console.error('❌ Failed to switch session:', (error as Error).message);
        process.exit(1);
      }
    });

  sessionCommand
    .command('suspend [sessionId]')
    .description('Suspend a session (current if not specified)')
    .action(async (sessionId) => {
      try {
        await sessionManager.initialize();
        await sessionManager.suspendSession(sessionId);
        
        const id = sessionId || sessionManager.getCurrentSession()?.sessionId;
        console.log(chalk.yellow(`⏸️  Suspended session: ${id?.slice(0, 8)}`));
      } catch (error) {
        logger.error('Failed to suspend session', error as Error);
        console.error('❌ Failed to suspend session:', (error as Error).message);
        process.exit(1);
      }
    });

  sessionCommand
    .command('resume <sessionId>')
    .description('Resume a suspended session')
    .action(async (sessionId) => {
      try {
        await sessionManager.initialize();
        const session = await sessionManager.resumeSession(sessionId);
        
        console.log(chalk.green(`▶️  Resumed session: ${session.sessionId.slice(0, 8)}`));
        console.log(`  Project: ${session.projectId}`);
        if (session.branch) {
          console.log(`  Branch: ${session.branch}`);
        }
      } catch (error) {
        logger.error('Failed to resume session', error as Error);
        console.error('❌ Failed to resume session:', (error as Error).message);
        process.exit(1);
      }
    });

  sessionCommand
    .command('merge <sourceId> <targetId>')
    .description('Merge two sessions')
    .action(async (sourceId, targetId) => {
      try {
        await sessionManager.initialize();
        const merged = await sessionManager.mergeSessions(sourceId, targetId);
        
        console.log(chalk.green(`✅ Merged sessions successfully`));
        console.log(`  Target: ${merged.sessionId.slice(0, 8)}`);
        console.log(`  Source ${sourceId.slice(0, 8)} has been closed`);
      } catch (error) {
        logger.error('Failed to merge sessions', error as Error);
        console.error('❌ Failed to merge sessions:', (error as Error).message);
        process.exit(1);
      }
    });

  sessionCommand
    .command('cleanup')
    .description('Clean up old closed sessions')
    .option('--days <days>', 'Remove sessions older than N days', '30')
    .action(async (options) => {
      try {
        await sessionManager.initialize();
        
        const days = parseInt(options.days);
        const maxAge = days * 24 * 60 * 60 * 1000;
        const cleaned = await sessionManager.cleanupStaleSessions(maxAge);
        
        console.log(chalk.green(`✅ Cleaned up ${cleaned} old session(s)`));
      } catch (error) {
        logger.error('Failed to cleanup sessions', error as Error);
        console.error('❌ Failed to cleanup sessions:', (error as Error).message);
        process.exit(1);
      }
    });

  return sessionCommand;
}

// Helper functions
async function getProjectHash(): Promise<string> {
  const crypto = await import('crypto');
  const cwd = process.cwd();
  const hash = crypto.createHash('sha256');
  hash.update(cwd);
  return hash.digest('hex').substring(0, 12);
}

function formatAge(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);
  
  if (days > 0) return `${days}d`;
  if (hours > 0) return `${hours}h`;
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  
  const h = hours;
  const m = minutes % 60;
  const s = seconds % 60;
  
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}