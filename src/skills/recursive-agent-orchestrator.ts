/**
 * Recursive Language Model (RLM) Orchestrator for StackMemory
 *
 * Implements recursive task decomposition with parallel Claude API execution
 * Based on "Recursive Language Models" paper concepts
 *
 * Key Features:
 * - Parallel subagent execution via Claude API
 * - Automatic test generation and validation
 * - Multi-stage code review and improvement
 * - Large codebase processing through chunking
 * - Full operation transparency
 */

import { logger } from '../core/monitoring/logger.js';
import { FrameManager } from '../core/context/frame-manager.js';
import { DualStackManager } from '../core/context/dual-stack-manager.js';
import { ContextRetriever } from '../core/retrieval/context-retriever.js';
import { PebblesTaskStore } from '../features/tasks/pebbles-task-store.js';
import { ParallelExecutor } from '../core/execution/parallel-executor.js';
import { RecursiveContextManager } from '../core/context/recursive-context-manager.js';
import { ClaudeCodeSubagentClient } from '../integrations/claude-code/subagent-client.js';
import type { Frame } from '../core/context/frame-manager.js';

// Subagent types
export type SubagentType =
  | 'planning'
  | 'code'
  | 'testing'
  | 'linting'
  | 'review'
  | 'context'
  | 'publish'
  | 'improve';

// Subagent configuration
export interface SubagentConfig {
  type: SubagentType;
  model:
    | 'claude-3-5-sonnet-latest'
    | 'claude-3-5-haiku-latest'
    | 'claude-3-opus-latest';
  maxTokens: number;
  temperature: number;
  systemPrompt: string;
  capabilities: string[];
}

// Task decomposition node
export interface TaskNode {
  id: string;
  type: 'task' | 'parallel' | 'sequential';
  description: string;
  agent: SubagentType;
  dependencies: string[];
  context: Record<string, any>;
  children?: TaskNode[];
  status: 'pending' | 'running' | 'completed' | 'failed';
  result?: any;
  error?: Error;
  attempts: number;
  startTime?: Date;
  endTime?: Date;
  tokens?: number;
  cost?: number;
}

// Execution result
export interface ExecutionResult {
  success: boolean;
  rootNode: TaskNode;
  totalTokens: number;
  totalCost: number;
  duration: number;
  improvements: string[];
  testsGenerated: number;
  issuesFound: number;
  issuesFixed: number;
}

// RLM Options
export interface RLMOptions {
  maxParallel?: number;
  maxRecursionDepth?: number;
  maxTokensPerAgent?: number;
  maxTotalCost?: number;
  timeoutPerAgent?: number;
  retryFailedAgents?: boolean;
  shareContextRealtime?: boolean;
  testGenerationMode?: 'unit' | 'integration' | 'e2e' | 'all';
  reviewStages?: number;
  qualityThreshold?: number;
  verboseLogging?: boolean;
}

/**
 * Main RLM Orchestrator
 */
export class RecursiveAgentOrchestrator {
  private frameManager: FrameManager;
  private contextRetriever: ContextRetriever;
  private taskStore: PebblesTaskStore;
  private parallelExecutor: ParallelExecutor;
  private contextManager: RecursiveContextManager;
  private subagentClient: ClaudeCodeSubagentClient;

  // Subagent configurations
  private subagentConfigs: Map<SubagentType, SubagentConfig>;

  // Execution tracking
  private activeExecutions: Map<string, TaskNode> = new Map();
  private executionHistory: ExecutionResult[] = [];

  // Default options
  private defaultOptions: Required<RLMOptions> = {
    maxParallel: 5,
    maxRecursionDepth: 4,
    maxTokensPerAgent: 30000,
    maxTotalCost: 50.0, // Quality over cost
    timeoutPerAgent: 300,
    retryFailedAgents: true,
    shareContextRealtime: true,
    testGenerationMode: 'all',
    reviewStages: 3, // Multi-stage review
    qualityThreshold: 0.85,
    verboseLogging: true, // Full transparency
  };

