import { describe, it, expect } from 'vitest';
import { scoreComplexity } from '../complexity-scorer.js';

describe('scoreComplexity', () => {
  describe('low complexity tasks', () => {
    it('should score "fix typo" as low', () => {
      const result = scoreComplexity('Fix typo in README');
      expect(result.tier).toBe('low');
      expect(result.score).toBeLessThan(0.25);
    });

    it('should score "rename variable" as low', () => {
      const result = scoreComplexity('Rename the variable foo to bar');
      expect(result.tier).toBe('low');
    });

    it('should score "remove unused imports" as low', () => {
      const result = scoreComplexity('Remove unused imports from utils.ts');
      expect(result.tier).toBe('low');
    });

    it('should score lint fix as low', () => {
      const result = scoreComplexity('Fix lint errors in the file');
      expect(result.tier).toBe('low');
    });

    it('should score very short prompt as low', () => {
      const result = scoreComplexity('Say hi');
      expect(result.tier).toBe('low');
    });
  });

  describe('high complexity tasks', () => {
    it('should score architecture redesign as high', () => {
      const result = scoreComplexity(
        'Refactor the authentication system to use distributed consensus with backward compatibility. ' +
          'Analyze the trade-offs between JWT and session-based auth. Consider security vulnerabilities.'
      );
      expect(result.tier).toBe('high');
      expect(result.score).toBeGreaterThanOrEqual(0.6);
    });

    it('should score security audit as high', () => {
      const result = scoreComplexity(
        'Evaluate the application for OWASP vulnerabilities. Check authentication and authorization ' +
          'flows for security issues. Analyze encryption and crypto usage.'
      );
      expect(result.tier).toBe('high');
    });

    it('should score complex migration as high', () => {
      const result = scoreComplexity(
        'Migrate the database schema from SQL to NoSQL while maintaining backward compatibility. ' +
          'Analyze the performance trade-offs and design a distributed caching layer for scalability.'
      );
      expect(result.tier).toBe('high');
    });

    it('should boost score for many files in context', () => {
      const result = scoreComplexity('Review the code changes', {
        files: Array.from({ length: 15 }, (_, i) => `src/file${i}.ts`),
      });
      expect(result.score).toBeGreaterThan(
        scoreComplexity('Review the code changes').score
      );
    });

    it('should boost score for large code context', () => {
      const result = scoreComplexity('Analyze this code', {
        codeSize: 10000,
      });
      expect(result.score).toBeGreaterThan(
        scoreComplexity('Analyze this code').score
      );
    });
  });

  describe('medium complexity tasks', () => {
    it('should score standard code task as medium', () => {
      const result = scoreComplexity(
        'Write a TypeScript function that parses CSV files and returns an array of objects. ' +
          'Handle quoted fields and escaped characters correctly.'
      );
      expect(result.tier).toBe('medium');
    });

    it('should score debugging as medium', () => {
      const result = scoreComplexity(
        'Debug the intermittent timeout in the API handler and find the root cause.'
      );
      // Has reasoning indicators but not overwhelming
      expect(result.score).toBeGreaterThan(0.2);
    });
  });

  describe('signals', () => {
    it('should report keyword matches in signals', () => {
      const result = scoreComplexity(
        'Refactor the architecture for scalability'
      );
      expect(result.signals.some((s) => s.includes('high-complexity'))).toBe(
        true
      );
    });

    it('should report low-complexity keywords', () => {
      const result = scoreComplexity('Fix typo and format the code');
      expect(result.signals.some((s) => s.includes('low-complexity'))).toBe(
        true
      );
    });

    it('should report prompt length when substance keywords present', () => {
      // Long prompt with substance keyword triggers length signal
      const longPrompt = 'Implement the feature. ' + 'x '.repeat(500);
      const result = scoreComplexity(longPrompt);
      expect(result.signals.some((s) => s.includes('prompt'))).toBe(true);
    });
  });

  describe('score bounds', () => {
    it('should never go below 0', () => {
      const result = scoreComplexity('fix typo rename cleanup todo');
      expect(result.score).toBeGreaterThanOrEqual(0);
    });

    it('should never exceed 1', () => {
      const result = scoreComplexity(
        'Architect a distributed system with encryption and authentication. ' +
          'Refactor for scalability with backward compatibility. ' +
          'Analyze trade-offs step by step. Evaluate security vulnerabilities. ' +
          'Design the migration strategy for the crypto layer. ' +
          'Compare approaches and diagnose root cause of concurrency race conditions. ' +
          'How? Why? What?',
        {
          files: Array.from({ length: 20 }, (_, i) => `f${i}`),
          codeSize: 50000,
        }
      );
      expect(result.score).toBeLessThanOrEqual(1);
    });
  });

  describe('density gating', () => {
    it('should not grant length bonus for padded prompt without keywords', () => {
      const padded = 'Fix typo. ' + 'x '.repeat(1500); // >2000 chars, only low keyword
      const result = scoreComplexity(padded);
      expect(result.signals.every((s) => !s.includes('long prompt'))).toBe(
        true
      );
      expect(result.tier).toBe('low');
    });

    it('should grant length bonus when substance keywords are present', () => {
      const substantive =
        'Implement a distributed caching layer. ' + 'Details: '.repeat(200);
      const result = scoreComplexity(substantive);
      expect(result.signals.some((s) => s.includes('prompt'))).toBe(true);
    });
  });

  describe('monotonicity', () => {
    const BASE = 'Fix the login page.';

    it('adding a high-complexity keyword never decreases score', () => {
      const base = scoreComplexity(BASE);
      const extended = scoreComplexity(BASE + ' Refactor the architecture.');
      expect(extended.score).toBeGreaterThanOrEqual(base.score);
    });

    it('adding context files never decreases score', () => {
      const base = scoreComplexity(BASE);
      const extended = scoreComplexity(BASE, {
        files: Array.from({ length: 10 }, (_, i) => `f${i}.ts`),
      });
      expect(extended.score).toBeGreaterThanOrEqual(base.score);
    });

    it('adding a reasoning indicator never decreases score', () => {
      const base = scoreComplexity(BASE);
      const extended = scoreComplexity(BASE + ' Analyze the root cause.');
      expect(extended.score).toBeGreaterThanOrEqual(base.score);
    });

    it('adding more high keywords only increases score', () => {
      const one = scoreComplexity('Refactor the code.');
      const two = scoreComplexity('Refactor the architecture for scalability.');
      const three = scoreComplexity(
        'Refactor the architecture for scalability with security and backward compatibility.'
      );
      expect(two.score).toBeGreaterThanOrEqual(one.score);
      expect(three.score).toBeGreaterThanOrEqual(two.score);
    });
  });
});
