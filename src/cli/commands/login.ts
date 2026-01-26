import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';
import open from 'open';
import { IntegrationError, ErrorCode } from '../../core/errors/index.js';

interface ConfigShape {
  version?: string;
  setupCompleted?: string;
  features?: any;
  paths?: any;
  database?: { mode?: 'local' | 'hosted'; url?: string };
  auth?: {
    apiKey?: string;
    apiUrl?: string;
    email?: string;
  };
}

interface AuthResponse {
  success: boolean;
  apiKey?: string;
  databaseUrl?: string;
  email?: string;
  error?: string;
}

export function registerLoginCommand(program: Command): void {
  program
    .command('login')
    .description('Login to hosted StackMemory service')
    .option('--api-url <url>', 'Custom API URL', 'https://api.stackmemory.ai')
    .option('--email <email>', 'Email address for login')
    .option('--password <password>', 'Password (not recommended in CLI)')
    .action(async (options) => {
      const cfgDir = join(homedir(), '.stackmemory');
      if (!existsSync(cfgDir)) mkdirSync(cfgDir, { recursive: true });

      console.log(chalk.cyan('🔐 StackMemory Hosted Service Login\n'));

      // Prompt for credentials
      const credentials = await inquirer.prompt([
        {
          type: 'input',
          name: 'email',
          message: 'Email:',
          default: options.email,
          validate: (input: string) => {
            const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
            return emailRegex.test(input) ? true : 'Please enter a valid email';
          },
        },
        {
          type: 'password',
          name: 'password',
          message: 'Password:',
          default: options.password,
          mask: '*',
          validate: (input: string) =>
            input.length >= 6 ? true : 'Password must be at least 6 characters',
        },
      ]);

      console.log(chalk.gray('\nAuthenticating with StackMemory API...'));

      try {
        // Authenticate with the hosted API
        const apiUrl =
          options.apiUrl ||
          process.env.STACKMEMORY_API_URL ||
          'https://api.stackmemory.ai';
        const response = await fetch(`${apiUrl}/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'User-Agent': 'StackMemory-CLI/0.3.19',
          },
          body: JSON.stringify({
            email: credentials.email,
            password: credentials.password,
          }),
        });

        const data: AuthResponse = await response.json();

        if (!response.ok || !data.success) {
          if (response.status === 404) {
            // Fallback to Railway server if hosted API not available
            console.log(
              chalk.yellow('\n⚠️  Hosted API not available. Would you like to:')
            );
            const { choice } = await inquirer.prompt([
              {
                type: 'list',
                name: 'choice',
                message: 'Select an option:',
                choices: [
                  { name: 'Open signup page in browser', value: 'signup' },
                  { name: 'Configure database URL manually', value: 'manual' },
                  { name: 'Use local database', value: 'local' },
                  { name: 'Cancel', value: 'cancel' },
                ],
              },
            ]);

            if (choice === 'signup') {
              await open('https://stackmemory.ai/signup');
              console.log(chalk.cyan('Opening signup page in browser...'));
              return;
            } else if (choice === 'manual') {
              const { databaseUrl } = await inquirer.prompt([
                {
                  type: 'password',
                  name: 'databaseUrl',
                  message: 'Enter your DATABASE_URL (postgres://...):',
                  validate: (input: string) =>
                    input.startsWith('postgres://') ||
                    input.startsWith('postgresql://')
                      ? true
                      : 'Must start with postgres:// or postgresql://',
                },
              ]);

              // Save manual configuration
              const cfgPath = join(cfgDir, 'config.json');
              let cfg: ConfigShape = {};
              try {
                if (existsSync(cfgPath))
                  cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
              } catch {}

              cfg.database = { mode: 'hosted', url: databaseUrl };
              cfg.auth = { email: credentials.email };

              writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
              console.log(chalk.green('✓ Database configured successfully'));
              return;
            } else if (choice === 'local') {
              const cfgPath = join(cfgDir, 'config.json');
              let cfg: ConfigShape = {};
              try {
                if (existsSync(cfgPath))
                  cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
              } catch {}

              cfg.database = { mode: 'local' };
              writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
              console.log(chalk.green('✓ Switched to local database mode'));
              return;
            } else {
              console.log(chalk.gray('Login cancelled'));
              return;
            }
          }

          throw new IntegrationError(
            data.error || 'Authentication failed',
            ErrorCode.LINEAR_AUTH_FAILED,
            { email: credentials.email, apiUrl }
          );
        }

        // Save configuration
        const cfgPath = join(cfgDir, 'config.json');
        let cfg: ConfigShape = {};
        try {
          if (existsSync(cfgPath))
            cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
        } catch {}

        cfg.auth = {
          apiKey: data.apiKey,
          apiUrl: apiUrl,
          email: credentials.email,
        };

        if (data.databaseUrl) {
          cfg.database = {
            mode: 'hosted',
            url: data.databaseUrl,
          };
        }

        writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));

        // Save environment variables
        const envFile = join(cfgDir, 'stackmemory.env');
        const envContent = `# StackMemory Authentication
STACKMEMORY_API_KEY=${data.apiKey}
STACKMEMORY_API_URL=${apiUrl}
${data.databaseUrl ? `DATABASE_URL=${data.databaseUrl}` : ''}
`;
        writeFileSync(envFile, envContent);

        console.log(chalk.green('\n✅ Successfully logged in to StackMemory'));
        console.log(
          chalk.green(`✓ Configuration saved to ~/.stackmemory/config.json`)
        );
        console.log(chalk.gray('\nYou can now use:'));
        console.log(
          chalk.cyan('  stackmemory sync     ') +
            chalk.gray('- Sync your context to the cloud')
        );
        console.log(
          chalk.cyan('  stackmemory db status') +
            chalk.gray('- Check database connection')
        );
        console.log(
          chalk.cyan('  stackmemory context  ') +
            chalk.gray('- Manage your contexts')
        );
      } catch (error: any) {
        console.error(chalk.red('\n❌ Login failed:'), error.message);
        console.log(
          chalk.yellow(
            '\nTip: Visit https://stackmemory.ai/signup to create an account'
          )
        );
        process.exit(1);
      }
    });
}
