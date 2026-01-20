/**
 * Swarm Coordination System for StackMemory
 * Orchestrates multiple specialized agents working together on the same codebase
 * Addresses multi-agent coordination challenges with role specialization and dynamic planning
 */

import { v4 as uuidv4 } from 'uuid';
import { logger } from '../../../core/monitoring/logger.js';
import { FrameManager } from '../../../core/context/frame-manager.js';
import { sessionManager } from '../../../core/session/index.js';
import { sharedContextLayer } from '../../../core/context/shared-context-layer.js';
import { RalphStackMemoryBridge } from '../bridge/ralph-stackmemory-bridge.js';
import {
  SwarmConfiguration,
  Agent,
  AgentRole,
  SwarmTask,
  CoordinationEvent,
  SwarmState,
  TaskAllocation,
  AgentSpecialization
} from '../types.js';

export interface SwarmCoordinatorConfig {
  maxAgents: number;
  coordinationInterval: number;
  driftDetectionThreshold: number;
  freshStartInterval: number;
  conflictResolutionStrategy: 'democratic' | 'hierarchical' | 'expertise';
  enableDynamicPlanning: boolean;
  pathologicalBehaviorDetection: boolean;
}

export class SwarmCoordinator {
  private frameManager?: FrameManager;
  private activeAgents: Map<string, Agent> = new Map();
  private swarmState: SwarmState;
  private config: SwarmCoordinatorConfig;
  private coordinationTimer?: NodeJS.Timeout;
  private plannerWakeupQueue: Map<string, () => void> = new Map();

  constructor(config?: Partial<SwarmCoordinatorConfig>) {
    this.config = {
      maxAgents: 10,
      coordinationInterval: 30000, // 30 seconds
      driftDetectionThreshold: 5, // 5 failed iterations before considering drift
      freshStartInterval: 3600000, // 1 hour
      conflictResolutionStrategy: 'expertise',
      enableDynamicPlanning: true,
      pathologicalBehaviorDetection: true,
      ...config
    };

    this.swarmState = {
      id: uuidv4(),
      status: 'idle',
      startTime: Date.now(),
      activeTaskCount: 0,
      completedTaskCount: 0,
      coordination: {
        events: [],
        conflicts: [],
        resolutions: []
      },
      performance: {
        throughput: 0,
        efficiency: 0,
        coordination_overhead: 0
      }
    };

    logger.info('Swarm coordinator initialized', this.config);
  }

  async initialize(): Promise<void> {
    try {
      await sessionManager.initialize();
      await sharedContextLayer.initialize();

      const session = await sessionManager.getOrCreateSession({});
      if (session.database) {
        this.frameManager = new FrameManager(session.database, session.projectId);
      }

      // Start coordination monitoring
      this.startCoordinationLoop();

      logger.info('Swarm coordinator initialized successfully');
    } catch (error: unknown) {
      logger.error('Failed to initialize swarm coordinator', error as Error);
      throw error;
    }
  }

  /**
   * Launch a swarm of agents to work on a complex project
   */
  async launchSwarm(
    projectDescription: string,
    agents: AgentSpecialization[],
    coordination?: SwarmConfiguration
  ): Promise<string> {
    logger.info('Launching swarm', {
      project: projectDescription.substring(0, 100),
      agentCount: agents.length
    });

    const swarmId = uuidv4();
    
    try {
      // 1. Validate swarm configuration
      if (agents.length > this.config.maxAgents) {
        throw new Error(`Too many agents requested: ${agents.length} > ${this.config.maxAgents}`);
      }

      // 2. Break down project into swarm tasks
      const swarmTasks = await this.decomposeProjectIntoSwarmTasks(projectDescription);

      // 3. Initialize specialized agents
      const initializedAgents = await this.initializeSpecializedAgents(agents, swarmTasks);

      // 4. Create task allocation plan
      const allocation = await this.allocateTasksToAgents(swarmTasks, initializedAgents);

      // 5. Begin swarm execution
      this.swarmState = {
        ...this.swarmState,
        id: swarmId,
        status: 'active',
        activeTaskCount: swarmTasks.length,
        project: projectDescription,
        agents: initializedAgents,
        tasks: swarmTasks,
        allocation
      };

      // 6. Start agent execution
      await this.executeSwarmTasks(allocation);

      logger.info('Swarm launched successfully', { swarmId, agentCount: initializedAgents.length });
      return swarmId;

    } catch (error: unknown) {
      logger.error('Failed to launch swarm', error as Error);
      throw error;
    }
  }