  constructor(
    frameManager: FrameManager,
    dualStackManager: DualStackManager,
    contextRetriever: ContextRetriever,
    taskStore: PebblesTaskStore
  ) {
    this.frameManager = frameManager;
    this.contextRetriever = contextRetriever;
    this.taskStore = taskStore;

    // Initialize components
    this.parallelExecutor = new ParallelExecutor(
      this.defaultOptions.maxParallel
    );
    this.contextManager = new RecursiveContextManager(
      dualStackManager,
      contextRetriever
    );
    this.subagentClient = new ClaudeCodeSubagentClient();

    // Initialize subagent configurations
    this.subagentConfigs = this.initializeSubagentConfigs();

    logger.info('RLM Orchestrator initialized', {
      maxParallel: this.defaultOptions.maxParallel,
      maxRecursion: this.defaultOptions.maxRecursionDepth,
      reviewStages: this.defaultOptions.reviewStages,
    });
  }

  /**
   * Initialize subagent configurations with specialized prompts
   */
  private initializeSubagentConfigs(): Map<SubagentType, SubagentConfig> {
    const configs = new Map<SubagentType, SubagentConfig>();

    // Planning Agent - Task decomposer
    configs.set('planning', {
      type: 'planning',
      model: 'claude-3-5-sonnet-latest',
      maxTokens: 20000,
      temperature: 0.3,
      systemPrompt: `You are a Planning Agent specializing in task decomposition.
        Analyze complex tasks and break them into parallel and sequential subtasks.
        Create detailed execution plans with clear dependencies.
        Consider edge cases and potential failures.
        Output structured task trees with agent assignments.`,
      capabilities: ['decompose', 'analyze', 'strategize', 'prioritize'],
    });

    // Code Agent - Implementation specialist
    configs.set('code', {
      type: 'code',
      model: 'claude-3-5-sonnet-latest',
      maxTokens: 30000,
      temperature: 0.2,
      systemPrompt: `You are a Code Agent specializing in implementation.
        Write clean, maintainable, production-ready code.
        Follow project conventions and best practices.
        Include comprehensive error handling.
        Document complex logic with clear comments.`,
      capabilities: ['implement', 'refactor', 'optimize', 'document'],
    });

    // Testing Agent - Test generation and validation
    configs.set('testing', {
      type: 'testing',
      model: 'claude-3-5-sonnet-latest', // High quality for test generation
      maxTokens: 25000,
      temperature: 0.1,
      systemPrompt: `You are a Testing Agent specializing in test generation and validation.
        Generate comprehensive test suites including:
        - Unit tests for all functions/methods
        - Integration tests for API endpoints
        - E2E tests for critical user flows
        - Edge cases and error scenarios
        Ensure 100% code coverage where possible.
        Validate that all tests pass and are meaningful.`,
      capabilities: [
        'generate-tests',
        'validate',
        'coverage-analysis',
        'test-execution',
      ],
    });

    // Linting Agent - Code quality enforcer
    configs.set('linting', {
      type: 'linting',
      model: 'claude-3-5-haiku-latest',
      maxTokens: 15000,
      temperature: 0,
      systemPrompt: `You are a Linting Agent specializing in code quality.
        Check for:
        - Syntax errors and type issues
        - Code formatting and style violations
        - Security vulnerabilities
        - Performance anti-patterns
        - Unused imports and dead code
        Provide actionable fixes for all issues found.`,
      capabilities: ['lint', 'format', 'type-check', 'security-scan'],
    });

    // Review Agent - Multi-stage code reviewer
    configs.set('review', {
      type: 'review',
      model: 'claude-3-5-sonnet-latest',
      maxTokens: 25000,
      temperature: 0.2,
      systemPrompt: `You are a Review Agent specializing in multi-stage code review.
        Perform thorough reviews focusing on:
        - Architecture and design patterns
        - Code quality and maintainability
        - Performance implications
        - Security considerations
        - Test coverage adequacy
        Suggest specific improvements with examples.
        Rate quality on a 0-1 scale.`,
      capabilities: [
        'review',
        'critique',
        'suggest-improvements',
        'quality-scoring',
      ],
    });

    // Improvement Agent - Code enhancer
    configs.set('improve', {
      type: 'improve',
      model: 'claude-3-5-sonnet-latest',
      maxTokens: 30000,
      temperature: 0.3,
      systemPrompt: `You are an Improvement Agent specializing in code enhancement.
        Take reviewed code and implement suggested improvements:
        - Refactor for better architecture
        - Optimize performance bottlenecks
        - Enhance error handling
        - Improve code clarity and documentation
        - Add missing test cases
        Ensure all improvements maintain backward compatibility.`,
      capabilities: ['enhance', 'refactor', 'optimize', 'polish'],
    });

    // Context Agent - Information retriever
    configs.set('context', {
      type: 'context',
      model: 'claude-3-5-haiku-latest',
      maxTokens: 10000,
      temperature: 0,
      systemPrompt: `You are a Context Agent specializing in information retrieval.
        Search and retrieve relevant context from:
        - Project codebase and documentation
        - Previous frame history
        - Similar implementations
        - Best practices and patterns
        Provide concise, relevant context for other agents.`,
      capabilities: ['search', 'retrieve', 'summarize', 'contextualize'],
    });

    // Publish Agent - Release and deployment
    configs.set('publish', {
      type: 'publish',
      model: 'claude-3-5-haiku-latest',
      maxTokens: 15000,
      temperature: 0,
      systemPrompt: `You are a Publish Agent specializing in release management.
        Handle:
        - NPM package publishing
        - GitHub releases and tagging
        - Documentation updates
        - Changelog generation
        - Deployment automation
        Ensure all release steps are properly sequenced.`,
      capabilities: ['publish-npm', 'github-release', 'deploy', 'document'],
    });

    return configs;
  }

