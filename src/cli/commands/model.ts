/**
 * Model Router CLI Commands
 * Configure model switching between Claude and alternative providers
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import {
  loadModelRouterConfig,
  saveModelRouterConfig,
  getModelRouter,
  getFallbackStatus,
  triggerFallback,
  resetFallback,
  type ModelProvider,
  type TaskType,
  type ModelRouterConfig,
  type ModelConfig,
} from '../../core/models/model-router.js';

/**
 * Create model router command
 */
export function createModelCommand(): Command {
  const model = new Command('model')
    .description(
      'Configure model routing between Claude and alternative providers'
    )
    .addHelpText(
      'after',
      `
Examples:
  stackmemory model status          Show current model configuration
  stackmemory model enable          Enable model routing
  stackmemory model disable         Disable model routing (use Claude only)
  stackmemory model route plan qwen Route plan tasks to Qwen
  stackmemory model provider qwen   Configure Qwen provider
  stackmemory model thinking        Configure thinking mode settings
`
    );

  // Status command
  model
    .command('status')
    .description('Show current model router configuration')
    .action(() => {
      const config = loadModelRouterConfig();
      const router = getModelRouter();

      console.log(chalk.cyan('\nModel Router Status'));
      console.log(chalk.gray('─'.repeat(40)));

      console.log(
        `  Enabled: ${config.enabled ? chalk.green('Yes') : chalk.gray('No')}`
      );
      console.log(`  Default Provider: ${chalk.white(config.defaultProvider)}`);
      console.log(
        `  Current Provider: ${chalk.white(router.getCurrentProvider())}`
      );

      console.log(chalk.cyan('\nTask Routing'));
      const routes = config.taskRouting;
      console.log(`  Plan tasks:   ${routes.plan || chalk.gray('(default)')}`);
      console.log(`  Think tasks:  ${routes.think || chalk.gray('(default)')}`);
      console.log(`  Code tasks:   ${routes.code || chalk.gray('(default)')}`);
      console.log(
        `  Review tasks: ${routes.review || chalk.gray('(default)')}`
      );

      console.log(chalk.cyan('\nConfigured Providers'));
      for (const [name, provider] of Object.entries(config.providers)) {
        if (provider) {
          const hasKey = process.env[provider.apiKeyEnv]
            ? chalk.green('*')
            : chalk.red('!');
          console.log(`  ${hasKey} ${name}: ${provider.model}`);
          if (provider.baseUrl) {
            console.log(chalk.gray(`      URL: ${provider.baseUrl}`));
          }
        }
      }

      console.log(chalk.cyan('\nThinking Mode'));
      console.log(
        `  Enabled: ${config.thinkingMode.enabled ? chalk.green('Yes') : chalk.gray('No')}`
      );
      if (config.thinkingMode.budget) {
        console.log(`  Budget: ${config.thinkingMode.budget} tokens`);
      }
      if (config.thinkingMode.temperature) {
        console.log(`  Temperature: ${config.thinkingMode.temperature}`);
      }

      // Fallback status
      console.log(chalk.cyan('\nFallback (Auto)'));
      const fallbackStatus = getFallbackStatus();
      console.log(
        `  Enabled: ${fallbackStatus.enabled ? chalk.green('Yes') : chalk.gray('No')}`
      );
      if (fallbackStatus.enabled) {
        const keyStatus = fallbackStatus.hasApiKey
          ? chalk.green('ready')
          : chalk.red('no API key');
        console.log(`  Provider: ${fallbackStatus.provider} (${keyStatus})`);
        console.log(
          `  Triggers: ${[
            config.fallback?.onRateLimit && 'rate-limit',
            config.fallback?.onError && 'errors',
            config.fallback?.onTimeout && 'timeout',
          ]
            .filter(Boolean)
            .join(', ')}`
        );
        if (fallbackStatus.inFallback) {
          console.log(
            chalk.yellow(`  Status: IN FALLBACK (${fallbackStatus.reason})`)
          );
        }
      }

      console.log(chalk.gray('\n* = API key found, ! = API key missing'));
    });

  // Enable command
  model
    .command('enable')
    .description('Enable model routing')
    .action(() => {
      const config = loadModelRouterConfig();
      config.enabled = true;
      saveModelRouterConfig(config);
      console.log(chalk.green('[OK] Model routing enabled'));
    });

  // Disable command
  model
    .command('disable')
    .description('Disable model routing (use Claude only)')
    .action(() => {
      const config = loadModelRouterConfig();
      config.enabled = false;
      saveModelRouterConfig(config);
      console.log(
        chalk.green('[OK] Model routing disabled (using Claude only)')
      );
    });

  // Route command
  model
    .command('route <task> [provider]')
    .description('Route a task type to a specific provider')
    .addHelpText(
      'after',
      `
Task types: plan, think, code, review
Providers: anthropic, qwen, openai, ollama, custom

Examples:
  stackmemory model route plan qwen      Route planning to Qwen
  stackmemory model route think qwen     Route deep thinking to Qwen
  stackmemory model route plan           Clear plan routing (use default)
`
    )
    .action((task: string, provider?: string) => {
      const validTasks: TaskType[] = ['plan', 'think', 'code', 'review'];
      const validProviders: ModelProvider[] = [
        'anthropic',
        'qwen',
        'openai',
        'ollama',
        'custom',
      ];

      if (!validTasks.includes(task as TaskType)) {
        console.error(
          chalk.red(`Invalid task type: ${task}. Use: ${validTasks.join(', ')}`)
        );
        process.exit(1);
      }

      if (provider && !validProviders.includes(provider as ModelProvider)) {
        console.error(
          chalk.red(
            `Invalid provider: ${provider}. Use: ${validProviders.join(', ')}`
          )
        );
        process.exit(1);
      }

      const config = loadModelRouterConfig();

      if (provider) {
        config.taskRouting[task as keyof typeof config.taskRouting] =
          provider as ModelProvider;
        saveModelRouterConfig(config);
        console.log(chalk.green(`[OK] ${task} tasks routed to ${provider}`));
      } else {
        delete config.taskRouting[task as keyof typeof config.taskRouting];
        saveModelRouterConfig(config);
        console.log(
          chalk.green(`[OK] ${task} routing cleared (using default)`)
        );
      }
    });

  // Provider command
  model
    .command('provider <name>')
    .description('Configure a model provider')
    .option('-m, --model <model>', 'Model name/ID')
    .option('-u, --url <url>', 'Base URL for API')
    .option('-k, --key-env <env>', 'Environment variable for API key')
    .option('-i, --interactive', 'Interactive configuration')
    .action(async (name: string, options) => {
      const validProviders: ModelProvider[] = [
        'anthropic',
        'qwen',
        'openai',
        'ollama',
        'custom',
      ];

      if (!validProviders.includes(name as ModelProvider)) {
        console.error(
          chalk.red(
            `Invalid provider: ${name}. Use: ${validProviders.join(', ')}`
          )
        );
        process.exit(1);
      }

      const config = loadModelRouterConfig();

      if (options.interactive) {
        const answers = await inquirer.prompt([
          {
            type: 'input',
            name: 'model',
            message: 'Model name/ID:',
            default:
              config.providers[name as ModelProvider]?.model ||
              getDefaultModel(name),
          },
          {
            type: 'input',
            name: 'baseUrl',
            message: 'Base URL (leave empty for provider default):',
            default:
              config.providers[name as ModelProvider]?.baseUrl ||
              getDefaultUrl(name),
          },
          {
            type: 'input',
            name: 'apiKeyEnv',
            message: 'Environment variable for API key:',
            default:
              config.providers[name as ModelProvider]?.apiKeyEnv ||
              getDefaultKeyEnv(name),
          },
        ]);

        const providerConfig: ModelConfig = {
          provider: name as ModelProvider,
          model: answers.model,
          apiKeyEnv: answers.apiKeyEnv,
        };

        if (answers.baseUrl) {
          providerConfig.baseUrl = answers.baseUrl;
        }

        config.providers[name as ModelProvider] = providerConfig;
      } else {
        // Non-interactive update
        const existing = config.providers[name as ModelProvider] || {
          provider: name as ModelProvider,
          model: getDefaultModel(name),
          apiKeyEnv: getDefaultKeyEnv(name),
        };

        if (options.model) existing.model = options.model;
        if (options.url) existing.baseUrl = options.url;
        if (options.keyEnv) existing.apiKeyEnv = options.keyEnv;

        config.providers[name as ModelProvider] = existing;
      }

      saveModelRouterConfig(config);
      console.log(chalk.green(`[OK] Provider ${name} configured`));

      // Show current config
      const provider = config.providers[name as ModelProvider];
      if (provider) {
        console.log(chalk.gray(`  Model: ${provider.model}`));
        if (provider.baseUrl) {
          console.log(chalk.gray(`  URL: ${provider.baseUrl}`));
        }
        console.log(chalk.gray(`  Key env: ${provider.apiKeyEnv}`));

        const hasKey = process.env[provider.apiKeyEnv];
        if (!hasKey) {
          console.log(
            chalk.yellow(
              `\n[WARN] ${provider.apiKeyEnv} not set in environment`
            )
          );
        }
      }
    });

  // Thinking command
  model
    .command('thinking')
    .description('Configure thinking mode settings')
    .option('--enable', 'Enable thinking mode')
    .option('--disable', 'Disable thinking mode')
    .option('-b, --budget <tokens>', 'Max thinking tokens', parseInt)
    .option('-t, --temperature <temp>', 'Temperature (0.0-1.0)', parseFloat)
    .option('-p, --top-p <topP>', 'Top P (0.0-1.0)', parseFloat)
    .action((options) => {
      const config = loadModelRouterConfig();

      if (options.enable !== undefined) {
        config.thinkingMode.enabled = true;
      }
      if (options.disable !== undefined) {
        config.thinkingMode.enabled = false;
      }
      if (options.budget !== undefined) {
        config.thinkingMode.budget = options.budget;
      }
      if (options.temperature !== undefined) {
        config.thinkingMode.temperature = options.temperature;
      }
      if (options.topP !== undefined) {
        config.thinkingMode.topP = options.topP;
      }

      saveModelRouterConfig(config);

      console.log(chalk.green('[OK] Thinking mode configured'));
      console.log(chalk.gray(`  Enabled: ${config.thinkingMode.enabled}`));
      if (config.thinkingMode.budget) {
        console.log(
          chalk.gray(`  Budget: ${config.thinkingMode.budget} tokens`)
        );
      }
      if (config.thinkingMode.temperature) {
        console.log(
          chalk.gray(`  Temperature: ${config.thinkingMode.temperature}`)
        );
      }
      if (config.thinkingMode.topP) {
        console.log(chalk.gray(`  Top P: ${config.thinkingMode.topP}`));
      }
    });

  // Quick setup for Qwen
  model
    .command('setup-qwen')
    .description('Quick setup for Qwen provider (DashScope)')
    .action(async () => {
      console.log(chalk.cyan('\nQwen Provider Setup'));
      console.log(chalk.gray('─'.repeat(40)));
      console.log(
        chalk.gray(
          'Qwen3-Max-Thinking supports extended reasoning with thinking mode.'
        )
      );
      console.log(
        chalk.gray('API: https://dashscope.aliyuncs.com/compatible-mode/v1\n')
      );

      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'model',
          message: 'Model name:',
          default: 'qwen3-max-2025-01-23',
        },
        {
          type: 'confirm',
          name: 'enableThinking',
          message: 'Enable thinking mode?',
          default: true,
        },
        {
          type: 'number',
          name: 'thinkingBudget',
          message: 'Thinking budget (tokens):',
          default: 10000,
          when: (a: { enableThinking: boolean }) => a.enableThinking,
        },
        {
          type: 'confirm',
          name: 'routePlan',
          message: 'Route plan tasks to Qwen?',
          default: true,
        },
        {
          type: 'confirm',
          name: 'routeThink',
          message: 'Route think tasks to Qwen?',
          default: true,
        },
      ]);

      const config = loadModelRouterConfig();

      // Configure Qwen provider
      config.providers.qwen = {
        provider: 'qwen',
        model: answers.model,
        baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
        apiKeyEnv: 'DASHSCOPE_API_KEY',
        params: {
          enable_thinking: answers.enableThinking,
          thinking_budget: answers.thinkingBudget || 10000,
        },
      };

      // Configure thinking mode
      if (answers.enableThinking) {
        config.thinkingMode = {
          enabled: true,
          budget: answers.thinkingBudget || 10000,
          temperature: 0.6,
          topP: 0.95,
        };
      }

      // Set up routing
      if (answers.routePlan) {
        config.taskRouting.plan = 'qwen';
      }
      if (answers.routeThink) {
        config.taskRouting.think = 'qwen';
      }

      config.enabled = true;
      saveModelRouterConfig(config);

      console.log(chalk.green('\n[OK] Qwen provider configured'));
      console.log(chalk.gray('  Model: ' + answers.model));
      console.log(
        chalk.gray(
          '  Thinking mode: ' +
            (answers.enableThinking ? 'Enabled' : 'Disabled')
        )
      );

      // Check for API key
      if (!process.env['DASHSCOPE_API_KEY']) {
        console.log(chalk.yellow('\n[WARN] DASHSCOPE_API_KEY not set'));
        console.log(chalk.gray('Add to your environment:'));
        console.log(chalk.white('  export DASHSCOPE_API_KEY=your-api-key'));
      }
    });

  // Default provider command
  model
    .command('default <provider>')
    .description('Set the default provider')
    .action((provider: string) => {
      const validProviders: ModelProvider[] = [
        'anthropic',
        'qwen',
        'openai',
        'ollama',
        'custom',
      ];

      if (!validProviders.includes(provider as ModelProvider)) {
        console.error(
          chalk.red(
            `Invalid provider: ${provider}. Use: ${validProviders.join(', ')}`
          )
        );
        process.exit(1);
      }

      const config = loadModelRouterConfig();
      config.defaultProvider = provider as ModelProvider;
      saveModelRouterConfig(config);
      console.log(chalk.green(`[OK] Default provider set to ${provider}`));
    });

  // Fallback command
  model
    .command('fallback')
    .description('Configure automatic fallback to Qwen')
    .option('--enable', 'Enable automatic fallback')
    .option('--disable', 'Disable automatic fallback')
    .option('-p, --provider <provider>', 'Set fallback provider')
    .option('--on-rate-limit', 'Fallback on rate limit (429)')
    .option('--no-rate-limit', 'Disable rate limit fallback')
    .option('--on-error', 'Fallback on server errors (5xx)')
    .option('--no-error', 'Disable error fallback')
    .option('--on-timeout', 'Fallback on timeout')
    .option('--no-timeout', 'Disable timeout fallback')
    .option('--test', 'Test fallback by triggering it manually')
    .option('--reset', 'Reset fallback state (exit fallback mode)')
    .action((options) => {
      const config = loadModelRouterConfig();

      // Initialize fallback if not present
      if (!config.fallback) {
        config.fallback = {
          enabled: true,
          provider: 'qwen',
          onRateLimit: true,
          onError: true,
          onTimeout: true,
          maxRetries: 2,
          retryDelayMs: 1000,
        };
      }

      // Handle test/reset first
      if (options.test) {
        console.log(chalk.yellow('Testing fallback...'));
        const env = triggerFallback('manual');
        if (Object.keys(env).length > 0) {
          console.log(chalk.green('[OK] Fallback activated'));
          console.log(chalk.gray(`  Provider: ${config.fallback.provider}`));
          console.log(chalk.gray(`  Model: ${env['ANTHROPIC_MODEL']}`));
        } else {
          console.log(chalk.red('Fallback not available'));
          console.log(chalk.gray('  Check: DASHSCOPE_API_KEY is set'));
        }
        return;
      }

      if (options.reset) {
        resetFallback();
        console.log(chalk.green('[OK] Fallback state reset'));
        return;
      }

      // Configuration updates
      let updated = false;

      if (options.enable !== undefined) {
        config.fallback.enabled = true;
        updated = true;
      }
      if (options.disable !== undefined) {
        config.fallback.enabled = false;
        updated = true;
      }
      if (options.provider) {
        config.fallback.provider = options.provider as ModelProvider;
        updated = true;
      }
      if (options.onRateLimit !== undefined) {
        config.fallback.onRateLimit = true;
        updated = true;
      }
      if (options.rateLimit === false) {
        config.fallback.onRateLimit = false;
        updated = true;
      }
      if (options.onError !== undefined) {
        config.fallback.onError = true;
        updated = true;
      }
      if (options.error === false) {
        config.fallback.onError = false;
        updated = true;
      }
      if (options.onTimeout !== undefined) {
        config.fallback.onTimeout = true;
        updated = true;
      }
      if (options.timeout === false) {
        config.fallback.onTimeout = false;
        updated = true;
      }

      if (updated) {
        saveModelRouterConfig(config);
        console.log(chalk.green('[OK] Fallback configuration updated'));
      }

      // Show current status
      const status = getFallbackStatus();
      console.log(chalk.cyan('\nFallback Configuration'));
      console.log(chalk.gray('─'.repeat(30)));
      console.log(
        `  Enabled: ${status.enabled ? chalk.green('Yes') : chalk.gray('No')}`
      );
      console.log(`  Provider: ${config.fallback.provider}`);
      console.log(
        `  API Key: ${status.hasApiKey ? chalk.green('Set') : chalk.red('Missing')}`
      );
      console.log(
        `  On Rate Limit: ${config.fallback.onRateLimit ? 'Yes' : 'No'}`
      );
      console.log(`  On Error: ${config.fallback.onError ? 'Yes' : 'No'}`);
      console.log(`  On Timeout: ${config.fallback.onTimeout ? 'Yes' : 'No'}`);

      if (status.inFallback) {
        console.log(
          chalk.yellow(`\n  Currently IN FALLBACK (${status.reason})`)
        );
      }

      if (!status.hasApiKey) {
        console.log(chalk.yellow('\nTo enable Qwen fallback:'));
        console.log(chalk.gray('  export DASHSCOPE_API_KEY=your-api-key'));
      }
    });

  // Reset command
  model
    .command('reset')
    .description('Reset model router to defaults')
    .action(async () => {
      const { confirmed } = await inquirer.prompt([
        {
          type: 'confirm',
          name: 'confirmed',
          message: 'Reset model router configuration to defaults?',
          default: false,
        },
      ]);

      if (confirmed) {
        const defaultConfig: ModelRouterConfig = {
          enabled: false,
          defaultProvider: 'anthropic',
          taskRouting: {},
          providers: {
            anthropic: {
              provider: 'anthropic',
              model: 'claude-sonnet-4-20250514',
              apiKeyEnv: 'ANTHROPIC_API_KEY',
            },
          },
          thinkingMode: {
            enabled: false,
          },
        };

        saveModelRouterConfig(defaultConfig);
        console.log(chalk.green('[OK] Model router reset to defaults'));
      } else {
        console.log(chalk.gray('Reset cancelled'));
      }
    });

  return model;
}

// Helper functions for defaults
function getDefaultModel(provider: string): string {
  const defaults: Record<string, string> = {
    anthropic: 'claude-sonnet-4-20250514',
    qwen: 'qwen3-max-2025-01-23',
    openai: 'gpt-4o',
    ollama: 'llama3.2',
    custom: 'custom-model',
  };
  return defaults[provider] || 'unknown';
}

function getDefaultUrl(provider: string): string {
  const defaults: Record<string, string> = {
    qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    ollama: 'http://localhost:11434/v1',
  };
  return defaults[provider] || '';
}

function getDefaultKeyEnv(provider: string): string {
  const defaults: Record<string, string> = {
    anthropic: 'ANTHROPIC_API_KEY',
    qwen: 'DASHSCOPE_API_KEY',
    openai: 'OPENAI_API_KEY',
    ollama: 'OLLAMA_API_KEY',
    custom: 'CUSTOM_API_KEY',
  };
  return defaults[provider] || 'API_KEY';
}
