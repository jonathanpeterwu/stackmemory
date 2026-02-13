/**
 * Complexity Scorer for provider routing.
 *
 * Analyzes a task prompt + context to produce a 0-1 complexity score.
 * Used by getOptimalProvider() to route simple tasks to cheap/fast providers
 * and complex tasks to high-quality providers.
 */

export type ComplexityTier = 'low' | 'medium' | 'high';

export interface ComplexityScore {
  score: number; // 0.0 – 1.0
  tier: ComplexityTier;
  signals: string[]; // human-readable reasons
}

// ---------------------------------------------------------------------------
// Signal weights — each contributes independently to the final score
// ---------------------------------------------------------------------------

/** Keywords that indicate high complexity (architecture, security, etc.) */
const HIGH_COMPLEXITY_KEYWORDS = [
  /\barchitect/i,
  /\brefactor\b/i,
  /\bredesign/i,
  /\bmigrat/i,
  /\bsecurity\b/i,
  /\bvulnerabilit/i,
  /\bconcurrency/i,
  /\brace\s+condition/i,
  /\bdistributed/i,
  /\bconsensus/i,
  /\btrade-?offs?\b/i,
  /\bbackward.?compat/i,
  /\bbreaking\s+change/i,
  /\bperformance\s+(?:optimi|critical|bottleneck)/i,
  /\bscalability/i,
  /\bcrypto/i,
  /\bencrypt/i,
  /\bauth(?:entication|orization)\b/i,
  /\bOWASP/i,
];

/** Keywords that indicate low complexity (trivial tasks) */
const LOW_COMPLEXITY_KEYWORDS = [
  /\bfix\s+typo/i,
  /\brename\b/i,
  /\bformat(?:ting)?\s+(?:the\s+)?(?:code|file|project|source)/i,
  /\bprettier/i,
  /\blint\s*(?:fix|error|warning)/i,
  /\bupdate\s+(?:version|dep)/i,
  /\badd\s+comment/i,
  /\bremove\s+unused/i,
  /\bimport\s+(?:sort|order)/i,
  /\bconsole\.log/i,
  /\btodo\b/i,
  /\bcleanup\b/i,
];

/** Keywords that indicate medium complexity (non-trivial coding tasks) */
const MEDIUM_COMPLEXITY_KEYWORDS = [
  /\bwrite\b/i,
  /\bimplement/i,
  /\bcreate\b/i,
  /\bbuild\b/i,
  /\bparse/i,
  /\bhandle\b/i,
  /\bvalidat/i,
  /\btransform/i,
  /\bconvert/i,
  /\bgenerat/i,
  /\bintegrat/i,
  /\boptimiz/i,
];

/** Multi-step reasoning indicators */
const REASONING_INDICATORS = [
  /\bstep\s*(?:by|1|2|3)/i,
  /\bfirst.*then.*finally/i,
  /\bcompare\s+(?:and|options|approaches)/i,
  /\banalyze/i,
  /\bevaluate/i,
  /\bdiagnos/i,
  /\bdebug.*(?:complex|intermittent|flaky)/i,
  /\broot\s+cause/i,
  /\bsystem\s*design/i,
];

// ---------------------------------------------------------------------------
// Thresholds
// ---------------------------------------------------------------------------

const LOW_THRESHOLD = 0.25;
const HIGH_THRESHOLD = 0.6;

/** Prompt length brackets (character count) */
const SHORT_PROMPT = 200;
const MEDIUM_PROMPT = 800;
const LONG_PROMPT = 2000;

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Score the complexity of a task for provider routing.
 *
 * @param task  - The prompt / task description
 * @param context - Optional context (files, prior results, etc.)
 */
export function scoreComplexity(
  task: string,
  context?: Record<string, unknown>
): ComplexityScore {
  const signals: string[] = [];
  let score = 0;

  // 2. High-complexity keyword matches (0 – 0.60)
  const highHits = HIGH_COMPLEXITY_KEYWORDS.filter((re) => re.test(task));
  if (highHits.length >= 5) {
    score += 0.6;
    signals.push(`${highHits.length} high-complexity keywords`);
  } else if (highHits.length >= 3) {
    score += 0.5;
    signals.push(`${highHits.length} high-complexity keywords`);
  } else if (highHits.length >= 1) {
    score += 0.2 * Math.min(highHits.length, 2);
    signals.push(`${highHits.length} high-complexity keyword(s)`);
  }

  // 3. Low-complexity keyword matches (negative signal, -0.25 – 0)
  const lowHits = LOW_COMPLEXITY_KEYWORDS.filter((re) => re.test(task));
  if (lowHits.length >= 2) {
    score -= 0.25;
    signals.push(`${lowHits.length} low-complexity keywords`);
  } else if (lowHits.length === 1) {
    score -= 0.15;
    signals.push('1 low-complexity keyword');
  }

  // 4. Medium-complexity keyword matches (0 – 0.30)
  const medHits = MEDIUM_COMPLEXITY_KEYWORDS.filter((re) => re.test(task));
  if (medHits.length >= 2) {
    score += 0.3;
    signals.push(`${medHits.length} medium-complexity keywords`);
  } else if (medHits.length === 1) {
    score += 0.15;
    signals.push('1 medium-complexity keyword');
  }

  // 1. Prompt length signal (0 – 0.20)
  // Density gate: only grant length bonus when there's at least 1 substantive
  // keyword, preventing filler text from inflating the score.
  const hasSubstance = highHits.length > 0 || medHits.length > 0;
  const len = task.length;
  if (len > LONG_PROMPT && hasSubstance) {
    score += 0.2;
    signals.push(`long prompt (${len} chars)`);
  } else if (len > MEDIUM_PROMPT && hasSubstance) {
    score += 0.1;
    signals.push(`medium prompt (${len} chars)`);
  } else if (len < SHORT_PROMPT) {
    score -= 0.03; // slightly reduce for very short
  }

  // 5. Multi-step reasoning indicators (0 – 0.25)
  const reasoningHits = REASONING_INDICATORS.filter((re) => re.test(task));
  if (reasoningHits.length >= 2) {
    score += 0.25;
    signals.push(`${reasoningHits.length} reasoning indicators`);
  } else if (reasoningHits.length === 1) {
    score += 0.15;
    signals.push('1 reasoning indicator');
  }

  // 6. File count in context (0 – 0.15)
  if (context) {
    const files = context['files'];
    if (Array.isArray(files)) {
      if (files.length >= 10) {
        score += 0.15;
        signals.push(`${files.length} files in context`);
      } else if (files.length >= 4) {
        score += 0.08;
        signals.push(`${files.length} files in context`);
      }
    }

    // Code size signal
    const codeSize = context['codeSize'];
    if (typeof codeSize === 'number' && codeSize > 5000) {
      score += 0.1;
      signals.push(`large code context (${codeSize} chars)`);
    }
  }

  // 7. Question / instruction complexity (0 – 0.10)
  const questionMarks = (task.match(/\?/g) || []).length;
  if (questionMarks >= 3) {
    score += 0.1;
    signals.push(`${questionMarks} questions`);
  }

  // Clamp to [0, 1]
  score = Math.max(0, Math.min(1, score));

  // Determine tier
  let tier: ComplexityTier;
  if (score < LOW_THRESHOLD) {
    tier = 'low';
  } else if (score >= HIGH_THRESHOLD) {
    tier = 'high';
  } else {
    tier = 'medium';
  }

  return { score: Math.round(score * 100) / 100, tier, signals };
}