  /**
   * Execute a task with recursive decomposition
   */
  async execute(
    task: string,
    context: Record<string, any>,
    options?: RLMOptions
  ): Promise<ExecutionResult> {
    const opts = { ...this.defaultOptions, ...options };
    const executionId = this.generateExecutionId();
    const startTime = Date.now();

    logger.info('Starting RLM execution', {
      executionId,
      task: task.slice(0, 100),
      options: opts,
    });

    try {
      // Create root frame for execution
      const rootFrame = await this.createExecutionFrame(executionId, task);

      // Step 1: Planning - Decompose task into subtasks
      const rootNode = await this.planTask(task, context, opts);
      this.activeExecutions.set(executionId, rootNode);

      // Log execution tree for transparency
      if (opts.verboseLogging) {
        this.logExecutionTree(rootNode);
      }

      // Step 2: Execute task tree recursively with parallelization
      await this.executeTaskTree(rootNode, context, opts, 0);

      // Step 3: Multi-stage review and improvement
      const improvements = await this.performMultiStageReview(
        rootNode,
        opts.reviewStages,
        opts.qualityThreshold
      );

      // Step 4: Aggregate results
      const result: ExecutionResult = {
        success: rootNode.status === 'completed',
        rootNode,
        totalTokens: this.calculateTotalTokens(rootNode),
        totalCost: this.calculateTotalCost(rootNode),
        duration: Date.now() - startTime,
        improvements,
        testsGenerated: this.countGeneratedTests(rootNode),
        issuesFound: this.countIssuesFound(rootNode),
        issuesFixed: this.countIssuesFixed(rootNode),
      };

      // Store execution history
      this.executionHistory.push(result);

      // Update frame with results
      await this.updateExecutionFrame(rootFrame, result);

      logger.info('RLM execution completed', {
        executionId,
        success: result.success,
        duration: result.duration,
        totalCost: result.totalCost,
        testsGenerated: result.testsGenerated,
        improvements: improvements.length,
      });

      return result;
    } catch (error) {
      logger.error('RLM execution failed', { executionId, error });
      throw error;
    } finally {
      this.activeExecutions.delete(executionId);
    }
  }

