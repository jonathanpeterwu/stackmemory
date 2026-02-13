/**
 * Provider Benchmark — compare latency, cost, and output across providers.
 *
 * Run:  BENCH_PROVIDERS=1 npx vitest run src/core/extensions/__tests__/provider-benchmark.test.ts
 *
 * Skipped entirely when BENCH_PROVIDERS is not set.
 * Individual providers skip when their API key is missing.
 * Results written to /tmp/provider-benchmark-<timestamp>.json
 */

import { describe, it, expect, afterAll } from 'vitest';
import {
  createProvider,
  type ProviderAdapter,
  type TextBlock,
} from '../provider-adapter.js';
import { calculateCost, formatCost } from '../../models/provider-pricing.js';

const BENCH = process.env['BENCH_PROVIDERS'] === '1';

// ---------------------------------------------------------------------------
// Provider definitions — each maps to a createProvider call
// ---------------------------------------------------------------------------

interface ProviderDef {
  name: string;
  providerId: Parameters<typeof createProvider>[0];
  model: string;
  apiKeyEnv: string;
  baseUrl?: string;
  pricingKey: string; // "provider/model" key into MODEL_PRICING
}

const PROVIDERS: ProviderDef[] = [
  {
    name: 'OpenRouter (Llama-4-Scout)',
    providerId: 'openrouter',
    model: 'meta-llama/llama-4-scout',
    apiKeyEnv: 'OPENROUTER_API_KEY',
    pricingKey: 'openrouter/meta-llama/llama-4-scout',
  },
  {
    name: 'OpenAI (GPT-4o)',
    providerId: 'openai',
    model: 'gpt-4o',
    apiKeyEnv: 'OPENAI_API_KEY',
    pricingKey: 'openai/gpt-4o',
  },
  {
    name: 'Anthropic (Claude Sonnet 4.5)',
    providerId: 'anthropic',
    model: 'claude-sonnet-4-5-20250929',
    apiKeyEnv: 'ANTHROPIC_API_KEY',
    pricingKey: 'anthropic/claude-sonnet-4-5-20250929',
  },
  {
    name: 'Cerebras (Llama-4-Scout)',
    providerId: 'cerebras',
    model: 'llama-4-scout-17b-16e-instruct',
    apiKeyEnv: 'CEREBRAS_API_KEY',
    pricingKey: 'cerebras/llama-4-scout-17b-16e-instruct',
  },
  {
    name: 'DeepInfra (GLM-4-9b)',
    providerId: 'deepinfra',
    model: 'THUDM/glm-4-9b-chat',
    apiKeyEnv: 'DEEPINFRA_API_KEY',
    pricingKey: 'deepinfra/THUDM/glm-4-9b-chat',
  },
];

// ---------------------------------------------------------------------------
// Test prompts — identical across all providers
// ---------------------------------------------------------------------------

const PROMPTS = {
  short: {
    label: 'short',
    messages: [
      { role: 'user' as const, content: 'Reply with exactly: hello world' },
    ],
    maxTokens: 32,
  },
  medium: {
    label: 'medium',
    messages: [
      {
        role: 'user' as const,
        content:
          'Write a TypeScript function called `isPalindrome` that checks if a string is a palindrome. Include one sentence explaining how it works.',
      },
    ],
    maxTokens: 256,
  },
};

// ---------------------------------------------------------------------------
// Results collection
// ---------------------------------------------------------------------------

interface QualityScore {
  instructionFollow: number; // 0-1: did it follow the instruction?
  codePresent: boolean; // contains a code block?
  hasFunction: boolean; // contains the requested function name?
  hasExplanation: boolean; // contains a prose explanation?
  completeness: number; // 0-1: overall completeness
  overall: number; // 0-1: weighted quality score
}

interface BenchResult {
  provider: string;
  model: string;
  prompt: string;
  latencyMs: number;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  costUsd: number | null;
  responseLength: number;
  responsePreview: string;
  quality: QualityScore | null;
  valueScore: number | null; // quality / cost — higher is better
  error?: string;
}

const results: BenchResult[] = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Score quality of the "short" prompt response.
 * Expected: exactly "hello world" (case-insensitive, trimmed).
 */
function scoreShort(text: string): QualityScore {
  const cleaned = text
    .trim()
    .toLowerCase()
    .replace(/[^a-z ]/g, '');
  const exactMatch = cleaned === 'hello world';
  const partialMatch = cleaned.includes('hello') && cleaned.includes('world');
  const instructionFollow = exactMatch ? 1.0 : partialMatch ? 0.7 : 0.2;

  return {
    instructionFollow,
    codePresent: false,
    hasFunction: false,
    hasExplanation: false,
    completeness: instructionFollow,
    overall: instructionFollow,
  };
}

