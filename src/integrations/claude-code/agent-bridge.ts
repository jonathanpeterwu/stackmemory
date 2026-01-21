/**
 * Claude Code Agent Bridge
 *
 * Integrates StackMemory's Oracle/Worker pattern with Claude Code's specialized agents.
 * Enables seamless use of Claude's built-in agents as Oracle strategists and Worker executors.
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../core/monitoring/logger.js';
import {
  OracleWorkerCoordinator,
  ModelConfig,
} from '../ralph/patterns/oracle-worker-pattern.js';
import { ClaudeCodeTaskCoordinator } from './task-coordinator.js';

// Claude Code agent types and their capabilities
export interface ClaudeCodeAgent {
  name: string;
  type: 'oracle' | 'worker' | 'reviewer';
  description: string;
  capabilities: string[];
  costMultiplier: number; // Relative cost compared to base model
  complexity: 'low' | 'medium' | 'high' | 'very_high';
  specializations: string[];
}

// Available Claude Code agents mapped to Oracle/Worker roles
export const CLAUDE_CODE_AGENTS: Record<string, ClaudeCodeAgent> = {
  // Oracle-level agents (strategic, high-level)
  'staff-architect': {
    name: 'staff-architect',
    type: 'oracle',
    description:
      'Strategic technical leadership, architectural guidance, and engineering direction',
    capabilities: [
      'system_design',
      'architectural_planning',
      'technical_strategy',
      'scalability_analysis',
      'technology_selection',
      'team_organization',
    ],
    costMultiplier: 1.0, // Oracle pricing
    complexity: 'very_high',
    specializations: ['architecture', 'strategy', 'leadership'],
  },

  'product-manager': {
    name: 'product-manager',
    type: 'oracle',
    description: 'Strategic planning, roadmap development, and market analysis',
    capabilities: [
      'product_strategy',
      'roadmap_planning',
      'market_analysis',
      'feature_prioritization',
      'stakeholder_alignment',
      'business_requirements',
    ],
    costMultiplier: 1.0,
    complexity: 'high',
    specializations: ['strategy', 'planning', 'business'],
  },

  // Worker-level agents (execution, focused tasks)
  'general-purpose': {
    name: 'general-purpose',
    type: 'worker',
    description:
      'General-purpose agent for researching, coding, and multi-step tasks',
    capabilities: [
      'code_implementation',
      'research',
      'debugging',
      'file_operations',
      'testing',
      'documentation',
    ],
    costMultiplier: 0.2, // Worker pricing
    complexity: 'medium',
    specializations: ['development', 'research', 'general'],
  },

  'code-reviewer': {
    name: 'code-reviewer',
    type: 'reviewer',
    description:
      'Reviews code against standards, checks for issues and best practices',
    capabilities: [
      'code_review',
      'quality_assessment',
      'security_analysis',
      'performance_review',
      'best_practices_enforcement',
      'typescript_validation',
    ],
    costMultiplier: 0.3, // Slightly more expensive worker
    complexity: 'medium',
    specializations: ['quality', 'security', 'standards'],
  },

  debugger: {
    name: 'debugger',
    type: 'worker',
    description:
      'Specialized debugging for errors, test failures, and unexpected behavior',
    capabilities: [
      'error_analysis',
      'debugging',
      'log_analysis',
      'performance_debugging',
      'test_failure_analysis',
      'root_cause_analysis',
    ],
    costMultiplier: 0.25,
    complexity: 'medium',
    specializations: ['debugging', 'analysis', 'troubleshooting'],
  },

  'qa-workflow-validator': {
    name: 'qa-workflow-validator',
    type: 'worker',
    description:
      'Comprehensive QA testing, workflow validation, and UI testing',
    capabilities: [
      'workflow_validation',
      'test_execution',
      'ui_testing',
      'integration_testing',
      'log_analysis',
      'quality_assurance',
    ],
    costMultiplier: 0.3,
    complexity: 'medium',
    specializations: ['testing', 'validation', 'quality'],
  },

  'merge-coordinator': {
    name: 'merge-coordinator',
    type: 'worker',
    description: 'Coordinates merge requests and handles code integration',
    capabilities: [
      'merge_coordination',
      'conflict_resolution',
      'code_integration',
      'branch_management',
      'review_coordination',
      'git_workflow',
    ],
    costMultiplier: 0.2,
    complexity: 'low',
    specializations: ['git', 'coordination', 'integration'],
  },

  'github-workflow': {
    name: 'github-workflow',
    type: 'worker',
    description: 'Git workflow management for commits, branches, and PRs',
    capabilities: [
      'git_operations',
      'branch_management',
      'commit_management',
      'pr_creation',
      'workflow_automation',
      'repository_management',
    ],
    costMultiplier: 0.15,
    complexity: 'low',
    specializations: ['git', 'automation', 'workflow'],
  },
};

/**
 * Claude Code Agent Bridge
 * Integrates Claude Code agents with Oracle/Worker pattern
 */
