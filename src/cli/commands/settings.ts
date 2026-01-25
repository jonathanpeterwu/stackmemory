/**
 * CLI command for viewing and configuring StackMemory settings
 */

import { Command } from 'commander';
import chalk from 'chalk';
import inquirer from 'inquirer';
import { existsSync, writeFileSync, mkdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  loadSMSConfig,
  saveSMSConfig,
  getMissingConfig,
  type MessageChannel,
} from '../../hooks/sms-notify.js';

export function createSettingsCommand(): Command {
  const cmd = new Command('settings')
    .description('View and configure StackMemory settings')
    .addHelpText(
      'after',
      `
Examples:
  stackmemory settings              Show all settings and missing config
  stackmemory settings notifications   Configure notifications interactively
  stackmemory settings env          Show required environment variables
`
    );

  cmd
    .command('show')
    .description('Show current settings and what is missing')
    .action(() => {
      showSettings();
    });

  cmd
    .command('notifications')
    .alias('notify')
    .description('Configure notifications interactively')
    .action(async () => {
      await configureNotifications();
    });

  cmd
    .command('env')
    .description('Show required environment variables')
    .action(() => {
      showEnvVars();
    });

  // Default action - show settings
  cmd.action(() => {
    showSettings();
  });

  return cmd;
}

function showSettings(): void {
  console.log(chalk.blue.bold('\nStackMemory Settings\n'));

  // Notification settings
  const config = loadSMSConfig();
  const { missing, configured, ready } = getMissingConfig();

  console.log(chalk.cyan('Notifications:'));
  console.log(
    `  ${chalk.gray('Enabled:')} ${config.enabled ? chalk.green('yes') : chalk.yellow('no')}`
  );
  console.log(
    `  ${chalk.gray('Channel:')} ${config.channel === 'whatsapp' ? chalk.cyan('WhatsApp') : chalk.blue('SMS')}`
  );
  console.log(
    `  ${chalk.gray('Ready:')} ${ready ? chalk.green('yes') : chalk.red('no')}`
  );

  if (configured.length > 0) {
    console.log(`\n  ${chalk.green('Configured:')}`);
    configured.forEach((item) => {
      console.log(`    ${chalk.green('✓')} ${item}`);
    });
  }

  if (missing.length > 0) {
    console.log(`\n  ${chalk.red('Missing:')}`);
    missing.forEach((item) => {
      console.log(`    ${chalk.red('✗')} ${item}`);
    });

    console.log(
      chalk.yellow('\n  Run "stackmemory settings notifications" to configure')
    );
  }

  // Show ngrok URL if available
  const ngrokUrlPath = join(homedir(), '.stackmemory', 'ngrok-url.txt');
  if (existsSync(ngrokUrlPath)) {
    const ngrokUrl = readFileSync(ngrokUrlPath, 'utf8').trim();
    console.log(`\n  ${chalk.gray('Webhook URL:')} ${ngrokUrl}/sms/incoming`);
  }

  console.log();
}

function showEnvVars(): void {
  console.log(chalk.blue.bold('\nRequired Environment Variables\n'));

  const { missing, configured } = getMissingConfig();
  const config = loadSMSConfig();

  console.log(chalk.cyan('Twilio Credentials (required):'));
  console.log(
    `  ${configured.includes('TWILIO_ACCOUNT_SID') ? chalk.green('✓') : chalk.red('✗')} TWILIO_ACCOUNT_SID`
  );
  console.log(
    `  ${configured.includes('TWILIO_AUTH_TOKEN') ? chalk.green('✓') : chalk.red('✗')} TWILIO_AUTH_TOKEN`
  );

  console.log(
    chalk.cyan(
      `\n${config.channel === 'whatsapp' ? 'WhatsApp' : 'SMS'} Numbers:`
    )
  );
  if (config.channel === 'whatsapp') {
    console.log(
      `  ${configured.includes('TWILIO_WHATSAPP_FROM') ? chalk.green('✓') : chalk.red('✗')} TWILIO_WHATSAPP_FROM`
    );
    console.log(
      `  ${configured.includes('TWILIO_WHATSAPP_TO') ? chalk.green('✓') : chalk.red('✗')} TWILIO_WHATSAPP_TO`
    );
  } else {
    console.log(
      `  ${configured.includes('TWILIO_SMS_FROM') ? chalk.green('✓') : chalk.red('✗')} TWILIO_SMS_FROM`
    );
    console.log(
      `  ${configured.includes('TWILIO_SMS_TO') ? chalk.green('✓') : chalk.red('✗')} TWILIO_SMS_TO`
    );
  }

  if (missing.length > 0) {
    console.log(chalk.yellow('\nAdd to your .env file or shell profile:'));
    console.log(chalk.gray('─'.repeat(50)));

    if (missing.includes('TWILIO_ACCOUNT_SID')) {
      console.log('export TWILIO_ACCOUNT_SID="your_account_sid"');
    }
    if (missing.includes('TWILIO_AUTH_TOKEN')) {
      console.log('export TWILIO_AUTH_TOKEN="your_auth_token"');
    }
    if (missing.includes('TWILIO_WHATSAPP_FROM')) {
      console.log(
        'export TWILIO_WHATSAPP_FROM="+14155238886"  # Twilio sandbox'
      );
    }
    if (missing.includes('TWILIO_WHATSAPP_TO')) {
      console.log('export TWILIO_WHATSAPP_TO="+1234567890"     # Your phone');
    }
    if (missing.includes('TWILIO_SMS_FROM')) {
      console.log('export TWILIO_SMS_FROM="+1234567890"  # Twilio number');
    }
    if (missing.includes('TWILIO_SMS_TO')) {
      console.log('export TWILIO_SMS_TO="+1234567890"    # Your phone');
    }

    console.log(chalk.gray('─'.repeat(50)));
  }

  console.log();
}