  /**
   * Plan task decomposition
   */
  private async planTask(
    task: string,
    context: Record<string, any>,
    options: Required<RLMOptions>
  ): Promise<TaskNode> {
    // Call planning agent using Claude Code Task tool
    const response = await this.subagentClient.executeSubagent({
      type: 'planning',
      task: task,
      context: {
        ...context,
        requirements: options,
      },
    });

    // Parse response into task tree
    const taskTree = this.parseTaskTree(JSON.stringify(response.result));

    // Add automatic test generation nodes
    this.injectTestGenerationNodes(taskTree, options.testGenerationMode);

    // Add review stages
    this.injectReviewStages(taskTree, options.reviewStages);

    return taskTree;
  }

  /**
   * Execute task tree recursively with parallelization
   */
  private async executeTaskTree(
    node: TaskNode,
    context: Record<string, any>,
    options: Required<RLMOptions>,
    depth: number
  ): Promise<void> {
    // Check recursion depth
    if (depth >= options.maxRecursionDepth) {
      logger.warn('Max recursion depth reached', { nodeId: node.id, depth });
      node.status = 'failed';
      node.error = new Error('Max recursion depth exceeded');
      return;
    }

    // Log execution start for transparency
    if (options.verboseLogging) {
      logger.info(`Executing node: ${node.description}`, {
        id: node.id,
        type: node.type,
        agent: node.agent,
        depth,
      });
    }

    node.status = 'running';
    node.startTime = new Date();

    try {
      if (node.type === 'parallel' && node.children) {
        // Execute children in parallel
        await this.parallelExecutor.executeParallel(
          node.children,
          async (child) => {
            await this.executeTaskTree(child, context, options, depth + 1);
          }
        );
      } else if (node.type === 'sequential' && node.children) {
        // Execute children sequentially
        for (const child of node.children) {
          await this.executeTaskTree(child, context, options, depth + 1);

          // Pass results to next child
          if (child.result) {
            context[`${child.id}_result`] = child.result;
          }
        }
      } else {
        // Leaf node - execute with appropriate agent
        await this.executeLeafNode(node, context, options);
      }

      node.status = 'completed';
    } catch (error) {
      logger.error(`Node execution failed: ${node.description}`, { error });

      if (options.retryFailedAgents && node.attempts < 3) {
        node.attempts++;
        logger.info(`Retrying node: ${node.description}`, {
          attempt: node.attempts,
        });
        await this.executeTaskTree(node, context, options, depth);
      } else {
        node.status = 'failed';
        node.error = error as Error;
      }
    } finally {
      node.endTime = new Date();

      // Log completion for transparency
      if (options.verboseLogging) {
        const duration = node.endTime.getTime() - node.startTime!.getTime();
        logger.info(`Completed node: ${node.description}`, {
          id: node.id,
          status: node.status,
          duration,
          tokens: node.tokens,
          cost: node.cost,
        });
      }
    }
  }

  /**
   * Execute a leaf node with the appropriate agent
   */
  private async executeLeafNode(
    node: TaskNode,
    context: Record<string, any>,
    options: Required<RLMOptions>
  ): Promise<void> {
    const agentConfig = this.subagentConfigs.get(node.agent)!;

    // Prepare agent-specific context
    const agentContext = await this.contextManager.prepareAgentContext(
      node.agent,
      context,
      options.maxTokensPerAgent
    );

    // Build task description for agent
    const taskDescription = this.buildAgentPrompt(node, agentContext);

    // Call agent via Claude Code Task tool
    const response = await this.subagentClient.executeSubagent({
      type: node.agent,
      task: taskDescription,
      context: agentContext,
    });

    // Process agent response
    node.result = response.result;
    node.tokens =
      response.tokens || this.estimateTokens(JSON.stringify(response));
    node.cost = this.calculateNodeCost(node.tokens, agentConfig.model);

    // Share results with other agents if real-time sharing is enabled
    if (options.shareContextRealtime) {
      await this.shareAgentResults(node);
    }
  }