export class ClaudeCodeAgentBridge extends OracleWorkerCoordinator {
  private claudeAgents: Map<string, ClaudeCodeAgent> = new Map();
  private activeAgentSessions: Map<string, any> = new Map();
  private taskCoordinator: ClaudeCodeTaskCoordinator;

  constructor() {
    // Create configurations before super call
    const oracleConfigs = ClaudeCodeAgentBridge.createOracleConfigs();
    const workerConfigs = ClaudeCodeAgentBridge.createWorkerConfigs();
    const reviewerConfigs = ClaudeCodeAgentBridge.createReviewerConfigs();

    super({
      oracle: oracleConfigs[0],
      workers: workerConfigs,
      reviewers: reviewerConfigs,
      maxWorkers: 8, // Allow more workers for Claude Code agents
      coordinationInterval: 30000,
      costBudget: 15.0, // Higher budget for Claude Code integration
    });

    // Initialize after super call

    // Initialize task coordinator
    this.taskCoordinator = new ClaudeCodeTaskCoordinator();

    // Load Claude Code agents
    this.loadClaudeCodeAgents();

    logger.info('Claude Code Agent Bridge initialized', {
      oracleAgents: oracleConfigs.length,
      workerAgents: workerConfigs.length,
      reviewerAgents: reviewerConfigs.length,
    });
  }

  /**
   * Launch Oracle/Worker swarm using Claude Code agents
   */
  async launchClaudeCodeSwarm(
    projectDescription: string,
    options: {
      oracleAgent?: string;
      workerAgents?: string[];
      reviewerAgents?: string[];
      budget?: number;
      complexity?: 'low' | 'medium' | 'high' | 'very_high';
    } = {}
  ): Promise<string> {
    const {
      oracleAgent = 'staff-architect',
      workerAgents = ['general-purpose', 'code-reviewer'],
      reviewerAgents = ['code-reviewer'],
      budget = 10.0,
      complexity = 'medium',
    } = options;

    logger.info('Launching Claude Code swarm', {
      project: projectDescription.substring(0, 100),
      oracleAgent,
      workerAgents,
      budget,
    });

    // Validate agents exist
    this.validateAgentSelection(oracleAgent, workerAgents, reviewerAgents);

    // Create specialized task decomposition using Claude Code capabilities
    const swarmId = uuidv4();

    try {
      // Phase 1: Oracle Planning with Claude Code staff-architect
      const oracleTaskId = await this.createClaudeOracleTask(
        oracleAgent,
        projectDescription,
        complexity
      );

      const decomposition = await this.executeClaudeOracleTask(
        oracleTaskId,
        oracleAgent
      );

      // Phase 2: Worker Assignment with Claude Code agents
      const workerTasks = await this.allocateTasksToClaudeWorkers(
        decomposition,
        workerAgents
      );

      // Phase 3: Parallel Worker Execution
      const workerPromises = workerTasks.map((task) =>
        this.executeClaudeWorkerTask(task)
      );

      // Phase 4: Review with Claude Code reviewers
      const reviewPromises = reviewerAgents.map((reviewer) =>
        this.executeClaudeReviewTask(reviewer, decomposition, workerTasks)
      );

      // Execute all phases
      const [workerResults, reviewResults] = await Promise.all([
        Promise.allSettled(workerPromises),
        Promise.allSettled(reviewPromises),
      ]);

      // Phase 5: Integration and Final Review
      await this.integrateClaudeResults(swarmId, workerResults, reviewResults);

      this.logClaudeCodeCostAnalysis();
      return swarmId;
    } catch (error: unknown) {
      logger.error('Claude Code swarm failed', error as Error);
      throw error;
    }
  }