  /**
   * Decompose project into tasks suitable for swarm execution
   */
  private async decomposeProjectIntoSwarmTasks(projectDescription: string): Promise<SwarmTask[]> {
    const tasks: SwarmTask[] = [];
    
    // Analyze project complexity and decompose based on patterns
    const complexity = this.analyzeProjectComplexity(projectDescription);
    
    // Pattern 1: Architecture and Planning
    if (complexity.needsArchitecture) {
      tasks.push({
        id: uuidv4(),
        type: 'architecture',
        title: 'System Architecture Design',
        description: 'Design overall system architecture and component relationships',
        priority: 1,
        estimatedEffort: 'high',
        requiredRoles: ['architect', 'system_designer'],
        dependencies: [],
        acceptanceCriteria: [
          'Architecture diagram created',
          'Component interfaces defined',
          'Data flow documented'
        ]
      });
    }

    // Pattern 2: Core Implementation Tasks
    const coreFeatures = this.extractCoreFeatures(projectDescription);
    for (const feature of coreFeatures) {
      tasks.push({
        id: uuidv4(),
        type: 'implementation',
        title: `Implement ${feature.name}`,
        description: feature.description,
        priority: 2,
        estimatedEffort: feature.complexity,
        requiredRoles: ['developer', feature.specialization || 'fullstack'],
        dependencies: complexity.needsArchitecture ? [tasks[0].id] : [],
        acceptanceCriteria: feature.criteria
      });
    }

    // Pattern 3: Testing and Validation
    if (complexity.needsTesting) {
      tasks.push({
        id: uuidv4(),
        type: 'testing',
        title: 'Comprehensive Testing Suite',
        description: 'Create unit, integration, and end-to-end tests',
        priority: 3,
        estimatedEffort: 'medium',
        requiredRoles: ['qa_engineer', 'test_automation'],
        dependencies: tasks.filter(t => t.type === 'implementation').map(t => t.id),
        acceptanceCriteria: [
          'Unit tests achieve >90% coverage',
          'Integration tests pass',
          'Performance benchmarks met'
        ]
      });
    }

    // Pattern 4: Documentation and Polish
    if (complexity.needsDocumentation) {
      tasks.push({
        id: uuidv4(),
        type: 'documentation',
        title: 'Documentation and Examples',
        description: 'Create user documentation, API docs, and usage examples',
        priority: 4,
        estimatedEffort: 'low',
        requiredRoles: ['technical_writer', 'developer'],
        dependencies: [], // Can run in parallel
        acceptanceCriteria: [
          'README with setup instructions',
          'API documentation complete',
          'Usage examples provided'
        ]
      });
    }

    return tasks;
  }

  /**
   * Initialize specialized agents with role-specific configurations
   */
  private async initializeSpecializedAgents(
    specifications: AgentSpecialization[],
    tasks: SwarmTask[]
  ): Promise<Agent[]> {
    const agents: Agent[] = [];

    for (const spec of specifications) {
      const agent: Agent = {
        id: uuidv4(),
        role: spec.role,
        specialization: spec,
        status: 'initializing',
        capabilities: this.defineCapabilities(spec.role),
        workingDirectory: `.swarm/${spec.role}-${Date.now()}`,
        currentTask: null,
        performance: {
          tasksCompleted: 0,
          successRate: 1.0,
          averageTaskTime: 0,
          driftDetected: false,
          lastFreshStart: Date.now()
        },
        coordination: {
          communicationStyle: this.defineCommuncationStyle(spec.role),
          conflictResolution: spec.conflictResolution || 'defer_to_expertise',
          collaborationPreferences: spec.collaborationPreferences || []
        }
      };

      // Initialize agent's working environment
      await this.setupAgentEnvironment(agent);

      // Configure role-specific prompting strategies
      await this.configureAgentPrompts(agent);

      agents.push(agent);
      this.activeAgents.set(agent.id, agent);
    }

    logger.info(`Initialized ${agents.length} specialized agents`);
    return agents;
  }

