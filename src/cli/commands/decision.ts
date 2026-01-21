/**
 * Decision capture command - Records key decisions for handoff context
 *
 * Usage:
 *   stackmemory decision add "Use SQLite as default" --why "Zero dependencies, faster onboarding"
 *   stackmemory decision list
 *   stackmemory decision clear
 */

import { Command } from 'commander';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join } from 'path';

interface Decision {
  id: string;
  what: string;
  why: string;
  alternatives?: string[];
  timestamp: string;
  category?: string;
}

interface DecisionStore {
  decisions: Decision[];
  sessionStart: string;
}

function getDecisionStorePath(projectRoot: string): string {
  return join(projectRoot, '.stackmemory', 'session-decisions.json');
}

function loadDecisions(projectRoot: string): DecisionStore {
  const storePath = getDecisionStorePath(projectRoot);
  if (existsSync(storePath)) {
    try {
      return JSON.parse(readFileSync(storePath, 'utf-8'));
    } catch {
      // Invalid file, start fresh
    }
  }
  return {
    decisions: [],
    sessionStart: new Date().toISOString(),
  };
}

function saveDecisions(projectRoot: string, store: DecisionStore): void {
  const storePath = getDecisionStorePath(projectRoot);
  const dir = join(projectRoot, '.stackmemory');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  writeFileSync(storePath, JSON.stringify(store, null, 2));
}

export function createDecisionCommand(): Command {
  const cmd = new Command('decision');
  cmd.description('Capture key decisions for session handoff context');

  // Add a decision
  cmd
    .command('add <what>')
    .description('Record a decision made during this session')
    .option('-w, --why <rationale>', 'Why this decision was made')
    .option(
      '-a, --alternatives <alts>',
      'Comma-separated alternatives considered'
    )
    .option(
      '-c, --category <category>',
      'Category (architecture, tooling, approach, etc.)'
    )
    .action((what, options) => {
      const projectRoot = process.cwd();
      const store = loadDecisions(projectRoot);

      const decision: Decision = {
        id: `d-${Date.now()}`,
        what,
        why: options.why || '',
        alternatives: options.alternatives
          ?.split(',')
          .map((a: string) => a.trim()),
        timestamp: new Date().toISOString(),
        category: options.category,
      };

      store.decisions.push(decision);
      saveDecisions(projectRoot, store);

      console.log('Decision recorded:');
      console.log(`  What: ${decision.what}`);
      if (decision.why) {
        console.log(`  Why: ${decision.why}`);
      }
      if (decision.alternatives) {
        console.log(`  Alternatives: ${decision.alternatives.join(', ')}`);
      }
      console.log(`\nTotal decisions this session: ${store.decisions.length}`);
    });

  // List decisions
  cmd
    .command('list')
    .description('List all decisions from this session')
    .option('--json', 'Output as JSON')
    .action((options) => {
      const projectRoot = process.cwd();
      const store = loadDecisions(projectRoot);

      if (options.json) {
        console.log(JSON.stringify(store.decisions, null, 2));
        return;
      }

      if (store.decisions.length === 0) {
        console.log('No decisions recorded this session.');
        console.log('\nRecord decisions with:');
        console.log('  stackmemory decision add "Decision" --why "Rationale"');
        return;
      }

      console.log(`Session Decisions (${store.decisions.length}):\n`);
      for (const d of store.decisions) {
        const category = d.category ? `[${d.category}] ` : '';
        console.log(`${category}${d.what}`);
        if (d.why) {
          console.log(`  Rationale: ${d.why}`);
        }
        if (d.alternatives && d.alternatives.length > 0) {
          console.log(`  Alternatives: ${d.alternatives.join(', ')}`);
        }
        console.log('');
      }
    });

  // Clear decisions (for new session)
  cmd
    .command('clear')
    .description('Clear all decisions (start fresh session)')
    .option('--force', 'Skip confirmation')
    .action((options) => {
      const projectRoot = process.cwd();
      const store = loadDecisions(projectRoot);

      if (store.decisions.length === 0) {
        console.log('No decisions to clear.');
        return;
      }

      if (!options.force) {
        console.log(`This will clear ${store.decisions.length} decisions.`);
        console.log('Use --force to confirm.');
        return;
      }

      const newStore: DecisionStore = {
        decisions: [],
        sessionStart: new Date().toISOString(),
      };
      saveDecisions(projectRoot, newStore);
      console.log('Decisions cleared. New session started.');
    });

  // Quick capture common decision types
  cmd
    .command('arch <description>')
    .description('Record an architecture decision')
    .option('-w, --why <rationale>', 'Why this architecture choice')
    .action((description, options) => {
      const projectRoot = process.cwd();
      const store = loadDecisions(projectRoot);

      const decision: Decision = {
        id: `d-${Date.now()}`,
        what: description,
        why: options.why || '',
        timestamp: new Date().toISOString(),
        category: 'architecture',
      };

      store.decisions.push(decision);
      saveDecisions(projectRoot, store);

      console.log(`Architecture decision recorded: ${description}`);
    });

  cmd
    .command('tool <description>')
    .description('Record a tooling decision')
    .option('-w, --why <rationale>', 'Why this tool choice')
    .action((description, options) => {
      const projectRoot = process.cwd();
      const store = loadDecisions(projectRoot);

      const decision: Decision = {
        id: `d-${Date.now()}`,
        what: description,
        why: options.why || '',
        timestamp: new Date().toISOString(),
        category: 'tooling',
      };

      store.decisions.push(decision);
      saveDecisions(projectRoot, store);

      console.log(`Tooling decision recorded: ${description}`);
    });

  return cmd;
}

// Export for use in enhanced handoff
export function getSessionDecisions(projectRoot: string): Decision[] {
  const store = loadDecisions(projectRoot);
  return store.decisions;
}
