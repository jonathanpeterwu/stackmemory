/**
 * Git Workflow Manager for Swarm Agents
 * Manages git operations, branching, and commits for each agent
 */

import { execSync } from 'child_process';
import { logger } from '../../../core/monitoring/logger.js';
import { Agent, SwarmTask } from '../types.js';

export interface GitConfig {
  enableGitWorkflow: boolean;
  branchStrategy: 'feature' | 'agent' | 'task';
  autoCommit: boolean;
  commitFrequency: number; // minutes
  mergStrategy: 'squash' | 'merge' | 'rebase';
  requirePR: boolean;
}

export class GitWorkflowManager {
  private config: GitConfig;
  private agentBranches: Map<string, string> = new Map();
  private baselineBranch: string;
  private mainBranch: string;

  constructor(config?: Partial<GitConfig>) {
    this.config = {
      enableGitWorkflow: true,
      branchStrategy: 'agent',
      autoCommit: true,
      commitFrequency: 5,
      mergStrategy: 'squash',
      requirePR: false,
      ...config
    };

    // Get current branch as baseline
    try {
      this.baselineBranch = this.getCurrentBranch();
      this.mainBranch = this.getMainBranch();
    } catch (error) {
      logger.warn('Git not initialized, workflow features disabled');
      this.config.enableGitWorkflow = false;
    }
  }

  /**
   * Initialize git workflow for an agent
   */
  async initializeAgentWorkflow(agent: Agent, task: SwarmTask): Promise<void> {
    if (!this.config.enableGitWorkflow) return;

    const branchName = this.generateBranchName(agent, task);
    
    try {
      // Create and checkout new branch
      this.createBranch(branchName);
      this.agentBranches.set(agent.id, branchName);
      
      logger.info(`Created git branch for agent ${agent.role}: ${branchName}`);

      // Set up commit timer if auto-commit enabled
      if (this.config.autoCommit) {
        this.scheduleAutoCommit(agent, task);
      }
    } catch (error: unknown) {
      logger.error(`Failed to initialize git workflow for agent ${agent.role}`, error as Error);
    }
  }

  /**
   * Commit agent work
   */
  async commitAgentWork(
    agent: Agent, 
    task: SwarmTask,
    message?: string
  ): Promise<void> {
    if (!this.config.enableGitWorkflow) return;

    const branchName = this.agentBranches.get(agent.id);
    if (!branchName) {
      logger.warn(`No branch found for agent ${agent.id}`);
      return;
    }

    try {
      // Ensure we're on the agent's branch
      this.checkoutBranch(branchName);

      // Check for changes
      const hasChanges = this.hasUncommittedChanges();
      if (!hasChanges) {
        logger.debug(`No changes to commit for agent ${agent.role}`);
        return;
      }

      // Stage all changes
      execSync('git add -A', { encoding: 'utf8' });

      // Generate commit message
      const commitMessage = message || this.generateCommitMessage(agent, task);
      
      // Commit changes
      execSync(`git commit -m "${commitMessage}"`, { encoding: 'utf8' });
      
      logger.info(`Agent ${agent.role} committed: ${commitMessage}`);

      // Push if remote exists
      if (this.hasRemote()) {
        try {
          execSync(`git push origin ${branchName}`, { encoding: 'utf8' });
          logger.info(`Pushed branch ${branchName} to remote`);
        } catch (error) {
          logger.warn(`Could not push to remote: ${error}`);
        }
      }
    } catch (error: unknown) {
      logger.error(`Failed to commit agent work`, error as Error);
    }
  }

  /**
   * Merge agent work back to baseline
   */
  async mergeAgentWork(agent: Agent, task: SwarmTask): Promise<void> {
    if (!this.config.enableGitWorkflow) return;

    const branchName = this.agentBranches.get(agent.id);
    if (!branchName) {
      logger.warn(`No branch found for agent ${agent.id}`);
      return;
    }

    try {
      // Switch to baseline branch
      this.checkoutBranch(this.baselineBranch);

      if (this.config.requirePR) {
        // Create pull request
        await this.createPullRequest(agent, task, branchName);
      } else {
        // Direct merge based on strategy
        this.mergeBranch(branchName);
        logger.info(`Merged agent ${agent.role} work from ${branchName}`);
      }

      // Clean up branch
      this.deleteBranch(branchName);
      this.agentBranches.delete(agent.id);

    } catch (error: unknown) {
      logger.error(`Failed to merge agent work`, error as Error);
    }
  }