  /**
   * Allocate tasks to agents based on specialization and workload
   */
  private async allocateTasksToAgents(
    tasks: SwarmTask[],
    agents: Agent[]
  ): Promise<TaskAllocation> {
    const allocation: TaskAllocation = {
      assignments: new Map(),
      loadBalancing: 'capability_based',
      conflictResolution: this.config.conflictResolutionStrategy
    };

    // Sort tasks by priority and dependencies
    const sortedTasks = this.topologicalSort(tasks);

    for (const task of sortedTasks) {
      // Find best-suited agents for this task
      const suitableAgents = agents.filter(agent =>
        task.requiredRoles.some(role => this.agentCanHandle(agent, role))
      );

      if (suitableAgents.length === 0) {
        logger.warn(`No suitable agents found for task: ${task.title}`);
        continue;
      }

      // Select agent based on workload and expertise
      const selectedAgent = this.selectOptimalAgent(suitableAgents, task);
      
      allocation.assignments.set(task.id, {
        agentId: selectedAgent.id,
        taskId: task.id,
        assignedAt: Date.now(),
        estimatedCompletion: Date.now() + this.estimateTaskDuration(task),
        coordination: {
          collaborators: this.findCollaborators(selectedAgent, task, agents),
          reviewers: this.findReviewers(selectedAgent, task, agents)
        }
      });

      // Update agent workload
      selectedAgent.currentTask = task.id;
    }

    return allocation;
  }

  /**
   * Execute swarm tasks with coordination
   */
  private async executeSwarmTasks(allocation: TaskAllocation): Promise<void> {
    const executionPromises: Promise<void>[] = [];

    for (const [taskId, assignment] of allocation.assignments) {
      const agent = this.activeAgents.get(assignment.agentId);
      const task = this.swarmState.tasks?.find(t => t.id === taskId);

      if (!agent || !task) continue;

      // Create execution promise for each agent
      const executionPromise = this.executeAgentTask(agent, task, assignment);
      executionPromises.push(executionPromise);
    }

    // Monitor all executions
    await Promise.allSettled(executionPromises);
  }

  /**
   * Execute a single agent task with coordination
   */
  private async executeAgentTask(
    agent: Agent,
    task: SwarmTask,
    assignment: any
  ): Promise<void> {
    logger.info(`Agent ${agent.role} starting task: ${task.title}`);

    try {
      agent.status = 'active';
      
      // Create Ralph loop for this agent/task
      const ralph = new RalphStackMemoryBridge({
        baseDir: path.join(agent.workingDirectory, task.id),
        maxIterations: this.calculateMaxIterations(task),
        useStackMemory: true
      });

      // Initialize with context from other agents
      const contextualPrompt = await this.synthesizeContextualPrompt(agent, task);
      
      await ralph.initialize({
        task: contextualPrompt,
        criteria: task.acceptanceCriteria.join('\n')
      });

      // Set up coordination hooks
      this.setupAgentCoordination(agent, ralph, assignment);

      // Run the task
      await ralph.run();

      // Update performance metrics
      this.updateAgentPerformance(agent, true);
      
      // Notify planners and collaborators
      await this.notifyTaskCompletion(agent, task, true);

      agent.status = 'idle';
      logger.info(`Agent ${agent.role} completed task: ${task.title}`);

    } catch (error: unknown) {
      logger.error(`Agent ${agent.role} failed task: ${task.title}`, error as Error);
      
      // Update performance metrics
      this.updateAgentPerformance(agent, false);
      
      // Trigger conflict resolution or reassignment
      await this.handleTaskFailure(agent, task, error as Error);
      
      agent.status = 'error';
    }
  }

