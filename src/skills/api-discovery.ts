/**
 * API Auto-Discovery Skill
 *
 * Automatically detects API endpoints and OpenAPI specs when Claude
 * reads documentation or API URLs, then registers them for easy access.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../core/monitoring/logger.js';
import { getAPISkill } from './api-skill.js';

// Common API documentation patterns
const API_PATTERNS = [
  // Direct API URLs
  {
    pattern: /https?:\/\/api\.([a-z0-9-]+)\.(com|io|dev|app|co)/,
    nameGroup: 1,
  },
  // REST API paths in docs
  { pattern: /https?:\/\/([a-z0-9-]+)\.com\/api/, nameGroup: 1 },
  // Developer docs
  { pattern: /https?:\/\/developer\.([a-z0-9-]+)\.com/, nameGroup: 1 },
  // Docs subdomains
  { pattern: /https?:\/\/docs\.([a-z0-9-]+)\.(com|io|dev)/, nameGroup: 1 },
];

// Known OpenAPI spec locations for popular services
const KNOWN_SPECS: Record<string, string> = {
  github:
    'https://raw.githubusercontent.com/github/rest-api-description/main/descriptions/api.github.com/api.github.com.json',
  stripe:
    'https://raw.githubusercontent.com/stripe/openapi/master/openapi/spec3.json',
  twilio:
    'https://raw.githubusercontent.com/twilio/twilio-oai/main/spec/json/twilio_api_v2010.json',
  slack: 'https://api.slack.com/specs/openapi/v2/slack_web.json',
  discord:
    'https://raw.githubusercontent.com/discord/discord-api-spec/main/specs/openapi.json',
  openai:
    'https://raw.githubusercontent.com/openai/openai-openapi/master/openapi.yaml',
  anthropic:
    'https://raw.githubusercontent.com/anthropics/anthropic-sdk-python/main/openapi.json',
  linear: 'https://api.linear.app/graphql', // GraphQL, not REST
  notion:
    'https://raw.githubusercontent.com/NotionX/notion-sdk-js/main/openapi.json',
  vercel: 'https://openapi.vercel.sh/',
  cloudflare:
    'https://raw.githubusercontent.com/cloudflare/api-schemas/main/openapi.json',
  // Google Cloud Platform - uses Google Discovery format
  gcp: 'https://www.googleapis.com/discovery/v1/apis',
  'gcp-compute': 'https://compute.googleapis.com/$discovery/rest?version=v1',
  'gcp-storage': 'https://storage.googleapis.com/$discovery/rest?version=v1',
  'gcp-run': 'https://run.googleapis.com/$discovery/rest?version=v2',
  'gcp-functions':
    'https://cloudfunctions.googleapis.com/$discovery/rest?version=v2',
  'gcp-bigquery': 'https://bigquery.googleapis.com/$discovery/rest?version=v2',
  'gcp-aiplatform':
    'https://aiplatform.googleapis.com/$discovery/rest?version=v1',
  // Railway - GraphQL API
  railway: 'https://backboard.railway.com/graphql/v2', // GraphQL endpoint
};

// Known base URLs for popular services
const KNOWN_BASES: Record<string, string> = {
  github: 'https://api.github.com',
  stripe: 'https://api.stripe.com',
  twilio: 'https://api.twilio.com',
  slack: 'https://slack.com/api',
  discord: 'https://discord.com/api',
  openai: 'https://api.openai.com',
  anthropic: 'https://api.anthropic.com',
  linear: 'https://api.linear.app',
  notion: 'https://api.notion.com',
  vercel: 'https://api.vercel.com',
  cloudflare: 'https://api.cloudflare.com',
  // Google Cloud Platform
  gcp: 'https://www.googleapis.com',
  'gcp-compute': 'https://compute.googleapis.com',
  'gcp-storage': 'https://storage.googleapis.com',
  'gcp-run': 'https://run.googleapis.com',
  'gcp-functions': 'https://cloudfunctions.googleapis.com',
  'gcp-bigquery': 'https://bigquery.googleapis.com',
  'gcp-aiplatform': 'https://aiplatform.googleapis.com',
  // Railway (GraphQL)
  railway: 'https://backboard.railway.com/graphql/v2',
};

// API types for special handling
const API_TYPES: Record<string, 'rest' | 'graphql' | 'google-discovery'> = {
  railway: 'graphql',
  linear: 'graphql',
  gcp: 'google-discovery',
  'gcp-compute': 'google-discovery',
  'gcp-storage': 'google-discovery',
  'gcp-run': 'google-discovery',
  'gcp-functions': 'google-discovery',
  'gcp-bigquery': 'google-discovery',
  'gcp-aiplatform': 'google-discovery',
};

export interface DiscoveredAPI {
  name: string;
  baseUrl: string;
  specUrl?: string;
  source: 'url' | 'docs' | 'known' | 'inferred';
  confidence: number; // 0-1
  apiType?: 'rest' | 'graphql' | 'google-discovery';
}

export interface DiscoveryResult {
  discovered: DiscoveredAPI[];
  registered: string[];
  skipped: string[];
}

export class APIDiscoverySkill {
  private discoveryLog: string;
  private discoveredAPIs: Map<string, DiscoveredAPI> = new Map();

  constructor() {
    this.discoveryLog = path.join(
      os.homedir(),
      '.stackmemory',
      'api-discovery.log'
    );
  }

  /**
   * Analyze a URL for potential API endpoints
   */
  analyzeUrl(url: string): DiscoveredAPI | null {
    // Check for GCP URLs first (special pattern)
    if (url.includes('googleapis.com')) {
      const gcpMatch = url.match(/https?:\/\/([a-z]+)\.googleapis\.com/);
      if (gcpMatch) {
        const service = gcpMatch[1];
        const name = `gcp-${service}`;
        return {
          name,
          baseUrl: `https://${service}.googleapis.com`,
          specUrl:
            KNOWN_SPECS[name] ||
            `https://${service}.googleapis.com/$discovery/rest?version=v1`,
          source: 'known',
          confidence: 0.95,
          apiType: 'google-discovery',
        };
      }
    }

    // Check for Railway
    if (url.includes('railway.com') || url.includes('railway.app')) {
      return {
        name: 'railway',
        baseUrl: KNOWN_BASES['railway'],
        specUrl: KNOWN_SPECS['railway'],
        source: 'known',
        confidence: 0.95,
        apiType: 'graphql',
      };
    }

    // Check if it's a known service
    for (const [name, baseUrl] of Object.entries(KNOWN_BASES)) {
      if (url.includes(name) || url.includes(baseUrl)) {
        return {
          name,
          baseUrl,
          specUrl: KNOWN_SPECS[name],
          source: 'known',
          confidence: 0.95,
          apiType: API_TYPES[name] || 'rest',
        };
      }
    }

    // Try to match API patterns
    for (const { pattern, nameGroup } of API_PATTERNS) {
      const match = url.match(pattern);
      if (match) {
        const name = match[nameGroup].toLowerCase();
        const baseUrl = this.inferBaseUrl(url, name);

        return {
          name,
          baseUrl,
          source: 'inferred',
          confidence: 0.7,
          apiType: 'rest',
        };
      }
    }

    return null;
  }

  /**
   * Infer base URL from a discovered URL
   */
  private inferBaseUrl(url: string, name: string): string {
    // Try common patterns
    const patterns = [
      `https://api.${name}.com`,
      `https://api.${name}.io`,
      `https://${name}.com/api`,
    ];

    // Extract domain from URL
    try {
      const urlObj = new URL(url);
      if (urlObj.hostname.startsWith('api.')) {
        return `${urlObj.protocol}//${urlObj.hostname}`;
      }
      if (urlObj.pathname.includes('/api')) {
        return `${urlObj.protocol}//${urlObj.hostname}/api`;
      }
      return `${urlObj.protocol}//${urlObj.hostname}`;
    } catch {
      return patterns[0];
    }
  }

  /**
   * Try to discover OpenAPI spec for a service
   */
  async discoverSpec(name: string, baseUrl: string): Promise<string | null> {
    // Check known specs first
    if (KNOWN_SPECS[name]) {
      return KNOWN_SPECS[name];
    }

    // Try common spec locations
    const specPaths = [
      '/openapi.json',
      '/openapi.yaml',
      '/swagger.json',
      '/swagger.yaml',
      '/api-docs',
      '/v1/openapi.json',
      '/v2/openapi.json',
      '/docs/openapi.json',
      '/.well-known/openapi.json',
    ];

    for (const specPath of specPaths) {
      const specUrl = `${baseUrl}${specPath}`;
      try {
        // Quick HEAD request to check if spec exists
        execSync(`curl -sI --max-time 2 "${specUrl}" | grep -q "200 OK"`, {
          stdio: 'pipe',
        });
        return specUrl;
      } catch {
        // Spec not found at this location
      }
    }

    return null;
  }

  /**
   * Process a URL and auto-register if it's an API
   */
  async processUrl(
    url: string,
    autoRegister: boolean = true
  ): Promise<DiscoveredAPI | null> {
    const discovered = this.analyzeUrl(url);

    if (!discovered) {
      return null;
    }

    // Check if already discovered
    const existing = this.discoveredAPIs.get(discovered.name);
    if (existing) {
      return existing;
    }

    // Only probe for spec if it's not a known service (known services already have spec URLs)
    if (!discovered.specUrl && discovered.source !== 'known') {
      // Try to find OpenAPI spec (with timeout protection)
      try {
        discovered.specUrl =
          (await this.discoverSpec(discovered.name, discovered.baseUrl)) ||
          undefined;
      } catch {
        // Spec discovery failed, continue without
      }
    }

    this.discoveredAPIs.set(discovered.name, discovered);
    this.logDiscovery(discovered, url);

    // Auto-register if enabled and confidence is high enough
    if (autoRegister && discovered.confidence >= 0.7) {
      await this.registerAPI(discovered);
    }

    return discovered;
  }

  /**
   * Register a discovered API
   */
  async registerAPI(api: DiscoveredAPI): Promise<boolean> {
    const skill = getAPISkill();

    try {
      const result = await skill.add(api.name, api.baseUrl, {
        spec: api.specUrl,
      });

      if (result.success) {
        logger.info(`Auto-registered API: ${api.name}`);
        return true;
      }
    } catch (error) {
      logger.warn(`Failed to auto-register API ${api.name}:`, error);
    }

    return false;
  }

  /**
   * Log discovery for debugging
   */
  private logDiscovery(api: DiscoveredAPI, sourceUrl: string): void {
    const entry = {
      timestamp: new Date().toISOString(),
      api,
      sourceUrl,
    };

    try {
      const dir = path.dirname(this.discoveryLog);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      fs.appendFileSync(this.discoveryLog, JSON.stringify(entry) + '\n');
    } catch (error) {
      logger.warn('Failed to log API discovery:', error);
    }
  }

  /**
   * Get all discovered APIs
   */
  getDiscoveredAPIs(): DiscoveredAPI[] {
    return Array.from(this.discoveredAPIs.values());
  }

  /**
   * Suggest API registration based on recent activity
   */
  async suggestFromContext(recentUrls: string[]): Promise<DiscoveryResult> {
    const result: DiscoveryResult = {
      discovered: [],
      registered: [],
      skipped: [],
    };

    for (const url of recentUrls) {
      const discovered = await this.processUrl(url, false);

      if (discovered) {
        result.discovered.push(discovered);

        // Check if already registered
        const skill = getAPISkill();
        const listResult = await skill.list();
        const existingAPIs = (listResult.data as Array<{ name: string }>) || [];

        if (existingAPIs.some((api) => api.name === discovered.name)) {
          result.skipped.push(discovered.name);
        } else if (discovered.confidence >= 0.7) {
          const registered = await this.registerAPI(discovered);
          if (registered) {
            result.registered.push(discovered.name);
          }
        }
      }
    }

    return result;
  }

  /**
   * Get help text
   */
  getHelp(): string {
    const restAPIs = Object.keys(KNOWN_SPECS).filter(
      (s) => !API_TYPES[s] || API_TYPES[s] === 'rest'
    );
    const graphqlAPIs = Object.keys(KNOWN_SPECS).filter(
      (s) => API_TYPES[s] === 'graphql'
    );
    const gcpAPIs = Object.keys(KNOWN_SPECS).filter(
      (s) => API_TYPES[s] === 'google-discovery'
    );

    return `
API Auto-Discovery

Automatically detects and registers APIs when you browse documentation.

REST APIs (OpenAPI specs):
${restAPIs.map((s) => `  - ${s}`).join('\n')}

GraphQL APIs:
${graphqlAPIs.map((s) => `  - ${s}`).join('\n')}

Google Cloud Platform (Discovery format):
${gcpAPIs.map((s) => `  - ${s}`).join('\n')}

How It Works:
1. Monitors URLs you access during development
2. Identifies API documentation and endpoints
3. Finds OpenAPI specs automatically
4. Registers APIs for easy access via /api exec

Usage:
  # Check if a URL is a known API
  stackmemory api discover <url>

  # List discovered APIs
  stackmemory api discovered

  # Register all discovered APIs
  stackmemory api register-discovered
`;
  }
}

// Singleton instance
let discoveryInstance: APIDiscoverySkill | null = null;

export function getAPIDiscovery(): APIDiscoverySkill {
  if (!discoveryInstance) {
    discoveryInstance = new APIDiscoverySkill();
  }
  return discoveryInstance;
}