  /**
   * Perform multi-stage review and improvement
   */
  private async performMultiStageReview(
    rootNode: TaskNode,
    stages: number,
    qualityThreshold: number
  ): Promise<string[]> {
    const improvements: string[] = [];
    let currentQuality = 0;

    for (let stage = 1; stage <= stages; stage++) {
      logger.info(`Starting review stage ${stage}/${stages}`);

      // Review stage
      const reviewNode: TaskNode = {
        id: `review-stage-${stage}`,
        type: 'task',
        description: `Review stage ${stage}`,
        agent: 'review',
        dependencies: [],
        context: { rootNode, stage },
        status: 'pending',
        attempts: 0,
      };

      // Execute review via Claude Code subagent
      const reviewResponse = await this.subagentClient.executeSubagent({
        type: 'review',
        task: `Review stage ${stage}: Analyze code quality and suggest improvements`,
        context: { rootNode, stage },
      });

      reviewNode.result = reviewResponse.result;
      reviewNode.status = reviewResponse.success ? 'completed' : 'failed';

      const reviewResult = reviewResponse.result as {
        quality: number;
        issues: string[];
        suggestions: string[];
      };

      currentQuality = reviewResult.quality;
      improvements.push(...reviewResult.suggestions);

      logger.info(`Review stage ${stage} complete`, {
        quality: currentQuality,
        issues: reviewResult.issues.length,
        suggestions: reviewResult.suggestions.length,
      });

      // If quality meets threshold, stop
      if (currentQuality >= qualityThreshold) {
        logger.info(
          `Quality threshold met: ${currentQuality} >= ${qualityThreshold}`
        );
        break;
      }

      // Improvement stage
      if (stage < stages) {
        const improveNode: TaskNode = {
          id: `improve-stage-${stage}`,
          type: 'task',
          description: `Improvement stage ${stage}`,
          agent: 'improve',
          dependencies: [reviewNode.id],
          context: { reviewResult, rootNode },
          status: 'pending',
          attempts: 0,
        };

        // Execute improvement via Claude Code subagent
        const improveResponse = await this.subagentClient.executeSubagent({
          type: 'improve',
          task: `Improvement stage ${stage}: Implement suggested improvements`,
          context: { reviewResult, rootNode },
        });

        improveNode.result = improveResponse.result;
        improveNode.status = improveResponse.success ? 'completed' : 'failed';

        // Apply improvements to root node
        this.applyImprovements(rootNode, improveNode.result);
      }
    }

    return improvements;
  }

  /**
   * Helper methods
   */

