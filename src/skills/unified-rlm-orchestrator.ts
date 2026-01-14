/**
 * Unified RLM-First Orchestrator for StackMemory
 *
 * All skills and tasks flow through RLM orchestration first,
 * ensuring consistent decomposition, parallel execution, and quality control.
 */

import {
  RecursiveAgentOrchestrator,
  type RLMOptions,
  type SubagentType,
  type ExecutionResult,
} from './recursive-agent-orchestrator.js';
import {
  ClaudeSkillsManager,
  type SkillContext,
  type SkillResult,
} from './claude-skills.js';
import { logger } from '../core/monitoring/logger.js';
import type { DualStackManager } from '../core/context/dual-stack-manager.js';
import type { ContextRetriever } from '../core/retrieval/context-retriever.js';
import type { FrameManager } from '../core/context/frame-manager.js';
import type { LinearTaskManager } from '../features/tasks/linear-task-manager.js';

// Skill to RLM mapping configuration
interface SkillToRLMConfig {
  skillName: string;
  primaryAgent: SubagentType;
  secondaryAgents?: SubagentType[];
  taskTemplate: string;
  defaultOptions?: Partial<RLMOptions>;
  preprocessor?: (
    args: string[],
    options: Record<string, unknown>
  ) => { task: string; context: Record<string, unknown> };
  postprocessor?: (result: ExecutionResult) => SkillResult;
}

/**
 * UnifiedRLMOrchestrator - Routes all skills through RLM first
 */
export class UnifiedRLMOrchestrator {
  private rlmOrchestrator: RecursiveAgentOrchestrator;
  private skillsManager: ClaudeSkillsManager;
  private skillMappings: Map<string, SkillToRLMConfig>;

  constructor(
    frameManager: FrameManager,
    dualStackManager: DualStackManager,
    contextRetriever: ContextRetriever,
    taskStore: LinearTaskManager,
    skillContext: SkillContext
  ) {
    // Initialize RLM orchestrator
    this.rlmOrchestrator = new RecursiveAgentOrchestrator(
      frameManager,
      dualStackManager,
      contextRetriever,
      taskStore
    );

    // Initialize skills manager (for legacy compatibility)
    this.skillsManager = new ClaudeSkillsManager(skillContext);

    // Initialize skill mappings
    this.skillMappings = this.initializeSkillMappings();

    logger.info('Unified RLM Orchestrator initialized with RLM-first routing');
  }

