/**
 * CLI command for SMS notification management
 */

import { Command } from 'commander';
import chalk from 'chalk';
import { execSync } from 'child_process';
import { join } from 'path';
import { existsSync, readFileSync, unlinkSync } from 'fs';
import {
  loadSMSConfig,
  saveSMSConfig,
  sendNotification,
  sendSMSNotification,
  notifyReviewReady,
  notifyWithYesNo,
  notifyTaskComplete,
  cleanupExpiredPrompts,
  type MessageChannel,
} from '../../hooks/sms-notify.js';
import {
  loadActionQueue,
  processAllPendingActions,
  cleanupOldActions,
  startActionWatcher,
} from '../../hooks/sms-action-runner.js';

// __dirname provided by esbuild banner

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
  2. Get Account SID, Auth Token, and phone numbers
  3. Set environment variables:
     export TWILIO_ACCOUNT_SID=your_sid
     export TWILIO_AUTH_TOKEN=your_token

     For WhatsApp (recommended - cheaper for conversations):
     export TWILIO_WHATSAPP_FROM=+1234567890
     export TWILIO_WHATSAPP_TO=+1234567890
     export TWILIO_CHANNEL=whatsapp

     For SMS:
     export TWILIO_SMS_FROM=+1234567890
     export TWILIO_SMS_TO=+1234567890
     export TWILIO_CHANNEL=sms

     Legacy (works for both, defaults to WhatsApp):
     export TWILIO_FROM_NUMBER=+1234567890
     export TWILIO_TO_NUMBER=+1234567890

  4. Enable: stackmemory notify enable

