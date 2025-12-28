/**
 * Tests for LinearAuthManager and LinearOAuthSetup
 */

import { describe, it, expect, beforeEach, afterEach, vi, Mock } from 'vitest';
import { LinearAuthManager, LinearOAuthSetup } from '../auth.js';
import { join } from 'path';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';

// Mock fetch for HTTP requests
global.fetch = vi.fn();

// Mock open command
vi.mock('child_process', () => ({
  exec: vi.fn()
}));

describe('LinearAuthManager', () => {
  let authManager: LinearAuthManager;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'stackmemory-auth-test-'));
    authManager = new LinearAuthManager(tempDir);
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  describe('Configuration Management', () => {
    it('should save and load configuration correctly', () => {
      const config = {
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['read', 'write']
      };

      authManager.saveConfig(config);

      const loadedConfig = authManager.loadConfig();
      expect(loadedConfig).toEqual(config);
    });

    it('should return null when no configuration exists', () => {
      const config = authManager.loadConfig();
      expect(config).toBeNull();
    });

    it('should detect if configured correctly', () => {
      expect(authManager.isConfigured()).toBe(false);

      authManager.saveConfig({
        clientId: 'test-id',
        clientSecret: 'test-secret',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['read', 'write']
      });

      expect(authManager.isConfigured()).toBe(true);
    });

    it('should handle corrupted configuration gracefully', () => {
      const configPath = join(tempDir, '.stackmemory', 'linear-config.json');
      
      // Create .stackmemory directory first
      const stackmemoryDir = join(tempDir, '.stackmemory');
      if (!existsSync(stackmemoryDir)) {
        require('fs').mkdirSync(stackmemoryDir, { recursive: true });
      }

      writeFileSync(configPath, 'invalid json');

      expect(authManager.loadConfig()).toBeNull();
      expect(authManager.isConfigured()).toBe(false);
    });
  });

  describe('Token Management', () => {
    beforeEach(() => {
      // Setup configuration first
      authManager.saveConfig({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['read', 'write']
      });
    });

    it('should save and load tokens correctly', () => {
      const tokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 3600000,
        scope: ['read', 'write']
      };

      authManager.saveTokens(tokens);

      const loadedTokens = authManager.loadTokens();
      expect(loadedTokens).toEqual(tokens);
    });

    it('should return null when no tokens exist', () => {
      const tokens = authManager.loadTokens();
      expect(tokens).toBeNull();
    });

    it('should detect expired tokens', () => {
      const expiredTokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() - 1000, // Expired
        scope: ['read', 'write']
      };

      (authManager as any).saveTokens(expiredTokens);

      expect(authManager.isTokenValid()).toBe(false);
    });

    it('should detect valid tokens', () => {
      const validTokens = {
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 3600000, // Valid for 1 hour
        scope: ['read', 'write']
      };

      authManager.saveTokens(validTokens);

      expect(authManager.isTokenValid()).toBe(true);
    });

    it('should handle corrupted tokens gracefully', () => {
      const tokensPath = join(tempDir, '.stackmemory', 'linear-tokens.json');
      
      // Ensure .stackmemory directory exists
      const stackmemoryDir = join(tempDir, '.stackmemory');
      if (!existsSync(stackmemoryDir)) {
        require('fs').mkdirSync(stackmemoryDir, { recursive: true });
      }

      writeFileSync(tokensPath, 'invalid json');

      expect(authManager.loadTokens()).toBeNull();
      expect(authManager.isTokenValid()).toBe(false);
    });

    it('should refresh expired tokens', async () => {
      const expiredTokens = {
        accessToken: 'old-access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() - 1000,
        scope: ['read', 'write']
      };

      (authManager as any).saveTokens(expiredTokens);

      const refreshResponse = {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer'
      };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(refreshResponse)
      });

      const newTokens = await authManager.refreshTokens();

      expect(newTokens).toEqual({
        accessToken: 'new-access-token',
        refreshToken: 'new-refresh-token',
        expiresAt: expect.any(Number),
        scope: ['read', 'write']
      });

      expect(global.fetch).toHaveBeenCalledWith('https://api.linear.app/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: expect.stringContaining('grant_type=refresh_token')
      });
    });

    it('should handle refresh token errors', async () => {
      const expiredTokens = {
        accessToken: 'old-access-token',
        refreshToken: 'invalid-refresh-token',
        expiresAt: Date.now() - 1000,
        scope: ['read', 'write']
      };

      (authManager as any).saveTokens(expiredTokens);

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: vi.fn().mockResolvedValue('{"error": "invalid_grant"}')
      });

      await expect(authManager.refreshTokens()).rejects.toThrow('Token refresh failed: 400 Bad Request');
    });

    it('should throw error when refreshing without refresh token', async () => {
      const tokensWithoutRefresh = {
        accessToken: 'access-token',
        expiresAt: Date.now() - 1000,
        scope: ['read', 'write']
      };

      authManager.saveTokens(tokensWithoutRefresh);

      await expect(authManager.refreshTokens()).rejects.toThrow('No refresh token available');
    });
  });

  describe('Token Auto-refresh', () => {
    beforeEach(() => {
      authManager.saveConfig({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['read', 'write']
      });
    });

    it('should return valid tokens without refresh', async () => {
      const validTokens = {
        accessToken: 'valid-access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 3600000,
        scope: ['read', 'write']
      };

      authManager.saveTokens(validTokens);

      const tokens = await authManager.getValidToken();

      expect(tokens).toEqual(validTokens);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    it('should automatically refresh expired tokens', async () => {
      const expiredTokens = {
        accessToken: 'expired-access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() - 1000,
        scope: ['read', 'write']
      };

      (authManager as any).saveTokens(expiredTokens);

      const refreshResponse = {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer'
      };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(refreshResponse)
      });

      const tokens = await authManager.getValidToken();

      expect(tokens.accessToken).toBe('new-access-token');
      expect(global.fetch).toHaveBeenCalled();
    });

    it('should throw error when tokens are not available', async () => {
      await expect(authManager.getValidToken()).rejects.toThrow('No tokens available');
    });

    it('should throw error when refresh fails', async () => {
      const expiredTokens = {
        accessToken: 'expired-access-token',
        refreshToken: 'invalid-refresh-token',
        expiresAt: Date.now() - 1000,
        scope: ['read', 'write']
      };

      (authManager as any).saveTokens(expiredTokens);

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      });

      await expect(authManager.getValidToken()).rejects.toThrow('Token refresh failed: 401 Unauthorized');
    });
  });

  describe('Cleanup Operations', () => {
    beforeEach(() => {
      authManager.saveConfig({
        clientId: 'test-client-id',
        clientSecret: 'test-client-secret',
        redirectUri: 'http://localhost:3000/callback',
        scopes: ['read', 'write']
      });

      authManager.saveTokens({
        accessToken: 'access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 3600000,
        scope: ['read', 'write']
      });
    });

    it('should clear all authentication data', () => {
      expect(authManager.isConfigured()).toBe(true);
      expect(authManager.loadTokens()).not.toBeNull();

      authManager.clearAuth();

      expect(authManager.isConfigured()).toBe(false);
      expect(authManager.loadTokens()).toBeNull();
    });

    it('should handle clearing when files do not exist', () => {
      authManager.clearAuth(); // Clear once
      
      // Should not throw when clearing again
      expect(() => authManager.clearAuth()).not.toThrow();
    });
  });
});

