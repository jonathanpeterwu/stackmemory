/**
 * CLI Commands for API Skill
 *
 * Provides command-line interface for managing and executing APIs
 * via the Restish-based API skill.
 */

import { Command } from 'commander';
import { getAPISkill } from '../../skills/api-skill.js';
import { getAPIDiscovery } from '../../skills/api-discovery.js';

export function createAPICommand(): Command {
  const api = new Command('api');
  api.description('OpenAPI-based API access via Restish');

  // Add API
  api
    .command('add <name> <url>')
    .description('Register a new API')
    .option('--spec <url>', 'OpenAPI spec URL')
    .option(
      '--auth-type <type>',
      'Authentication type (none|api-key|oauth2|basic)',
      'none'
    )
    .option('--header-name <name>', 'Auth header name', 'Authorization')
    .option('--env-var <name>', 'Environment variable for auth token')
    .action(async (name: string, url: string, options) => {
      const skill = getAPISkill();
      const result = await skill.add(name, url, {
        spec: options.spec,
        authType: options.authType,
        headerName: options.headerName,
        envVar: options.envVar,
      });

      if (result.success) {
        console.log(`API '${name}' registered`);
        if (result.data) {
          console.log(JSON.stringify(result.data, null, 2));
        }
      } else {
        console.error(`Error: ${result.message}`);
        process.exit(1);
      }
    });

  // List APIs
  api
    .command('list')
    .description('List all registered APIs')
    .action(async () => {
      const skill = getAPISkill();
      const result = await skill.list();

      if (result.success) {
        if (Array.isArray(result.data) && result.data.length === 0) {
          console.log(
            'No APIs registered. Use: stackmemory api add <name> <url>'
          );
        } else {
          console.log('Registered APIs:');
          for (const api of result.data as Array<{
            name: string;
            baseUrl: string;
            authType: string;
            operations: number | string;
          }>) {
            console.log(`  ${api.name}`);
            console.log(`    URL: ${api.baseUrl}`);
            console.log(`    Auth: ${api.authType}`);
            console.log(`    Operations: ${api.operations}`);
          }
        }
      } else {
        console.error(`Error: ${result.message}`);
        process.exit(1);
      }
    });

  // Describe API
  api
    .command('describe <name> [operation]')
    .description('Show API details or specific operation')
    .action(async (name: string, operation?: string) => {
      const skill = getAPISkill();
      const result = await skill.describe(name, operation);

      if (result.success) {
        console.log(result.message);
        if (result.data) {
          console.log(JSON.stringify(result.data, null, 2));
        }
      } else {
        console.error(`Error: ${result.message}`);
        process.exit(1);
      }
    });

  // Execute API operation
  api
    .command('exec <name> <operation>')
    .description('Execute an API operation')
    .option('--raw', 'Output raw response')
    .option('--filter <query>', 'Filter/project response using shorthand query')
    .option('-H, --header <header...>', 'Add custom headers (key:value)')
    .allowUnknownOption(true)
    .action(async (name: string, operation: string, options, command) => {
      const skill = getAPISkill();

      // Parse unknown options as API parameters
      const params: Record<string, unknown> = {};
      const args = command.args.slice(2); // Skip name and operation

      for (let i = 0; i < args.length; i++) {
        const arg = args[i];
        if (arg.startsWith('--')) {
          const key = arg.slice(2);
          const nextArg = args[i + 1];
          if (nextArg && !nextArg.startsWith('--')) {
            params[key] = nextArg;
            i++;
          } else {
            params[key] = true;
          }
        }
      }

      // Parse headers
      const headers: Record<string, string> = {};
      if (options.header) {
        for (const h of options.header) {
          const [key, ...valueParts] = h.split(':');
          headers[key] = valueParts.join(':').trim();
        }
      }

      const result = await skill.exec(name, operation, params, {
        raw: options.raw,
        filter: options.filter,
        headers,
      });

      if (result.success) {
        if (typeof result.data === 'string') {
          console.log(result.data);
        } else {
          console.log(JSON.stringify(result.data, null, 2));
        }
      } else {
        console.error(`Error: ${result.message}`);
        process.exit(1);
      }
    });

  // Configure auth
  api
    .command('auth <name>')
    .description('Configure API authentication')
    .option('--token <token>', 'API token/key')
    .option('--env-var <name>', 'Environment variable name for token')
    .option('--oauth', 'Use OAuth2 flow')
    .option('--scopes <scopes>', 'OAuth2 scopes (comma-separated)')
    .action(async (name: string, options) => {
      const skill = getAPISkill();

      const result = await skill.auth(name, {
        token: options.token,
        envVar: options.envVar,
        oauth: options.oauth,
        scopes: options.scopes?.split(','),
      });

      if (result.success) {
        console.log(result.message);
      } else {
        console.error(`Error: ${result.message}`);
        process.exit(1);
      }
    });

  // Sync API
  api
    .command('sync <name>')
    .description('Refresh API operations from spec')
    .action(async (name: string) => {
      const skill = getAPISkill();
      const result = await skill.sync(name);

      if (result.success) {
        console.log(result.message);
        if (result.data?.operations) {
          console.log(
            `Operations: ${(result.data.operations as string[]).join(', ')}`
          );
        }
      } else {
        console.error(`Error: ${result.message}`);
        process.exit(1);
      }
    });

  // Remove API
  api
    .command('remove <name>')
    .description('Remove a registered API')
    .action(async (name: string) => {
      const skill = getAPISkill();
      const result = await skill.remove(name);

      if (result.success) {
        console.log(result.message);
      } else {
        console.error(`Error: ${result.message}`);
        process.exit(1);
      }
    });

  // Discover API from URL
  api
    .command('discover <url>')
    .description('Analyze a URL and discover API endpoints')
    .option('--register', 'Auto-register if API is discovered')
    .action(async (url: string, options) => {
      const discovery = getAPIDiscovery();

      // Use analyzeUrl directly for quick response (no network probing)
      const result = discovery.analyzeUrl(url);

      if (result) {
        console.log(`Discovered API: ${result.name}`);
        console.log(`  Base URL: ${result.baseUrl}`);
        console.log(`  Spec URL: ${result.specUrl || 'not found'}`);
        console.log(`  Type: ${result.apiType || 'rest'}`);
        console.log(`  Source: ${result.source}`);
        console.log(`  Confidence: ${(result.confidence * 100).toFixed(0)}%`);

        if (result.apiType === 'graphql') {
          console.log(
            `\nNote: This is a GraphQL API. Use a GraphQL client for queries.`
          );
        } else if (result.apiType === 'google-discovery') {
          console.log(
            `\nNote: This uses Google Discovery format. Auth via gcloud CLI.`
          );
        }

        if (options.register) {
          await discovery.registerAPI(result);
          console.log(
            `\nAPI registered. Use: stackmemory api exec ${result.name} <path>`
          );
        } else {
          console.log(
            `\nTo register: stackmemory api add ${result.name} ${result.baseUrl}`
          );
        }
      } else {
        console.log('No API detected in this URL');
      }
    });

  // List discovered APIs
  api
    .command('discovered')
    .description('List all auto-discovered APIs')
    .action(() => {
      const discovery = getAPIDiscovery();
      const discovered = discovery.getDiscoveredAPIs();

      if (discovered.length === 0) {
        console.log('No APIs discovered yet.');
        console.log(
          'Browse API documentation or use: stackmemory api discover <url>'
        );
        return;
      }

      console.log('Discovered APIs:');
      for (const api of discovered) {
        console.log(`  ${api.name}`);
        console.log(`    Base: ${api.baseUrl}`);
        console.log(`    Spec: ${api.specUrl || 'none'}`);
        console.log(`    Confidence: ${(api.confidence * 100).toFixed(0)}%`);
      }
    });

  // Register all discovered APIs
  api
    .command('register-discovered')
    .description('Register all discovered APIs')
    .action(async () => {
      const discovery = getAPIDiscovery();
      const discovered = discovery.getDiscoveredAPIs();

      if (discovered.length === 0) {
        console.log('No APIs to register. Use: stackmemory api discover <url>');
        return;
      }

      let registered = 0;
      for (const api of discovered) {
        if (await discovery.registerAPI(api)) {
          console.log(`Registered: ${api.name}`);
          registered++;
        }
      }

      console.log(`\nRegistered ${registered}/${discovered.length} APIs`);
    });

  // Help
  api
    .command('help')
    .description('Show API skill help')
    .action(() => {
      const skill = getAPISkill();
      const discovery = getAPIDiscovery();
      console.log(skill.getHelp());
      console.log('\n---\n');
      console.log(discovery.getHelp());
    });

  return api;
}