  /**
   * Initialize skill to RLM agent mappings
   */
  private initializeSkillMappings(): Map<string, SkillToRLMConfig> {
    const mappings = new Map<string, SkillToRLMConfig>();

    // Handoff skill -> Context + Planning agents
    mappings.set('handoff', {
      skillName: 'handoff',
      primaryAgent: 'context',
      secondaryAgents: ['planning'],
      taskTemplate:
        'Prepare comprehensive handoff to {targetUser}: {message}. Extract relevant context, identify dependencies, and create actionable items.',
      defaultOptions: {
        maxParallel: 3,
        reviewStages: 1,
        shareContextRealtime: true,
      },
      preprocessor: (args, options) => ({
        task: `Handoff to ${args[0]}: ${args[1]}`,
        context: {
          targetUser: args[0],
          message: args[1],
          priority: options.priority || 'medium',
          frames: options.frames || [],
        },
      }),
      postprocessor: (result) => ({
        success: result.success,
        message: `Handoff ${result.success ? 'completed' : 'failed'}`,
        data: result.rootNode.result,
      }),
    });

    // Checkpoint skill -> Context + Code agents
    mappings.set('checkpoint', {
      skillName: 'checkpoint',
      primaryAgent: 'context',
      secondaryAgents: ['code'],
      taskTemplate:
        'Create recovery checkpoint: {description}. Capture current state, identify risky operations, and backup critical files.',
      defaultOptions: {
        maxParallel: 2,
        reviewStages: 0,
        verboseLogging: false,
      },
      preprocessor: (args, options) => ({
        task: `${args[0]} checkpoint: ${args[1]}`,
        context: {
          operation: args[0],
          description: args[1],
          ...options,
        },
      }),
    });

    // Dig skill -> Context agent (deep search)
    mappings.set('dig', {
      skillName: 'dig',
      primaryAgent: 'context',
      taskTemplate:
        'Deep archaeological search: {query}. Analyze patterns, extract decisions, and build timeline.',
      defaultOptions: {
        maxParallel: 1,
        maxTokensPerAgent: 50000,
        reviewStages: 0,
      },
      preprocessor: (args, options) => ({
        task: `Archaeological dig: ${args[0]}`,
        context: {
          query: args[0],
          depth: options.depth || '30days',
          patterns: options.patterns,
          decisions: options.decisions,
          timeline: options.timeline,
        },
      }),
    });

    // Lint skill -> Linting agent primarily
    mappings.set('lint', {
      skillName: 'lint',
      primaryAgent: 'linting',
      secondaryAgents: ['improve'],
      taskTemplate:
        'Comprehensive linting of {path}: Check syntax, types, formatting, security, performance, and dead code. Provide fixes.',
      defaultOptions: {
        maxParallel: 1,
        reviewStages: 0,
        verboseLogging: true,
      },
      preprocessor: (args, options) => ({
        task: `Lint ${args[0] || 'current directory'}`,
        context: {
          path: args[0] || process.cwd(),
          fix: options.fix,
          focus: options.security
            ? 'security'
            : options.performance
              ? 'performance'
              : 'all',
        },
      }),
      postprocessor: (result) => {
        const lintingNode = this.findNodeByAgent(result.rootNode, 'linting');
        return {
          success: result.success,
          message: `Found ${result.issuesFound} issues, fixed ${result.issuesFixed}`,
          data: {
            issues: lintingNode?.result?.issues || [],
            fixes: lintingNode?.result?.fixes || [],
            stats: {
              found: result.issuesFound,
              fixed: result.issuesFixed,
              duration: result.duration,
            },
          },
        };
      },
    });

    // Test generation -> Testing agent
    mappings.set('test', {
      skillName: 'test',
      primaryAgent: 'testing',
      secondaryAgents: ['code', 'review'],
      taskTemplate:
        'Generate comprehensive {testMode} tests for {target}. Ensure high coverage and meaningful assertions.',
      defaultOptions: {
        maxParallel: 3,
        testGenerationMode: 'all',
        reviewStages: 2,
        qualityThreshold: 0.9,
      },
      preprocessor: (args, options) => ({
        task: `Generate tests for ${args[0] || 'project'}`,
        context: {
          target: args[0] || process.cwd(),
          testMode: options.mode || 'all',
          coverage: options.coverage || 'high',
        },
      }),
    });

    // Code review -> Review + Improve agents
    mappings.set('review', {
      skillName: 'review',
      primaryAgent: 'review',
      secondaryAgents: ['improve', 'testing'],
      taskTemplate:
        'Multi-stage code review of {target}. Analyze architecture, quality, performance, security. Suggest improvements.',
      defaultOptions: {
        maxParallel: 2,
        reviewStages: 3,
        qualityThreshold: 0.85,
        verboseLogging: true,
      },
      preprocessor: (args, options) => ({
        task: `Review code in ${args[0] || 'project'}`,
        context: {
          target: args[0] || process.cwd(),
          focus: options.focus || 'all',
          autofix: options.fix || false,
        },
      }),
    });

    // Refactor -> Code + Review + Improve agents
    mappings.set('refactor', {
      skillName: 'refactor',
      primaryAgent: 'code',
      secondaryAgents: ['review', 'improve', 'testing'],
      taskTemplate:
        'Refactor {target}: Improve architecture, reduce complexity, enhance maintainability. Preserve functionality.',
      defaultOptions: {
        maxParallel: 4,
        reviewStages: 2,
        qualityThreshold: 0.9,
        testGenerationMode: 'unit',
      },
      preprocessor: (args, options) => ({
        task: `Refactor ${args[0] || 'codebase'}`,
        context: {
          target: args[0] || process.cwd(),
          scope: options.scope || 'moderate',
          preserveApi: options.preserveApi !== false,
        },
      }),
    });

    // Deploy/Publish -> Publish agent
    mappings.set('publish', {
      skillName: 'publish',
      primaryAgent: 'publish',
      secondaryAgents: ['testing', 'linting'],
      taskTemplate:
        'Prepare and execute {publishType} release. Run tests, update versions, generate changelog, publish.',
      defaultOptions: {
        maxParallel: 1,
        reviewStages: 1,
        testGenerationMode: 'all',
      },
      preprocessor: (args, options) => ({
        task: `Publish ${options.type || 'npm'} release`,
        context: {
          version: args[0],
          publishType: options.type || 'npm',
          prerelease: options.prerelease || false,
          skipTests: options.skipTests || false,
        },
      }),
    });

    return mappings;
  }