  /**
   * Coordinate merges between multiple agents
   */
  async coordinateMerges(agents: Agent[]): Promise<void> {
    if (!this.config.enableGitWorkflow) return;

    logger.info('Coordinating merges from all agents');

    // Create integration branch
    const integrationBranch = `swarm-integration-${Date.now()}`;
    this.createBranch(integrationBranch);

    // Merge each agent's work
    for (const agent of agents) {
      const branchName = this.agentBranches.get(agent.id);
      if (branchName && this.branchExists(branchName)) {
        try {
          this.mergeBranch(branchName);
          logger.info(`Integrated ${agent.role} work`);
        } catch (error) {
          logger.error(`Failed to integrate ${agent.role} work: ${error}`);
        }
      }
    }

    // Run tests on integration branch
    const testsPass = await this.runIntegrationTests();
    
    if (testsPass) {
      // Merge to baseline
      this.checkoutBranch(this.baselineBranch);
      this.mergeBranch(integrationBranch);
      logger.info('Successfully integrated all agent work');
    } else {
      logger.warn('Integration tests failed, keeping changes in branch: ' + integrationBranch);
    }
  }

  /**
   * Handle merge conflicts
   */
  async resolveConflicts(agent: Agent): Promise<void> {
    const conflicts = this.getConflictedFiles();
    
    if (conflicts.length === 0) return;

    logger.warn(`Agent ${agent.role} encountering merge conflicts: ${conflicts.join(', ')}`);

    // Strategy 1: Try to auto-resolve
    for (const file of conflicts) {
      try {
        // Accept current changes for agent's own files
        if (this.isAgentFile(file, agent)) {
          execSync(`git checkout --ours ${file}`, { encoding: 'utf8' });
          execSync(`git add ${file}`, { encoding: 'utf8' });
        } else {
          // Accept incoming changes for other files
          execSync(`git checkout --theirs ${file}`, { encoding: 'utf8' });
          execSync(`git add ${file}`, { encoding: 'utf8' });
        }
      } catch (error) {
        logger.error(`Could not auto-resolve conflict in ${file}`);
      }
    }

    // Complete merge if all conflicts resolved
    const remainingConflicts = this.getConflictedFiles();
    if (remainingConflicts.length === 0) {
      execSync('git commit --no-edit', { encoding: 'utf8' });
      logger.info('All conflicts resolved automatically');
    } else {
      logger.error(`Manual intervention needed for: ${remainingConflicts.join(', ')}`);
    }
  }

  // Private helper methods
  private getCurrentBranch(): string {
    return execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  }

  private getMainBranch(): string {
    try {
      // Try to detect main branch
      const branches = execSync('git branch -r', { encoding: 'utf8' });
      if (branches.includes('origin/main')) return 'main';
      if (branches.includes('origin/master')) return 'master';
    } catch (error) {
      // Fallback to current branch
    }
    return this.getCurrentBranch();
  }

  private generateBranchName(agent: Agent, task: SwarmTask): string {
    const sanitizedTitle = task.title.toLowerCase()
      .replace(/\s+/g, '-')
      .replace(/[^a-z0-9-]/g, '')
      .substring(0, 30);

    switch (this.config.branchStrategy) {
      case 'feature':
        return `feature/${sanitizedTitle}`;
      case 'task':
        return `task/${task.id}`;
      case 'agent':
      default:
        return `swarm/${agent.role}-${sanitizedTitle}`;
    }
  }

  private createBranch(branchName: string): void {
    execSync(`git checkout -b ${branchName}`, { encoding: 'utf8' });
  }

  private checkoutBranch(branchName: string): void {
    execSync(`git checkout ${branchName}`, { encoding: 'utf8' });
  }