async function configureNotifications(): Promise<void> {
  console.log(chalk.blue.bold('\nNotification Setup\n'));

  const config = loadSMSConfig();
  const { missing } = getMissingConfig();

  // Ask if they want to enable
  const { enable } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'enable',
      message: 'Enable SMS/WhatsApp notifications?',
      default: config.enabled,
    },
  ]);

  if (!enable) {
    config.enabled = false;
    saveSMSConfig(config);
    console.log(chalk.yellow('Notifications disabled'));
    return;
  }

  // Choose channel
  const { channel } = await inquirer.prompt([
    {
      type: 'list',
      name: 'channel',
      message: 'Which channel do you want to use?',
      choices: [
        {
          name: 'WhatsApp (recommended - cheaper for conversations)',
          value: 'whatsapp',
        },
        { name: 'SMS (requires A2P 10DLC registration for US)', value: 'sms' },
      ],
      default: config.channel,
    },
  ]);

  config.channel = channel as MessageChannel;

  // Check for missing credentials
  if (
    missing.includes('TWILIO_ACCOUNT_SID') ||
    missing.includes('TWILIO_AUTH_TOKEN')
  ) {
    console.log(chalk.yellow('\nTwilio credentials not found in environment.'));

    const { hasAccount } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'hasAccount',
        message: 'Do you have a Twilio account?',
        default: true,
      },
    ]);

    if (!hasAccount) {
      console.log(chalk.cyan('\nCreate a free Twilio account:'));
      console.log('  https://www.twilio.com/try-twilio\n');
      console.log('Then run this command again.');
      return;
    }

    const { saveToEnv } = await inquirer.prompt([
      {
        type: 'confirm',
        name: 'saveToEnv',
        message: 'Would you like to save credentials to ~/.stackmemory/.env?',
        default: true,
      },
    ]);

    if (saveToEnv) {
      const { accountSid, authToken } = await inquirer.prompt([
        {
          type: 'input',
          name: 'accountSid',
          message: 'Twilio Account SID:',
          validate: (input: string) =>
            input.startsWith('AC') ? true : 'Account SID should start with AC',
        },
        {
          type: 'password',
          name: 'authToken',
          message: 'Twilio Auth Token:',
          mask: '*',
        },
      ]);

      saveToEnvFile({
        TWILIO_ACCOUNT_SID: accountSid,
        TWILIO_AUTH_TOKEN: authToken,
      });
      console.log(chalk.green('Credentials saved to ~/.stackmemory/.env'));
    }
  }

  // Get phone numbers
  if (channel === 'whatsapp') {
    console.log(chalk.cyan('\nWhatsApp Setup:'));
    console.log(
      '  1. Go to: https://console.twilio.com/us1/develop/sms/try-it-out/whatsapp-learn'
    );
    console.log('  2. Note the sandbox number (e.g., +14155238886)');
    console.log('  3. Send the join code from your phone\n');

    const { whatsappFrom, whatsappTo } = await inquirer.prompt([
      {
        type: 'input',
        name: 'whatsappFrom',
        message: 'Twilio WhatsApp number (sandbox):',
        default: config.whatsappFromNumber || '+14155238886',
      },
      {
        type: 'input',
        name: 'whatsappTo',
        message: 'Your phone number:',
        default: config.whatsappToNumber,
        validate: (input: string) =>
          input.startsWith('+')
            ? true
            : 'Include country code (e.g., +1234567890)',
      },
    ]);

    saveToEnvFile({
      TWILIO_WHATSAPP_FROM: whatsappFrom,
      TWILIO_WHATSAPP_TO: whatsappTo,
      TWILIO_CHANNEL: 'whatsapp',
    });
  } else {
    console.log(chalk.cyan('\nSMS Setup:'));
    console.log(
      chalk.yellow('  Note: US carriers require A2P 10DLC registration')
    );
    console.log(
      '  Register at: https://console.twilio.com/us1/develop/sms/settings/compliance\n'
    );

    const { smsFrom, smsTo } = await inquirer.prompt([
      {
        type: 'input',
        name: 'smsFrom',
        message: 'Twilio SMS number:',
        default: config.smsFromNumber,
      },
      {
        type: 'input',
        name: 'smsTo',
        message: 'Your phone number:',
        default: config.smsToNumber,
        validate: (input: string) =>
          input.startsWith('+')
            ? true
            : 'Include country code (e.g., +1234567890)',
      },
    ]);

    saveToEnvFile({
      TWILIO_SMS_FROM: smsFrom,
      TWILIO_SMS_TO: smsTo,
      TWILIO_CHANNEL: 'sms',
    });
  }

  config.enabled = true;
  saveSMSConfig(config);

  console.log(chalk.green('\nNotifications configured!'));
  console.log(chalk.gray('Test with: stackmemory notify test'));
}

function saveToEnvFile(vars: Record<string, string>): void {
  const envDir = join(homedir(), '.stackmemory');
  const envPath = join(envDir, '.env');

  if (!existsSync(envDir)) {
    mkdirSync(envDir, { recursive: true });
  }

  let content = '';
  if (existsSync(envPath)) {
    content = readFileSync(envPath, 'utf8');
  }

  for (const [key, value] of Object.entries(vars)) {
    const regex = new RegExp(`^${key}=.*$`, 'm');
    const line = `${key}="${value}"`;

    if (regex.test(content)) {
      content = content.replace(regex, line);
    } else {
      content += `${content.endsWith('\n') || content === '' ? '' : '\n'}${line}\n`;
    }
  }

  writeFileSync(envPath, content);
}

export default createSettingsCommand;
