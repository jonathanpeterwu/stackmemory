/**
 * Privacy Filter for Unified Context Assembly
 * Filters sensitive patterns from content before including in context
 */

import { SENSITIVE_PATTERNS } from '../security/input-sanitizer.js';

export type PrivacyMode = 'strict' | 'standard' | 'permissive';

export interface PrivacyFilterConfig {
  mode: PrivacyMode;
}

export interface FilterResult {
  filtered: string;
  redactedCount: number;
}

/**
 * Additional patterns for privacy filtering beyond security patterns
 * Organized by strictness level
 */
const PRIVACY_PATTERNS: Record<PrivacyMode, RegExp[]> = {
  // Permissive: Only critical secrets
  permissive: [],

  // Standard: Secrets + PII basics
  standard: [
    // Email addresses
    /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    // Phone numbers (various formats)
    /\b(?:\+?1[-.\s]?)?(?:\(?\d{3}\)?[-.\s]?)?\d{3}[-.\s]?\d{4}\b/g,
    // SSN-like patterns
    /\b\d{3}[-.\s]?\d{2}[-.\s]?\d{4}\b/g,
    // IP addresses (v4)
    /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
  ],

  // Strict: All standard + additional PII
  strict: [
    // Credit card-like numbers (13-19 digits, optionally separated)
    /\b(?:\d{4}[-.\s]?){3,4}\d{1,4}\b/g,
    // Date of birth patterns (various formats)
    /\b(?:0?[1-9]|1[0-2])[-/](?:0?[1-9]|[12][0-9]|3[01])[-/](?:19|20)\d{2}\b/g,
    // AWS-style keys
    /\b(?:AKIA|ABIA|ACCA|ASIA)[A-Z0-9]{16}\b/g,
    // Private key markers
    /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    // JWT tokens
    /\beyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*/g,
    // URLs with credentials
    /(?:https?|ftp):\/\/[^\s:@]+:[^\s:@]+@[^\s]+/gi,
    // MAC addresses
    /\b(?:[0-9A-Fa-f]{2}[:-]){5}[0-9A-Fa-f]{2}\b/g,
    // UUID-like patterns that might be sensitive
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi,
  ],
};

/**
 * Privacy Filter class for filtering sensitive content
 */
export class PrivacyFilter {
  private config: PrivacyFilterConfig;
  private patterns: RegExp[];

  constructor(config: PrivacyFilterConfig) {
    this.config = config;
    this.patterns = this.buildPatternList();
  }

  /**
   * Build the complete list of patterns based on privacy mode
   */
  private buildPatternList(): RegExp[] {
    const patterns: RegExp[] = [];

    // Always include security patterns (API keys, tokens, etc.)
    patterns.push(...SENSITIVE_PATTERNS);

    // Add mode-specific patterns
    switch (this.config.mode) {
      case 'strict':
        patterns.push(...PRIVACY_PATTERNS.strict);
        patterns.push(...PRIVACY_PATTERNS.standard);
        break;
      case 'standard':
        patterns.push(...PRIVACY_PATTERNS.standard);
        break;
      case 'permissive':
        // Only security patterns (already added above)
        break;
    }

    return patterns;
  }

  /**
   * Filter sensitive patterns from content
   * @param content The content to filter
   * @returns Filtered content and count of redactions
   */
  filter(content: string): FilterResult {
    if (!content) {
      return { filtered: '', redactedCount: 0 };
    }

    let filtered = content;
    let redactedCount = 0;

    for (const pattern of this.patterns) {
      // Reset regex state for global patterns
      pattern.lastIndex = 0;

      // Count matches before replacing
      const matches = content.match(pattern);
      if (matches) {
        redactedCount += matches.length;
      }

      // Replace sensitive content
      filtered = filtered.replace(pattern, '[REDACTED]');
    }

    return { filtered, redactedCount };
  }

  /**
   * Check if content contains sensitive data without modifying it
   * @param content The content to check
   * @returns True if sensitive data is detected
   */
  containsSensitive(content: string): boolean {
    if (!content) return false;

    for (const pattern of this.patterns) {
      pattern.lastIndex = 0;
      if (pattern.test(content)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Get the current privacy mode
   */
  getMode(): PrivacyMode {
    return this.config.mode;
  }

  /**
   * Update the privacy mode and rebuild patterns
   */
  setMode(mode: PrivacyMode): void {
    this.config.mode = mode;
    this.patterns = this.buildPatternList();
  }

  /**
   * Get the count of active patterns
   */
  getPatternCount(): number {
    return this.patterns.length;
  }
}

/**
 * Create a privacy filter with default config
 */
export function createPrivacyFilter(
  mode: PrivacyMode = 'standard'
): PrivacyFilter {
  return new PrivacyFilter({ mode });
}