  /**
   * Execute any skill through RLM orchestration first
   */
  async executeSkill(
    skillName: string,
    args: string[],
    options?: Record<string, unknown>
  ): Promise<SkillResult> {
    logger.info(`Executing skill through RLM: ${skillName}`, { args, options });

    // Check if skill has RLM mapping
    const mapping = this.skillMappings.get(skillName);

    if (mapping) {
      // Route through RLM orchestrator
      return this.executeViaRLM(mapping, args, options || {});
    }

    // Special case: Direct RLM execution
    if (skillName === 'rlm') {
      const task = args.join(' ') || 'Analyze and optimize current code';
      const result = await this.rlmOrchestrator.execute(
        task,
        options || {},
        options as RLMOptions
      );
      return {
        success: result.success,
        message: `RLM execution ${result.success ? 'completed' : 'failed'}`,
        data: result,
      };
    }

    // Fallback to legacy skill manager for unmapped skills
    logger.warn(`Skill ${skillName} not mapped to RLM, using legacy execution`);
    return this.skillsManager.executeSkill(skillName, args, options);
  }

  /**
   * Execute skill via RLM orchestration
   */
  private async executeViaRLM(
    mapping: SkillToRLMConfig,
    args: string[],
    options: Record<string, unknown>
  ): Promise<SkillResult> {
    try {
      // Preprocess arguments
      const { task, context } = mapping.preprocessor
        ? mapping.preprocessor(args, options)
        : {
            task: mapping.taskTemplate.replace('{args}', args.join(' ')),
            context: { args, ...options },
          };

      // Merge options
      const rlmOptions: RLMOptions = {
        ...mapping.defaultOptions,
        ...options,
        // Force specific agents if specified
        agents: [mapping.primaryAgent, ...(mapping.secondaryAgents || [])],
      };

      // Execute through RLM
      const result = await this.rlmOrchestrator.execute(
        task,
        context,
        rlmOptions
      );

      // Postprocess result
      if (mapping.postprocessor) {
        return mapping.postprocessor(result);
      }

      // Default postprocessing
      return {
        success: result.success,
        message: `${mapping.skillName} ${result.success ? 'completed' : 'failed'}`,
        data: {
          duration: result.duration,
          tokens: result.totalTokens,
          cost: result.totalCost,
          improvements: result.improvements,
          testsGenerated: result.testsGenerated,
          issuesFound: result.issuesFound,
          issuesFixed: result.issuesFixed,
          details: result.rootNode,
        },
      };
    } catch (error) {
      logger.error(`RLM execution failed for ${mapping.skillName}:`, error);
      return {
        success: false,
        message: `Failed to execute ${mapping.skillName}: ${error.message}`,
      };
    }
  }

  /**
   * Helper: Find node by agent type in task tree
   */
  private findNodeByAgent(
    node: ExecutionNode,
    agentType: SubagentType
  ): ExecutionNode | null {
    if (node.agent === agentType) {
      return node;
    }
    if (node.children) {
      for (const child of node.children) {
        const found = this.findNodeByAgent(child, agentType);
        if (found) return found;
      }
    }
    return null;
  }

