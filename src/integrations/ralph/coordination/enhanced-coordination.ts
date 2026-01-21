/**
 * Enhanced Agent Coordination System
 * Provides advanced coordination patterns, conflict resolution, and inter-agent communication
 */

import { EventEmitter } from 'events';
import { logger } from '../../../core/monitoring/logger.js';
import { Agent, SwarmTask, CoordinationEvent } from '../types.js';

export interface CoordinationMessage {
  id: string;
  from: string; // agent ID
  to: string[] | 'broadcast'; // agent IDs or broadcast
  type:
    | 'status_update'
    | 'help_request'
    | 'resource_conflict'
    | 'task_handoff'
    | 'knowledge_share';
  content: any;
  timestamp: number;
  priority: 'low' | 'normal' | 'high' | 'urgent';
}

export interface TaskDependency {
  taskId: string;
  dependsOn: string[];
  blockingFor: string[];
  estimatedCompletionTime: number;
  criticalPath: boolean;
}

export interface ConflictResolution {
  id: string;
  type: 'resource' | 'task_overlap' | 'knowledge_conflict' | 'priority_dispute';
  involvedAgents: string[];
  description: string;
  resolutionStrategy:
    | 'voting'
    | 'expertise_based'
    | 'random'
    | 'manager_override';
  resolution: any;
  timestamp: number;
  status: 'pending' | 'resolved' | 'escalated';
}

export class EnhancedCoordinationSystem extends EventEmitter {
  private agents: Map<string, Agent> = new Map();
  private messageQueue: CoordinationMessage[] = [];
  private dependencies: Map<string, TaskDependency> = new Map();
  private conflicts: Map<string, ConflictResolution> = new Map();
  private coordinationRules: CoordinationRule[] = [];

  constructor() {
    super();
    this.setupDefaultRules();
  }

  /**
   * Register an agent with the coordination system
   */
  registerAgent(agent: Agent): void {
    this.agents.set(agent.id, agent);
    logger.info(`Agent ${agent.role} registered for coordination`);

    // Notify other agents
    this.broadcastMessage({
      id: this.generateId(),
      from: 'system',
      to: 'broadcast',
      type: 'status_update',
      content: { type: 'agent_joined', agent: agent.role },
      timestamp: Date.now(),
      priority: 'normal',
    });
  }

  /**
   * Send message between agents
   */
  sendMessage(message: Omit<CoordinationMessage, 'id' | 'timestamp'>): void {
    const fullMessage: CoordinationMessage = {
      ...message,
      id: this.generateId(),
      timestamp: Date.now(),
    };

    this.messageQueue.push(fullMessage);
    this.routeMessage(fullMessage);
    this.emit('messageReceived', fullMessage);
  }

  /**
   * Broadcast message to all agents
   */
  broadcastMessage(
    message: Omit<CoordinationMessage, 'id' | 'timestamp'>
  ): void {
    this.sendMessage({
      ...message,
      to: 'broadcast',
    });
  }

  /**
   * Request help from other agents
   */
  requestHelp(fromAgent: string, helpType: string, context: any): void {
    const suitableAgents = this.findSuitableHelpers(helpType);

    this.sendMessage({
      from: fromAgent,
      to: suitableAgents,
      type: 'help_request',
      content: {
        helpType,
        context,
        requesterCapabilities: this.agents.get(fromAgent)?.capabilities || [],
      },
      priority: 'high',
    });
  }

  /**
   * Add task dependency
   */
  addDependency(dependency: TaskDependency): void {
    this.dependencies.set(dependency.taskId, dependency);
    this.updateCriticalPath();
    logger.info(
      `Added dependency: ${dependency.taskId} depends on ${dependency.dependsOn.join(', ')}`
    );
  }

