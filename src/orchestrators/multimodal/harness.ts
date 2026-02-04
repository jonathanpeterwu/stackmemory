import { callClaude, callCodexCLI, implementWithClaude } from './providers.js';
import * as fs from 'fs';
import * as path from 'path';
import Database from 'better-sqlite3';
import { FrameManager } from '../../core/context/index.js';
import { deriveProjectId } from './utils.js';
import type {
  PlanningInput,
  ImplementationPlan,
  CritiqueResult,
  HarnessOptions,
  HarnessResult,
} from './types.js';

function heuristicPlan(input: PlanningInput): ImplementationPlan {
  return {
    summary: `Plan for: ${input.task}`,
    steps: [
      {
        id: 'plan-1',
        title: 'Understand requirements',
        rationale: 'Clarify task definition and constraints',
        acceptanceCriteria: ['Inputs/outputs documented', 'Edge cases listed'],
      },
      {
        id: 'plan-2',
        title: 'Add minimal harness modules',
        rationale: 'Create planner, implementer, critic adapters',
        acceptanceCriteria: [
          'Planner returns JSON plan',
          'Implementer can spawn codex-sm',
        ],
      },
      {
        id: 'plan-3',
        title: 'Wire CLI spike',
        rationale: 'Expose mm-spike entry for E2E flow',
        acceptanceCriteria: [
          'CLI prints plan',
          'Dry-run shows implementer command',
        ],
      },
    ],
    risks: [
      'Native module issues (sqlite) in dev env',
      'Provider quota or auth failures',
    ],
  };
}

export async function runSpike(
  input: PlanningInput,
  options: HarnessOptions = {}
): Promise<HarnessResult> {
  const plannerSystem = `You write concise, actionable implementation plans with numbered steps, acceptance criteria, and explicit risks. Output JSON only.`;

  // Attempt to enrich planner prompt with local StackMemory context (best-effort)
  const contextSummary = getLocalContextSummary(input.repoPath);
  const plannerPrompt = `Task: ${input.task}\nRepo: ${input.repoPath}\nNotes: ${input.contextNotes || '(none)'}\n${contextSummary}\nConstraints: Keep the plan minimal and implementable in a single PR.`;

  let plan: ImplementationPlan;
  try {
    const raw = await callClaude(plannerPrompt, {
      model: options.plannerModel,
      system: plannerSystem,
    });
    try {
      plan = JSON.parse(raw);
    } catch {
      // Fall back to heuristic if model returned text
      plan = heuristicPlan(input);
    }
  } catch {
    plan = heuristicPlan(input);
  }

  // Implementer (Codex by default) with retry loop driven by critique suggestions
  const implementer = (options.implementer || 'codex') as 'codex' | 'claude';
  const maxIters = Math.max(1, options.maxIters ?? 2);
  const iterations: HarnessResult['iterations'] = [];

  let approved = false;
  let lastCommand = '';
  let lastOutput = '';
  let lastCritique: CritiqueResult = {
    approved: true,
    issues: [],
    suggestions: [],
  };

  for (let i = 0; i < maxIters; i++) {
    const stepTitle =
      plan.steps[1]?.title || plan.steps[0]?.title || 'Initial step';
    const basePrompt = `Implement: ${stepTitle}. Keep changes minimal and focused. Avoid unrelated edits.`;
    const refine =
      i === 0
        ? ''
        : `\nIncorporate reviewer suggestions: ${lastCritique.suggestions.join('; ')}`;
    const implPrompt = basePrompt + refine;

    let ok = false;
    if (implementer === 'codex') {
      const impl = callCodexCLI(
        implPrompt,
        ['--no-trace'],
        options.dryRun !== false
      );
      ok = impl.ok;
      lastCommand = impl.command;
      lastOutput = impl.output;
    } else {
      const impl = await implementWithClaude(implPrompt, {
        model: options.plannerModel,
      });
      ok = impl.ok;
      lastCommand = `claude:${options.plannerModel || 'sonnet'} prompt`; // logical label
      lastOutput = impl.output;
    }

    // Critic
    const criticSystem = `You are a strict code reviewer. Return a JSON object: { approved: boolean, issues: string[], suggestions: string[] }`;
    const criticPrompt = `Plan: ${plan.summary}\nAttempt ${i + 1}/${maxIters}\nCommand: ${lastCommand}\nOutput: ${lastOutput.slice(0, 2000)}`;
    try {
      const raw = await callClaude(criticPrompt, {
        model: options.reviewerModel,
        system: criticSystem,
      });
      lastCritique = JSON.parse(raw);
    } catch {
      lastCritique = {
        approved: ok,
        issues: ok ? [] : ['Critique failed'],
        suggestions: [],
      };
    }

    iterations.push({
      command: lastCommand,
      ok,
      outputPreview: lastOutput.slice(0, 400),
      critique: lastCritique,
    });

    if (lastCritique.approved) {
      approved = true;
      break;
    }
  }

  // Persist audit
  try {
    const dir =
      options.auditDir || path.join(input.repoPath, '.stackmemory', 'mm-spike');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const file = path.join(dir, `spike-${stamp}.json`);
    fs.writeFileSync(
      file,
      JSON.stringify(
        {
          input,
          options: { ...options, auditDir: undefined },
          plan,
          iterations,
        },
        null,
        2
      )
    );
  } catch {
    // best-effort only
  }

  // Optionally record to local context DB
  if (options.record) {
    recordContext(input.repoPath, 'decision', `Plan: ${plan.summary}`, 0.8);
    recordContext(
      input.repoPath,
      'decision',
      `Critique: ${lastCritique.approved ? 'approved' : 'needs_changes'}`,
      0.6
    );
  }

  // Optionally record as a real frame with anchors
  if (options.recordFrame) {
    recordAsFrame(input.repoPath, input.task, plan, lastCritique, iterations);
  }

  return {
    plan,
    implementation: {
      success: approved,
      summary: approved
        ? 'Implementation approved by critic'
        : 'Implementation not approved',
      commands: iterations.map((it) => it.command),
    },
    critique: lastCritique,
    iterations,
  };
}

