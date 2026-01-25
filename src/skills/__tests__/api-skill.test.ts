/**
 * Tests for API Skill
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { APISkill, getAPISkill, type APIConfig } from '../api-skill.js';
import { APIDiscoverySkill, getAPIDiscovery } from '../api-discovery.js';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Mock the logger
vi.mock('../../core/monitoring/logger.js', () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock execSync for restish commands
vi.mock('child_process', async () => {
  const actual = await vi.importActual('child_process');
  return {
    ...actual,
    execSync: vi.fn((cmd: string) => {
      if (cmd.includes('which restish')) {
        return '/opt/homebrew/bin/restish';
      }
      if (cmd.includes('restish') && cmd.includes('--help')) {
        return `
Available Commands:
  get       Get a resource
  list      List resources
  help      Help about any command

Flags:
  -h, --help   help for restish
`;
      }
      if (cmd.includes('restish') && cmd.includes('-o json')) {
        return JSON.stringify({ status: 'ok', data: [] });
      }
      throw new Error(`Command not mocked: ${cmd}`);
    }),
  };
});

describe('APISkill', () => {
  let apiSkill: APISkill;
  let tempDir: string;
  let originalRegistryPath: string;
  let originalRestishPath: string;

  beforeEach(() => {
    // Create temp directory for tests
    tempDir = path.join(os.tmpdir(), `api-skill-test-${Date.now()}`);
    fs.mkdirSync(tempDir, { recursive: true });

    // Create fresh instance
    apiSkill = new APISkill();

    // Override paths for testing
    originalRegistryPath = (apiSkill as any).registryPath;
    originalRestishPath = (apiSkill as any).restishConfigPath;
    (apiSkill as any).registryPath = path.join(tempDir, 'api-registry.json');
    (apiSkill as any).restishConfigPath = path.join(tempDir, 'apis.json');

    // Reset the registry with empty data (since constructor already loaded real registry)
    (apiSkill as any).registry = { apis: {}, version: '1.0.0' };
  });

  afterEach(() => {
    vi.clearAllMocks();
    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }
  });

  describe('add', () => {
    it('should add a new API', async () => {
      const result = await apiSkill.add('test-api', 'https://api.test.com', {
        authType: 'api-key',
        headerName: 'X-API-Key',
        envVar: 'TEST_API_KEY',
      });

      expect(result.success).toBe(true);
      expect(result.message).toContain("API 'test-api' registered");
      expect(result.data).toMatchObject({
        name: 'test-api',
        baseUrl: 'https://api.test.com',
        authType: 'api-key',
      });
    });

    it('should add API with spec URL', async () => {
      const result = await apiSkill.add('github', 'https://api.github.com', {
        spec: 'https://example.com/openapi.json',
      });

      expect(result.success).toBe(true);

      // Verify registry was updated
      const registryPath = (apiSkill as any).registryPath;
      const registry = JSON.parse(fs.readFileSync(registryPath, 'utf-8'));
      expect(registry.apis.github.specUrl).toBe(
        'https://example.com/openapi.json'
      );
    });
  });

  describe('list', () => {
    it('should list empty APIs', async () => {
      const result = await apiSkill.list();

      expect(result.success).toBe(true);
      expect(result.message).toContain('No APIs registered');
      expect(result.data).toEqual([]);
    });

    it('should list registered APIs', async () => {
      // Add some APIs first
      await apiSkill.add('api1', 'https://api1.com');
      await apiSkill.add('api2', 'https://api2.com');

      const result = await apiSkill.list();

      expect(result.success).toBe(true);
      expect(result.message).toBe('2 API(s) registered');
      expect(result.data).toHaveLength(2);
    });
  });

  describe('describe', () => {
    it('should return error for non-existent API', async () => {
      const result = await apiSkill.describe('nonexistent');

      expect(result.success).toBe(false);
      expect(result.message).toContain("API 'nonexistent' not found");
    });

    it('should describe registered API', async () => {
      await apiSkill.add('test-api', 'https://api.test.com');

      const result = await apiSkill.describe('test-api');

      expect(result.success).toBe(true);
      expect(result.message).toBe('API: test-api');
      expect(result.data).toMatchObject({
        name: 'test-api',
        baseUrl: 'https://api.test.com',
      });
    });
  });

  describe('remove', () => {
    it('should remove API', async () => {
      await apiSkill.add('to-remove', 'https://api.remove.com');

      const result = await apiSkill.remove('to-remove');

      expect(result.success).toBe(true);
      expect(result.message).toBe("API 'to-remove' removed");

      // Verify it's removed from list
      const listResult = await apiSkill.list();
      expect(listResult.data).toEqual([]);
    });

    it('should return error for non-existent API', async () => {
      const result = await apiSkill.remove('nonexistent');

      expect(result.success).toBe(false);
      expect(result.message).toContain('not found');
    });
  });

  describe('getHelp', () => {
    it('should return help text', () => {
      const help = apiSkill.getHelp();

      expect(help).toContain('/api');
      expect(help).toContain('add');
      expect(help).toContain('list');
      expect(help).toContain('exec');
      expect(help).toContain('auth');
      expect(help).toContain('sync');
      expect(help).toContain('remove');
      expect(help).toContain('restish');
    });
  });

  describe('getAPISkill singleton', () => {
    it('should return singleton instance', () => {
      const instance1 = getAPISkill();
      const instance2 = getAPISkill();

      expect(instance1).toBe(instance2);
    });
  });
});

describe('APIDiscoverySkill', () => {
  let discoverySkill: APIDiscoverySkill;

  beforeEach(() => {
    discoverySkill = new APIDiscoverySkill();
  });

  describe('analyzeUrl', () => {
    it('should detect GitHub API', () => {
      const result = discoverySkill.analyzeUrl(
        'https://api.github.com/users/octocat'
      );

      expect(result).not.toBeNull();
      expect(result?.name).toBe('github');
      expect(result?.baseUrl).toBe('https://api.github.com');
      expect(result?.source).toBe('known');
      expect(result?.confidence).toBeGreaterThanOrEqual(0.9);
    });

    it('should detect Stripe API', () => {
      const result = discoverySkill.analyzeUrl(
        'https://api.stripe.com/v1/charges'
      );

      expect(result).not.toBeNull();
      expect(result?.name).toBe('stripe');
      expect(result?.apiType).toBe('rest');
    });

    it('should detect Railway GraphQL API', () => {
      const result = discoverySkill.analyzeUrl(
        'https://backboard.railway.com/graphql/v2'
      );

      expect(result).not.toBeNull();
      expect(result?.name).toBe('railway');
      expect(result?.apiType).toBe('graphql');
    });

    it('should detect GCP APIs', () => {
      const result = discoverySkill.analyzeUrl(
        'https://compute.googleapis.com/compute/v1/projects'
      );

      expect(result).not.toBeNull();
      expect(result?.name).toBe('gcp-compute');
      expect(result?.apiType).toBe('google-discovery');
    });

    it('should infer API from pattern', () => {
      const result = discoverySkill.analyzeUrl(
        'https://api.example.com/v1/users'
      );

      expect(result).not.toBeNull();
      expect(result?.name).toBe('example');
      expect(result?.source).toBe('inferred');
      expect(result?.confidence).toBeLessThan(0.9);
    });

    it('should return null for non-API URL', () => {
      const result = discoverySkill.analyzeUrl(
        'https://www.google.com/search?q=test'
      );

      expect(result).toBeNull();
    });
  });

  describe('getHelp', () => {
    it('should return help text', () => {
      const help = discoverySkill.getHelp();

      expect(help).toContain('API Auto-Discovery');
      expect(help).toContain('REST APIs');
      expect(help).toContain('GraphQL APIs');
      expect(help).toContain('Google Cloud Platform');
    });
  });

  describe('getAPIDiscovery singleton', () => {
    it('should return singleton instance', () => {
      const instance1 = getAPIDiscovery();
      const instance2 = getAPIDiscovery();

      expect(instance1).toBe(instance2);
    });
  });
});
