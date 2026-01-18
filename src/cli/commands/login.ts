import { Command } from 'commander';
import inquirer from 'inquirer';
import chalk from 'chalk';
import { homedir } from 'os';
import { join } from 'path';
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'fs';

interface ConfigShape {
  version?: string;
  setupCompleted?: string;
  features?: any;
  paths?: any;
  database?: { mode?: 'local' | 'hosted'; url?: string };
}

export function registerLoginCommand(program: Command): void {
  program
    .command('login')
    .description('Login to hosted StackMemory (configure managed Postgres)')
    .option('--open', 'Open hosted signup/login page before prompting')
    .action(async (options) => {
      const cfgDir = join(homedir(), '.stackmemory');
      if (!existsSync(cfgDir)) mkdirSync(cfgDir, { recursive: true });

      if (options.open) {
        try {
          const signupUrl = 'https://stackmemory.ai/hosted';
          const mod = await import('open');
          await mod.default(signupUrl);
        } catch (e) {
          console.log(chalk.yellow('Could not open browser automatically.'));
        }
      }

      const { databaseUrl } = await inquirer.prompt([
        {
          type: 'password',
          name: 'databaseUrl',
          message: 'Paste your hosted DATABASE_URL (postgres://...)',
          validate: (input: string) =>
            input.startsWith('postgres://') || input.startsWith('postgresql://')
              ? true
              : 'Must start with postgres:// or postgresql://',
        },
      ]);

      // Merge into config.json
      const cfgPath = join(cfgDir, 'config.json');
      let cfg: ConfigShape = {};
      try {
        if (existsSync(cfgPath)) cfg = JSON.parse(readFileSync(cfgPath, 'utf-8'));
      } catch {}
      cfg.database = { ...(cfg.database || {}), mode: 'hosted', url: databaseUrl };
      writeFileSync(cfgPath, JSON.stringify(cfg, null, 2));
      console.log(chalk.green('✓ Hosted database configured in ~/.stackmemory/config.json'));

      // Save env helper
      try {
        const envFile = join(cfgDir, 'railway.env');
        writeFileSync(envFile, `# StackMemory hosted DB\nDATABASE_URL=${databaseUrl}\n`);
        console.log(chalk.green('✓ Saved DATABASE_URL to ~/.stackmemory/railway.env'));
      } catch {}

      console.log(chalk.gray('Tip: export DATABASE_URL before starting the server.'));
    });
}