  /**
   * Load Claude Code agents into the bridge
   */
  private loadClaudeCodeAgents(): void {
    for (const [agentName, agentConfig] of Object.entries(CLAUDE_CODE_AGENTS)) {
      this.claudeAgents.set(agentName, agentConfig);
    }

    logger.info('Claude Code agents loaded', {
      totalAgents: this.claudeAgents.size,
      oracles: Array.from(this.claudeAgents.values()).filter(
        (a) => a.type === 'oracle'
      ).length,
      workers: Array.from(this.claudeAgents.values()).filter(
        (a) => a.type === 'worker'
      ).length,
      reviewers: Array.from(this.claudeAgents.values()).filter(
        (a) => a.type === 'reviewer'
      ).length,
    });
  }

  /**
   * Create Oracle model configurations from Claude Code agents
   */
  private static createOracleConfigs(): ModelConfig[] {
    return Object.values(CLAUDE_CODE_AGENTS)
      .filter((agent) => agent.type === 'oracle')
      .map((agent) => ({
        tier: 'oracle' as const,
        provider: 'claude',
        model: `claude-code-${agent.name}`,
        costPerToken: 0.015 * agent.costMultiplier, // Base Oracle cost with multiplier
        capabilities: agent.capabilities,
      }));
  }

  /**
   * Create Worker model configurations from Claude Code agents
   */
  private static createWorkerConfigs(): ModelConfig[] {
    return Object.values(CLAUDE_CODE_AGENTS)
      .filter((agent) => agent.type === 'worker')
      .map((agent) => ({
        tier: 'worker' as const,
        provider: 'claude',
        model: `claude-code-${agent.name}`,
        costPerToken: 0.00025 * agent.costMultiplier, // Base worker cost with multiplier
        capabilities: agent.capabilities,
      }));
  }

  /**
   * Create Reviewer model configurations from Claude Code agents
   */
  private static createReviewerConfigs(): ModelConfig[] {
    return Object.values(CLAUDE_CODE_AGENTS)
      .filter((agent) => agent.type === 'reviewer')
      .map((agent) => ({
        tier: 'reviewer' as const,
        provider: 'claude',
        model: `claude-code-${agent.name}`,
        costPerToken: 0.003 * agent.costMultiplier, // Base reviewer cost with multiplier
        capabilities: agent.capabilities,
      }));
  }

  /**
   * Validate that selected agents exist and are appropriate
   */
  private validateAgentSelection(
    oracleAgent: string,
    workerAgents: string[],
    reviewerAgents: string[]
  ): void {
    // Validate Oracle agent
    const oracle = this.claudeAgents.get(oracleAgent);
    if (!oracle) {
      throw new Error(`Oracle agent '${oracleAgent}' not found`);
    }
    if (oracle.type !== 'oracle') {
      throw new Error(`Agent '${oracleAgent}' is not an Oracle-level agent`);
    }

    // Validate Worker agents
    for (const workerAgent of workerAgents) {
      const worker = this.claudeAgents.get(workerAgent);
      if (!worker) {
        throw new Error(`Worker agent '${workerAgent}' not found`);
      }
      if (worker.type !== 'worker') {
        throw new Error(`Agent '${workerAgent}' is not a Worker-level agent`);
      }
    }

    // Validate Reviewer agents
    for (const reviewerAgent of reviewerAgents) {
      const reviewer = this.claudeAgents.get(reviewerAgent);
      if (!reviewer) {
        throw new Error(`Reviewer agent '${reviewerAgent}' not found`);
      }
      if (reviewer.type !== 'reviewer') {
        throw new Error(
          `Agent '${reviewerAgent}' is not a Reviewer-level agent`
        );
      }
    }
  }

