/**
 * API Skill - OpenAPI-based API access via Restish
 *
 * Wraps the restish CLI to provide zero-code API integration
 * based on OpenAPI specifications.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../core/monitoring/logger.js';
import type { SkillResult } from './claude-skills.js';

export interface APIConfig {
  name: string;
  baseUrl: string;
  specUrl?: string;
  authType: 'none' | 'api-key' | 'oauth2' | 'basic';
  authConfig?: {
    headerName?: string;
    queryParam?: string;
    envVar?: string;
  };
  registeredAt: string;
  operations?: string[];
}

export interface APIRegistry {
  apis: Record<string, APIConfig>;
  version: string;
}

export class APISkill {
  private registryPath: string;
  private restishConfigPath: string;
  private registry: APIRegistry;

  constructor() {
    this.registryPath = path.join(
      os.homedir(),
      '.stackmemory',
      'api-registry.json'
    );
    // Platform-specific restish config path
    // Mac: ~/Library/Application Support/restish/apis.json
    // Linux: ~/.config/restish/apis.json
    // Windows: %AppData%/restish/apis.json
    this.restishConfigPath =
      process.platform === 'darwin'
        ? path.join(
            os.homedir(),
            'Library',
            'Application Support',
            'restish',
            'apis.json'
          )
        : path.join(os.homedir(), '.config', 'restish', 'apis.json');
    this.registry = this.loadRegistry();
  }

  private loadRegistry(): APIRegistry {
    try {
      if (fs.existsSync(this.registryPath)) {
        return JSON.parse(fs.readFileSync(this.registryPath, 'utf-8'));
      }
    } catch (error) {
      logger.warn('Failed to load API registry:', error);
    }
    return { apis: {}, version: '1.0.0' };
  }

  private saveRegistry(): void {
    const dir = path.dirname(this.registryPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.registryPath, JSON.stringify(this.registry, null, 2));
  }

  /**
   * Load restish config
   */
  private loadRestishConfig(): Record<string, unknown> {
    try {
      if (fs.existsSync(this.restishConfigPath)) {
        return JSON.parse(fs.readFileSync(this.restishConfigPath, 'utf-8'));
      }
    } catch (error) {
      logger.warn('Failed to load restish config:', error);
    }
    return {};
  }

  /**
   * Save restish config
   */
  private saveRestishConfig(config: Record<string, unknown>): void {
    const dir = path.dirname(this.restishConfigPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(this.restishConfigPath, JSON.stringify(config, null, 2));
  }

  /**
   * Check if restish is installed
   */
  private checkRestish(): boolean {
    try {
      execSync('which restish', { stdio: 'pipe' });
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Add/register a new API
   */
  async add(
    name: string,
    baseUrl: string,
    options?: {
      spec?: string;
      authType?: 'none' | 'api-key' | 'oauth2' | 'basic';
      headerName?: string;
      envVar?: string;
    }
  ): Promise<SkillResult> {
    if (!this.checkRestish()) {
      return {
        success: false,
        message: 'restish not installed. Run: brew install restish',
      };
    }

    try {
      // Configure restish for this API by writing directly to config
      const restishConfig = this.loadRestishConfig();

      // Build restish API config
      const apiConfig: Record<string, unknown> = {
        base: baseUrl,
      };

      // Add spec URL if provided for auto-discovery
      if (options?.spec) {
        apiConfig.spec_files = [options.spec];
      }

      // Add auth config based on type
      if (options?.authType === 'api-key' && options?.envVar) {
        apiConfig.profiles = {
          default: {
            headers: {
              [options.headerName || 'Authorization']: `$${options.envVar}`,
            },
          },
        };
      }

      restishConfig[name] = apiConfig;
      this.saveRestishConfig(restishConfig);

      // Store in our registry
      const config: APIConfig = {
        name,
        baseUrl,
        specUrl: options?.spec,
        authType: options?.authType || 'none',
        authConfig: {
          headerName: options?.headerName || 'Authorization',
          envVar: options?.envVar,
        },
        registeredAt: new Date().toISOString(),
      };

      // Skip sync during add - it can be slow due to network requests
      // Users can manually sync with: stackmemory api sync <name>
      if (options?.spec) {
        config.specUrl = options.spec;
      }

      this.registry.apis[name] = config;
      this.saveRegistry();

      return {
        success: true,
        message: `API '${name}' registered successfully`,
        data: {
          name,
          baseUrl,
          authType: config.authType,
          operations: config.operations?.length || 'auto-discovered',
        },
      };
    } catch (error) {
      logger.error('Failed to add API:', error);
      return {
        success: false,
        message: `Failed to register API: ${error.message}`,
      };
    }
  }

  /**
   * Discover available operations for an API
   */
  private discoverOperations(apiName: string): string[] {
    try {
      const output = execSync(`restish ${apiName} --help 2>&1`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      });

      // Parse operations from help output
      const operations: string[] = [];
      const lines = output.split('\n');
      let inCommands = false;

      for (const line of lines) {
        if (line.includes('Available Commands:')) {
          inCommands = true;
          continue;
        }
        if (inCommands && line.trim()) {
          const match = line.match(/^\s+(\S+)/);
          if (match && !line.includes('help')) {
            operations.push(match[1]);
          }
        }
        if (inCommands && line.includes('Flags:')) {
          break;
        }
      }

      return operations;
    } catch {
      return [];
    }
  }

  /**
   * List registered APIs
   */
  async list(): Promise<SkillResult> {
    const apis = Object.values(this.registry.apis);

    if (apis.length === 0) {
      return {
        success: true,
        message:
          'No APIs registered. Use /api add <name> <url> to register one.',
        data: [],
      };
    }

    return {
      success: true,
      message: `${apis.length} API(s) registered`,
      data: apis.map((api) => ({
        name: api.name,
        baseUrl: api.baseUrl,
        authType: api.authType,
        operations: api.operations?.length || 'unknown',
        registeredAt: api.registeredAt,
      })),
    };
  }

  /**
   * Show details for a specific API
   */
  async describe(apiName: string, operation?: string): Promise<SkillResult> {
    const api = this.registry.apis[apiName];

    if (!api) {
      // Try to get info directly from restish
      try {
        const output = execSync(`restish api show ${apiName}`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        return {
          success: true,
          message: `API '${apiName}' (from restish config)`,
          data: { raw: output },
        };
      } catch {
        return {
          success: false,
          message: `API '${apiName}' not found`,
        };
      }
    }

    if (operation) {
      // Get specific operation details
      try {
        const output = execSync(`restish ${apiName} ${operation} --help`, {
          encoding: 'utf-8',
          stdio: ['pipe', 'pipe', 'pipe'],
        });

        return {
          success: true,
          message: `Operation: ${apiName}.${operation}`,
          data: {
            operation,
            help: output,
          },
        };
      } catch {
        return {
          success: false,
          message: `Operation '${operation}' not found for API '${apiName}'`,
        };
      }
    }

    // Get all operations
    const operations = this.discoverOperations(apiName);
    api.operations = operations;
    this.saveRegistry();

    return {
      success: true,
      message: `API: ${apiName}`,
      data: {
        ...api,
        operations,
      },
    };
  }

  /**
   * Execute an API operation
   */
  async exec(
    apiName: string,
    operation: string,
    params?: Record<string, unknown>,
    options?: {
      raw?: boolean;
      filter?: string;
      headers?: Record<string, string>;
    }
  ): Promise<SkillResult> {
    if (!this.checkRestish()) {
      return {
        success: false,
        message: 'restish not installed. Run: brew install restish',
      };
    }

    const api = this.registry.apis[apiName];
    if (!api) {
      return {
        success: false,
        message: `API '${apiName}' not registered. Use /api add first.`,
      };
    }

    // Build the URL path from operation
    // e.g., "repos/owner/repo" or "/repos/owner/repo"
    const urlPath = operation.startsWith('/') ? operation : `/${operation}`;
    const fullUrl = `${api.baseUrl}${urlPath}`;

    // Build command using direct URL (more reliable than API names)
    const args: string[] = ['get', fullUrl];

    // Add options
    if (options?.raw) {
      args.push('--rsh-raw');
    }
    if (options?.filter) {
      args.push('--rsh-filter', options.filter);
    }

    // Add headers (including auth)
    if (api?.authConfig?.envVar) {
      const token = process.env[api.authConfig.envVar];
      if (token) {
        const headerName = api.authConfig.headerName || 'Authorization';
        args.push('-H', `${headerName}:${token}`);
      }
    }

    if (options?.headers) {
      for (const [key, value] of Object.entries(options.headers)) {
        args.push('-H', `${key}:${value}`);
      }
    }

    // Add query parameters
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        args.push('-q', `${key}=${String(value)}`);
      }
    }

    // Output as JSON
    args.push('-o', 'json');

    try {
      logger.info(`Executing: restish ${args.join(' ')}`);

      const output = execSync(`restish ${args.join(' ')}`, {
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
        env: process.env,
      });

      // Try to parse as JSON
      let data: unknown;
      try {
        data = JSON.parse(output);
      } catch {
        data = output;
      }

      return {
        success: true,
        message: `${apiName} ${operation} executed`,
        data,
      };
    } catch (error) {
      const stderr = error.stderr?.toString() || error.message;
      logger.error(`API exec failed:`, stderr);

      return {
        success: false,
        message: `API call failed: ${stderr}`,
      };
    }
  }

  /**
   * Configure authentication for an API
   */
  async auth(
    apiName: string,
    options: {
      token?: string;
      envVar?: string;
      oauth?: boolean;
      scopes?: string[];
    }
  ): Promise<SkillResult> {
    const api = this.registry.apis[apiName];

    if (!api) {
      return {
        success: false,
        message: `API '${apiName}' not registered. Use /api add first.`,
      };
    }

    if (options.token) {
      // Store token in env var (don't save to disk for security)
      const envVar = options.envVar || `${apiName.toUpperCase()}_API_KEY`;
      process.env[envVar] = options.token;

      api.authType = 'api-key';
      api.authConfig = {
        ...api.authConfig,
        envVar,
      };
      this.saveRegistry();

      return {
        success: true,
        message: `Auth configured for '${apiName}'. Token stored in ${envVar}`,
        data: { envVar },
      };
    }

    if (options.oauth) {
      // Use restish's OAuth flow
      try {
        const scopeArg = options.scopes
          ? `--scopes=${options.scopes.join(',')}`
          : '';
        execSync(`restish api configure ${apiName} --auth=oauth2 ${scopeArg}`, {
          stdio: 'inherit',
        });

        api.authType = 'oauth2';
        this.saveRegistry();

        return {
          success: true,
          message: `OAuth2 configured for '${apiName}'`,
        };
      } catch (error) {
        return {
          success: false,
          message: `OAuth setup failed: ${error.message}`,
        };
      }
    }

    return {
      success: false,
      message: 'Specify --token or --oauth',
    };
  }

  /**
   * Remove an API
   */
  async remove(apiName: string): Promise<SkillResult> {
    if (!this.registry.apis[apiName]) {
      return {
        success: false,
        message: `API '${apiName}' not found`,
      };
    }

    delete this.registry.apis[apiName];
    this.saveRegistry();

    return {
      success: true,
      message: `API '${apiName}' removed`,
    };
  }

  /**
   * Sync API spec (refresh operations)
   */
  async sync(apiName: string): Promise<SkillResult> {
    if (!this.checkRestish()) {
      return {
        success: false,
        message: 'restish not installed. Run: brew install restish',
      };
    }

    try {
      execSync(`restish api sync ${apiName}`, { stdio: 'pipe' });

      const operations = this.discoverOperations(apiName);

      if (this.registry.apis[apiName]) {
        this.registry.apis[apiName].operations = operations;
        this.saveRegistry();
      }

      return {
        success: true,
        message: `API '${apiName}' synced`,
        data: { operations },
      };
    } catch (error) {
      return {
        success: false,
        message: `Sync failed: ${error.message}`,
      };
    }
  }

  /**
   * Get help for the API skill
   */
  getHelp(): string {
    return `
/api - OpenAPI-based API access via Restish

Commands:
  /api add <name> <url> [--spec <url>] [--auth-type api-key|oauth2]
      Register a new API

  /api list
      List all registered APIs

  /api describe <name> [operation]
      Show API details or specific operation

  /api exec <name> <operation> [--param value...]
      Execute an API operation

  /api auth <name> --token <token> [--env-var NAME]
      Configure API authentication

  /api auth <name> --oauth [--scopes scope1,scope2]
      Configure OAuth2 authentication

  /api sync <name>
      Refresh API operations from spec

  /api remove <name>
      Remove a registered API

Examples:
  /api add github https://api.github.com --spec https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json
  /api auth github --token "$GITHUB_TOKEN"
  /api exec github repos list-for-user --username octocat
  /api exec github issues list --owner microsoft --repo vscode --state open

Built on restish (https://rest.sh) for automatic OpenAPI discovery.
`;
  }
}

// Singleton instance
let apiSkillInstance: APISkill | null = null;

export function getAPISkill(): APISkill {
  if (!apiSkillInstance) {
    apiSkillInstance = new APISkill();
  }
  return apiSkillInstance;
}