/**
 * Score quality of the "medium" prompt response.
 * Expected: TypeScript function `isPalindrome` + one explanation sentence.
 */
function scoreMedium(text: string): QualityScore {
  const hasCodeBlock =
    /```(?:typescript|ts)?[\s\S]*?```/.test(text) ||
    /function\s+\w+/.test(text);
  const hasFunction = /isPalindrome/.test(text);
  const hasReturn = /return\s/.test(text);
  const hasExplanation = text.replace(/```[\s\S]*?```/g, '').trim().length > 20;
  const hasTypeAnnotation = /:\s*(?:string|boolean)/.test(text);

  // Code quality sub-score
  const codeScore =
    (hasCodeBlock ? 0.3 : 0) +
    (hasFunction ? 0.25 : 0) +
    (hasReturn ? 0.15 : 0) +
    (hasTypeAnnotation ? 0.1 : 0);

  const completeness =
    (hasCodeBlock ? 0.4 : 0) +
    (hasFunction ? 0.2 : 0) +
    (hasExplanation ? 0.2 : 0) +
    (hasReturn ? 0.1 : 0) +
    (hasTypeAnnotation ? 0.1 : 0);

  // Instruction following: asked for function + explanation
  const instructionFollow =
    (hasFunction ? 0.4 : 0) +
    (hasCodeBlock ? 0.3 : 0) +
    (hasExplanation ? 0.3 : 0);

  return {
    instructionFollow,
    codePresent: hasCodeBlock,
    hasFunction,
    hasExplanation,
    completeness,
    overall: instructionFollow * 0.5 + codeScore * 0.3 + completeness * 0.2,
  };
}

function scoreResponse(prompt: string, text: string): QualityScore {
  if (prompt === 'short') return scoreShort(text);
  if (prompt === 'medium') return scoreMedium(text);
  return {
    instructionFollow: 0,
    codePresent: false,
    hasFunction: false,
    hasExplanation: false,
    completeness: 0,
    overall: 0,
  };
}

/**
 * Value score = quality / normalized_cost.
 * Higher is better — "most quality per dollar".
 * Uses log scale for cost to avoid extremes dominating.
 */
function computeValueScore(
  quality: number,
  costUsd: number | null,
  latencyMs: number
): number | null {
  if (costUsd === null || costUsd === 0) return null;
  // Penalize latency: decay factor 0.9 per second over 1s baseline
  const latencyPenalty = Math.pow(0.9, Math.max(0, (latencyMs - 1000) / 1000));
  // Scale cost to per-1000-requests to get readable numbers
  const costPer1k = costUsd * 1000;
  return (quality * latencyPenalty) / costPer1k;
}

function extractText(
  adapter: ProviderAdapter,
  content: Awaited<ReturnType<ProviderAdapter['complete']>>['content']
): string {
  return content
    .filter((c): c is TextBlock => c.type === 'text')
    .map((c) => c.text)
    .join('');
}

