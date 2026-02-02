#!/usr/bin/env node
/**
 * GEPA Optimizer
 *
 * Genetic Eval-driven Prompt Algorithm for optimizing CLAUDE.md
 *
 * Usage:
 *   node optimize.js init                    # Initialize with current CLAUDE.md
 *   node optimize.js mutate                  # Generate new variants
 *   node optimize.js eval [variant]          # Run evals on variant(s)
 *   node optimize.js score                   # Score all variants in generation
 *   node optimize.js select                  # Select best, advance generation
 *   node optimize.js run [generations]       # Full optimization loop
 *   node optimize.js status                  # Show current status
 *   node optimize.js diff [a] [b]            # Compare two variants
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { spawn, execSync } from 'child_process';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Configuration
const CONFIG_PATH = path.join(__dirname, 'config.json');
const config = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));

const GEPA_DIR = process.env.GEPA_DIR || __dirname;
const GENERATIONS_DIR = path.join(GEPA_DIR, 'generations');
const RESULTS_DIR = path.join(GEPA_DIR, 'results');
const EVALS_DIR = path.join(GEPA_DIR, 'evals');

// Ensure directories
[GENERATIONS_DIR, RESULTS_DIR, EVALS_DIR].forEach((dir) => {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

/**
 * State management
 */
function getState() {
  const statePath = path.join(GEPA_DIR, 'state.json');
  if (fs.existsSync(statePath)) {
    return JSON.parse(fs.readFileSync(statePath, 'utf8'));
  }
  return {
    currentGeneration: 0,
    bestVariant: null,
    bestScore: 0,
    history: [],
  };
}

function saveState(state) {
  fs.writeFileSync(
    path.join(GEPA_DIR, 'state.json'),
    JSON.stringify(state, null, 2)
  );
}

/**
 * Get path for a generation/variant
 */
function getGenPath(gen, variant = null) {
  const genDir = path.join(
    GENERATIONS_DIR,
    `gen-${String(gen).padStart(3, '0')}`
  );
  if (!fs.existsSync(genDir)) fs.mkdirSync(genDir, { recursive: true });
  return variant ? path.join(genDir, `${variant}.md`) : genDir;
}

/**
 * Initialize GEPA with current CLAUDE.md
 */
async function init(targetPath) {
  const claudeMdPath = targetPath || path.join(process.cwd(), 'CLAUDE.md');

  if (!fs.existsSync(claudeMdPath)) {
    console.error(`Error: ${claudeMdPath} not found`);
    process.exit(1);
  }

  const content = fs.readFileSync(claudeMdPath, 'utf8');
  const genPath = getGenPath(0, 'baseline');

  fs.writeFileSync(genPath, content);

  const state = {
    currentGeneration: 0,
    bestVariant: 'baseline',
    bestScore: 0,
    targetPath: claudeMdPath,
    history: [
      {
        generation: 0,
        variant: 'baseline',
        action: 'init',
        timestamp: new Date().toISOString(),
      },
    ],
  };

  saveState(state);
  console.log(`Initialized GEPA with ${claudeMdPath}`);
  console.log(`Baseline saved to ${genPath}`);
}

/**
 * Generate mutations of the current best variant
 */
async function mutate() {
  const state = getState();
  const nextGen = state.currentGeneration + 1;
  const currentBest = fs.readFileSync(
    getGenPath(state.currentGeneration, state.bestVariant),
    'utf8'
  );

  console.log(
    `Generating ${config.evolution.populationSize} variants for generation ${nextGen}...`
  );

  const mutations = config.evolution.mutationStrategies;
  const variants = [];

  for (let i = 0; i < config.evolution.populationSize; i++) {
    const strategy = mutations[i % mutations.length];
    const variantName = `variant-${String.fromCharCode(97 + i)}`; // a, b, c, d...

    console.log(`  Creating ${variantName} using strategy: ${strategy}`);

    const mutatedContent = await generateMutation(currentBest, strategy, state);
    const variantPath = getGenPath(nextGen, variantName);

    fs.writeFileSync(variantPath, mutatedContent);
    variants.push({ name: variantName, strategy, path: variantPath });
  }

  // Also copy baseline for comparison
  fs.writeFileSync(getGenPath(nextGen, 'baseline'), currentBest);

  state.history.push({
    generation: nextGen,
    action: 'mutate',
    variants: variants.map((v) => v.name),
    timestamp: new Date().toISOString(),
  });
  saveState(state);

  console.log(
    `\nGenerated ${variants.length} variants in gen-${String(nextGen).padStart(3, '0')}/`
  );
  return variants;
}