Examples:
  stackmemory notify status              Check configuration
  stackmemory notify enable              Enable notifications
  stackmemory notify channel whatsapp    Switch to WhatsApp
  stackmemory notify channel sms         Switch to SMS
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

      console.log(chalk.blue('Notification Status:'));
      console.log();

      // Check credentials
      const hasCreds = config.accountSid && config.authToken;

      // Check channel-specific numbers
      const channel = config.channel || 'whatsapp';
      const hasWhatsApp =
        config.whatsappFromNumber ||
        config.fromNumber ||
        config.whatsappToNumber ||
        config.toNumber;
      const hasSMS =
        config.smsFromNumber ||
        config.fromNumber ||
        config.smsToNumber ||
        config.toNumber;
      const hasNumbers = channel === 'whatsapp' ? hasWhatsApp : hasSMS;

      console.log(
        `  ${chalk.gray('Enabled:')} ${config.enabled ? chalk.green('yes') : chalk.red('no')}`
      );
      console.log(
        `  ${chalk.gray('Channel:')} ${channel === 'whatsapp' ? chalk.cyan('WhatsApp') : chalk.blue('SMS')}`
      );
      console.log(
        `  ${chalk.gray('Configured:')} ${hasCreds && hasNumbers ? chalk.green('yes') : chalk.yellow('no (set env vars)')}`
      );

      // Show channel-specific numbers
      console.log();
      console.log(chalk.blue('Numbers:'));
      if (channel === 'whatsapp') {
        const from = config.whatsappFromNumber || config.fromNumber;
        const to = config.whatsappToNumber || config.toNumber;
        if (from) {
          console.log(`  ${chalk.gray('WhatsApp From:')} ${maskPhone(from)}`);
        }
        if (to) {
          console.log(`  ${chalk.gray('WhatsApp To:')} ${maskPhone(to)}`);
        }
      } else {
        const from = config.smsFromNumber || config.fromNumber;
        const to = config.smsToNumber || config.toNumber;
        if (from) {
          console.log(`  ${chalk.gray('SMS From:')} ${maskPhone(from)}`);
        }
        if (to) {
          console.log(`  ${chalk.gray('SMS To:')} ${maskPhone(to)}`);
        }
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

      if (!hasCreds || !hasNumbers) {
        console.log();
        console.log(
          chalk.yellow('To configure, set these environment variables:')
        );
        console.log(chalk.gray('  export TWILIO_ACCOUNT_SID=your_sid'));
        console.log(chalk.gray('  export TWILIO_AUTH_TOKEN=your_token'));
        console.log();
        console.log(chalk.gray('  For WhatsApp (recommended):'));
        console.log(chalk.gray('  export TWILIO_WHATSAPP_FROM=+1234567890'));
        console.log(chalk.gray('  export TWILIO_WHATSAPP_TO=+1234567890'));
        console.log();
        console.log(chalk.gray('  For SMS:'));
        console.log(chalk.gray('  export TWILIO_SMS_FROM=+1234567890'));
        console.log(chalk.gray('  export TWILIO_SMS_TO=+1234567890'));
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
    .command('channel <type>')
    .description('Set notification channel (whatsapp|sms)')
    .action((type: string) => {
      const validChannels: MessageChannel[] = ['whatsapp', 'sms'];
      const channel = type.toLowerCase() as MessageChannel;

      if (!validChannels.includes(channel)) {
        console.log(
          chalk.red(`Invalid channel. Use: ${validChannels.join(', ')}`)
        );
        return;
      }

      const config = loadSMSConfig();
      config.channel = channel;
      saveSMSConfig(config);

      const label = channel === 'whatsapp' ? 'WhatsApp' : 'SMS';
      console.log(chalk.green(`Notification channel set to ${label}`));

      // Show relevant env vars
      if (channel === 'whatsapp') {
        const hasNumbers = config.whatsappFromNumber || config.fromNumber;
        if (!hasNumbers) {
          console.log(
            chalk.yellow('Set TWILIO_WHATSAPP_FROM and TWILIO_WHATSAPP_TO')
          );
        }
      } else {
        const hasNumbers = config.smsFromNumber || config.fromNumber;
        if (!hasNumbers) {
          console.log(chalk.yellow('Set TWILIO_SMS_FROM and TWILIO_SMS_TO'));
        }
      }
    });

  cmd
    .command('test')
    .description('Send a test notification')
    .option('--sms', 'Force SMS channel')
    .option('--whatsapp', 'Force WhatsApp channel')
    .action(async (options: { sms?: boolean; whatsapp?: boolean }) => {
      const config = loadSMSConfig();
      const channelOverride: MessageChannel | undefined = options.sms
        ? 'sms'
        : options.whatsapp
          ? 'whatsapp'
          : undefined;
      const channelLabel =
        channelOverride || config.channel === 'whatsapp' ? 'WhatsApp' : 'SMS';

      console.log(
        chalk.blue(`Sending test notification via ${channelLabel}...`)
      );

      const result = await sendNotification(
        {
          type: 'custom',
          title: 'StackMemory Test',
          message: 'This is a test notification from StackMemory.',
        },
        channelOverride
      );

      if (result.success) {
        const usedChannel = result.channel === 'whatsapp' ? 'WhatsApp' : 'SMS';
        console.log(chalk.green(`Test message sent via ${usedChannel}!`));
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
    .command('check')
    .description(
      'Check for new SMS/WhatsApp responses (use in Claude sessions)'
    )
    .action(() => {
      const responsePath = join(
        process.env['HOME'] || '~',
        '.stackmemory',
        'sms-latest-response.json'
      );

      try {
        if (existsSync(responsePath)) {
          const data = JSON.parse(readFileSync(responsePath, 'utf8'));
          const age = Date.now() - new Date(data.timestamp).getTime();

          if (age < 5 * 60 * 1000) {
            // Less than 5 minutes old
            console.log(chalk.green.bold('\n*** NEW SMS RESPONSE ***'));
            console.log(`  Response: "${data.response}"`);
            console.log(`  Prompt ID: ${data.promptId}`);
            console.log(`  Received: ${Math.round(age / 1000)}s ago\n`);

            // Clear it after reading
            unlinkSync(responsePath);
            return;
          }
        }
      } catch {
        // Ignore errors
      }

      console.log(chalk.gray('No new responses'));
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

  // Action queue commands
  cmd
    .command('actions')
    .description('List queued actions from SMS responses')
    .action(() => {
      const queue = loadActionQueue();

      if (queue.actions.length === 0) {
        console.log(chalk.gray('No actions in queue'));
        return;
      }

      console.log(chalk.blue('Action Queue:'));
      queue.actions.forEach((a) => {
        const statusColor =
          a.status === 'completed'
            ? chalk.green
            : a.status === 'failed'
              ? chalk.red
              : a.status === 'running'
                ? chalk.yellow
                : chalk.gray;

        console.log();
        console.log(`  ${chalk.gray('ID:')} ${a.id}`);
        console.log(`  ${chalk.gray('Status:')} ${statusColor(a.status)}`);
        console.log(
          `  ${chalk.gray('Action:')} ${a.action.substring(0, 60)}...`
        );
        console.log(`  ${chalk.gray('Response:')} ${a.response}`);
        if (a.error) {
          console.log(`  ${chalk.gray('Error:')} ${chalk.red(a.error)}`);
        }
      });
    });

  cmd
    .command('run-actions')
    .description('Execute all pending actions from SMS responses')
    .action(() => {
      console.log(chalk.blue('Processing pending actions...'));
      const result = processAllPendingActions();

      console.log(
        chalk.green(
          `Processed ${result.processed} action(s): ${result.succeeded} succeeded, ${result.failed} failed`
        )
      );
    });

  cmd
    .command('watch')
    .description('Watch for and execute SMS response actions')
    .option('-i, --interval <ms>', 'Check interval in milliseconds', '5000')
    .action((options: { interval: string }) => {
      const interval = parseInt(options.interval, 10);
      console.log(chalk.blue(`Watching for actions (interval: ${interval}ms)`));
      console.log(chalk.gray('Press Ctrl+C to stop'));

      startActionWatcher(interval);
    });

  cmd
    .command('cleanup-actions')
    .description('Remove old completed actions')
    .action(() => {
      const removed = cleanupOldActions();
      console.log(chalk.green(`Removed ${removed} old action(s)`));
    });

  cmd
    .command('watch-responses')
    .description('Watch for incoming SMS/WhatsApp responses and notify')
    .option('-i, --interval <ms>', 'Check interval in milliseconds', '2000')
    .action(async (options: { interval: string }) => {
      const { startResponseWatcher } =
        await import('../../hooks/sms-watcher.js');
      const interval = parseInt(options.interval, 10);
      startResponseWatcher(interval);
    });

  // Hook installation commands
  cmd
    .command('install-hook')
    .description('Install Claude Code notification hook')
    .action(() => {
      try {
        const scriptPath = join(
          __dirname,
          '../../../scripts/install-notify-hook.sh'
        );
        execSync(`bash "${scriptPath}"`, { stdio: 'inherit' });
      } catch {
        console.error(chalk.red('Failed to install hook'));
      }
    });

  cmd
    .command('install-response-hook')
    .description('Install Claude Code response handler hook')
    .action(() => {
      try {
        // Create install script inline
        const hooksDir = join(process.env['HOME'] || '~', '.claude', 'hooks');
        const hookSrc = join(
          __dirname,
          '../../../templates/claude-hooks/sms-response-handler.js'
        );
        const hookDest = join(hooksDir, 'sms-response-handler.js');

        execSync(`mkdir -p "${hooksDir}"`, { stdio: 'inherit' });
        execSync(`cp "${hookSrc}" "${hookDest}"`, { stdio: 'inherit' });
        execSync(`chmod +x "${hookDest}"`, { stdio: 'inherit' });

        console.log(chalk.green('Response handler hook installed!'));
        console.log(chalk.gray(`Location: ${hookDest}`));
        console.log();
        console.log(chalk.blue('Add to ~/.claude/settings.json:'));
        console.log(
          chalk.gray(`  "hooks": { "pre_tool_use": ["node ${hookDest}"] }`)
        );
      } catch {
        console.error(chalk.red('Failed to install response hook'));
      }
    });

  cmd
    .command('webhook')
    .description('Start SMS webhook server for receiving responses')
    .option('-p, --port <port>', 'Port to listen on', '3456')
    .action(async (options: { port: string }) => {
      const { startWebhookServer } = await import('../../hooks/sms-webhook.js');
      const port = parseInt(options.port, 10);
      startWebhookServer(port);
    });

  return cmd;
}

function maskPhone(phone: string): string {
  if (phone.length < 8) return phone;
  return phone.substring(0, 4) + '****' + phone.substring(phone.length - 2);
}