// Programmatic API alias, intended for chat UIs to call directly
export const runPlanAndCode = runSpike;

// Best-effort context recorder compatible with MCP server's contexts table
function recordContext(
  repoPath: string,
  type: string,
  content: string,
  importance = 0.6
) {
  try {
    const dbPath = path.join(repoPath, '.stackmemory', 'context.db');
    if (!fs.existsSync(path.dirname(dbPath)))
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    db.exec(`
      CREATE TABLE IF NOT EXISTS contexts (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        content TEXT NOT NULL,
        importance REAL DEFAULT 0.5,
        created_at INTEGER DEFAULT (unixepoch()),
        last_accessed INTEGER DEFAULT (unixepoch()),
        access_count INTEGER DEFAULT 1
      );
    `);
    const id = `ctx_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const stmt = db.prepare(
      'INSERT OR REPLACE INTO contexts (id, type, content, importance) VALUES (?, ?, ?, ?)'
    );
    stmt.run(id, type, content, importance);
    db.close();
  } catch {
    // ignore
  }
}

function recordAsFrame(
  repoPath: string,
  task: string,
  plan: ImplementationPlan,
  critique: CritiqueResult,
  iterations: NonNullable<HarnessResult['iterations']>
) {
  try {
    const dbPath = path.join(repoPath, '.stackmemory', 'context.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const db = new Database(dbPath);
    const projectId = deriveProjectId(repoPath);
    const fm = new FrameManager(db, projectId);
    const frameId = fm.createFrame({
      type: 'task',
      name: `Plan & Code: ${task}`,
      inputs: { plan },
    });

    // Anchors: decision (plan summary), fact (implementer commands), risk/todo (critique)
    fm.addAnchor('DECISION', plan.summary, 8, { source: 'mm-spike' }, frameId);
    const commands = iterations.map((it) => it.command).filter(Boolean);
    if (commands.length) {
      fm.addAnchor(
        'FACT',
        `Commands: ${commands.join(' | ')}`,
        5,
        { commands },
        frameId
      );
    }
    if (critique.issues?.length) {
      critique.issues
        .slice(0, 5)
        .forEach((issue) => fm.addAnchor('RISK', issue, 6, {}, frameId));
    }
    if (critique.suggestions?.length) {
      critique.suggestions
        .slice(0, 5)
        .forEach((s) =>
          fm.addAnchor('TODO', s, 5, { from: 'critic' }, frameId)
        );
    }

    fm.closeFrame(frameId, { approved: critique.approved });
    db.close();
  } catch {
    // best-effort
  }
}

// Lightweight planner: returns only the plan without implementation/critique
export async function runPlanOnly(
  input: PlanningInput,
  options: { plannerModel?: string } = {}
): Promise<ImplementationPlan> {
  const plannerSystem = `You write concise, actionable implementation plans with numbered steps, acceptance criteria, and explicit risks. Output JSON only.`;
  const contextSummary = getLocalContextSummary(input.repoPath);
  const plannerPrompt = `Task: ${input.task}\nRepo: ${input.repoPath}\nNotes: ${input.contextNotes || '(none)'}\n${contextSummary}\nConstraints: Keep the plan minimal and implementable in a single PR.`;

  try {
    const raw = await callClaude(plannerPrompt, {
      model: options.plannerModel,
      system: plannerSystem,
    });
    try {
      return JSON.parse(raw);
    } catch {
      return heuristicPlan(input);
    }
  } catch {
    return heuristicPlan(input);
  }
}

function getLocalContextSummary(repoPath: string): string {
  try {
    const dbPath = path.join(repoPath, '.stackmemory', 'context.db');
    if (!fs.existsSync(dbPath)) return 'Project context: (no local DB found)';
    const db = new Database(dbPath);
    // recent frames
    const frames = db
      .prepare(
        'SELECT name,type,state,digest_text,created_at FROM frames ORDER BY created_at DESC LIMIT 5'
      )
      .all() as Array<{
      name: string;
      type: string;
      state: string;
      digest_text: string | null;
      created_at: number;
    }>;
    // recent anchors
    const anchors = db
      .prepare(
        'SELECT type,text,priority,created_at FROM anchors ORDER BY created_at DESC LIMIT 5'
      )
      .all() as Array<{
      type: string;
      text: string;
      priority: number;
      created_at: number;
    }>;
    db.close();

    const fStr = frames
      .map(
        (f) =>
          `- [${f.type}/${f.state}] ${f.name} ${f.digest_text ? `— ${f.digest_text}` : ''}`
      )
      .join('\n');
    const aStr = anchors
      .map((a) => `- (${a.priority}) [${a.type}] ${a.text}`)
      .join('\n');
    return `Project context:\nRecent frames:\n${fStr || '(none)'}\nRecent anchors:\n${aStr || '(none)'}`;
  } catch {
    return 'Project context: (unavailable — local DB not ready)';
  }
}