/**
 * Generate a mutation using AI
 */
async function generateMutation(content, strategy, state) {
  const strategyPrompts = {
    rephrase: `Rephrase instructions for clarity without changing meaning. Make them more direct and actionable.`,

    add_examples: `Add concrete examples where instructions are abstract. Use <example> tags for code examples.`,

    remove_redundancy: `Remove redundant or repetitive instructions. Consolidate similar rules. Keep it DRY.`,

    restructure: `Reorganize sections for better flow. Group related instructions. Improve hierarchy.`,

    add_constraints: `Add specific constraints and guardrails based on common failure modes. Be precise about what NOT to do.`,

    simplify: `Simplify complex instructions. Break down multi-step rules. Use bullet points over paragraphs.`,
  };

  const prompt = `You are optimizing a CLAUDE.md system prompt for an AI coding agent.

CURRENT PROMPT:
\`\`\`markdown
${content}
\`\`\`

OPTIMIZATION STRATEGY: ${strategy}
${strategyPrompts[strategy]}

EVALUATION FEEDBACK FROM PREVIOUS GENERATIONS:
${getRecentFeedback(state)}

REQUIREMENTS:
1. Output ONLY the improved markdown content
2. Preserve all critical instructions and constraints
3. Keep the same overall structure unless restructuring
4. Do not add commentary or explanations
5. Target <8000 tokens total length

OUTPUT THE IMPROVED CLAUDE.MD:`;

  // Use Claude to generate mutation
  const result = await callClaude(prompt);
  return result.trim();
}

/**
 * Get recent evaluation feedback for context
 */
function getRecentFeedback(state) {
  const scoresPath = path.join(RESULTS_DIR, 'scores.jsonl');
  if (!fs.existsSync(scoresPath)) return 'No previous evaluations.';

  const lines = fs
    .readFileSync(scoresPath, 'utf8')
    .trim()
    .split('\n')
    .slice(-20);
  const scores = lines.map((l) => JSON.parse(l));

  const summary = scores.reduce((acc, s) => {
    if (!acc[s.variant]) acc[s.variant] = { total: 0, count: 0, errors: 0 };
    acc[s.variant].total += s.metrics?.successfulToolCalls || 0;
    acc[s.variant].count++;
    acc[s.variant].errors += s.metrics?.errorCount || 0;
    return acc;
  }, {});

  return Object.entries(summary)
    .map(
      ([v, s]) =>
        `${v}: ${s.count} sessions, ${s.errors} errors, avg success: ${(s.total / s.count).toFixed(1)}`
    )
    .join('\n');
}

/**
 * Call Claude API for mutation generation
 */
async function callClaude(prompt) {
  // Try using claude CLI first
  try {
    const result = execSync(`echo ${JSON.stringify(prompt)} | claude --print`, {
      encoding: 'utf8',
      maxBuffer: 10 * 1024 * 1024,
    });
    return result;
  } catch (e) {
    // Fallback to API
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error('Error: ANTHROPIC_API_KEY not set and claude CLI failed');
      process.exit(1);
    }

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 8000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    return data.content[0].text;
  }
}

/**
 * Run evaluations on a variant
 */
async function runEval(variantName) {
  const state = getState();
  const gen = state.currentGeneration + 1; // Eval next gen variants
  const variantPath = getGenPath(gen, variantName);

  if (!fs.existsSync(variantPath)) {
    console.error(`Variant not found: ${variantPath}`);
    return null;
  }

  console.log(`Running evals on ${variantName}...`);

  // Load eval tasks
  const evalFiles = fs
    .readdirSync(EVALS_DIR)
    .filter((f) => f.endsWith('.jsonl'));
  const tasks = evalFiles.flatMap((f) =>
    fs
      .readFileSync(path.join(EVALS_DIR, f), 'utf8')
      .trim()
      .split('\n')
      .map((l) => JSON.parse(l))
  );

  console.log(`  Found ${tasks.length} eval tasks`);

  // Set environment for tracking
  process.env.GEPA_VARIANT = variantName;
  process.env.GEPA_GENERATION = String(gen);

  const results = [];

  for (const task of tasks.slice(0, config.evals.minSamplesPerVariant)) {
    console.log(`  Running: ${task.name}`);

    const result = await runSingleEval(task, variantPath);
    results.push({
      taskId: task.id,
      taskName: task.name,
      ...result,
    });
  }

  // Save results
  const resultsPath = path.join(RESULTS_DIR, `eval-${gen}-${variantName}.json`);
  fs.writeFileSync(
    resultsPath,
    JSON.stringify({ variant: variantName, generation: gen, results }, null, 2)
  );

  // Calculate aggregate score
  const score = calculateScore(results);
  console.log(`  Score: ${(score * 100).toFixed(1)}%`);

  return { variant: variantName, score, results };
}

