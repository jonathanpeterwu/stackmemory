/**
 * CLI command for SMS notification management
 */

import { Command } from 'commander';
import chalk from 'chalk';
import {
  loadSMSConfig,
  saveSMSConfig,
  sendSMSNotification,
  notifyReviewReady,
  notifyWithYesNo,
  notifyTaskComplete,
  cleanupExpiredPrompts,
} from '../../hooks/sms-notify.js';

export function createSMSNotifyCommand(): Command {
  const cmd = new Command('notify')
    .description(
      'SMS notification system for review alerts (optional, requires Twilio)'
    )
    .addHelpText(
      'after',
      `
Setup (optional):
  1. Create Twilio account at https://twilio.com
  2. Get Account SID, Auth Token, and phone number
  3. Set environment variables:
     export TWILIO_ACCOUNT_SID=your_sid
     export TWILIO_AUTH_TOKEN=your_token
     export TWILIO_FROM_NUMBER=+1234567890
     export TWILIO_TO_NUMBER=+1234567890
  4. Enable: stackmemory notify enable

Examples:
  stackmemory notify status              Check configuration
  stackmemory notify enable              Enable notifications
  stackmemory notify test                Send test message
  stackmemory notify send "PR ready"     Send custom message
  stackmemory notify review "PR #123"    Send review notification with options
  stackmemory notify ask "Deploy?"       Send yes/no prompt
`
    );

  cmd
    .command('status')
    .description('Show notification configuration status')
    .action(() => {
      const config = loadSMSConfig();

      console.log(chalk.blue('SMS Notification Status:'));
      console.log();

      // Check if configured
      const hasCreds =
        config.accountSid &&
        config.authToken &&
        config.fromNumber &&
        config.toNumber;

      console.log(
        `  ${chalk.gray('Enabled:')} ${config.enabled ? chalk.green('yes') : chalk.red('no')}`
      );
      console.log(
        `  ${chalk.gray('Configured:')} ${hasCreds ? chalk.green('yes') : chalk.yellow('no (set env vars)')}`
      );

      if (config.fromNumber) {
        console.log(`  ${chalk.gray('From:')} ${maskPhone(config.fromNumber)}`);
      }
      if (config.toNumber) {
        console.log(`  ${chalk.gray('To:')} ${maskPhone(config.toNumber)}`);
      }

      console.log();
      console.log(chalk.blue('Notify On:'));
      console.log(
        `  ${chalk.gray('Task Complete:')} ${config.notifyOn.taskComplete ? 'yes' : 'no'}`
      );
      console.log(
        `  ${chalk.gray('Review Ready:')} ${config.notifyOn.reviewReady ? 'yes' : 'no'}`
      );
      console.log(
        `  ${chalk.gray('Errors:')} ${config.notifyOn.error ? 'yes' : 'no'}`
      );

      if (config.quietHours?.enabled) {
        console.log();
        console.log(
          chalk.blue(
            `Quiet Hours: ${config.quietHours.start} - ${config.quietHours.end}`
          )
        );
      }

      console.log();
      console.log(
        `  ${chalk.gray('Pending Prompts:')} ${config.pendingPrompts.length}`
      );
      console.log(
        `  ${chalk.gray('Response Timeout:')} ${config.responseTimeout}s`
      );

      if (!hasCreds) {
        console.log();
        console.log(
          chalk.yellow('To configure, set these environment variables:')
        );
        console.log(chalk.gray('  export TWILIO_ACCOUNT_SID=your_sid'));
        console.log(chalk.gray('  export TWILIO_AUTH_TOKEN=your_token'));
        console.log(chalk.gray('  export TWILIO_FROM_NUMBER=+1234567890'));
        console.log(chalk.gray('  export TWILIO_TO_NUMBER=+1234567890'));
      }
    });

  cmd
    .command('enable')
    .description('Enable SMS notifications')
    .action(() => {
      const config = loadSMSConfig();
      config.enabled = true;
      saveSMSConfig(config);
      console.log(chalk.green('SMS notifications enabled'));

      const hasCreds =
        config.accountSid &&
        config.authToken &&
        config.fromNumber &&
        config.toNumber;
      if (!hasCreds) {
        console.log(
          chalk.yellow(
            'Note: Set Twilio environment variables to send messages'
          )
        );
      }
    });

  cmd
    .command('disable')
    .description('Disable SMS notifications')
    .action(() => {
      const config = loadSMSConfig();
      config.enabled = false;
      saveSMSConfig(config);
      console.log(chalk.yellow('SMS notifications disabled'));
    });

  cmd
    .command('test')
    .description('Send a test notification')
    .action(async () => {
      console.log(chalk.blue('Sending test notification...'));

      const result = await sendSMSNotification({
        type: 'custom',
        title: 'StackMemory Test',
        message: 'This is a test notification from StackMemory.',
      });

      if (result.success) {
        console.log(chalk.green('Test message sent successfully!'));
      } else {
        console.log(chalk.red(`Failed: ${result.error}`));
      }
    });

  cmd
    .command('send <message>')
    .description('Send a custom notification')
    .option('-t, --title <title>', 'Message title', 'StackMemory Alert')
    .action(async (message: string, options: { title: string }) => {
      const result = await sendSMSNotification({
        type: 'custom',
        title: options.title,
        message,
      });

      if (result.success) {
        console.log(chalk.green('Message sent!'));
      } else {
        console.log(chalk.red(`Failed: ${result.error}`));
      }
    });

  cmd
    .command('review <title>')
    .description('Send review-ready notification with options')
    .option('-m, --message <msg>', 'Description', 'Ready for your review')
    .option(
      '-o, --options <opts>',
      'Comma-separated options',
      'Approve,Request Changes,Skip'
    )
    .action(
      async (title: string, options: { message: string; options: string }) => {
        const opts = options.options.split(',').map((o) => ({
          label: o.trim(),
        }));

        console.log(chalk.blue('Sending review notification...'));

        const result = await notifyReviewReady(title, options.message, opts);

        if (result.success) {
          console.log(chalk.green('Review notification sent!'));
          if (result.promptId) {
            console.log(chalk.gray(`Prompt ID: ${result.promptId}`));
          }
        } else {
          console.log(chalk.red(`Failed: ${result.error}`));
        }
      }
    );

  cmd
    .command('ask <question>')
    .description('Send a yes/no prompt')
    .option('-t, --title <title>', 'Message title', 'StackMemory')
    .action(async (question: string, options: { title: string }) => {
      console.log(chalk.blue('Sending yes/no prompt...'));

      const result = await notifyWithYesNo(options.title, question);

      if (result.success) {
        console.log(chalk.green('Prompt sent!'));
        if (result.promptId) {
          console.log(chalk.gray(`Prompt ID: ${result.promptId}`));
        }
      } else {
        console.log(chalk.red(`Failed: ${result.error}`));
      }
    });

  cmd
    .command('complete <task>')
    .description('Send task completion notification')
    .option('-s, --summary <text>', 'Task summary', '')
    .action(async (task: string, options: { summary: string }) => {
      const result = await notifyTaskComplete(
        task,
        options.summary || `Task "${task}" has been completed.`
      );

      if (result.success) {
        console.log(chalk.green('Completion notification sent!'));
      } else {
        console.log(chalk.red(`Failed: ${result.error}`));
      }
    });

  cmd
    .command('quiet')
    .description('Configure quiet hours')
    .option('--enable', 'Enable quiet hours')
    .option('--disable', 'Disable quiet hours')
    .option('--start <time>', 'Start time (HH:MM)', '22:00')
    .option('--end <time>', 'End time (HH:MM)', '08:00')
    .action(
      (options: {
        enable?: boolean;
        disable?: boolean;
        start: string;
        end: string;
      }) => {
        const config = loadSMSConfig();

        if (!config.quietHours) {
          config.quietHours = { enabled: false, start: '22:00', end: '08:00' };
        }

        if (options.enable) {
          config.quietHours.enabled = true;
        } else if (options.disable) {
          config.quietHours.enabled = false;
        }

        if (options.start) {
          config.quietHours.start = options.start;
        }
        if (options.end) {
          config.quietHours.end = options.end;
        }

        saveSMSConfig(config);

        if (config.quietHours.enabled) {
          console.log(
            chalk.green(
              `Quiet hours enabled: ${config.quietHours.start} - ${config.quietHours.end}`
            )
          );
        } else {
          console.log(chalk.yellow('Quiet hours disabled'));
        }
      }
    );

  cmd
    .command('toggle <type>')
    .description(
      'Toggle notification type (taskComplete|reviewReady|error|custom)'
    )
    .action((type: string) => {
      const config = loadSMSConfig();
      const validTypes = ['taskComplete', 'reviewReady', 'error', 'custom'];

      if (!validTypes.includes(type)) {
        console.log(chalk.red(`Invalid type. Use: ${validTypes.join(', ')}`));
        return;
      }

      const key = type as keyof typeof config.notifyOn;
      config.notifyOn[key] = !config.notifyOn[key];
      saveSMSConfig(config);

      console.log(
        chalk.green(
          `${type} notifications ${config.notifyOn[key] ? 'enabled' : 'disabled'}`
        )
      );
    });

  cmd
    .command('pending')
    .description('List pending prompts awaiting response')
    .action(() => {
      const config = loadSMSConfig();

      if (config.pendingPrompts.length === 0) {
        console.log(chalk.gray('No pending prompts'));
        return;
      }

      console.log(chalk.blue('Pending Prompts:'));
      config.pendingPrompts.forEach((p) => {
        const expires = new Date(p.expiresAt);
        const remaining = Math.round((expires.getTime() - Date.now()) / 1000);

        console.log();
        console.log(`  ${chalk.gray('ID:')} ${p.id}`);
        console.log(`  ${chalk.gray('Type:')} ${p.type}`);
        console.log(
          `  ${chalk.gray('Message:')} ${p.message.substring(0, 50)}...`
        );
        console.log(
          `  ${chalk.gray('Expires:')} ${remaining > 0 ? `${remaining}s` : chalk.red('expired')}`
        );
      });
    });

  cmd
    .command('cleanup')
    .description('Remove expired pending prompts')
    .action(() => {
      const removed = cleanupExpiredPrompts();
      console.log(chalk.green(`Removed ${removed} expired prompt(s)`));
    });

  cmd
    .command('timeout <seconds>')
    .description('Set response timeout for prompts')
    .action((seconds: string) => {
      const config = loadSMSConfig();
      const timeout = parseInt(seconds, 10);

      if (isNaN(timeout) || timeout < 30) {
        console.log(chalk.red('Timeout must be at least 30 seconds'));
        return;
      }

      config.responseTimeout = timeout;
      saveSMSConfig(config);
      console.log(chalk.green(`Response timeout set to ${timeout} seconds`));
    });

  return cmd;
}

function maskPhone(phone: string): string {
  if (phone.length < 8) return phone;
  return phone.substring(0, 4) + '****' + phone.substring(phone.length - 2);
}