  /**
   * Get available skills (all RLM-mapped + legacy)
   */
  getAvailableSkills(): string[] {
    const rlmSkills = Array.from(this.skillMappings.keys());
    const legacySkills = this.skillsManager.getAvailableSkills();
    const allSkills = new Set([...rlmSkills, ...legacySkills, 'rlm']);
    return Array.from(allSkills);
  }

  /**
   * Get skill help
   */
  getSkillHelp(skillName: string): string {
    const mapping = this.skillMappings.get(skillName);
    if (mapping) {
      return `
${skillName} (RLM-Orchestrated)
Primary Agent: ${mapping.primaryAgent}
Secondary Agents: ${mapping.secondaryAgents?.join(', ') || 'none'}

${mapping.taskTemplate}

This skill is executed through RLM orchestration for:
- Automatic task decomposition
- Parallel agent execution
- Multi-stage quality review
- Comprehensive result aggregation
`;
    }

    // Fallback to legacy help
    return this.skillsManager.getSkillHelp(skillName);
  }

  /**
   * Execute task with intelligent routing
   */
  async executeTask(
    task: string,
    context?: Record<string, unknown>
  ): Promise<SkillResult> {
    // Analyze task to determine best skill/agent combination
    const taskAnalysis = this.analyzeTask(task);

    if (taskAnalysis.suggestedSkill) {
      // Route to specific skill
      return this.executeSkill(
        taskAnalysis.suggestedSkill,
        taskAnalysis.args,
        taskAnalysis.options
      );
    }

    // Direct RLM execution for complex/ambiguous tasks
    const result = await this.rlmOrchestrator.execute(task, context || {}, {
      maxParallel: 5,
      reviewStages: 2,
      qualityThreshold: 0.85,
      verboseLogging: true,
    });

    return {
      success: result.success,
      message: `Task ${result.success ? 'completed' : 'failed'}`,
      data: result,
    };
  }

  /**
   * Analyze task to determine best routing
   */
  private analyzeTask(task: string): {
    suggestedSkill?: string;
    args: string[];
    options: Record<string, unknown>;
  } {
    const taskLower = task.toLowerCase();

    // Pattern matching for skill detection
    const patterns = [
      { pattern: /lint|format|style|quality/i, skill: 'lint' },
      { pattern: /test|coverage|unit|integration/i, skill: 'test' },
      { pattern: /review|analyze|improve/i, skill: 'review' },
      { pattern: /refactor|restructure|clean/i, skill: 'refactor' },
      { pattern: /handoff|transfer|pass/i, skill: 'handoff' },
      { pattern: /checkpoint|backup|save/i, skill: 'checkpoint' },
      { pattern: /search|find|dig|history/i, skill: 'dig' },
      { pattern: /publish|release|deploy/i, skill: 'publish' },
    ];

    for (const { pattern, skill } of patterns) {
      if (pattern.test(taskLower)) {
        return {
          suggestedSkill: skill,
          args: [task],
          options: {},
        };
      }
    }

    // No specific skill detected
    return {
      args: [task],
      options: {},
    };
  }
}

/**
 * Singleton instance for global access
 */
let unifiedOrchestrator: UnifiedRLMOrchestrator | null = null;

export function initializeUnifiedOrchestrator(
  frameManager: FrameManager,
  dualStackManager: DualStackManager,
  contextRetriever: ContextRetriever,
  taskStore: LinearTaskManager,
  skillContext: SkillContext
): UnifiedRLMOrchestrator {
  if (!unifiedOrchestrator) {
    unifiedOrchestrator = new UnifiedRLMOrchestrator(
      frameManager,
      dualStackManager,
      contextRetriever,
      taskStore,
      skillContext
    );
  }
  return unifiedOrchestrator;
}

export function getUnifiedOrchestrator(): UnifiedRLMOrchestrator | null {
  return unifiedOrchestrator;
}
