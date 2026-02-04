import { callClaude, callCodexCLI, implementWithClaude } from './providers.js';
import * as fs from 'fs';
import * as path from 'path';
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
  // Generic fallback plan when Claude API is unavailable
  return {
    summary: `Plan for: ${input.task}`,
    steps: [
      {
        id: 'step-1',
        title: 'Analyze requirements',
        rationale: 'Understand the task scope and constraints',
        acceptanceCriteria: [
          'Requirements clearly defined',
          'Edge cases identified',
        ],
      },
      {
        id: 'step-2',
        title: 'Implement core changes',
        rationale: 'Make the minimal changes needed to complete the task',
        acceptanceCriteria: [
          'Code compiles without errors',
          'Core functionality works',
        ],
      },
      {
        id: 'step-3',
        title: 'Verify and test',
        rationale: 'Ensure changes work correctly',
        acceptanceCriteria: ['Tests pass', 'No regressions introduced'],
      },
    ],
    risks: [
      'API key not configured - using heuristic plan',
      'May need manual review of generated code',
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
    // Build implementation prompt from all plan steps
    const stepsList = plan.steps
      .map((s, idx) => `${idx + 1}. ${s.title}`)
      .join('\n');
    const basePrompt = `Implement the following plan:\n${stepsList}\n\nKeep changes minimal and focused. Avoid unrelated edits.`;
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
      options.auditDir || path.join(input.repoPath, '.stackmemory', 'build');
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
    void recordContext(
      input.repoPath,
      'decision',
      `Plan: ${plan.summary}`,
      0.8
    );
    void recordContext(
      input.repoPath,
      'decision',
      `Critique: ${lastCritique.approved ? 'approved' : 'needs_changes'}`,
      0.6
    );
  }

  // Optionally record as a real frame with anchors
  if (options.recordFrame) {
    void recordAsFrame(
      input.repoPath,
      input.task,
      plan,
      lastCritique,
      iterations
    );
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
async function recordContext(
  repoPath: string,
  type: string,
  content: string,
  importance = 0.6
) {
  try {
    const dbPath = path.join(repoPath, '.stackmemory', 'context.db');
    if (!fs.existsSync(path.dirname(dbPath)))
      fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const { default: Database } = await import('better-sqlite3');
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

async function recordAsFrame(
  repoPath: string,
  task: string,
  plan: ImplementationPlan,
  critique: CritiqueResult,
  iterations: NonNullable<HarnessResult['iterations']>
) {
  try {
    const dbPath = path.join(repoPath, '.stackmemory', 'context.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    const { default: Database } = await import('better-sqlite3');
    const db = new Database(dbPath);
    const projectId = deriveProjectId(repoPath);
    const fm = new FrameManager(db, projectId);
    const frameId = fm.createFrame({
      type: 'task',
      name: `Plan & Code: ${task}`,
      inputs: { plan },
    });

    // Anchors: decision (plan summary), fact (implementer commands), risk/todo (critique)
    fm.addAnchor('DECISION', plan.summary, 8, { source: 'build' }, frameId);
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
    // Keep it lightweight to avoid native module in planning path
    return 'Project context: (available — DB present)';
  } catch {
    return 'Project context: (unavailable — local DB not ready)';
  }
}
