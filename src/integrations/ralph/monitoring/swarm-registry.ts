/**
 * Global swarm registry for tracking active swarms
 * Allows TUI to connect to running swarms
 */

import { EventEmitter } from 'events';
import { SwarmCoordinator } from '../swarm/swarm-coordinator.js';
import { logger } from '../../../core/monitoring/logger.js';

export interface RegisteredSwarm {
  id: string;
  coordinator: SwarmCoordinator;
  startTime: number;
  status: 'active' | 'idle' | 'completed' | 'error';
  description: string;
}

export class SwarmRegistry extends EventEmitter {
  private static instance: SwarmRegistry | null = null;
  private swarms: Map<string, RegisteredSwarm> = new Map();
  
  private constructor() {
    super();
    logger.info('SwarmRegistry initialized');
  }

  static getInstance(): SwarmRegistry {
    if (!SwarmRegistry.instance) {
      SwarmRegistry.instance = new SwarmRegistry();
    }
    return SwarmRegistry.instance;
  }

  /**
   * Register a swarm coordinator
   */
  registerSwarm(coordinator: SwarmCoordinator, description: string): string {
    const swarmId = this.generateSwarmId();
    
    const registration: RegisteredSwarm = {
      id: swarmId,
      coordinator,
      startTime: Date.now(),
      status: 'active',
      description
    };
    
    this.swarms.set(swarmId, registration);
    this.emit('swarmRegistered', registration);
    
    logger.info(`Swarm registered: ${swarmId} - ${description}`);
    return swarmId;
  }

  /**
   * Unregister a swarm
   */
  unregisterSwarm(swarmId: string): void {
    const swarm = this.swarms.get(swarmId);
    if (swarm) {
      this.swarms.delete(swarmId);
      this.emit('swarmUnregistered', { id: swarmId });
      logger.info(`Swarm unregistered: ${swarmId}`);
    }
  }

  /**
   * Get a specific swarm by ID
   */
  getSwarm(swarmId: string): RegisteredSwarm | null {
    return this.swarms.get(swarmId) || null;
  }

  /**
   * List all active swarms
   */
  listActiveSwarms(): RegisteredSwarm[] {
    return Array.from(this.swarms.values()).filter(
      swarm => swarm.status === 'active'
    );
  }

  /**
   * Update swarm status
   */
  updateSwarmStatus(swarmId: string, status: 'active' | 'idle' | 'completed' | 'error'): void {
    const swarm = this.swarms.get(swarmId);
    if (swarm) {
      swarm.status = status;
      this.emit('swarmStatusChanged', { id: swarmId, status });
      logger.debug(`Swarm ${swarmId} status updated: ${status}`);
    }
  }

  /**
   * Get swarm statistics
   */
  getStatistics(): {
    totalSwarms: number;
    activeSwarms: number;
    completedSwarms: number;
    averageUptime: number;
  } {
    const active = this.listActiveSwarms();
    const completed = Array.from(this.swarms.values()).filter(s => s.status === 'completed');
    
    const totalUptime = active.reduce((sum, swarm) => 
      sum + (Date.now() - swarm.startTime), 0
    );
    
    return {
      totalSwarms: this.swarms.size,
      activeSwarms: active.length,
      completedSwarms: completed.length,
      averageUptime: active.length > 0 ? totalUptime / active.length : 0
    };
  }

  private generateSwarmId(): string {
    return `swarm_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  }
}

export default SwarmRegistry;