/**
 * Run a single eval task
 */
async function runSingleEval(task, variantPath) {
  const startTime = Date.now();

  try {
    // Create temp project with variant as CLAUDE.md
    const tempDir = fs.mkdtempSync('/tmp/gepa-eval-');
    fs.copyFileSync(variantPath, path.join(tempDir, 'CLAUDE.md'));

    // Copy fixture if needed
    if (task.input_file) {
      const fixturePath = path.join(EVALS_DIR, task.input_file);
      if (fs.existsSync(fixturePath)) {
        fs.copyFileSync(
          fixturePath,
          path.join(tempDir, path.basename(task.input_file))
        );
      }
    }

    // Run claude with the task prompt
    const result = execSync(
      `cd ${tempDir} && echo ${JSON.stringify(task.prompt)} | timeout ${config.evals.timeout / 1000} claude --print 2>&1 || true`,
      { encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 }
    );

    // Evaluate result against expected outcomes
    const passed = evaluateExpectations(result, task.expected);

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });

    return {
      passed,
      duration: Date.now() - startTime,
      output: result.slice(0, 2000),
    };
  } catch (error) {
    return {
      passed: false,
      duration: Date.now() - startTime,
      error: error.message,
    };
  }
}

/**
 * Evaluate output against expectations
 */
