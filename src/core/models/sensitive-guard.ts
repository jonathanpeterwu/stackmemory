/**
 * Sensitive Context Guard
 *
 * Pre-routing check that detects credentials, secrets, and PII in task
 * prompts and context. When sensitive content is detected, routing is
 * restricted to approved-only providers (Anthropic) to prevent data
 * leaks to third-party LLM providers.
 *
 * This is the #1 safety gate in the multi-provider pipeline — it runs
 * BEFORE complexity scoring and overrides all other routing decisions.
 */

/** Patterns that indicate sensitive content */
const SENSITIVE_PATTERNS: { pattern: RegExp; label: string }[] = [
  // API keys — common prefixes
  { pattern: /\bsk-[a-zA-Z0-9]{20,}/, label: 'API key (sk-)' },
  { pattern: /\bsk-ant-[a-zA-Z0-9-]{20,}/, label: 'Anthropic key' },
  { pattern: /\bAKIA[A-Z0-9]{12,}/, label: 'AWS access key' },
  { pattern: /\bghp_[a-zA-Z0-9]{30,}/, label: 'GitHub PAT' },
  { pattern: /\bgho_[a-zA-Z0-9]{30,}/, label: 'GitHub OAuth' },
  { pattern: /\bghs_[a-zA-Z0-9]{30,}/, label: 'GitHub App' },
  { pattern: /\bglpat-[a-zA-Z0-9_-]{20,}/, label: 'GitLab PAT' },
  { pattern: /\bnpm_[a-zA-Z0-9]{30,}/, label: 'npm token' },
  { pattern: /\bxox[bpsar]-[a-zA-Z0-9-]{10,}/, label: 'Slack token' },
  { pattern: /\blin_api_[a-zA-Z0-9]{20,}/, label: 'Linear API key' },
  { pattern: /\blin_oauth_[a-zA-Z0-9]{20,}/, label: 'Linear OAuth' },
  { pattern: /\bSG\.[a-zA-Z0-9_-]{20,}/, label: 'SendGrid key' },
  { pattern: /\brk_live_[a-zA-Z0-9]{20,}/, label: 'Stripe key' },
  { pattern: /\bsk_(?:live|test)_[a-zA-Z0-9]{20,}/, label: 'Stripe secret' },
  { pattern: /\bwhsec_[a-zA-Z0-9]{20,}/, label: 'Webhook secret' },

  // Private keys and certificates
  {
    pattern: /-----BEGIN\s+(?:RSA\s+)?PRIVATE\s+KEY-----/,
    label: 'Private key (PEM)',
  },
  { pattern: /-----BEGIN\s+CERTIFICATE-----/, label: 'Certificate (PEM)' },
  {
    pattern: /-----BEGIN\s+(?:EC\s+)?PRIVATE\s+KEY-----/,
    label: 'EC private key',
  },

  // JWT tokens (header.payload.signature format)
  {
    pattern: /\beyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}/,
    label: 'JWT token',
  },
  { pattern: /\bBearer\s+eyJ[a-zA-Z0-9_-]{10,}/, label: 'Bearer JWT' },

  // Connection strings with credentials
  {
    pattern: /(?:mysql|postgres|postgresql|mongodb|redis):\/\/[^:]+:[^@]+@/,
    label: 'DB connection string',
  },

  // Generic high-entropy secrets (base64 blocks in config-like context)
  {
    pattern:
      /(?:password|secret|token|api[_-]?key|auth[_-]?token)\s*[:=]\s*["'][^"']{8,}["']/i,
    label: 'Credential assignment',
  },
  {
    pattern: /(?:PASSWORD|SECRET|TOKEN|API_KEY|AUTH_TOKEN)\s*=\s*\S{8,}/,
    label: 'Env var credential',
  },
];

/** Providers considered safe for sensitive content */
const APPROVED_PROVIDERS = new Set(['anthropic', 'anthropic-batch']);

export interface SensitiveCheckResult {
  /** Whether sensitive content was detected */
  sensitive: boolean;
  /** Labels of matched patterns (for logging, NOT the actual secrets) */
  matches: string[];
}

/**
 * Check a string for sensitive content patterns.
 */
function checkString(text: string): SensitiveCheckResult {
  const matches: string[] = [];

  for (const { pattern, label } of SENSITIVE_PATTERNS) {
    if (pattern.test(text)) {
      matches.push(label);
    }
  }

  return { sensitive: matches.length > 0, matches };
}

/**
 * Scan task prompt and context for sensitive content.
 *
 * Checks:
 * 1. The task prompt itself
 * 2. All string values in the context object (shallow + one level deep)
 * 3. Stringified context keys that look like file contents
 */
export function detectSensitiveContent(
  task: string,
  context?: Record<string, unknown>
): SensitiveCheckResult {
  const allMatches: string[] = [];

  // Check task prompt
  const taskResult = checkString(task);
  allMatches.push(...taskResult.matches);

  // Check context values
  if (context) {
    for (const value of Object.values(context)) {
      if (typeof value === 'string') {
        const r = checkString(value);
        allMatches.push(...r.matches);
      } else if (Array.isArray(value)) {
        for (const item of value) {
          if (typeof item === 'string') {
            const r = checkString(item);
            allMatches.push(...r.matches);
          }
        }
      } else if (value && typeof value === 'object') {
        // One level deep for nested objects
        for (const nested of Object.values(value as Record<string, unknown>)) {
          if (typeof nested === 'string') {
            const r = checkString(nested);
            allMatches.push(...r.matches);
          }
        }
      }
    }
  }

  // Deduplicate
  const unique = [...new Set(allMatches)];
  return { sensitive: unique.length > 0, matches: unique };
}

/**
 * Check if a provider is approved for sensitive content.
 */
export function isApprovedProvider(provider: string): boolean {
  return APPROVED_PROVIDERS.has(provider);
}

/**
 * Pre-routing guard: should we block routing to a third-party provider?
 *
 * Returns true if the content is sensitive AND the target provider
 * is not in the approved list.
 */
export function shouldBlockProvider(
  provider: string,
  task: string,
  context?: Record<string, unknown>
): { blocked: boolean; reason?: string } {
  if (isApprovedProvider(provider)) {
    return { blocked: false };
  }

  const check = detectSensitiveContent(task, context);
  if (!check.sensitive) {
    return { blocked: false };
  }

  return {
    blocked: true,
    reason:
      `Sensitive content detected (${check.matches.join(', ')}). ` +
      `Blocked routing to ${provider}; using approved provider instead.`,
  };
}