  /**
   * Synthesize contextual prompt incorporating swarm knowledge
   */
  private async synthesizeContextualPrompt(agent: Agent, task: SwarmTask): Promise<string> {
    const basePrompt = task.description;
    const roleSpecificInstructions = this.getRoleSpecificInstructions(agent.role);
    const swarmContext = await this.getSwarmContext(task);
    const coordinationInstructions = this.getCoordinationInstructions(agent);

    return `
${roleSpecificInstructions}

TASK: ${basePrompt}

SWARM CONTEXT:
${swarmContext}

COORDINATION GUIDELINES:
${coordinationInstructions}

Remember:
- You are part of a swarm working on: ${this.swarmState.project}
- Other agents are working on related tasks
- Communicate findings through StackMemory shared context
- Focus on your specialization while being aware of the bigger picture
- Detect and avoid pathological behaviors (infinite loops, tunnel vision)
- Request fresh starts if you detect drift in your approach

ACCEPTANCE CRITERIA:
${task.acceptanceCriteria.map(c => `- ${c}`).join('\n')}
`;
  }

  /**
   * Start coordination monitoring loop
   */
  private startCoordinationLoop(): void {
    this.coordinationTimer = setInterval(() => {
      this.performCoordinationCycle().catch(error => {
        logger.error('Coordination cycle failed', error as Error);
      });
    }, this.config.coordinationInterval);
  }

  /**
   * Perform coordination cycle
   */
  private async performCoordinationCycle(): Promise<void> {
    if (this.swarmState.status !== 'active') return;

    logger.debug('Performing coordination cycle');

    // 1. Detect pathological behaviors
    if (this.config.pathologicalBehaviorDetection) {
      await this.detectPathologicalBehaviors();
    }

    // 2. Check for task completion and wake planners
    if (this.config.enableDynamicPlanning) {
      await this.wakeUpPlanners();
    }

    // 3. Resolve conflicts
    await this.resolveActiveConflicts();

    // 4. Rebalance workload if needed
    await this.rebalanceWorkload();

    // 5. Trigger fresh starts if needed
    await this.triggerFreshStartsIfNeeded();

    // 6. Update swarm performance metrics
    this.updateSwarmMetrics();
  }

  /**
   * Detect pathological behaviors in agents
   */
  private async detectPathologicalBehaviors(): Promise<void> {
    for (const agent of this.activeAgents.values()) {
      if (agent.status !== 'active') continue;

      // Check for drift (repeated failures)
      if (agent.performance.driftDetected) {
        logger.warn(`Drift detected in agent ${agent.role}, triggering fresh start`);
        await this.triggerFreshStart(agent);
        continue;
      }

      // Check for tunnel vision (same approach repeated)
      if (await this.detectTunnelVision(agent)) {
        logger.warn(`Tunnel vision detected in agent ${agent.role}, providing alternative approach`);
        await this.provideAlternativeApproach(agent);
      }

      // Check for excessive runtime (running too long)
      if (await this.detectExcessiveRuntime(agent)) {
        logger.warn(`Excessive runtime detected in agent ${agent.role}, requesting checkpoint`);
        await this.requestCheckpoint(agent);
      }
    }
  }

  /**
   * Wake up planners when their tasks complete
   */
  private async wakeUpPlanners(): Promise<void> {
    for (const [agentId, wakeupCallback] of this.plannerWakeupQueue) {
      const agent = this.activeAgents.get(agentId);
      if (!agent || agent.status !== 'idle') continue;

      logger.info(`Waking up planner agent: ${agent.role}`);
      wakeupCallback();
      this.plannerWakeupQueue.delete(agentId);
    }
  }

  // Helper methods for role specialization and coordination
  private defineCapabilities(role: AgentRole): string[] {
    const capabilityMap: Record<AgentRole, string[]> = {
      'architect': ['system_design', 'component_modeling', 'architecture_validation'],
      'planner': ['task_decomposition', 'dependency_analysis', 'resource_planning'],
      'developer': ['code_implementation', 'debugging', 'refactoring'],
      'reviewer': ['code_review', 'quality_assessment', 'best_practice_enforcement'],
      'tester': ['test_design', 'automation', 'validation'],
      'optimizer': ['performance_analysis', 'resource_optimization', 'bottleneck_identification'],
      'documenter': ['technical_writing', 'api_documentation', 'example_creation'],
      'coordinator': ['task_coordination', 'conflict_resolution', 'progress_tracking']
    };

    return capabilityMap[role] || [];
  }

