/**
 * Tests for ClaudeCodeAgentBridge
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  ClaudeCodeAgentBridge,
  CLAUDE_CODE_AGENTS,
  ClaudeCodeAgent,
} from '../agent-bridge.js';

// Mock the oracle-worker-pattern module
vi.mock('../../ralph/patterns/oracle-worker-pattern.js', () => ({
  OracleWorkerCoordinator: class MockCoordinator {
    constructor() {}
  },
}));

describe('CLAUDE_CODE_AGENTS', () => {
  it('should define staff-architect as oracle', () => {
    const agent = CLAUDE_CODE_AGENTS['staff-architect'];

    expect(agent.type).toBe('oracle');
    expect(agent.complexity).toBe('very_high');
    expect(agent.capabilities).toContain('system_design');
    expect(agent.capabilities).toContain('architectural_planning');
  });

  it('should define product-manager as oracle', () => {
    const agent = CLAUDE_CODE_AGENTS['product-manager'];

    expect(agent.type).toBe('oracle');
    expect(agent.capabilities).toContain('product_strategy');
    expect(agent.capabilities).toContain('roadmap_planning');
  });

  it('should define general-purpose as worker', () => {
    const agent = CLAUDE_CODE_AGENTS['general-purpose'];

    expect(agent.type).toBe('worker');
    expect(agent.costMultiplier).toBeLessThan(1);
    expect(agent.capabilities).toContain('code_implementation');
    expect(agent.capabilities).toContain('debugging');
  });

  it('should define code-reviewer as reviewer', () => {
    const agent = CLAUDE_CODE_AGENTS['code-reviewer'];

    expect(agent.type).toBe('reviewer');
    expect(agent.capabilities).toContain('code_review');
    expect(agent.capabilities).toContain('security_analysis');
  });

  it('should define debugger as worker', () => {
    const agent = CLAUDE_CODE_AGENTS['debugger'];

    expect(agent.type).toBe('worker');
    expect(agent.capabilities).toContain('error_analysis');
    expect(agent.capabilities).toContain('debugging');
    expect(agent.capabilities).toContain('root_cause_analysis');
  });

  it('should define qa-workflow-validator as worker', () => {
    const agent = CLAUDE_CODE_AGENTS['qa-workflow-validator'];

    expect(agent.type).toBe('worker');
    expect(agent.capabilities).toContain('workflow_validation');
    expect(agent.capabilities).toContain('test_execution');
  });

  it('should define merge-coordinator as worker', () => {
    const agent = CLAUDE_CODE_AGENTS['merge-coordinator'];

    expect(agent.type).toBe('worker');
    expect(agent.capabilities).toContain('merge_coordination');
    expect(agent.capabilities).toContain('conflict_resolution');
  });

  it('should define github-workflow as worker', () => {
    const agent = CLAUDE_CODE_AGENTS['github-workflow'];

    expect(agent.type).toBe('worker');
    expect(agent.capabilities).toContain('git_operations');
    expect(agent.capabilities).toContain('pr_creation');
  });

  it('should have consistent agent structure', () => {
    for (const [name, agent] of Object.entries(CLAUDE_CODE_AGENTS)) {
      expect(agent.name).toBe(name);
      expect(agent.type).toMatch(/^(oracle|worker|reviewer)$/);
      expect(agent.description).toBeDefined();
      expect(Array.isArray(agent.capabilities)).toBe(true);
      expect(agent.capabilities.length).toBeGreaterThan(0);
      expect(typeof agent.costMultiplier).toBe('number');
      expect(agent.complexity).toMatch(/^(low|medium|high|very_high)$/);
      expect(Array.isArray(agent.specializations)).toBe(true);
    }
  });

  it('should have oracle agents with higher cost multiplier', () => {
    const oracleAgents = Object.values(CLAUDE_CODE_AGENTS).filter(
      (a) => a.type === 'oracle'
    );
    const workerAgents = Object.values(CLAUDE_CODE_AGENTS).filter(
      (a) => a.type === 'worker'
    );

    const avgOracleCost =
      oracleAgents.reduce((sum, a) => sum + a.costMultiplier, 0) /
      oracleAgents.length;
    const avgWorkerCost =
      workerAgents.reduce((sum, a) => sum + a.costMultiplier, 0) /
      workerAgents.length;

    expect(avgOracleCost).toBeGreaterThan(avgWorkerCost);
  });
});

describe('ClaudeCodeAgentBridge', () => {
  let bridge: ClaudeCodeAgentBridge;

  beforeEach(() => {
    bridge = new ClaudeCodeAgentBridge();
  });

  describe('constructor', () => {
    it('should create bridge instance', () => {
      expect(bridge).toBeInstanceOf(ClaudeCodeAgentBridge);
    });
  });

  describe('getAvailableAgents', () => {
    it('should return agents grouped by type', () => {
      const agents = bridge.getAvailableAgents();

      expect(agents.oracles).toContain('staff-architect');
      expect(agents.oracles).toContain('product-manager');
      expect(agents.workers).toContain('general-purpose');
      expect(agents.workers).toContain('debugger');
      expect(agents.reviewers).toContain('code-reviewer');
    });

    it('should not mix agent types', () => {
      const agents = bridge.getAvailableAgents();

      // Verify oracles are only oracle type
      for (const oracleName of agents.oracles) {
        const agent = CLAUDE_CODE_AGENTS[oracleName];
        expect(agent.type).toBe('oracle');
      }

      // Verify workers are only worker type
      for (const workerName of agents.workers) {
        const agent = CLAUDE_CODE_AGENTS[workerName];
        expect(agent.type).toBe('worker');
      }

      // Verify reviewers are only reviewer type
      for (const reviewerName of agents.reviewers) {
        const agent = CLAUDE_CODE_AGENTS[reviewerName];
        expect(agent.type).toBe('reviewer');
      }
    });
  });

  describe('launchClaudeCodeSwarm', () => {
    it('should launch swarm with explicit agents', async () => {
      const swarmId = await bridge.launchClaudeCodeSwarm(
        'Test project description',
        {
          oracleAgent: 'staff-architect',
          workerAgents: ['general-purpose'],
          reviewerAgents: ['code-reviewer'],
        }
      );

      expect(swarmId).toBeDefined();
      expect(typeof swarmId).toBe('string');
    }, 30000);

    it('should throw for invalid oracle agent', async () => {
      await expect(
        bridge.launchClaudeCodeSwarm('Test', {
          oracleAgent: 'nonexistent-oracle',
          workerAgents: ['general-purpose'],
          reviewerAgents: ['code-reviewer'],
        })
      ).rejects.toThrow("Oracle agent 'nonexistent-oracle' not found");
    });

    it('should throw for invalid worker agent', async () => {
      await expect(
        bridge.launchClaudeCodeSwarm('Test', {
          oracleAgent: 'staff-architect',
          workerAgents: ['nonexistent-worker'],
          reviewerAgents: ['code-reviewer'],
        })
      ).rejects.toThrow("Worker agent 'nonexistent-worker' not found");
    });

    it('should throw when using worker as oracle', async () => {
      await expect(
        bridge.launchClaudeCodeSwarm('Test', {
          oracleAgent: 'general-purpose', // This is a worker, not oracle
          workerAgents: ['debugger'],
          reviewerAgents: ['code-reviewer'],
        })
      ).rejects.toThrow('is not an Oracle-level agent');
    });

    it('should throw when using reviewer as worker', async () => {
      await expect(
        bridge.launchClaudeCodeSwarm('Test', {
          oracleAgent: 'staff-architect',
          workerAgents: ['code-reviewer'], // This is a reviewer, not worker
          reviewerAgents: ['code-reviewer'],
        })
      ).rejects.toThrow('is not a Worker-level agent');
    });
  });
});

describe('ClaudeCodeAgent interface', () => {
  it('should validate agent structure', () => {
    const validAgent: ClaudeCodeAgent = {
      name: 'test-agent',
      type: 'worker',
      description: 'Test agent description',
      capabilities: ['capability1', 'capability2'],
      costMultiplier: 0.5,
      complexity: 'medium',
      specializations: ['spec1'],
    };

    expect(validAgent.name).toBeDefined();
    expect(validAgent.type).toBeDefined();
    expect(validAgent.description).toBeDefined();
    expect(validAgent.capabilities).toBeDefined();
    expect(validAgent.costMultiplier).toBeDefined();
    expect(validAgent.complexity).toBeDefined();
    expect(validAgent.specializations).toBeDefined();
  });
});