  /**
   * Resolve conflicts automatically
   */
  async resolveConflict(conflictId: string): Promise<boolean> {
    const conflict = this.conflicts.get(conflictId);
    if (!conflict) return false;

    try {
      switch (conflict.resolutionStrategy) {
        case 'voting':
          conflict.resolution = await this.resolveByVoting(conflict);
          break;
        case 'expertise_based':
          conflict.resolution = await this.resolveByExpertise(conflict);
          break;
        case 'random':
          conflict.resolution = await this.resolveRandomly(conflict);
          break;
        case 'manager_override':
          conflict.resolution = await this.resolveByManagerOverride(conflict);
          break;
      }

      conflict.status = 'resolved';
      this.conflicts.set(conflictId, conflict);

      // Notify agents of resolution
      this.broadcastMessage({
        from: 'system',
        to: conflict.involvedAgents,
        type: 'status_update',
        content: {
          type: 'conflict_resolved',
          conflictId,
          resolution: conflict.resolution,
        },
        priority: 'high',
      });

      return true;
    } catch (error) {
      conflict.status = 'escalated';
      logger.error(`Failed to resolve conflict ${conflictId}:`, error as Error);
      return false;
    }
  }

  /**
   * Get optimal task execution order considering dependencies
   */
  getOptimalExecutionOrder(tasks: SwarmTask[]): SwarmTask[] {
    const graph = this.buildDependencyGraph(tasks);
    return this.topologicalSort(graph, tasks);
  }

  /**
   * Detect and report coordination patterns
   */
  analyzeCoordinationPatterns(): {
    communicationFrequency: Map<string, number>;
    helpRequestPatterns: any[];
    conflictFrequency: Map<string, number>;
    bottlenecks: string[];
  } {
    const patterns = {
      communicationFrequency: new Map<string, number>(),
      helpRequestPatterns: [],
      conflictFrequency: new Map<string, number>(),
      bottlenecks: this.identifyBottlenecks(),
    };

    // Analyze message patterns
    for (const message of this.messageQueue) {
      const key = `${message.from}-${message.type}`;
      patterns.communicationFrequency.set(
        key,
        (patterns.communicationFrequency.get(key) || 0) + 1
      );
    }

    // Analyze conflicts
    for (const conflict of this.conflicts.values()) {
      patterns.conflictFrequency.set(
        conflict.type,
        (patterns.conflictFrequency.get(conflict.type) || 0) + 1
      );
    }

    return patterns;
  }

  /**
   * Load balancing recommendations
   */
  getLoadBalancingRecommendations(): {
    overloadedAgents: string[];
    underutilizedAgents: string[];
    suggestedReassignments: Array<{
      fromAgent: string;
      toAgent: string;
      taskType: string;
      reason: string;
    }>;
  } {
    const recommendations = {
      overloadedAgents: [],
      underutilizedAgents: [],
      suggestedReassignments: [],
    };

    // Analyze agent workloads
    for (const agent of this.agents.values()) {
      const workload = this.calculateAgentWorkload(agent);

      if (workload > 0.8) {
        recommendations.overloadedAgents.push(agent.id);
      } else if (workload < 0.3) {
        recommendations.underutilizedAgents.push(agent.id);
      }
    }

    // Generate reassignment suggestions
    for (const overloaded of recommendations.overloadedAgents) {
      for (const underutilized of recommendations.underutilizedAgents) {
        const compatibility = this.checkAgentCompatibility(
          overloaded,
          underutilized
        );
        if (compatibility.score > 0.7) {
          recommendations.suggestedReassignments.push({
            fromAgent: overloaded,
            toAgent: underutilized,
            taskType: compatibility.bestTaskType,
            reason: `Load balancing: ${compatibility.reason}`,
          });
        }
      }
    }

    return recommendations;
  }

  private routeMessage(message: CoordinationMessage): void {
    if (message.to === 'broadcast') {
      // Route to all agents except sender
      for (const agentId of this.agents.keys()) {
        if (agentId !== message.from) {
          this.deliverMessage(agentId, message);
        }
      }
    } else {
      // Route to specific agents
      for (const agentId of message.to as string[]) {
        this.deliverMessage(agentId, message);
      }
    }

    // Apply coordination rules
    this.applyCoordinationRules(message);
  }