  private branchExists(branchName: string): boolean {
    try {
      execSync(`git rev-parse --verify ${branchName}`, { 
        encoding: 'utf8',
        stdio: 'pipe'
      });
      return true;
    } catch {
      return false;
    }
  }

  private deleteBranch(branchName: string): void {
    try {
      execSync(`git branch -d ${branchName}`, { encoding: 'utf8' });
    } catch (error) {
      // Force delete if needed
      execSync(`git branch -D ${branchName}`, { encoding: 'utf8' });
    }
  }

  private mergeBranch(branchName: string): void {
    const strategy = this.config.mergStrategy;
    
    switch (strategy) {
      case 'squash':
        execSync(`git merge --squash ${branchName}`, { encoding: 'utf8' });
        execSync('git commit -m "Squashed agent changes"', { encoding: 'utf8' });
        break;
      case 'rebase':
        execSync(`git rebase ${branchName}`, { encoding: 'utf8' });
        break;
      case 'merge':
      default:
        execSync(`git merge ${branchName}`, { encoding: 'utf8' });
        break;
    }
  }

  private hasUncommittedChanges(): boolean {
    const status = execSync('git status --porcelain', { encoding: 'utf8' });
    return status.trim().length > 0;
  }

  private hasRemote(): boolean {
    try {
      execSync('git remote get-url origin', { encoding: 'utf8' });
      return true;
    } catch {
      return false;
    }
  }

  private getConflictedFiles(): string[] {
    try {
      const conflicts = execSync('git diff --name-only --diff-filter=U', { 
        encoding: 'utf8' 
      });
      return conflicts.trim().split('\n').filter(f => f.length > 0);
    } catch {
      return [];
    }
  }

  private isAgentFile(file: string, agent: Agent): boolean {
    // Simple heuristic: check if file is in agent's working directory
    return file.includes(agent.role) || file.includes(agent.id);
  }

  private generateCommitMessage(agent: Agent, task: SwarmTask): string {
    return `[${agent.role}] ${task.title} - Iteration ${agent.performance?.tasksCompleted || 1}`;
  }

  private scheduleAutoCommit(agent: Agent, task: SwarmTask): void {
    const intervalMs = this.config.commitFrequency * 60 * 1000;
    
    setInterval(async () => {
      await this.commitAgentWork(agent, task, `[${agent.role}] Auto-commit: ${task.title}`);
    }, intervalMs);
  }

  private async createPullRequest(agent: Agent, task: SwarmTask, branchName: string): Promise<void> {
    try {
      const title = `[Swarm ${agent.role}] ${task.title}`;
      const body = `
## Agent: ${agent.role}
## Task: ${task.title}

### Acceptance Criteria:
${task.acceptanceCriteria.map(c => `- ${c}`).join('\n')}

### Status:
- Tasks Completed: ${agent.performance?.tasksCompleted || 0}
- Success Rate: ${agent.performance?.successRate || 0}%

Generated by Swarm Coordinator
      `;

      execSync(`gh pr create --title "${title}" --body "${body}" --base ${this.baselineBranch}`, {
        encoding: 'utf8'
      });
      
      logger.info(`Created PR for agent ${agent.role}`);
    } catch (error) {
      logger.warn(`Could not create PR: ${error}`);
    }
  }

  private async runIntegrationTests(): Promise<boolean> {
    try {
      // Try to run tests
      execSync('npm test', { encoding: 'utf8' });
      return true;
    } catch {
      // Tests failed or not available
      return false;
    }
  }

  /**
   * Get status of all agent branches
   */
  getGitStatus(): object {
    const status: any = {
      enabled: this.config.enableGitWorkflow,
      currentBranch: this.getCurrentBranch(),
      agentBranches: Array.from(this.agentBranches.entries()).map(([agentId, branch]) => ({
        agentId,
        branch,
        exists: this.branchExists(branch)
      })),
      hasUncommittedChanges: this.hasUncommittedChanges()
    };

    return status;
  }
}

export const gitWorkflowManager = new GitWorkflowManager();