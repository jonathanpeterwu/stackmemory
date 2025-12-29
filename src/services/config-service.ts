import { Logger } from '../utils/logger.js';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';

export interface StackMemoryConfig {
  version?: string;
  projectId?: string;
  integrations?: {
    linear?: {
      enabled?: boolean;
      apiKey?: string;
      teamId?: string;
      projectId?: string;
      syncInterval?: number;
      webhookSecret?: string;
    };
  };
  webhook?: {
    port?: number;
    host?: string;
    ngrokSubdomain?: string;
  };
  features?: {
    autoSync?: boolean;
    realTimeSync?: boolean;
    conflictResolution?: 'manual' | 'auto' | 'prompt';
  };
}

export class ConfigService {
  private logger: Logger;
  private config: StackMemoryConfig = {};
  private configPath: string;

  constructor() {
    this.logger = new Logger('ConfigService');
    this.configPath = join(process.cwd(), '.stackmemory', 'config.json');
    this.loadConfig();
  }

  private loadConfig(): void {
    try {
      if (existsSync(this.configPath)) {
        const content = readFileSync(this.configPath, 'utf-8');
        this.config = JSON.parse(content);
        this.logger.debug('Loaded configuration', this.config);
      }
    } catch (error) {
      this.logger.warn('Failed to load configuration, using defaults', error);
    }
  }

  private saveConfig(): void {
    try {
      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
      this.logger.debug('Saved configuration');
    } catch (error) {
      this.logger.error('Failed to save configuration', error);
    }
  }

  public async getConfig(): Promise<StackMemoryConfig> {
    return this.config;
  }

  public async updateConfig(
    updates: Partial<StackMemoryConfig>
  ): Promise<void> {
    this.config = {
      ...this.config,
      ...updates,
    };
    this.saveConfig();
  }

  public async getLinearConfig() {
    return this.config.integrations?.linear || {};
  }

  public async updateLinearConfig(
    updates: Record<string, unknown>
  ): Promise<void> {
    if (!this.config.integrations) {
      this.config.integrations = {};
    }
    if (!this.config.integrations.linear) {
      this.config.integrations.linear = {};
    }

    this.config.integrations.linear = {
      ...this.config.integrations.linear,
      ...updates,
    };

    this.saveConfig();
  }
}
