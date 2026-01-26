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
import {
  syncContext,
  syncFrame,
  enableAutoSync,
  disableAutoSync,
  isAutoSyncEnabled,
  loadSyncOptions,
  saveSyncOptions,
} from '../../hooks/whatsapp-sync.js';
import {
  loadCommandsConfig,
  enableCommands,
  disableCommands,
  getAvailableCommands,
} from '../../hooks/whatsapp-commands.js';
import {
  listSchedules,
  cancelSchedule,
  scheduleDailyDigest,
  scheduleHourlyDigest,
  scheduleIntervalDigest,
  startScheduler,
  stopScheduler,
  isSchedulerRunning,
  runScheduledDigest,
} from '../../hooks/whatsapp-scheduler.js';

// __dirname provided by esbuild banner

export function createSMSNotifyCommand(): Command {
  const cmd = new Command('notify')
    .description(
      'SMS/WhatsApp notifications with context sync and scheduled digests'
    )
    .addHelpText(
      'after',
      `
Setup:
  1. Create Twilio account at https://twilio.com
  2. Set environment variables:
     export TWILIO_ACCOUNT_SID=your_sid
     export TWILIO_AUTH_TOKEN=your_token
     export TWILIO_WHATSAPP_FROM=+1234567890
     export TWILIO_WHATSAPP_TO=+1234567890
  3. Enable: stackmemory notify enable

Basic Commands:
  stackmemory notify status              Check configuration
  stackmemory notify enable              Enable notifications
  stackmemory notify channel whatsapp    Switch to WhatsApp (default)
  stackmemory notify channel sms         Switch to SMS
  stackmemory notify test                Send test message
  stackmemory notify send "message"      Send custom message
  stackmemory notify review "PR #123"    Send review notification
  stackmemory notify ask "Deploy?"       Send yes/no prompt

Context Sync:
  Pushes development context (active frames, decisions, files) to WhatsApp.
  stackmemory notify sync                Push current context now
  stackmemory notify sync --frame <id>   Sync specific frame
  stackmemory notify sync --auto         Enable auto-sync on frame close
  stackmemory notify sync --no-auto      Disable auto-sync
  stackmemory notify sync-status         Show sync configuration

Scheduled Digests:
  Automatically sends context summaries at configured intervals.
  stackmemory notify schedule list             List all schedules
  stackmemory notify schedule daily 09:00      Daily digest at 9 AM
  stackmemory notify schedule hourly           Every hour
  stackmemory notify schedule interval 30      Every 30 minutes
  stackmemory notify schedule cancel <id>      Remove a schedule
  stackmemory notify schedule run <id>         Run schedule now
  stackmemory notify schedule start            Start scheduler daemon
  stackmemory notify schedule stop             Stop scheduler daemon

Inbound Commands:
  Enable command processing to respond to WhatsApp messages.
  stackmemory notify commands            List available commands
  stackmemory notify commands --enable   Enable command processing
  stackmemory notify commands --disable  Disable command processing

  Supported WhatsApp commands:
    status    - Get current session status
    frames    - List active frames
    tasks     - Show pending tasks
    digest    - Request full context digest
    pause     - Pause notifications
    resume    - Resume notifications
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

  // ===== Context Sync Commands =====
  cmd
    .command('sync')
    .description('Push current context to WhatsApp')
    .option('--frame <id>', 'Sync specific frame by ID')
    .option('--auto', 'Enable auto-sync on frame close')
    .option('--no-auto', 'Disable auto-sync')
    .action(async (options: { frame?: string; auto?: boolean }) => {
      if (options.auto === true) {
        enableAutoSync();
        console.log(chalk.green('Auto-sync enabled'));
        return;
      }

      if (options.auto === false) {
        disableAutoSync();
        console.log(chalk.yellow('Auto-sync disabled'));
        return;
      }

      console.log(chalk.blue('Syncing context...'));

      const result = options.frame
        ? await syncFrame(options.frame)
        : await syncContext();

      if (result.success) {
        console.log(
          chalk.green(
            `Context synced via ${result.channel} (${result.digestLength} chars)`
          )
        );
      } else {
        console.log(chalk.red(`Sync failed: ${result.error}`));
      }
    });

  cmd
    .command('sync-status')
    .description('Show sync configuration status')
    .action(() => {
      const options = loadSyncOptions();
      const autoEnabled = isAutoSyncEnabled();

      console.log(chalk.blue('Sync Configuration:'));
      console.log();
      console.log(
        `  ${chalk.gray('Auto-sync on close:')} ${autoEnabled ? chalk.green('enabled') : chalk.yellow('disabled')}`
      );
      console.log(
        `  ${chalk.gray('Min frame duration:')} ${options.minFrameDuration}s`
      );
      console.log(
        `  ${chalk.gray('Max digest length:')} ${options.maxDigestLength} chars`
      );
      console.log(
        `  ${chalk.gray('Include decisions:')} ${options.includeDecisions ? 'yes' : 'no'}`
      );
      console.log(
        `  ${chalk.gray('Include files:')} ${options.includeFiles ? 'yes' : 'no'}`
      );
      console.log(
        `  ${chalk.gray('Include tests:')} ${options.includeTests ? 'yes' : 'no'}`
      );
    });

  // ===== Schedule Commands =====
  cmd
    .command('schedule')
    .description('Manage scheduled digests')
    .argument('[action]', 'Action: daily, hourly, interval, list, cancel, run')
    .argument(
      '[value]',
      'Time (HH:MM) for daily, minutes for interval, or schedule ID'
    )
    .action(async (action?: string, value?: string) => {
      if (!action || action === 'list') {
        const schedules = listSchedules();

        if (schedules.length === 0) {
          console.log(chalk.gray('No scheduled digests'));
          return;
        }

        console.log(chalk.blue('Scheduled Digests:'));
        schedules.forEach((s) => {
          const status = s.enabled
            ? chalk.green('active')
            : chalk.yellow('paused');
          const nextRun = s.nextRun
            ? new Date(s.nextRun).toLocaleString()
            : 'N/A';

          console.log();
          console.log(`  ${chalk.gray('ID:')} ${s.id}`);
          console.log(`  ${chalk.gray('Type:')} ${s.config.type}`);
          console.log(`  ${chalk.gray('Status:')} ${status}`);
          console.log(`  ${chalk.gray('Next run:')} ${nextRun}`);
          if (s.lastRun) {
            console.log(
              `  ${chalk.gray('Last run:')} ${new Date(s.lastRun).toLocaleString()}`
            );
          }
        });
        return;
      }

      switch (action) {
        case 'daily': {
          const time = value || '09:00';
          try {
            const id = scheduleDailyDigest(time);
            console.log(chalk.green(`Daily digest scheduled at ${time}`));
            console.log(chalk.gray(`Schedule ID: ${id}`));
          } catch (err) {
            console.log(
              chalk.red(
                `Error: ${err instanceof Error ? err.message : String(err)}`
              )
            );
          }
          break;
        }

        case 'hourly': {
          const id = scheduleHourlyDigest();
          console.log(chalk.green('Hourly digest scheduled'));
          console.log(chalk.gray(`Schedule ID: ${id}`));
          break;
        }

        case 'interval': {
          const minutes = parseInt(value || '60', 10);
          if (isNaN(minutes) || minutes < 5) {
            console.log(chalk.red('Interval must be at least 5 minutes'));
            return;
          }
          try {
            const id = scheduleIntervalDigest(minutes);
            console.log(
              chalk.green(`Digest scheduled every ${minutes} minutes`)
            );
            console.log(chalk.gray(`Schedule ID: ${id}`));
          } catch (err) {
            console.log(
              chalk.red(
                `Error: ${err instanceof Error ? err.message : String(err)}`
              )
            );
          }
          break;
        }

        case 'cancel': {
          if (!value) {
            console.log(chalk.red('Schedule ID required'));
            return;
          }
          const cancelled = cancelSchedule(value);
          if (cancelled) {
            console.log(chalk.green(`Schedule ${value} cancelled`));
          } else {
            console.log(chalk.red(`Schedule not found: ${value}`));
          }
          break;
        }

        case 'run': {
          if (!value) {
            console.log(chalk.red('Schedule ID required'));
            return;
          }
          console.log(chalk.blue(`Running schedule ${value}...`));
          const result = await runScheduledDigest(value);
          if (result.success) {
            if (result.sent) {
              console.log(chalk.green(result.message));
            } else {
              console.log(chalk.yellow(result.message));
            }
          } else {
            console.log(chalk.red(`Error: ${result.error}`));
          }
          break;
        }

        case 'start': {
          if (isSchedulerRunning()) {
            console.log(chalk.yellow('Scheduler already running'));
          } else {
            startScheduler();
            console.log(chalk.green('Scheduler started'));
          }
          break;
        }

        case 'stop': {
          if (!isSchedulerRunning()) {
            console.log(chalk.yellow('Scheduler not running'));
          } else {
            stopScheduler();
            console.log(chalk.green('Scheduler stopped'));
          }
          break;
        }

        default:
          console.log(chalk.red(`Unknown action: ${action}`));
          console.log(
            chalk.gray(
              'Available: daily, hourly, interval, list, cancel, run, start, stop'
            )
          );
      }
    });

  // ===== Commands Management =====
  cmd
    .command('commands')
    .description('Manage inbound WhatsApp command processing')
    .option('--enable', 'Enable command processing')
    .option('--disable', 'Disable command processing')
    .action((options: { enable?: boolean; disable?: boolean }) => {
      if (options.enable) {
        enableCommands();
        console.log(chalk.green('Command processing enabled'));
        return;
      }

      if (options.disable) {
        disableCommands();
        console.log(chalk.yellow('Command processing disabled'));
        return;
      }

      // List available commands
      const config = loadCommandsConfig();
      const commands = getAvailableCommands();

      console.log(chalk.blue('WhatsApp Commands:'));
      console.log();
      console.log(
        `  ${chalk.gray('Processing:')} ${config.enabled ? chalk.green('enabled') : chalk.yellow('disabled')}`
      );
      console.log();
      console.log(chalk.gray('Available commands:'));

      commands.forEach((cmd) => {
        const argHint = cmd.requiresArg ? ' <arg>' : '';
        console.log(`  ${chalk.cyan(cmd.name)}${argHint} - ${cmd.description}`);
      });

      console.log();
      console.log(chalk.gray('Users can send these as WhatsApp messages'));
    });

  // ===== Claude Code Hook Installation =====
  cmd
    .command('install-whatsapp-hook')
    .description('Install WhatsApp integration hook for Claude Code')
    .action(async () => {
      const {
        writeFileSync,
        mkdirSync,
        existsSync: fsExists,
      } = await import('fs');
      const { join: pathJoin } = await import('path');
      const homeDir = process.env['HOME'] || '~';

      // Create settings.json content
      const claudeDir = pathJoin(homeDir, '.claude');
      const settingsPath = pathJoin(claudeDir, 'settings.json');
      const hookPath = pathJoin(
        __dirname,
        '../hooks/claude-code-whatsapp-hook.js'
      );

      console.log(chalk.blue('Installing WhatsApp hook for Claude Code...'));

      // Ensure .claude directory exists
      if (!fsExists(claudeDir)) {
        mkdirSync(claudeDir, { recursive: true });
      }

      // Load existing settings or create new
      let settings: Record<string, unknown> = {};
      if (fsExists(settingsPath)) {
        try {
          settings = JSON.parse(readFileSync(settingsPath, 'utf8'));
        } catch {
          // Start fresh
        }
      }

      // Add hooks configuration
      const hooks = (settings['hooks'] as Record<string, string[]>) || {};
      hooks['Stop'] = ['node', hookPath, 'stop'];

      settings['hooks'] = hooks;

      console.log();
      console.log(chalk.yellow('Add to ~/.claude/settings.json:'));
      console.log(chalk.gray(JSON.stringify({ hooks }, null, 2)));
      console.log();
      console.log(chalk.gray('Hook will:'));
      console.log(
        chalk.gray('  - Send session digest to WhatsApp when Claude exits')
      );
      console.log(
        chalk.gray('  - Check for incoming WhatsApp messages during session')
      );
      console.log();
      console.log(
        chalk.green('Manual setup required - copy the hooks config above')
      );
    });

  // ===== Auto-Fallback Status =====
  cmd
    .command('fallback-status')
    .description('Show auto-fallback status for Claude -> Qwen')
    .action(async () => {
      const { getFallbackStatus } =
        await import('../../core/models/model-router.js');
      const status = getFallbackStatus();

      console.log(chalk.blue('Auto-Fallback Status:'));
      console.log();
      console.log(
        `  ${chalk.gray('Enabled:')} ${status.enabled ? chalk.green('yes') : chalk.yellow('no')}`
      );
      console.log(
        `  ${chalk.gray('Fallback provider:')} ${status.provider || 'none'}`
      );
      console.log(
        `  ${chalk.gray('API key ready:')} ${status.hasApiKey ? chalk.green('yes') : chalk.red('no')}`
      );
      console.log(
        `  ${chalk.gray('Currently in fallback:')} ${status.inFallback ? chalk.yellow('YES') : 'no'}`
      );
      if (status.reason) {
        console.log(`  ${chalk.gray('Fallback reason:')} ${status.reason}`);
      }
      console.log();
      console.log(
        chalk.gray(
          'When Claude fails (rate limit, errors), Qwen takes over automatically.'
        )
      );
      console.log(
        chalk.gray('Configure with: stackmemory model fallback --enable')
      );
    });

  return cmd;
}

function maskPhone(phone: string): string {
  if (phone.length < 8) return phone;
  return phone.substring(0, 4) + '****' + phone.substring(phone.length - 2);
}
