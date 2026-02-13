import { describe, it, expect } from 'vitest';
import {
  detectSensitiveContent,
  isApprovedProvider,
  shouldBlockProvider,
} from '../sensitive-guard.js';

describe('detectSensitiveContent', () => {
  describe('API keys', () => {
    it('should detect sk- prefixed keys', () => {
      const r = detectSensitiveContent(
        'Use key sk-abc123def456ghi789jkl012mno345pqr'
      );
      expect(r.sensitive).toBe(true);
      expect(r.matches).toContain('API key (sk-)');
    });

    it('should detect Anthropic keys', () => {
      const r = detectSensitiveContent(
        'sk-ant-api03-aBcDeFgHiJkLmNoPqRsTuVwXyZ'
      );
      expect(r.sensitive).toBe(true);
      expect(r.matches).toContain('Anthropic key');
    });

    it('should detect AWS access keys', () => {
      const r = detectSensitiveContent('AKIAIOSFODNN7EXAMPLE');
      expect(r.sensitive).toBe(true);
      expect(r.matches).toContain('AWS access key');
    });

    it('should detect GitHub PATs', () => {
      const r = detectSensitiveContent(
        'ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZaBcDeFgHi'
      );
      expect(r.sensitive).toBe(true);
      expect(r.matches).toContain('GitHub PAT');
    });

    it('should detect npm tokens', () => {
      const r = detectSensitiveContent(
        'npm_aBcDeFgHiJkLmNoPqRsTuVwXyZaBcDeFgHi'
      );
      expect(r.sensitive).toBe(true);
      expect(r.matches).toContain('npm token');
    });

    it('should detect Slack tokens', () => {
      const r = detectSensitiveContent('xoxb-123456789-abcdefghij');
      expect(r.sensitive).toBe(true);
      expect(r.matches).toContain('Slack token');
    });

    it('should detect Linear API keys', () => {
      const r = detectSensitiveContent('lin_api_aBcDeFgHiJkLmNoPqRsTuVwXyZ');
      expect(r.sensitive).toBe(true);
      expect(r.matches).toContain('Linear API key');
    });

    it('should detect Stripe keys', () => {
      const r = detectSensitiveContent('sk_test_aBcDeFgHiJkLmNoPqRsTuVwXyZ');
      expect(r.sensitive).toBe(true);
      expect(r.matches).toContain('Stripe secret');
    });

    it('should detect SendGrid keys', () => {
      const r = detectSensitiveContent('SG.aBcDeFgHiJkLmNoPqRsTuVwXyZ');
      expect(r.sensitive).toBe(true);
      expect(r.matches).toContain('SendGrid key');
    });

    it('should detect GitLab PATs', () => {
      const r = detectSensitiveContent('glpat-aBcDeFgHiJkLmNoPqRsT_uvw');
      expect(r.sensitive).toBe(true);
      expect(r.matches).toContain('GitLab PAT');
    });
  });

  describe('private keys and certificates', () => {
    it('should detect PEM private keys', () => {
      const r = detectSensitiveContent(
        '-----BEGIN PRIVATE KEY-----\nMIIEvQIBADANBg...'
      );
      expect(r.sensitive).toBe(true);
      expect(r.matches).toContain('Private key (PEM)');
    });

    it('should detect RSA private keys', () => {
      const r = detectSensitiveContent(
        '-----BEGIN RSA PRIVATE KEY-----\nMIIEowIBAA...'
      );
      expect(r.sensitive).toBe(true);
      expect(r.matches).toContain('Private key (PEM)');
    });

    it('should detect EC private keys', () => {
      const r = detectSensitiveContent(
        '-----BEGIN EC PRIVATE KEY-----\nMHQCAQEE...'
      );
      expect(r.sensitive).toBe(true);
      expect(r.matches).toContain('EC private key');
    });

    it('should detect certificates', () => {
      const r = detectSensitiveContent(
        '-----BEGIN CERTIFICATE-----\nMIIDXTCCA...'
      );
      expect(r.sensitive).toBe(true);
      expect(r.matches).toContain('Certificate (PEM)');
    });
  });

  describe('JWT tokens', () => {
    it('should detect JWT tokens', () => {
      const r = detectSensitiveContent(
        'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
      );
      expect(r.sensitive).toBe(true);
      expect(r.matches).toContain('JWT token');
    });

    it('should detect Bearer JWT', () => {
      const r = detectSensitiveContent(
        'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.test.sig'
      );
      expect(r.sensitive).toBe(true);
    });
  });

  describe('connection strings', () => {
    it('should detect postgres connection strings', () => {
      const r = detectSensitiveContent(
        'postgres://admin:secretPassword123@db.example.com:5432/mydb'
      );
      expect(r.sensitive).toBe(true);
      expect(r.matches).toContain('DB connection string');
    });

    it('should detect mongodb connection strings', () => {
      const r = detectSensitiveContent(
        'mongodb://user:pass@cluster.example.com:27017/db'
      );
      expect(r.sensitive).toBe(true);
    });

    it('should detect redis connection strings', () => {
      const r = detectSensitiveContent(
        'redis://default:mypassword@redis.example.com:6379'
      );
      expect(r.sensitive).toBe(true);
    });
  });

  describe('credential assignments', () => {
    it('should detect password assignments in quotes', () => {
      const r = detectSensitiveContent('password: "super_secret_123"');
      expect(r.sensitive).toBe(true);
      expect(r.matches).toContain('Credential assignment');
    });

    it('should detect API key assignments', () => {
      const r = detectSensitiveContent("api_key = 'abcdef1234567890'");
      expect(r.sensitive).toBe(true);
    });

    it('should detect env var credentials', () => {
      const r = detectSensitiveContent('API_KEY=sk_test_abcdef1234567890');
      expect(r.sensitive).toBe(true);
      expect(r.matches).toContain('Env var credential');
    });

    it('should detect auth_token env vars', () => {
      const r = detectSensitiveContent('AUTH_TOKEN=a1b2c3d4e5f6g7h8i9j0');
      expect(r.sensitive).toBe(true);
    });
  });

  describe('context scanning', () => {
    it('should detect secrets in context string values', () => {
      const r = detectSensitiveContent('Clean prompt', {
        fileContent: '-----BEGIN PRIVATE KEY-----\nMIIEv...',
      });
      expect(r.sensitive).toBe(true);
    });

    it('should detect secrets in context arrays', () => {
      const r = detectSensitiveContent('Clean prompt', {
        files: ['clean.ts', 'API_KEY=sk_test_abc123def456ghi789jkl'],
      });
      expect(r.sensitive).toBe(true);
    });

    it('should detect secrets in nested context objects', () => {
      const r = detectSensitiveContent('Clean prompt', {
        config: { dbUrl: 'postgres://user:pass@host:5432/db' },
      });
      expect(r.sensitive).toBe(true);
    });

    it('should not flag clean context', () => {
      const r = detectSensitiveContent('Fix typo', {
        files: ['src/utils.ts', 'src/index.ts'],
        codeSize: 5000,
      });
      expect(r.sensitive).toBe(false);
    });
  });

  describe('false positive resistance', () => {
    it('should not flag normal code discussion', () => {
      const r = detectSensitiveContent(
        'Implement a function that validates API key format'
      );
      expect(r.sensitive).toBe(false);
    });

    it('should not flag short sk- references', () => {
      // "sk-" alone without sufficient trailing chars is not a key
      const r = detectSensitiveContent('The sk-1 model variant');
      expect(r.sensitive).toBe(false);
    });

    it('should not flag "password" in discussion', () => {
      const r = detectSensitiveContent(
        'Add password validation to the login form'
      );
      expect(r.sensitive).toBe(false);
    });

    it('should not flag "BEGIN" in normal text', () => {
      const r = detectSensitiveContent('We should BEGIN with the tests');
      expect(r.sensitive).toBe(false);
    });

    it('should not flag JWT discussion without actual token', () => {
      const r = detectSensitiveContent(
        'Use JWT for authentication between services'
      );
      expect(r.sensitive).toBe(false);
    });

    it('should not flag postgres:// without credentials', () => {
      const r = detectSensitiveContent(
        'Use postgres://localhost:5432/dev for local development'
      );
      expect(r.sensitive).toBe(false);
    });
  });

  describe('deduplication', () => {
    it('should deduplicate match labels', () => {
      const r = detectSensitiveContent(
        'sk-abc123def456ghi789jkl012mno345pqr and sk-xyz789abc012def345ghi678jkl901mno'
      );
      expect(r.sensitive).toBe(true);
      // Same label should appear once
      const count = r.matches.filter((m) => m === 'API key (sk-)').length;
      expect(count).toBe(1);
    });
  });
});