  private generateExecutionId(): string {
    return `rlm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  private async createExecutionFrame(
    executionId: string,
    task: string
  ): Promise<Frame> {
    return this.frameManager.pushFrame({
      name: `RLM: ${task.slice(0, 50)}`,
      type: 'rlm-execution',
      metadata: { executionId },
    });
  }

  private async updateExecutionFrame(
    frame: Frame,
    result: ExecutionResult
  ): Promise<void> {
    frame.outputs = [
      {
        type: 'rlm-result',
        content: JSON.stringify(result, null, 2),
      },
    ];
    frame.state = result.success ? 'completed' : 'failed';
  }

  private logExecutionTree(node: TaskNode, depth: number = 0): void {
    const indent = '  '.repeat(depth);
    const status =
      node.status === 'completed'
        ? '✓'
        : node.status === 'failed'
          ? '✗'
          : node.status === 'running'
            ? '⟳'
            : '○';

    console.log(`${indent}${status} ${node.description} [${node.agent}]`);

    if (node.children) {
      for (const child of node.children) {
        this.logExecutionTree(child, depth + 1);
      }
    }
  }

  private parseTaskTree(_response: string): TaskNode {
    // Parse LLM response into structured task tree
    // This would need sophisticated parsing logic
    // For now, return a mock structure
    return {
      id: 'root',
      type: 'sequential',
      description: 'Root task',
      agent: 'planning',
      dependencies: [],
      context: {},
      status: 'pending',
      attempts: 0,
      children: [],
    };
  }

  private injectTestGenerationNodes(node: TaskNode, _mode: string): void {
    // Inject test generation nodes based on mode
    if (!node.children) return;

    const testNode: TaskNode = {
      id: `${node.id}-test`,
      type: 'task',
      description: `Generate ${_mode} tests for ${node.description}`,
      agent: 'testing',
      dependencies: [node.id],
      context: { testMode: _mode },
      status: 'pending',
      attempts: 0,
    };

    node.children.push(testNode);
  }

  private injectReviewStages(_node: TaskNode, _stages: number): void {
    // Inject review stages into task tree
    // Implementation would add review nodes at appropriate points
  }

  private buildAgentPrompt(node: TaskNode, context: any): string {
    return `
      Task: ${node.description}
      
      Context:
      ${JSON.stringify(context, null, 2)}
      
      Previous Results:
      ${JSON.stringify(
        node.dependencies.map((id) => this.activeExecutions.get(id)?.result),
        null,
        2
      )}
      
      Please complete this task following your specialized role.
    `;
  }

  private estimateTokens(text: string): number {
    // Rough estimation: 1 token ≈ 4 characters
    return Math.ceil(text.length / 4);
  }

  private async shareAgentResults(_node: TaskNode): Promise<void> {
    // Share results with other agents via Redis or shared context
    logger.debug('Sharing agent results', { nodeId: _node.id });
  }

  private applyImprovements(_rootNode: TaskNode, improvements: any): void {
    // Apply improvements to the task tree
    logger.debug('Applying improvements', { improvements });
  }

  private calculateTotalTokens(node: TaskNode): number {
    let total = node.tokens || 0;
    if (node.children) {
      for (const child of node.children) {
        total += this.calculateTotalTokens(child);
      }
    }
    return total;
  }

  private calculateTotalCost(node: TaskNode): number {
    let total = node.cost || 0;
    if (node.children) {
      for (const child of node.children) {
        total += this.calculateTotalCost(child);
      }
    }
    return total;
  }

  private calculateNodeCost(tokens: number, model: string): number {
    // Pricing per 1M tokens (approximate)
    const pricing: Record<string, number> = {
      'claude-3-5-sonnet-latest': 15.0,
      'claude-3-5-haiku-latest': 1.0,
      'claude-3-opus-latest': 75.0,
    };
    return (tokens / 1000000) * (pricing[model] || 10);
  }

  private countGeneratedTests(node: TaskNode): number {
    let count = 0;
    if (node.agent === 'testing' && node.result?.tests) {
      count += node.result.tests.length;
    }
    if (node.children) {
      for (const child of node.children) {
        count += this.countGeneratedTests(child);
      }
    }
    return count;
  }

  private countIssuesFound(node: TaskNode): number {
    let count = 0;
    if (
      (node.agent === 'review' || node.agent === 'linting') &&
      node.result?.issues
    ) {
      count += node.result.issues.length;
    }
    if (node.children) {
      for (const child of node.children) {
        count += this.countIssuesFound(child);
      }
    }
    return count;
  }

  private countIssuesFixed(node: TaskNode): number {
    let count = 0;
    if (node.agent === 'improve' && node.result?.fixed) {
      count += node.result.fixed.length;
    }
    if (node.children) {
      for (const child of node.children) {
        count += this.countIssuesFixed(child);
      }
    }
    return count;
  }
}