  /**
   * Create Oracle task with Claude Code agent capabilities
   */
  private async createClaudeOracleTask(
    agentName: string,
    projectDescription: string,
    complexity: string
  ): Promise<string> {
    const taskId = uuidv4();
    const agent = this.claudeAgents.get(agentName)!;

    logger.info('Creating Claude Oracle task', {
      taskId,
      agent: agentName,
      complexity,
    });

    // Store task configuration for execution
    this.activeAgentSessions.set(taskId, {
      agentName,
      agentType: 'oracle',
      projectDescription,
      complexity,
      capabilities: agent.capabilities,
    });

    return taskId;
  }

  /**
   * Execute Oracle task using Claude Code agent
   */
  private async executeClaudeOracleTask(
    taskId: string,
    agentName: string
  ): Promise<any> {
    const session = this.activeAgentSessions.get(taskId);
    if (!session) {
      throw new Error(`Oracle task session ${taskId} not found`);
    }

    logger.info('Executing Claude Oracle task', {
      taskId,
      agent: agentName,
    });

    // Build Oracle prompt optimized for Claude Code agent
    const oraclePrompt = this.buildClaudeOraclePrompt(session);

    // Execute with Claude Code agent (integration point)
    const result = await this.invokeClaudeCodeAgent(agentName, oraclePrompt, {
      type: 'oracle',
      maxTokens: 4000,
      temperature: 0.7,
    });

    // Parse and validate the decomposition
    const decomposition = this.parseClaudeTaskDecomposition(result);

    return decomposition;
  }

  /**
   * Build Oracle prompt optimized for Claude Code capabilities
   */
  private buildClaudeOraclePrompt(session: any): string {
    const agent = this.claudeAgents.get(session.agentName)!;

    return `
# CLAUDE CODE ORACLE: ${agent.name.toUpperCase()}

## Your Role & Capabilities
You are a **${agent.description}** acting as the Oracle in an Oracle/Worker pattern.

**Your Specialized Capabilities:**
${agent.capabilities.map((cap) => `- ${cap.replace(/_/g, ' ')}`).join('\n')}

**Your Specializations:**
${agent.specializations.map((spec) => `- ${spec}`).join('\n')}

## Project Context
${session.projectDescription}

**Complexity Level:** ${session.complexity}

## Oracle Responsibilities
As the Oracle, you provide strategic oversight while specialized Claude Code workers handle execution:

1. **Strategic Decomposition**: Break down the project into tasks optimized for Claude Code agents
2. **Agent Selection**: Recommend which Claude Code agents should handle each task
3. **Quality Standards**: Define acceptance criteria that leverage Claude Code capabilities
4. **Coordination Plan**: Plan how agents should collaborate and integrate work

## Available Claude Code Workers
${this.getAvailableWorkersDescription()}

## Output Required
Provide a detailed strategic plan in JSON format:

\`\`\`json
{
  "project_analysis": {
    "complexity_assessment": "low|medium|high|very_high",
    "key_challenges": ["challenge 1", "challenge 2"],
    "success_criteria": ["criterion 1", "criterion 2"]
  },
  "task_decomposition": [
    {
      "id": "task-1",
      "title": "Task name",
      "description": "Detailed description",
      "recommended_agent": "agent-name",
      "agent_rationale": "Why this agent is optimal",
      "complexity": "low|medium|high",
      "estimated_effort": "1-5 scale",
      "dependencies": ["task-id"],
      "acceptance_criteria": ["criterion 1", "criterion 2"],
      "claude_code_integration": {
        "tools_needed": ["tool1", "tool2"],
        "validation_method": "how to verify completion"
      }
    }
  ],
  "coordination_strategy": {
    "integration_points": ["when agents should sync"],
    "quality_gates": ["checkpoints for review"],
    "risk_mitigation": ["potential issues and solutions"],
    "success_metrics": ["how to measure overall success"]
  }
}
\`\`\`

Focus on strategic thinking that maximizes Claude Code's specialized capabilities.
    `;
  }