  private defineCommuncationStyle(role: AgentRole): string {
    const styleMap: Record<AgentRole, string> = {
      'architect': 'high_level_design_focused',
      'planner': 'structured_and_methodical',
      'developer': 'implementation_focused',
      'reviewer': 'quality_focused_constructive',
      'tester': 'validation_focused',
      'optimizer': 'performance_metrics_focused',
      'documenter': 'clarity_focused',
      'coordinator': 'facilitative_and_diplomatic'
    };

    return styleMap[role] || 'collaborative';
  }

  private getRoleSpecificInstructions(role: AgentRole): string {
    const instructionMap: Record<AgentRole, string> = {
      'architect': `
You are a SYSTEM ARCHITECT. Your role is to:
- Design high-level system architecture
- Define component interfaces and relationships
- Ensure architectural consistency across the project
- Think in terms of scalability, maintainability, and extensibility
- Collaborate with developers to validate feasibility`,

      'planner': `
You are a PROJECT PLANNER. Your role is to:
- Break down complex tasks into manageable steps
- Identify dependencies and critical path
- Coordinate with other agents on sequencing
- Wake up when tasks complete to plan next steps
- Adapt plans based on actual progress`,

      'developer': `
You are a SPECIALIZED DEVELOPER. Your role is to:
- Implement features according to specifications
- Write clean, maintainable code
- Follow established patterns and conventions
- Integrate with other components
- Communicate implementation details clearly`,

      'reviewer': `
You are a CODE REVIEWER. Your role is to:
- Review code for quality, correctness, and best practices
- Provide constructive feedback
- Ensure consistency with project standards
- Identify potential issues before they become problems
- Approve or request changes`,

      'tester': `
You are a QA ENGINEER. Your role is to:
- Design comprehensive test strategies
- Implement automated tests
- Validate functionality and performance
- Report bugs clearly and reproducibly
- Ensure quality gates are met`,

      'optimizer': `
You are a PERFORMANCE OPTIMIZER. Your role is to:
- Analyze system performance and identify bottlenecks
- Implement optimizations
- Monitor resource usage
- Establish performance benchmarks
- Ensure scalability requirements are met`,

      'documenter': `
You are a TECHNICAL WRITER. Your role is to:
- Create clear, comprehensive documentation
- Write API documentation and usage examples
- Ensure documentation stays up-to-date
- Focus on user experience and clarity
- Collaborate with developers to understand features`,

      'coordinator': `
You are a PROJECT COORDINATOR. Your role is to:
- Facilitate communication between agents
- Resolve conflicts and blockers
- Track overall project progress
- Ensure no tasks fall through cracks
- Maintain project timeline and quality`
    };

    return instructionMap[role] || 'You are a specialized agent contributing to a larger project.';
  }

  // Additional helper methods would be implemented here...
  private analyzeProjectComplexity(description: string): any {
    // Analyze project description to determine decomposition strategy
    return {
      needsArchitecture: description.length > 500 || description.includes('system') || description.includes('platform'),
      needsTesting: true, // Almost all projects need testing
      needsDocumentation: description.includes('API') || description.includes('library'),
      complexity: 'medium'
    };
  }

  private extractCoreFeatures(description: string): any[] {
    // Extract core features from project description
    // This would use NLP in a real implementation
    return [{
      name: 'Core Feature',
      description: 'Main functionality implementation',
      complexity: 'medium',
      criteria: ['Feature works correctly', 'Handles edge cases', 'Follows coding standards']
    }];
  }

  // Implement remaining helper methods...
  [Symbol.toStringTag] = 'SwarmCoordinator';
}

// Export default instance
export const swarmCoordinator = new SwarmCoordinator();