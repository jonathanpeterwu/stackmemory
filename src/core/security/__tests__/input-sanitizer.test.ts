/**
 * Tests for input sanitizer security utilities
 */

import { describe, it, expect } from 'vitest';
import {
  redactSensitiveData,
  containsSensitiveData,
  sanitizeForSqlLike,
  sanitizeIdentifier,
  validateTableName,
  sanitizeFilePath,
  validateShellArg,
  sanitizeForLogging,
  InputSchemas,
  validateInput,
} from '../input-sanitizer.js';
import { ValidationError } from '../../errors/index.js';

describe('redactSensitiveData', () => {
  it('should redact API keys', () => {
    const input = 'Using api_key: sk-12345abcdef';
    const result = redactSensitiveData(input);
    expect(result).not.toContain('sk-12345abcdef');
    expect(result).toContain('[REDACTED]');
  });

  it('should redact Linear API tokens', () => {
    const input = 'Token is lin_api_abc123xyz';
    const result = redactSensitiveData(input);
    expect(result).not.toContain('lin_api_abc123xyz');
    expect(result).toContain('[REDACTED]');
  });

  it('should redact database URLs with credentials', () => {
    const input = 'postgres://user:password@host:5432/db';
    const result = redactSensitiveData(input);
    expect(result).not.toContain('password');
    expect(result).toContain('[REDACTED]');
  });

  it('should redact Bearer tokens', () => {
    const input = 'Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9';
    const result = redactSensitiveData(input);
    expect(result).not.toContain('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9');
    expect(result).toContain('[REDACTED]');
  });

  it('should not modify safe strings', () => {
    const input = 'This is a normal log message about tasks';
    const result = redactSensitiveData(input);
    expect(result).toBe(input);
  });
});

describe('containsSensitiveData', () => {
  it('should detect API key patterns', () => {
    expect(containsSensitiveData('api_key=abc123')).toBe(true);
    expect(containsSensitiveData('apiKey: secret')).toBe(true);
  });

  it('should detect token patterns', () => {
    expect(containsSensitiveData('token=xyz')).toBe(true);
    expect(containsSensitiveData('sk-projectkey123')).toBe(true);
  });

  it('should return false for safe strings', () => {
    expect(containsSensitiveData('normal text')).toBe(false);
    expect(containsSensitiveData('task: implement feature')).toBe(false);
  });
});

describe('sanitizeForSqlLike', () => {
  it('should escape % characters', () => {
    expect(sanitizeForSqlLike('100%')).toBe('100\\%');
  });

  it('should escape _ characters', () => {
    expect(sanitizeForSqlLike('test_value')).toBe('test\\_value');
  });

  it('should escape backslashes', () => {
    expect(sanitizeForSqlLike('path\\file')).toBe('path\\\\file');
  });

  it('should escape single quotes', () => {
    expect(sanitizeForSqlLike("it's")).toBe("it''s");
  });

  it('should handle empty strings', () => {
    expect(sanitizeForSqlLike('')).toBe('');
  });
});

describe('sanitizeIdentifier', () => {
  it('should accept valid identifiers', () => {
    expect(sanitizeIdentifier('frames')).toBe('frames');
    expect(sanitizeIdentifier('task_cache')).toBe('task_cache');
    expect(sanitizeIdentifier('column1')).toBe('column1');
  });

  it('should reject identifiers with special characters', () => {
    expect(() => sanitizeIdentifier('table; DROP')).toThrow(ValidationError);
    expect(() => sanitizeIdentifier('table--')).toThrow(ValidationError);
    expect(() => sanitizeIdentifier('table/*')).toThrow(ValidationError);
  });

  it('should reject SQL keywords', () => {
    expect(() => sanitizeIdentifier('DROP')).toThrow(ValidationError);
    expect(() => sanitizeIdentifier('SELECT')).toThrow(ValidationError);
    expect(() => sanitizeIdentifier('DELETE')).toThrow(ValidationError);
  });

  it('should reject empty strings', () => {
    expect(() => sanitizeIdentifier('')).toThrow(ValidationError);
  });
});

describe('validateTableName', () => {
  it('should accept allowed table names', () => {
    expect(validateTableName('frames')).toBe('frames');
    expect(validateTableName('events')).toBe('events');
    expect(validateTableName('anchors')).toBe('anchors');
  });

  it('should reject unknown table names', () => {
    expect(() => validateTableName('users')).toThrow(ValidationError);
    expect(() => validateTableName('passwords')).toThrow(ValidationError);
  });
});

describe('sanitizeFilePath', () => {
  it('should accept valid paths', () => {
    expect(sanitizeFilePath('/home/user/file.txt')).toBe('/home/user/file.txt');
    expect(sanitizeFilePath('relative/path.js')).toBe('relative/path.js');
  });

  it('should reject path traversal attempts', () => {
    expect(() => sanitizeFilePath('../../../etc/passwd')).toThrow(
      ValidationError
    );
    expect(() => sanitizeFilePath('/home/../../../etc/shadow')).toThrow(
      ValidationError
    );
  });

  it('should reject null bytes', () => {
    expect(() => sanitizeFilePath('/home/user\0/file')).toThrow(
      ValidationError
    );
  });

  it('should reject empty paths', () => {
    expect(() => sanitizeFilePath('')).toThrow(ValidationError);
  });
});