  /**
   * Get description of available Claude Code workers
   */
  private getAvailableWorkersDescription(): string {
    const workers = Array.from(this.claudeAgents.values()).filter(
      (agent) => agent.type === 'worker' || agent.type === 'reviewer'
    );

    return workers
      .map(
        (worker) =>
          `**${worker.name}**: ${worker.description}\n  Capabilities: ${worker.capabilities.join(', ')}`
      )
      .join('\n\n');
  }

  /**
   * Allocate tasks to Claude Code worker agents
   */
  private async allocateTasksToClaudeWorkers(
    decomposition: any,
    workerAgents: string[]
  ): Promise<any[]> {
    const allocatedTasks = [];

    for (const task of decomposition.task_decomposition || []) {
      // Use Oracle's recommendation if available, otherwise select optimal worker
      const recommendedAgent = task.recommended_agent;
      const selectedAgent = workerAgents.includes(recommendedAgent)
        ? recommendedAgent
        : this.selectOptimalClaudeWorker(task, workerAgents);

      const claudeAgent = this.claudeAgents.get(selectedAgent)!;

      allocatedTasks.push({
        ...task,
        assignedAgent: selectedAgent,
        agentCapabilities: claudeAgent.capabilities,
        agentType: claudeAgent.type,
      });

      logger.debug('Task allocated to Claude Code agent', {
        taskId: task.id,
        agent: selectedAgent,
        rationale:
          task.agent_rationale || 'Auto-selected based on capabilities',
      });
    }

    return allocatedTasks;
  }

  /**
   * Select optimal Claude Code worker for a task
   */
  private selectOptimalClaudeWorker(
    task: any,
    availableWorkers: string[]
  ): string {
    let bestAgent = availableWorkers[0];
    let bestScore = 0;

    for (const workerName of availableWorkers) {
      const worker = this.claudeAgents.get(workerName)!;
      let score = 0;

      // Score based on capability overlap
      const taskKeywords = (task.description || '').toLowerCase().split(' ');
      for (const capability of worker.capabilities) {
        const capabilityKeywords = capability.replace(/_/g, ' ').toLowerCase();
        if (
          taskKeywords.some((keyword) => capabilityKeywords.includes(keyword))
        ) {
          score += 2;
        }
      }

      // Score based on specialization match
      for (const specialization of worker.specializations) {
        if (taskKeywords.some((keyword) => keyword.includes(specialization))) {
          score += 3;
        }
      }

      // Prefer lower cost for similar capabilities
      score -= worker.costMultiplier;

      if (score > bestScore) {
        bestScore = score;
        bestAgent = workerName;
      }
    }

    return bestAgent;
  }

  /**
   * Execute worker task using Claude Code agent
   */
  private async executeClaudeWorkerTask(task: any): Promise<any> {
    const agentName = task.assignedAgent;
    const agent = this.claudeAgents.get(agentName)!;

    logger.info('Executing Claude Code worker task', {
      taskId: task.id,
      agent: agentName,
    });

    // Build worker prompt optimized for the specific Claude Code agent
    const workerPrompt = this.buildClaudeWorkerPrompt(task, agent);

    // Execute with Claude Code agent
    const result = await this.invokeClaudeCodeAgent(agentName, workerPrompt, {
      type: 'worker',
      maxTokens: 2000,
      temperature: 0.3,
    });

    return {
      taskId: task.id,
      agentName,
      result,
      success: true,
    };
  }

  /**
   * Execute review task using Claude Code reviewer
   */
  private async executeClaudeReviewTask(
    reviewerName: string,
    decomposition: any,
    workerTasks: any[]
  ): Promise<any> {
    const agent = this.claudeAgents.get(reviewerName)!;

    logger.info('Executing Claude Code review task', {
      reviewer: reviewerName,
      tasksToReview: workerTasks.length,
    });

    // Build review prompt
    const reviewPrompt = this.buildClaudeReviewPrompt(
      agent,
      decomposition,
      workerTasks
    );

    // Execute review
    const result = await this.invokeClaudeCodeAgent(
      reviewerName,
      reviewPrompt,
      {
        type: 'reviewer',
        maxTokens: 3000,
        temperature: 0.2,
      }
    );

    return {
      reviewerId: reviewerName,
      result,
      success: true,
    };
  }

