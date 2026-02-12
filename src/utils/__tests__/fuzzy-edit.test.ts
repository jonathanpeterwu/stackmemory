import { describe, it, expect } from 'vitest';
import { fuzzyMatch, fuzzyEdit } from '../fuzzy-edit.js';

describe('fuzzyMatch', () => {
  it('matches across all four tiers and rejects non-matches', () => {
    // Tier 1: Exact
    const exact = fuzzyMatch(
      'function hello() {\n  return "world";\n}',
      'return "world";'
    );
    expect(exact).not.toBeNull();
    expect(exact!.method).toBe('exact');
    expect(exact!.confidence).toBe(1.0);

    // Tier 2: Whitespace-normalized (tabs vs spaces)
    const ws = fuzzyMatch(
      'function hello() {\n\treturn "world";\n}',
      'function hello() {\n  return "world";\n}'
    );
    expect(ws).not.toBeNull();
    expect(ws!.confidence).toBeGreaterThanOrEqual(0.9);

    // Tier 3: Indentation-insensitive (2-space vs 4-space)
    const indent = fuzzyMatch(
      '    function foo() {\n        return 1;\n    }',
      '  function foo() {\n    return 1;\n  }'
    );
    expect(indent).not.toBeNull();
    expect(indent!.confidence).toBeGreaterThanOrEqual(0.9);

    // Tier 4: Line-level fuzzy (typo)
    const fuzzy = fuzzyMatch(
      'function greet(name) {\n  console.log(`Hello ${name}!`);\n}',
      'function greeet(name) {\n  console.log(`Hello ${name}!`);\n}',
      0.85
    );
    expect(fuzzy).not.toBeNull();
    expect(fuzzy!.method).toBe('line-fuzzy');

    // No match
    expect(fuzzyMatch('hello', 'completely different text', 0.85)).toBeNull();
    expect(fuzzyMatch('content', '')).toBeNull();
  });
});

describe('fuzzyEdit', () => {
  it('performs replacement and handles edge cases', () => {
    // Exact replacement
    const exact = fuzzyEdit(
      'const x = 1;\nconst y = 2;\n',
      'const x = 1;',
      'const x = 42;'
    );
    expect(exact).not.toBeNull();
    expect(exact!.content).toBe('const x = 42;\nconst y = 2;\n');

    // Fuzzy replacement with indentation mismatch
    const fuzzy = fuzzyEdit(
      '    if (true) {\n        doSomething();\n    }',
      '  if (true) {\n    doSomething();\n  }',
      '  if (false) {\n    doNothing();\n  }'
    );
    expect(fuzzy).not.toBeNull();
    expect(fuzzy!.match.confidence).toBeGreaterThanOrEqual(0.9);

    // No match returns null
    expect(
      fuzzyEdit('const a = 1;', 'totally different', 'replacement')
    ).toBeNull();
  });
});