describe('LinearOAuthSetup', () => {
  let oauthSetup: LinearOAuthSetup;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'stackmemory-oauth-test-'));
    oauthSetup = new LinearOAuthSetup(tempDir);
  });

  afterEach(() => {
    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
    vi.clearAllMocks();
  });

  describe('Interactive Setup', () => {
    it('should provide setup instructions and authorization URL', async () => {
      const result = await oauthSetup.setupInteractive();

      expect(result.instructions).toBeDefined();
      expect(Array.isArray(result.instructions)).toBe(true);
      expect(result.instructions.length).toBeGreaterThan(0);
      
      expect(result.authUrl).toBeDefined();
      expect(result.authUrl).toContain('https://linear.app/oauth/authorize');
      expect(result.authUrl).toContain('client_id=');
      expect(result.authUrl).toContain('redirect_uri=');
      expect(result.authUrl).toContain('response_type=code');
    });

    it('should save configuration during setup', async () => {
      await oauthSetup.setupInteractive();

      const authManager = new LinearAuthManager(tempDir);
      const config = authManager.loadConfig();

      expect(config).toBeDefined();
      expect(config!.clientId).toBeDefined();
      expect(config!.clientSecret).toBeDefined();
      expect(config!.redirectUri).toBeDefined();
    });

    it('should include state parameter for security', async () => {
      const result = await oauthSetup.setupInteractive();

      expect(result.authUrl).toContain('state=');
      
      const urlParams = new URLSearchParams(result.authUrl.split('?')[1]);
      const state = urlParams.get('state');
      expect(state).toBeDefined();
      expect(state!.length).toBeGreaterThan(10); // Should be a secure random string
    });
  });

  describe('Authorization Code Exchange', () => {
    beforeEach(async () => {
      await oauthSetup.setupInteractive(); // Initialize configuration
    });

    it('should complete authorization successfully', async () => {
      const tokenResponse = {
        access_token: 'access-token',
        refresh_token: 'refresh-token',
        expires_in: 3600,
        token_type: 'Bearer'
      };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(tokenResponse)
      });

      const success = await oauthSetup.completeAuth('auth-code-123');

      expect(success).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith('https://api.linear.app/oauth/token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: expect.stringContaining('grant_type=authorization_code')
      });

      // Check that tokens were saved
      const authManager = new LinearAuthManager(tempDir);
      const tokens = authManager.loadTokens();
      expect(tokens).toBeDefined();
      expect(tokens!.accessToken).toBe('access-token');
    });

    it('should handle authorization errors', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 400,
        statusText: 'Bad Request',
        text: vi.fn().mockResolvedValue('{"error": "invalid_grant"}')
      });

      const success = await oauthSetup.completeAuth('invalid-auth-code');

      expect(success).toBe(false);
    });

    it('should handle network errors during token exchange', async () => {
      (global.fetch as Mock).mockRejectedValueOnce(new Error('Network error'));

      const success = await oauthSetup.completeAuth('auth-code-123');

      expect(success).toBe(false);
    });

    it('should fail when not configured', async () => {
      const unconfiguredSetup = new LinearOAuthSetup(tempDir);

      const success = await unconfiguredSetup.completeAuth('auth-code-123');

      expect(success).toBe(false);
    });
  });

  describe('Connection Testing', () => {
    beforeEach(async () => {
      await oauthSetup.setupInteractive(); // Initialize configuration
      
      // Set up valid tokens
      const authManager = new LinearAuthManager(tempDir);
      authManager.saveTokens({
        accessToken: 'valid-access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() + 3600000,
        scope: ['read', 'write']
      });
    });

    it('should test connection successfully with valid tokens', async () => {
      const userResponse = {
        data: {
          viewer: {
            id: 'user-1',
            name: 'Test User',
            email: 'test@example.com'
          }
        }
      };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(userResponse)
      });

      const connectionOk = await oauthSetup.testConnection();

      expect(connectionOk).toBe(true);
      expect(global.fetch).toHaveBeenCalledWith('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          'Authorization': 'Bearer valid-access-token',
          'Content-Type': 'application/json'
        },
        body: expect.stringContaining('viewer')
      });
    });

    it('should fail connection test with invalid tokens', async () => {
      (global.fetch as Mock).mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized'
      });

      const connectionOk = await oauthSetup.testConnection();

      expect(connectionOk).toBe(false);
    });

    it('should fail connection test when not configured', async () => {
      const unconfiguredSetup = new LinearOAuthSetup(tempDir);

      const connectionOk = await unconfiguredSetup.testConnection();

      expect(connectionOk).toBe(false);
    });

    it('should handle GraphQL errors in connection test', async () => {
      const errorResponse = {
        errors: [
          { message: 'Authentication required' }
        ]
      };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(errorResponse)
      });

      const connectionOk = await oauthSetup.testConnection();

      expect(connectionOk).toBe(false);
    });

    it('should handle network errors in connection test', async () => {
      (global.fetch as Mock).mockRejectedValueOnce(new Error('Network timeout'));

      const connectionOk = await oauthSetup.testConnection();

      expect(connectionOk).toBe(false);
    });

    it('should automatically refresh tokens during connection test', async () => {
      // Set up expired tokens
      const authManager = new LinearAuthManager(tempDir);
      authManager.saveTokens({
        accessToken: 'expired-access-token',
        refreshToken: 'refresh-token',
        expiresAt: Date.now() - 1000, // Expired
        scope: ['read', 'write']
      });

      const refreshResponse = {
        access_token: 'new-access-token',
        refresh_token: 'new-refresh-token',
        expires_in: 3600,
        token_type: 'Bearer'
      };

      const userResponse = {
        data: {
          viewer: {
            id: 'user-1',
            name: 'Test User',
            email: 'test@example.com'
          }
        }
      };

      // Mock token refresh then successful API call
      (global.fetch as Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue(refreshResponse)
        })
        .mockResolvedValueOnce({
          ok: true,
          json: vi.fn().mockResolvedValue(userResponse)
        });

      const connectionOk = await oauthSetup.testConnection();

      expect(connectionOk).toBe(true);
      expect(global.fetch).toHaveBeenCalledTimes(2); // Refresh + API call
    });
  });

  describe('Error Handling and Edge Cases', () => {
    it('should handle missing Linear environment variables gracefully', async () => {
      // Remove any Linear environment variables
      delete process.env.LINEAR_CLIENT_ID;
      delete process.env.LINEAR_CLIENT_SECRET;

      const result = await oauthSetup.setupInteractive();

      expect(result.authUrl).toBeDefined(); // Should use default values
    });

    it('should validate authorization URL format', async () => {
      const result = await oauthSetup.setupInteractive();

      expect(result.authUrl).toMatch(/^https:\/\/linear\.app\/oauth\/authorize\?/);
      
      const url = new URL(result.authUrl);
      expect(url.searchParams.get('client_id')).toBeDefined();
      expect(url.searchParams.get('redirect_uri')).toBeDefined();
      expect(url.searchParams.get('response_type')).toBe('code');
      expect(url.searchParams.get('scope')).toBeDefined();
      expect(url.searchParams.get('state')).toBeDefined();
    });

    it('should handle file system errors during configuration save', async () => {
      // Mock fs.writeFileSync to throw an error
      const originalWriteFileSync = require('fs').writeFileSync;
      require('fs').writeFileSync = vi.fn(() => {
        throw new Error('Permission denied');
      });

      try {
        await expect(oauthSetup.setupInteractive()).rejects.toThrow();
      } finally {
        require('fs').writeFileSync = originalWriteFileSync;
      }
    });

    it('should validate token response structure', async () => {
      await oauthSetup.setupInteractive();

      // Mock malformed token response
      const malformedResponse = {
        access_token: 'token',
        // Missing required fields like expires_in
      };

      (global.fetch as Mock).mockResolvedValueOnce({
        ok: true,
        json: vi.fn().mockResolvedValue(malformedResponse)
      });

      const success = await oauthSetup.completeAuth('auth-code-123');

      expect(success).toBe(false);
    });
  });
});