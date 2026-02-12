/**
 * Fuzzy Edit Utility
 * Four-tier matching strategy for resilient text replacement.
 * Used by sm_edit MCP tool as fallback when CC's Edit fails.
 */

export interface FuzzyMatchResult {
  found: boolean;
  startIndex: number;
  endIndex: number;
  confidence: number;
  matchedText: string;
  method:
    | 'exact'
    | 'whitespace-normalized'
    | 'indentation-insensitive'
    | 'line-fuzzy';
}

/**
 * Compute Levenshtein distance between two strings.
 */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () =>
    new Array(n + 1).fill(0)
  );

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[m][n];
}

/**
 * Normalize whitespace: trim each line, collapse runs of spaces to single space.
 */
function normalizeWhitespace(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trim().replace(/\s+/g, ' '))
    .join('\n');
}

/**
 * Strip leading whitespace from each line (indentation-insensitive).
 */
function stripIndentation(text: string): string {
  return text
    .split('\n')
    .map((line) => line.trimStart())
    .join('\n');
}

/**
 * Attempt to find oldString in content using four-tier matching.
 *
 * 1. Exact — direct indexOf (confidence: 1.0)
 * 2. Whitespace-normalized — trim lines, collapse spaces (confidence: 0.95)
 * 3. Indentation-insensitive — strip leading whitespace (confidence: 0.90)
 * 4. Line-level fuzzy — sliding window + Levenshtein (confidence: threshold)
 */
export function fuzzyMatch(
  content: string,
  oldString: string,
  threshold = 0.85
): FuzzyMatchResult | null {
  if (!oldString) return null;

  // Tier 1: Exact match
  const exactIdx = content.indexOf(oldString);
  if (exactIdx !== -1) {
    return {
      found: true,
      startIndex: exactIdx,
      endIndex: exactIdx + oldString.length,
      confidence: 1.0,
      matchedText: oldString,
      method: 'exact',
    };
  }

  // Tier 2: Whitespace-normalized
  const normContent = normalizeWhitespace(content);
  const normOld = normalizeWhitespace(oldString);
  const normIdx = normContent.indexOf(normOld);
  if (normIdx !== -1) {
    // Map back to original content by finding the corresponding line range
    const match = mapNormalizedToOriginal(
      content,
      normContent,
      normOld,
      normIdx
    );
    if (match) {
      return {
        found: true,
        startIndex: match.start,
        endIndex: match.end,
        confidence: 0.95,
        matchedText: content.slice(match.start, match.end),
        method: 'whitespace-normalized',
      };
    }
  }

  // Tier 3: Indentation-insensitive
  const stripContent = stripIndentation(content);
  const stripOld = stripIndentation(oldString);
  const stripIdx = stripContent.indexOf(stripOld);
  if (stripIdx !== -1) {
    const match = mapStrippedToOriginal(
      content,
      stripContent,
      stripOld,
      stripIdx
    );
    if (match) {
      return {
        found: true,
        startIndex: match.start,
        endIndex: match.end,
        confidence: 0.9,
        matchedText: content.slice(match.start, match.end),
        method: 'indentation-insensitive',
      };
    }
  }

  // Tier 4: Line-level fuzzy (sliding window + Levenshtein)
  const contentLines = content.split('\n');
  const oldLines = oldString.split('\n');
  const windowSize = oldLines.length;

  if (windowSize === 0 || contentLines.length < windowSize) return null;

  let bestScore = 0;
  let bestStart = -1;
  let bestEnd = -1;

  for (let i = 0; i <= contentLines.length - windowSize; i++) {
    const windowText = contentLines.slice(i, i + windowSize).join('\n');
    const maxLen = Math.max(windowText.length, oldString.length);
    if (maxLen === 0) continue;

    const dist = levenshtein(windowText, oldString);
    const similarity = 1 - dist / maxLen;

    if (similarity > bestScore) {
      bestScore = similarity;
      bestStart = i;
      bestEnd = i + windowSize;
    }
  }

  if (bestScore >= threshold && bestStart >= 0) {
    // Calculate character offsets from line indices
    let startCharIdx = 0;
    for (let i = 0; i < bestStart; i++) {
      startCharIdx += contentLines[i].length + 1; // +1 for \n
    }
    let endCharIdx = startCharIdx;
    for (let i = bestStart; i < bestEnd; i++) {
      endCharIdx += contentLines[i].length + (i < bestEnd - 1 ? 1 : 0);
    }

    return {
      found: true,
      startIndex: startCharIdx,
      endIndex: endCharIdx,
      confidence: Math.round(bestScore * 100) / 100,
      matchedText: contentLines.slice(bestStart, bestEnd).join('\n'),
      method: 'line-fuzzy',
    };
  }

  return null;
}

/**
 * Perform a fuzzy edit: find oldString in content, replace with newString.
 */
export function fuzzyEdit(
  content: string,
  oldString: string,
  newString: string,
  threshold = 0.85
): { content: string; match: FuzzyMatchResult } | null {
  const match = fuzzyMatch(content, oldString, threshold);
  if (!match) return null;

  const result =
    content.slice(0, match.startIndex) +
    newString +
    content.slice(match.endIndex);

  return { content: result, match };
}

/**
 * Map a match in normalized content back to original content positions.
 * Works by counting lines — normalized content preserves line count.
 */
function mapNormalizedToOriginal(
  original: string,
  _normalized: string,
  normNeedle: string,
  normIdx: number
): { start: number; end: number } | null {
  const normLines = _normalized.split('\n');
  const origLines = original.split('\n');

  // Find which line the normIdx starts on
  let charCount = 0;
  let startLine = 0;
  for (let i = 0; i < normLines.length; i++) {
    if (charCount + normLines[i].length >= normIdx) {
      startLine = i;
      break;
    }
    charCount += normLines[i].length + 1; // +1 for \n
  }

  // Count how many lines the needle spans
  const needleLineCount = normNeedle.split('\n').length;
  const endLine = startLine + needleLineCount;

  // Map to original character positions
  let startChar = 0;
  for (let i = 0; i < startLine; i++) {
    startChar += origLines[i].length + 1;
  }

  let endChar = startChar;
  for (let i = startLine; i < endLine && i < origLines.length; i++) {
    endChar += origLines[i].length + (i < endLine - 1 ? 1 : 0);
  }

  return { start: startChar, end: endChar };
}

/**
 * Map a match in stripped content back to original content positions.
 */
function mapStrippedToOriginal(
  original: string,
  stripped: string,
  stripNeedle: string,
  stripIdx: number
): { start: number; end: number } | null {
  return mapNormalizedToOriginal(original, stripped, stripNeedle, stripIdx);
}