  private deliverMessage(agentId: string, message: CoordinationMessage): void {
    const agent = this.agents.get(agentId);
    if (agent) {
      // Store message for agent (in real implementation, would integrate with agent's message handler)
      logger.debug(`Message delivered to ${agent.role}: ${message.type}`);
    }
  }

  private findSuitableHelpers(helpType: string): string[] {
    const helpers: string[] = [];

    for (const agent of this.agents.values()) {
      if (this.canProvideHelp(agent, helpType)) {
        helpers.push(agent.id);
      }
    }

    return helpers;
  }

  private canProvideHelp(agent: Agent, helpType: string): boolean {
    // Check if agent has relevant capabilities
    const capabilities = agent.capabilities || [];

    switch (helpType) {
      case 'code_review':
        return (
          capabilities.includes('code_review') || agent.role === 'reviewer'
        );
      case 'debugging':
        return capabilities.includes('debugging') || agent.role === 'developer';
      case 'testing':
        return capabilities.includes('testing') || agent.role === 'tester';
      case 'optimization':
        return (
          capabilities.includes('optimization') || agent.role === 'optimizer'
        );
      default:
        return false;
    }
  }

  private async resolveByVoting(conflict: ConflictResolution): Promise<any> {
    // Simulate voting resolution
    const votes = new Map();
    for (const agentId of conflict.involvedAgents) {
      const agent = this.agents.get(agentId);
      if (agent) {
        // In real implementation, would request vote from agent
        votes.set(agentId, Math.random() > 0.5 ? 'option_a' : 'option_b');
      }
    }

    // Count votes
    const results = new Map();
    for (const vote of votes.values()) {
      results.set(vote, (results.get(vote) || 0) + 1);
    }

    // Return winning option
    return Array.from(results.entries()).reduce((a, b) =>
      a[1] > b[1] ? a : b
    )[0];
  }

  private async resolveByExpertise(conflict: ConflictResolution): Promise<any> {
    // Find most expert agent for the conflict type
    let bestAgent = null;
    let bestExpertise = 0;

    for (const agentId of conflict.involvedAgents) {
      const agent = this.agents.get(agentId);
      if (agent) {
        const expertise = this.calculateExpertise(agent, conflict.type);
        if (expertise > bestExpertise) {
          bestExpertise = expertise;
          bestAgent = agent;
        }
      }
    }

    return {
      resolutionSource: bestAgent?.id,
      method: 'expertise_based',
      expertiseScore: bestExpertise,
    };
  }

  private async resolveRandomly(conflict: ConflictResolution): Promise<any> {
    const options = ['option_a', 'option_b', 'compromise'];
    return options[Math.floor(Math.random() * options.length)];
  }

  private async resolveByManagerOverride(
    conflict: ConflictResolution
  ): Promise<any> {
    // Find coordinator or architect agent
    const manager = Array.from(this.agents.values()).find(
      (agent) => agent.role === 'coordinator' || agent.role === 'architect'
    );

    return {
      resolutionSource: manager?.id || 'system',
      method: 'manager_override',
    };
  }

  private calculateExpertise(agent: Agent, conflictType: string): number {
    // Calculate agent expertise for specific conflict type
    const capabilities = agent.capabilities || [];
    const performance = agent.performance;

    let expertise = 0;

    // Base expertise from capabilities
    switch (conflictType) {
      case 'resource':
        expertise += capabilities.includes('resource_optimization') ? 0.5 : 0;
        break;
      case 'task_overlap':
        expertise += capabilities.includes('coordination') ? 0.5 : 0;
        break;
    }

    // Add performance-based expertise
    if (performance) {
      expertise += performance.successRate * 0.3;
      expertise += Math.min(performance.tasksCompleted / 10, 0.2);
    }

    return Math.min(expertise, 1.0);
  }

  private buildDependencyGraph(tasks: SwarmTask[]): Map<string, string[]> {
    const graph = new Map<string, string[]>();

    for (const task of tasks) {
      const deps = this.dependencies.get(task.id);
      graph.set(task.id, deps?.dependsOn || []);
    }

    return graph;
  }