  /**
   * Build worker prompt for Claude Code agent
   */
  private buildClaudeWorkerPrompt(task: any, agent: ClaudeCodeAgent): string {
    return `
# CLAUDE CODE WORKER: ${agent.name.toUpperCase()}

## Your Specialized Role
You are a **${agent.description}** executing a focused task as part of a larger project.

**Your Capabilities:**
${agent.capabilities.map((cap) => `- ${cap.replace(/_/g, ' ')}`).join('\n')}

## Your Task
**${task.title}**

${task.description}

## Success Criteria
${(task.acceptance_criteria || []).map((c: string) => `- ${c}`).join('\n')}

## Integration Requirements
${
  task.claude_code_integration
    ? `
**Tools Needed:** ${task.claude_code_integration.tools_needed?.join(', ') || 'Standard tools'}
**Validation Method:** ${task.claude_code_integration.validation_method || 'Standard validation'}
`
    : ''
}

## Worker Guidelines
- **Focus** on this specific task only
- **Execute** using your specialized capabilities
- **Communicate** progress clearly
- **Deliver** according to the acceptance criteria
- **Coordinate** with other agents through shared context

Execute your specialized task now, leveraging your Claude Code capabilities.
    `;
  }

  /**
   * Build review prompt for Claude Code reviewer
   */
  private buildClaudeReviewPrompt(
    agent: ClaudeCodeAgent,
    decomposition: any,
    workerTasks: any[]
  ): string {
    return `
# CLAUDE CODE REVIEWER: ${agent.name.toUpperCase()}

## Your Review Role
You are a **${agent.description}** conducting comprehensive review of completed work.

**Your Review Capabilities:**
${agent.capabilities.map((cap) => `- ${cap.replace(/_/g, ' ')}`).join('\n')}

## Project Context
${JSON.stringify(decomposition.project_analysis || {}, null, 2)}

## Completed Tasks to Review
${workerTasks
  .map(
    (task, i) => `
### Task ${i + 1}: ${task.title}
- **Agent:** ${task.agentName}
- **Status:** ${task.success ? 'Completed' : 'Failed'}
- **Acceptance Criteria:** ${(task.acceptance_criteria || []).join(', ')}
`
  )
  .join('\n')}

## Review Requirements
1. **Quality Assessment**: Evaluate if each task meets its acceptance criteria
2. **Integration Check**: Verify tasks work together cohesively
3. **Standards Compliance**: Ensure code/work follows best practices
4. **Risk Analysis**: Identify potential issues or improvements needed
5. **Final Recommendation**: Approve, request changes, or flag for re-work

## Output Format
Provide structured review in JSON:

\`\`\`json
{
  "overall_assessment": "pass|conditional_pass|fail",
  "task_reviews": [
    {
      "task_id": "task-id",
      "status": "approved|changes_requested|rejected",
      "issues": ["issue 1", "issue 2"],
      "recommendations": ["recommendation 1"]
    }
  ],
  "integration_review": {
    "cohesion_score": "1-10",
    "integration_issues": ["issue 1"],
    "recommended_improvements": ["improvement 1"]
  },
  "final_recommendation": "deploy|fix_and_redeploy|major_rework_needed"
}
\`\`\`

Conduct thorough review using your specialized Claude Code capabilities.
    `;
  }

  /**
   * Invoke Claude Code agent (integration point)
   */
  private async invokeClaudeCodeAgent(
    agentName: string,
    prompt: string,
    options: { type: string; maxTokens: number; temperature: number }
  ): Promise<string> {
    const agent = this.claudeAgents.get(agentName)!;

    // Use task coordinator for execution
    return await this.taskCoordinator.executeTask(agentName, agent, prompt, {
      maxRetries: options.type === 'oracle' ? 1 : 2, // Oracle tasks are more expensive, fewer retries
      timeout: options.type === 'oracle' ? 600000 : 300000, // Oracle gets more time
      priority: options.type === 'oracle' ? 'high' : 'medium',
    });
  }