describe('isApprovedProvider', () => {
  it('should approve anthropic', () => {
    expect(isApprovedProvider('anthropic')).toBe(true);
  });

  it('should approve anthropic-batch', () => {
    expect(isApprovedProvider('anthropic-batch')).toBe(true);
  });

  it('should reject openrouter', () => {
    expect(isApprovedProvider('openrouter')).toBe(false);
  });

  it('should reject deepinfra', () => {
    expect(isApprovedProvider('deepinfra')).toBe(false);
  });

  it('should reject cerebras', () => {
    expect(isApprovedProvider('cerebras')).toBe(false);
  });
});

describe('shouldBlockProvider', () => {
  const SECRET_PROMPT = 'Deploy with key sk-abc123def456ghi789jkl012mno345pqr';
  const CLEAN_PROMPT = 'Fix typo in README';

  it('should block third-party provider with sensitive content', () => {
    const r = shouldBlockProvider('openrouter', SECRET_PROMPT);
    expect(r.blocked).toBe(true);
    expect(r.reason).toContain('Sensitive content detected');
    expect(r.reason).toContain('openrouter');
  });

  it('should not block approved provider even with sensitive content', () => {
    const r = shouldBlockProvider('anthropic', SECRET_PROMPT);
    expect(r.blocked).toBe(false);
  });

  it('should not block any provider with clean content', () => {
    expect(shouldBlockProvider('openrouter', CLEAN_PROMPT).blocked).toBe(false);
    expect(shouldBlockProvider('deepinfra', CLEAN_PROMPT).blocked).toBe(false);
    expect(shouldBlockProvider('cerebras', CLEAN_PROMPT).blocked).toBe(false);
  });

  it('should check context too', () => {
    const r = shouldBlockProvider('cerebras', 'Clean prompt', {
      env: 'ANTHROPIC_API_KEY=sk-ant-api03-realKeyHereAbcDefGhiJkl',
    });
    expect(r.blocked).toBe(true);
  });
});