  private topologicalSort(
    graph: Map<string, string[]>,
    tasks: SwarmTask[]
  ): SwarmTask[] {
    const result: SwarmTask[] = [];
    const visited = new Set<string>();
    const visiting = new Set<string>();

    const visit = (taskId: string) => {
      if (visited.has(taskId)) return;
      if (visiting.has(taskId)) {
        logger.warn(`Circular dependency detected involving task: ${taskId}`);
        return;
      }

      visiting.add(taskId);
      const deps = graph.get(taskId) || [];

      for (const dep of deps) {
        visit(dep);
      }

      visiting.delete(taskId);
      visited.add(taskId);

      const task = tasks.find((t) => t.id === taskId);
      if (task) result.push(task);
    };

    for (const task of tasks) {
      visit(task.id);
    }

    return result;
  }

  private updateCriticalPath(): void {
    // Identify critical path through dependencies
    // Implementation would use network analysis algorithms
    logger.debug('Critical path updated');
  }

  private identifyBottlenecks(): string[] {
    const bottlenecks: string[] = [];

    // Find tasks with many dependencies
    for (const [taskId, dep] of this.dependencies) {
      if (dep.blockingFor.length > 2) {
        bottlenecks.push(taskId);
      }
    }

    return bottlenecks;
  }

  private calculateAgentWorkload(agent: Agent): number {
    // Calculate workload based on current tasks, message frequency, etc.
    let workload = 0;

    if (agent.status === 'active') workload += 0.5;
    if (agent.currentTask) workload += 0.3;

    // Add message handling workload
    const recentMessages = this.messageQueue.filter(
      (m) =>
        (m.from === agent.id ||
          (Array.isArray(m.to) && m.to.includes(agent.id))) &&
        Date.now() - m.timestamp < 300000 // 5 minutes
    );

    workload += Math.min(recentMessages.length * 0.05, 0.2);

    return Math.min(workload, 1.0);
  }

  private checkAgentCompatibility(
    agent1Id: string,
    agent2Id: string
  ): {
    score: number;
    bestTaskType: string;
    reason: string;
  } {
    const agent1 = this.agents.get(agent1Id);
    const agent2 = this.agents.get(agent2Id);

    if (!agent1 || !agent2) {
      return { score: 0, bestTaskType: '', reason: 'Agent not found' };
    }

    // Check capability overlap
    const caps1 = new Set(agent1.capabilities || []);
    const caps2 = new Set(agent2.capabilities || []);
    const overlap = new Set([...caps1].filter((x) => caps2.has(x)));

    const score = overlap.size / Math.max(caps1.size, caps2.size, 1);

    return {
      score,
      bestTaskType: Array.from(overlap)[0] || 'general',
      reason: `Capability overlap: ${overlap.size} common skills`,
    };
  }

  private applyCoordinationRules(message: CoordinationMessage): void {
    for (const rule of this.coordinationRules) {
      if (rule.condition(message)) {
        rule.action(message, this);
      }
    }
  }

  private setupDefaultRules(): void {
    this.coordinationRules = [
      {
        id: 'help_request_timeout',
        condition: (msg) => msg.type === 'help_request',
        action: (msg, system) => {
          // Auto-escalate help requests after timeout
          setTimeout(() => {
            system.broadcastMessage({
              from: 'system',
              to: 'broadcast',
              type: 'status_update',
              content: {
                type: 'help_request_timeout',
                originalRequest: msg.id,
              },
              priority: 'urgent',
            });
          }, 300000); // 5 minutes
        },
      },
    ];
  }

  private generateId(): string {
    return `coord_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

interface CoordinationRule {
  id: string;
  condition: (message: CoordinationMessage) => boolean;
  action: (
    message: CoordinationMessage,
    system: EnhancedCoordinationSystem
  ) => void;
}

export default EnhancedCoordinationSystem;
