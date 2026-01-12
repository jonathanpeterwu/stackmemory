import { Command } from 'commander';
import chalk from 'chalk';
import { LinearWebhookServer } from '../../integrations/linear/webhook-server.js';
import { ConfigService } from '../../services/config-service.js';
import { logger } from '../../core/monitoring/logger.js';
import ngrok from 'ngrok';
// Type-safe environment variable access
function getEnv(key: string, defaultValue?: string): string {
  const value = process.env[key];
  if (value === undefined) {
    if (defaultValue !== undefined) return defaultValue;
    throw new Error(`Environment variable ${key} is required`);
  }
  return value;
}

function getOptionalEnv(key: string): string | undefined {
  return process.env[key];
}

export function webhookCommand(): Command {
  const command = new Command('webhook');

  command
    .description('Manage webhook servers for real-time sync')
    .option('-p, --port <port>', 'Port to run webhook server on', '3456')
    .option('-h, --host <host>', 'Host to bind to', 'localhost')
    .option('--ngrok', 'Create ngrok tunnel for public webhook URL')
    .option('--secret <secret>', 'Webhook secret for signature validation');

  command
    .command('start')
    .description('Start the Linear webhook server')
    .option('-p, --port <port>', 'Port to run webhook server on', '3456')
    .option('-h, --host <host>', 'Host to bind to', 'localhost')
    .option('--ngrok', 'Create ngrok tunnel for public webhook URL')
    .option('--background', 'Run in background (daemon mode)')
    .action(async (options) => {
      

      try {
        console.log(
          chalk.cyan.bold('\n📡 Starting Linear Webhook Server...\n')
        );

        const server = new LinearWebhookServer({
          port: parseInt(options.port),
          host: options.host,
          webhookSecret: process.env['LINEAR_WEBHOOK_SECRET'],
        });

        await server.start();

        if (options.ngrok) {
          try {
            const url = await ngrok.connect({
              addr: options.port,
              subdomain: process.env['NGROK_SUBDOMAIN'],
              authtoken: process.env['NGROK_AUTH_TOKEN'],
            });

            console.log(chalk.green('✓') + chalk.bold(' Ngrok Tunnel Created'));
            console.log(chalk.cyan('  Public URL: ') + url);
            console.log(
              chalk.cyan('  Webhook URL: ') + url + '/webhook/linear'
            );
            console.log(
              chalk.yellow(
                '\n⚠  Add this webhook URL to your Linear settings:\n'
              )
            );
            console.log(
              chalk.white(`  1. Go to Linear Settings → API → Webhooks`)
            );
            console.log(chalk.white(`  2. Click "New webhook"`));
            console.log(chalk.white(`  3. Set URL to: ${url}/webhook/linear`));
            console.log(
              chalk.white(
                `  4. Select events: Issues (all), Comments (optional)`
              )
            );
            console.log(
              chalk.white(
                `  5. Copy the webhook secret to LINEAR_WEBHOOK_SECRET env var\n`
              )
            );
          } catch (error: any) {
            logger.warn('Failed to create ngrok tunnel:', error.message);
            console.log(
              chalk.yellow('  ⚠ Ngrok tunnel failed, running locally only')
            );
          }
        } else {
          console.log(
            chalk.yellow(
              '\n💡 Tip: Use --ngrok flag to create a public webhook URL'
            )
          );
        }

        if (options.background) {
          console.log(chalk.dim('\nRunning in background mode...'));
          process.exit(0);
        } else {
          console.log(chalk.dim('\nPress Ctrl+C to stop the server\n'));
        }
      } catch (error: any) {
        logger.error('Failed to start webhook server:', error);
        console.error(
          chalk.red('✗ Failed to start webhook server:'),
          error.message
        );
        process.exit(1);
      }
    });

  command
    .command('stop')
    .description('Stop the webhook server')
    .action(async () => {
      console.log(chalk.yellow('Stopping webhook server...'));
      console.log(
        chalk.dim(
          '(This would stop a background webhook server if implemented)'
        )
      );
    });

  command
    .command('status')
    .description('Check webhook server status')
    .action(async () => {
      try {
        const response = await fetch('http://localhost:3456/health');
        if (response.ok) {
          const health = (await response.json()) as any;
          console.log(chalk.green('✓') + chalk.bold(' Webhook Server Status'));
          console.log(chalk.cyan('  Status: ') + health.status);
          console.log(chalk.cyan('  Queue: ') + health.queue + ' events');
          console.log(
            chalk.cyan('  Processing: ') + (health.processing ? 'Yes' : 'No')
          );
          console.log(chalk.cyan('  Timestamp: ') + health.timestamp);
        } else {
          console.log(chalk.red('✗ Webhook server not responding'));
        }
      } catch (error: unknown) {
        console.log(chalk.red('✗ Webhook server not running'));
        console.log(
          chalk.dim('  Run "stackmemory webhook start" to start the server')
        );
      }
    });

  command
    .command('test')
    .description('Send a test webhook to verify configuration')
    .option(
      '--url <url>',
      'Webhook URL to test',
      'http://localhost:3456/webhook/linear'
    )
    .action(async (options) => {
      

      try {
        console.log(chalk.cyan('🧪 Testing webhook endpoint...'));

        const testPayload = {
          action: 'create',
          type: 'Issue',
          data: {
            id: 'test-' + Date.now(),
            identifier: 'TEST-1',
            title: 'Test webhook issue',
            description: 'This is a test webhook event',
            state: {
              id: 'state-1',
              name: 'Todo',
              type: 'unstarted',
            },
            team: {
              id: 'team-1',
              key: 'TEST',
              name: 'Test Team',
            },
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            url: 'https://linear.app/test/issue/TEST-1',
          },
          createdAt: new Date().toISOString(),
        };

        const response = await fetch(options.url, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(testPayload),
        });

        if (response.ok) {
          const result = await response.json();
          console.log(chalk.green('✓') + ' Webhook test successful');
          console.log(
            chalk.cyan('  Response: ') + JSON.stringify(result, null, 2)
          );
        } else {
          console.log(chalk.red('✗ Webhook test failed'));
          console.log(chalk.red('  Status: ') + response.status);
          console.log(chalk.red('  Response: ') + (await response.text()));
        }
      } catch (error: any) {
        logger.error('Webhook test failed:', error);
        console.error(chalk.red('✗ Webhook test failed:'), error.message);
      }
    });

  return command;
}