describe('property: sensitive content never routes to third-party', () => {
  const THIRD_PARTY = ['openrouter', 'deepinfra', 'cerebras', 'openai', 'qwen'];
  const SENSITIVE_SAMPLES = [
    'sk-abc123def456ghi789jkl012mno345pqr',
    '-----BEGIN PRIVATE KEY-----\nMIIEv...',
    'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.rg2e9VoJPGMoaGH7',
    'postgres://admin:secret@db.example.com:5432/prod',
    'API_KEY=sk_test_aBcDeFgHiJkLmNoPqRsTuVwXyZ',
    'ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZaBcDeFgHi',
    'xoxb-123456789-abcdefghij',
  ];

  for (const secret of SENSITIVE_SAMPLES) {
    for (const provider of THIRD_PARTY) {
      it(`should block ${provider} when prompt contains ${secret.slice(0, 20)}...`, () => {
        const r = shouldBlockProvider(provider, `Task with ${secret}`);
        expect(r.blocked).toBe(true);
      });
    }
  }

  for (const secret of SENSITIVE_SAMPLES) {
    for (const provider of THIRD_PARTY) {
      it(`should block ${provider} when context contains ${secret.slice(0, 20)}...`, () => {
        const r = shouldBlockProvider(provider, 'Clean task', {
          data: secret,
        });
        expect(r.blocked).toBe(true);
      });
    }
  }
});