describe('validateShellArg', () => {
  it('should accept safe arguments', () => {
    expect(validateShellArg('filename.txt')).toBe('filename.txt');
    expect(validateShellArg('test-file')).toBe('test-file');
    expect(validateShellArg('path/to/file')).toBe('path/to/file');
  });

  it('should reject shell metacharacters', () => {
    expect(() => validateShellArg('file; rm -rf /')).toThrow(ValidationError);
    expect(() => validateShellArg('file | cat /etc/passwd')).toThrow(
      ValidationError
    );
    expect(() => validateShellArg('$(whoami)')).toThrow(ValidationError);
    expect(() => validateShellArg('`id`')).toThrow(ValidationError);
  });

  it('should handle empty strings', () => {
    expect(validateShellArg('')).toBe('');
  });
});

describe('sanitizeForLogging', () => {
  it('should redact sensitive object properties', () => {
    const obj = {
      username: 'user',
      password: 'secret123',
      apiKey: 'key123',
    };
    const result = sanitizeForLogging(obj) as Record<string, unknown>;
    expect(result['username']).toBe('user');
    expect(result['password']).toBe('[REDACTED]');
    expect(result['apiKey']).toBe('[REDACTED]');
  });

  it('should handle nested objects', () => {
    const obj = {
      user: {
        name: 'test',
        config: {
          token: 'secret',
        },
      },
    };
    const result = sanitizeForLogging(obj) as any;
    expect(result.user.name).toBe('test');
    // 'token' field should be redacted even when nested
    expect(result.user.config.token).toBe('[REDACTED]');
  });

  it('should redact fields containing sensitive keywords', () => {
    const obj = {
      userCredentials: { id: 1 },
      apiKey: 'secret',
      data: { accessToken: 'abc' },
    };
    const result = sanitizeForLogging(obj) as any;
    // 'userCredentials' contains 'credential'
    expect(result.userCredentials).toBe('[REDACTED]');
    expect(result.apiKey).toBe('[REDACTED]');
    expect(result.data.accessToken).toBe('[REDACTED]');
  });

  it('should handle arrays', () => {
    const arr = [{ password: 'secret' }, { name: 'safe' }];
    const result = sanitizeForLogging(arr) as any[];
    expect(result[0].password).toBe('[REDACTED]');
    expect(result[1].name).toBe('safe');
  });

  it('should redact sensitive strings', () => {
    const str = 'Using api_key=secret123 for auth';
    const result = sanitizeForLogging(str);
    expect(result).toContain('[REDACTED]');
    expect(result).not.toContain('secret123');
  });

  it('should pass through primitives', () => {
    expect(sanitizeForLogging(null)).toBe(null);
    expect(sanitizeForLogging(undefined)).toBe(undefined);
    expect(sanitizeForLogging(42)).toBe(42);
    expect(sanitizeForLogging(true)).toBe(true);
  });
});

describe('InputSchemas', () => {
  describe('frameId', () => {
    it('should accept valid UUIDs', () => {
      const validUuid = '123e4567-e89b-12d3-a456-426614174000';
      expect(() => InputSchemas.frameId.parse(validUuid)).not.toThrow();
    });

    it('should reject invalid UUIDs', () => {
      expect(() => InputSchemas.frameId.parse('not-a-uuid')).toThrow();
      expect(() => InputSchemas.frameId.parse('')).toThrow();
    });
  });

  describe('searchQuery', () => {
    it('should accept valid search queries', () => {
      const result = InputSchemas.searchQuery.parse('test query');
      expect(result).toBe('test query');
    });

    it('should escape LIKE special characters', () => {
      const result = InputSchemas.searchQuery.parse('100% complete');
      expect(result).toBe('100\\% complete');
    });

    it('should reject empty queries', () => {
      expect(() => InputSchemas.searchQuery.parse('')).toThrow();
    });
  });

  describe('email', () => {
    it('should accept valid emails', () => {
      const result = InputSchemas.email.parse('Test@Example.com');
      expect(result).toBe('test@example.com'); // Should be lowercased
    });

    it('should reject invalid emails', () => {
      expect(() => InputSchemas.email.parse('not-an-email')).toThrow();
      expect(() => InputSchemas.email.parse('@nodomain')).toThrow();
    });
  });

  describe('filePath', () => {
    it('should accept valid paths', () => {
      expect(() => InputSchemas.filePath.parse('/valid/path')).not.toThrow();
    });

    it('should reject path traversal', () => {
      expect(() =>
        InputSchemas.filePath.parse('../../../etc/passwd')
      ).toThrow();
    });

    it('should reject null bytes', () => {
      expect(() => InputSchemas.filePath.parse('/path\0/file')).toThrow();
    });
  });

  describe('limit', () => {
    it('should accept valid limits', () => {
      expect(InputSchemas.limit.parse(50)).toBe(50);
      expect(InputSchemas.limit.parse(1)).toBe(1);
      expect(InputSchemas.limit.parse(1000)).toBe(1000);
    });

    it('should use default value', () => {
      expect(InputSchemas.limit.parse(undefined)).toBe(50);
    });

    it('should reject out of range values', () => {
      expect(() => InputSchemas.limit.parse(0)).toThrow();
      expect(() => InputSchemas.limit.parse(1001)).toThrow();
      expect(() => InputSchemas.limit.parse(-1)).toThrow();
    });
  });
});

describe('validateInput', () => {
  it('should validate and return data for valid input', () => {
    const result = validateInput(InputSchemas.limit, 50, 'test');
    expect(result).toBe(50);
  });

  it('should throw ValidationError for invalid input', () => {
    expect(() => validateInput(InputSchemas.limit, 0, 'test')).toThrow(
      ValidationError
    );
  });

  it('should include context in error', () => {
    try {
      validateInput(InputSchemas.limit, -1, 'myContext');
      expect.fail('Should have thrown');
    } catch (e) {
      expect(e).toBeInstanceOf(ValidationError);
      expect((e as ValidationError).message).toContain('myContext');
    }
  });
});