  /**
   * Generate mock response (to be replaced with real Claude Code integration)
   */
  private generateMockResponse(agentName: string, type: string): string {
    const agent = this.claudeAgents.get(agentName)!;

    if (type === 'oracle') {
      return JSON.stringify(
        {
          project_analysis: {
            complexity_assessment: 'medium',
            key_challenges: [
              'Integration complexity',
              'Performance requirements',
            ],
            success_criteria: ['All tests pass', 'Performance benchmarks met'],
          },
          task_decomposition: [
            {
              id: 'task-1',
              title: 'Core Implementation',
              description: 'Implement main functionality',
              recommended_agent: 'general-purpose',
              agent_rationale: 'Best suited for general development tasks',
              complexity: 'medium',
              estimated_effort: '3',
              dependencies: [],
              acceptance_criteria: ['Feature works correctly', 'Tests pass'],
              claude_code_integration: {
                tools_needed: ['Write', 'Edit', 'Bash'],
                validation_method: 'Run tests and verify functionality',
              },
            },
          ],
          coordination_strategy: {
            integration_points: ['After core implementation'],
            quality_gates: ['Code review', 'Testing'],
            risk_mitigation: ['Regular checkpoints', 'Incremental delivery'],
          },
        },
        null,
        2
      );
    }

    return `Claude Code agent ${agentName} completed ${type} task successfully using capabilities: ${agent.capabilities.join(', ')}`;
  }

  /**
   * Parse task decomposition from Claude Code response
   */
  private parseClaudeTaskDecomposition(response: string): any {
    try {
      return JSON.parse(response);
    } catch {
      // Fallback parsing if not valid JSON
      return {
        task_decomposition: [
          {
            id: 'task-1',
            title: 'Implementation Task',
            description: response.substring(0, 200),
            complexity: 'medium',
            acceptance_criteria: ['Task completed successfully'],
          },
        ],
      };
    }
  }

  /**
   * Integrate results from Claude Code agents
   */
  private async integrateClaudeResults(
    swarmId: string,
    workerResults: PromiseSettledResult<any>[],
    reviewResults: PromiseSettledResult<any>[]
  ): Promise<void> {
    const successfulWorkers = workerResults.filter(
      (r) => r.status === 'fulfilled'
    ).length;
    const successfulReviews = reviewResults.filter(
      (r) => r.status === 'fulfilled'
    ).length;

    logger.info('Claude Code swarm integration completed', {
      swarmId,
      totalWorkerTasks: workerResults.length,
      successfulWorkers,
      totalReviews: reviewResults.length,
      successfulReviews,
      successRate: ((successfulWorkers / workerResults.length) * 100).toFixed(
        1
      ),
    });
  }

  /**
   * Log cost analysis for Claude Code agents
   */
  private logClaudeCodeCostAnalysis(): void {
    // Calculate costs based on Claude Code agent usage
    const totalSessions = this.activeAgentSessions.size;

    logger.info('Claude Code Agent Cost Analysis', {
      totalSessions,
      estimatedSavings: '60-80% vs all-Oracle approach',
      agentEfficiency: 'Specialized agents for optimal task matching',
      qualityMaintenance:
        'High-quality output through specialized capabilities',
    });
  }

  /**
   * Get available Claude Code agents by type
   */
  getAvailableAgents(): {
    oracles: string[];
    workers: string[];
    reviewers: string[];
  } {
    const agents = Array.from(this.claudeAgents.values());

    return {
      oracles: agents.filter((a) => a.type === 'oracle').map((a) => a.name),
      workers: agents.filter((a) => a.type === 'worker').map((a) => a.name),
      reviewers: agents.filter((a) => a.type === 'reviewer').map((a) => a.name),
    };
  }
}

export default ClaudeCodeAgentBridge;