async function benchmarkCall(
  def: ProviderDef,
  adapter: ProviderAdapter,
  prompt: (typeof PROMPTS)[keyof typeof PROMPTS]
): Promise<BenchResult> {
  const start = performance.now();
  try {
    const result = await adapter.complete(prompt.messages, {
      model: def.model,
      maxTokens: prompt.maxTokens,
      temperature: 0,
    });
    const latencyMs = performance.now() - start;
    const text = extractText(adapter, result.content);
    const cost = calculateCost(
      def.pricingKey.split('/')[0],
      def.pricingKey.split('/').slice(1).join('/'),
      result.usage.inputTokens,
      result.usage.outputTokens
    );

    const quality = scoreResponse(prompt.label, text);
    const totalCost = cost?.totalCost ?? null;
    const valueScore = computeValueScore(quality.overall, totalCost, latencyMs);

    return {
      provider: def.name,
      model: def.model,
      prompt: prompt.label,
      latencyMs: Math.round(latencyMs),
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      totalTokens: result.usage.inputTokens + result.usage.outputTokens,
      costUsd: totalCost,
      responseLength: text.length,
      responsePreview: text.slice(0, 120),
      quality,
      valueScore,
    };
  } catch (error: any) {
    return {
      provider: def.name,
      model: def.model,
      prompt: prompt.label,
      latencyMs: Math.round(performance.now() - start),
      inputTokens: 0,
      outputTokens: 0,
      totalTokens: 0,
      costUsd: null,
      responseLength: 0,
      responsePreview: '',
      quality: null,
      valueScore: null,
      error: error.message,
    };
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe.skipIf(!BENCH)('Provider Benchmark', () => {
  // Write results after all tests complete
  afterAll(async () => {
    if (results.length === 0) return;

    const { writeFileSync } = await import('fs');
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const outPath = `/tmp/provider-benchmark-${ts}.json`;

    const summary = {
      timestamp: new Date().toISOString(),
      results,
      comparison: buildComparison(results),
    };

    writeFileSync(outPath, JSON.stringify(summary, null, 2));
    console.log(`\n  Benchmark results → ${outPath}`);
    printTable(results);
  });

  for (const def of PROVIDERS) {
    const hasKey = !!process.env[def.apiKeyEnv];

    describe.skipIf(!hasKey)(def.name, () => {
      let adapter: ProviderAdapter;

      adapter = createProvider(def.providerId, {
        apiKey: process.env[def.apiKeyEnv]!,
        baseUrl: def.baseUrl,
      });

      it(`short prompt — latency + cost`, async () => {
        const r = await benchmarkCall(def, adapter, PROMPTS.short);
        results.push(r);

        if (r.error) {
          console.warn(`  ⚠ ${def.name} short: ${r.error}`);
        } else {
          expect(r.responseLength).toBeGreaterThan(0);
          expect(r.latencyMs).toBeLessThan(30_000);
        }
      }, 30_000);

      it(`medium prompt — latency + cost`, async () => {
        const r = await benchmarkCall(def, adapter, PROMPTS.medium);
        results.push(r);

        if (r.error) {
          console.warn(`  ⚠ ${def.name} medium: ${r.error}`);
        } else {
          expect(r.responseLength).toBeGreaterThan(20);
          expect(r.latencyMs).toBeLessThan(30_000);
        }
      }, 30_000);

      it(`validateConnection`, async () => {
        const ok = await adapter.validateConnection();
        // Some providers reject with valid key but wrong permissions
        if (!ok)
          console.warn(`  ⚠ ${def.name}: validateConnection returned false`);
      }, 15_000);
    });
  }
});

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

interface ProviderRanking {
  provider: string;
  avgQuality: number;
  avgLatencyMs: number;
  totalCostUsd: number;
  avgValueScore: number | null;
  grade: string; // A/B/C/D/F
}

interface Comparison {
  cheapest: { provider: string; costUsd: number } | null;
  fastest: { provider: string; latencyMs: number } | null;
  bestQuality: { provider: string; quality: number } | null;
  bestValue: { provider: string; valueScore: number } | null;
  rankings: ProviderRanking[];
  byPrompt: Record<
    string,
    {
      cheapest: string;
      fastest: string;
      bestQuality: string;
      bestValue: string;
    }
  >;
}

function gradeProvider(
  avgQuality: number,
  avgValueScore: number | null
): string {
  if (avgValueScore === null) return '?';
  // Quality gates: must meet minimum quality to get high grade
  if (avgQuality < 0.3) return 'F';
  if (avgQuality < 0.5) return 'D';
  // Value-based grading (quality already above threshold)
  if (avgValueScore >= 100) return 'A';
  if (avgValueScore >= 20) return 'B';
  if (avgValueScore >= 5) return 'C';
  return 'D';
}

function buildComparison(data: BenchResult[]): Comparison {
  const successful = data.filter((r) => !r.error && r.costUsd !== null);
  const byPrompt: Comparison['byPrompt'] = {};

  for (const prompt of ['short', 'medium']) {
    const group = successful.filter((r) => r.prompt === prompt);
    if (group.length === 0) continue;

    const cheapest = group.reduce((a, b) => (a.costUsd! < b.costUsd! ? a : b));
    const fastest = group.reduce((a, b) => (a.latencyMs < b.latencyMs ? a : b));
    const bestQ = group.reduce((a, b) =>
      (a.quality?.overall ?? 0) > (b.quality?.overall ?? 0) ? a : b
    );
    const withValue = group.filter((r) => r.valueScore !== null);
    const bestV = withValue.length
      ? withValue.reduce((a, b) => (a.valueScore! > b.valueScore! ? a : b))
      : null;

    byPrompt[prompt] = {
      cheapest: `${cheapest.provider} (${formatCost(cheapest.costUsd!)})`,
      fastest: `${fastest.provider} (${fastest.latencyMs}ms)`,
      bestQuality: `${bestQ.provider} (${((bestQ.quality?.overall ?? 0) * 100).toFixed(0)}%)`,
      bestValue: bestV
        ? `${bestV.provider} (${bestV.valueScore!.toFixed(1)})`
        : 'N/A',
    };
  }

  // Aggregate per provider
  const providerNames = [...new Set(successful.map((r) => r.provider))];
  const rankings: ProviderRanking[] = providerNames
    .map((name) => {
      const rows = successful.filter((r) => r.provider === name);
      const avgQuality =
        rows.reduce((s, r) => s + (r.quality?.overall ?? 0), 0) / rows.length;
      const avgLatencyMs =
        rows.reduce((s, r) => s + r.latencyMs, 0) / rows.length;
      const totalCostUsd = rows.reduce((s, r) => s + (r.costUsd ?? 0), 0);
      const withValue = rows.filter((r) => r.valueScore !== null);
      const avgValueScore = withValue.length
        ? withValue.reduce((s, r) => s + r.valueScore!, 0) / withValue.length
        : null;

      return {
        provider: name,
        avgQuality,
        avgLatencyMs: Math.round(avgLatencyMs),
        totalCostUsd,
        avgValueScore,
        grade: gradeProvider(avgQuality, avgValueScore),
      };
    })
    .sort((a, b) => (b.avgValueScore ?? 0) - (a.avgValueScore ?? 0));

  const allCosts = successful.filter((r) => r.costUsd! > 0);
  const allQuality = successful.filter((r) => r.quality !== null);
  const allValue = successful.filter((r) => r.valueScore !== null);

  return {
    cheapest: allCosts.length
      ? (() => {
          const c = allCosts.reduce((a, b) =>
            a.costUsd! < b.costUsd! ? a : b
          );
          return { provider: c.provider, costUsd: c.costUsd! };
        })()
      : null,
    fastest: successful.length
      ? (() => {
          const f = successful.reduce((a, b) =>
            a.latencyMs < b.latencyMs ? a : b
          );
          return { provider: f.provider, latencyMs: f.latencyMs };
        })()
      : null,
    bestQuality: allQuality.length
      ? (() => {
          const q = allQuality.reduce((a, b) =>
            (a.quality?.overall ?? 0) > (b.quality?.overall ?? 0) ? a : b
          );
          return { provider: q.provider, quality: q.quality!.overall };
        })()
      : null,
    bestValue: allValue.length
      ? (() => {
          const v = allValue.reduce((a, b) =>
            a.valueScore! > b.valueScore! ? a : b
          );
          return { provider: v.provider, valueScore: v.valueScore! };
        })()
      : null,
    rankings,
    byPrompt,
  };
}

function printTable(data: BenchResult[]): void {
  console.log(
    '\n  ┌─ Provider Benchmark Results ───────────────────────────────────────────────────────────┐'
  );
  console.log(
    '  │ Provider                        │ Prompt │ Latency │ Cost     │ Quality │ Value  │'
  );
  console.log(
    '  ├─────────────────────────────────┼────────┼─────────┼──────────┼─────────┼────────┤'
  );

  for (const r of data) {
    if (r.error) {
      const name = r.provider.padEnd(31);
      const prompt = r.prompt.padEnd(6);
      console.log(
        `  │ ${name} │ ${prompt} │  ERROR  │    --    │   --    │   --   │`
      );
      continue;
    }

    const name = r.provider.padEnd(31);
    const prompt = r.prompt.padEnd(6);
    const latency = `${r.latencyMs}ms`.padStart(7);
    const cost =
      r.costUsd !== null ? formatCost(r.costUsd).padStart(8) : '     N/A';
    const quality = r.quality
      ? `${(r.quality.overall * 100).toFixed(0)}%`.padStart(7)
      : '    N/A';
    const value =
      r.valueScore !== null ? r.valueScore.toFixed(1).padStart(6) : '   N/A';

    console.log(
      `  │ ${name} │ ${prompt} │ ${latency} │ ${cost} │ ${quality} │ ${value} │`
    );
  }

  console.log(
    '  └─────────────────────────────────┴────────┴─────────┴──────────┴─────────┴────────┘'
  );

  // Provider rankings summary
  const successful = data.filter((r) => !r.error);
  if (successful.length === 0) return;

  const comp = buildComparison(data);
  if (comp.rankings.length > 0) {
    console.log(
      '\n  ┌─ Provider Rankings (quality-adjusted value) ──────────────────────┐'
    );
    console.log(
      '  │ Grade │ Provider                        │ Quality │ Value  │ Cost/2  │'
    );
    console.log(
      '  ├───────┼─────────────────────────────────┼─────────┼────────┼─────────┤'
    );

    for (const r of comp.rankings) {
      const grade = `  ${r.grade}  `;
      const name = r.provider.padEnd(31);
      const quality = `${(r.avgQuality * 100).toFixed(0)}%`.padStart(7);
      const value =
        r.avgValueScore !== null
          ? r.avgValueScore.toFixed(1).padStart(6)
          : '   N/A';
      const cost = formatCost(r.totalCostUsd).padStart(7);

      console.log(`  │ ${grade} │ ${name} │ ${quality} │ ${value} │ ${cost} │`);
    }

    console.log(
      '  └───────┴─────────────────────────────────┴─────────┴────────┴─────────┘'
    );
  }
}