function evaluateExpectations(output, expected) {
  if (!expected) return true;

  const checks = Object.entries(expected).map(([key, value]) => {
    // Simple heuristic checks
    switch (key) {
      case 'has_function':
        return /function\s+\w+|const\s+\w+\s*=\s*(\([^)]*\)|async)?\s*(=>|\{)/.test(
          output
        );
      case 'handles_edge_cases':
        return /if\s*\(|edge|empty|null|undefined|\.length/.test(output);
      case 'uses_async':
        return /async|await|Promise/.test(output);
      case 'no_nested_callbacks':
        return !/callback\s*\(\s*function|\.then\s*\([^)]*\.then/.test(output);
      case 'bug_fixed':
        return /fix|correct|change|update/i.test(output);
      case 'explains_fix':
        return (
          output.length > 200 &&
          /because|since|the issue|the problem/i.test(output)
        );
      default:
        return output.toLowerCase().includes(key.toLowerCase());
    }
  });

  return checks.filter(Boolean).length / checks.length >= 0.6;
}

/**
 * Calculate weighted score
 */
function calculateScore(results) {
  const passed = results.filter((r) => r.passed).length;
  return passed / results.length;
}

/**
 * Score all variants and select best
 */
async function scoreAndSelect() {
  const state = getState();
  const gen = state.currentGeneration + 1;
  const genDir = getGenPath(gen);

  if (!fs.existsSync(genDir)) {
    console.error(`Generation ${gen} not found. Run 'mutate' first.`);
    return;
  }

  const variants = fs
    .readdirSync(genDir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => f.replace('.md', ''));

  console.log(`Scoring ${variants.length} variants in generation ${gen}...`);

  const scores = [];

  for (const variant of variants) {
    const result = await runEval(variant);
    if (result) scores.push(result);
  }

  // Sort by score
  scores.sort((a, b) => b.score - a.score);

  console.log('\nResults:');
  scores.forEach((s, i) => {
    const marker = i === 0 ? ' <-- BEST' : '';
    console.log(
      `  ${i + 1}. ${s.variant}: ${(s.score * 100).toFixed(1)}%${marker}`
    );
  });

  // Select best
  const best = scores[0];

  if (best.score > state.bestScore) {
    state.currentGeneration = gen;
    state.bestVariant = best.variant;
    state.bestScore = best.score;

    // Update symlink
    const currentLink = path.join(GENERATIONS_DIR, 'current');
    if (fs.existsSync(currentLink)) fs.unlinkSync(currentLink);
    fs.symlinkSync(getGenPath(gen, best.variant), currentLink);

    console.log(
      `\nNew best: ${best.variant} (${(best.score * 100).toFixed(1)}%)`
    );
    console.log(
      `Symlink updated: generations/current -> gen-${String(gen).padStart(3, '0')}/${best.variant}.md`
    );
  } else {
    console.log(
      `\nNo improvement over previous best (${(state.bestScore * 100).toFixed(1)}%)`
    );
  }

  state.history.push({
    generation: gen,
    action: 'select',
    scores: scores.map((s) => ({ variant: s.variant, score: s.score })),
    best: best.variant,
    timestamp: new Date().toISOString(),
  });

  saveState(state);
  return best;
}

/**
 * Full optimization loop
 */
async function run(generations = config.evolution.generations) {
  console.log(`Starting GEPA optimization for ${generations} generations...\n`);

  for (let i = 0; i < generations; i++) {
    console.log(`\n${'='.repeat(60)}`);
    console.log(`GENERATION ${i + 1}/${generations}`);
    console.log(`${'='.repeat(60)}\n`);

    await mutate();
    const best = await scoreAndSelect();

    if (best.score >= config.scoring.threshold) {
      console.log(
        `\nThreshold reached (${(config.scoring.threshold * 100).toFixed(0)}%)! Stopping early.`
      );
      break;
    }
  }

  console.log('\n' + '='.repeat(60));
  console.log('OPTIMIZATION COMPLETE');
  console.log('='.repeat(60));

  const state = getState();
  console.log(`Best variant: ${state.bestVariant}`);
  console.log(`Best score: ${(state.bestScore * 100).toFixed(1)}%`);
  console.log(`Generations: ${state.currentGeneration}`);
  console.log(`\nTo apply: cp generations/current /path/to/your/CLAUDE.md`);
}

/**
 * Show status
 */
function status() {
  const state = getState();

  console.log('GEPA Status');
  console.log('===========');
  console.log(`Current generation: ${state.currentGeneration}`);
  console.log(`Best variant: ${state.bestVariant}`);
  console.log(`Best score: ${(state.bestScore * 100).toFixed(1)}%`);
  console.log(`Target: ${state.targetPath}`);
  console.log(`\nHistory:`);

  state.history.slice(-10).forEach((h) => {
    console.log(`  [${h.timestamp}] ${h.action} (gen ${h.generation})`);
  });
}

/**
 * Diff two variants
 */
function diff(a, b) {
  const state = getState();
  const gen = state.currentGeneration;

  const pathA = getGenPath(gen, a || 'baseline');
  const pathB = getGenPath(gen, b || state.bestVariant);

  if (!fs.existsSync(pathA) || !fs.existsSync(pathB)) {
    console.error('Variant not found');
    return;
  }

  try {
    execSync(`diff -u ${pathA} ${pathB}`, { stdio: 'inherit' });
  } catch (e) {
    // diff returns non-zero when files differ
  }
}

// CLI
const command = process.argv[2];
const arg1 = process.argv[3];
const arg2 = process.argv[4];

switch (command) {
  case 'init':
    init(arg1);
    break;
  case 'mutate':
    mutate();
    break;
  case 'eval':
    runEval(arg1 || 'baseline');
    break;
  case 'select':
  case 'score':
    scoreAndSelect();
    break;
  case 'run':
    run(parseInt(arg1) || config.evolution.generations);
    break;
  case 'status':
    status();
    break;
  case 'diff':
    diff(arg1, arg2);
    break;
  default:
    console.log(`
GEPA - Genetic Eval-driven Prompt Algorithm

Usage:
  node optimize.js init [path]           Initialize with CLAUDE.md
  node optimize.js mutate                Generate new variants
  node optimize.js eval [variant]        Run evals on variant
  node optimize.js score                 Score all variants, select best
  node optimize.js run [generations]     Full optimization loop
  node optimize.js status                Show current status
  node optimize.js diff [a] [b]          Compare two variants
`);
}
