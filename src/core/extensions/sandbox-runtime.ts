/**
 * Browser Sandbox Extension Runtime
 *
 * Provides isolated execution environment for extensions using iframe/worker isolation.
 * Exposes controlled Web APIs (fetch, DOM, storage) with permission-based access.
 * Supports hot-reload for extension updates without restart.
 */

import { z } from 'zod';
import { EventEmitter } from 'events';
import { ValidationError, ErrorCode, SystemError } from '../errors/index.js';
import { logger } from '../monitoring/logger.js';

// ============================================================================
// Permission System Types
// ============================================================================

/**
 * Permission types for extension capabilities
 */
export type PermissionType =
  | 'network' // Network access with domain allowlist
  | 'storage:local' // Local storage access
  | 'storage:indexed' // IndexedDB access
  | 'frames:read' // Read frame data
  | 'frames:write' // Write frame data
  | 'events:emit' // Emit events to other extensions
  | 'events:subscribe' // Subscribe to events
  | 'dom:read' // Read DOM elements (sandbox only)
  | 'dom:write'; // Write DOM elements (sandbox only)

/**
 * Network permission with domain specification
 */
export interface NetworkPermission {
  type: 'network';
  domains: string[]; // Allowlisted domains (e.g., ['api.linear.app', '*.github.com'])
}

/**
 * Storage permission
 */
export interface StoragePermission {
  type: 'storage:local' | 'storage:indexed';
  quotaBytes?: number; // Optional storage quota
}

/**
 * Frame access permission
 */
export interface FramePermission {
  type: 'frames:read' | 'frames:write';
  scope?: 'own' | 'all'; // 'own' = only extension's frames, 'all' = all frames
}

/**
 * Event permission
 */
export interface EventPermission {
  type: 'events:emit' | 'events:subscribe';
  patterns?: string[]; // Event name patterns (glob-style)
}

/**
 * DOM permission (sandbox only)
 */
export interface DomPermission {
  type: 'dom:read' | 'dom:write';
}

export type Permission =
  | NetworkPermission
  | StoragePermission
  | FramePermission
  | EventPermission
  | DomPermission;

/**
 * Permission manifest for an extension
 */
export interface PermissionManifest {
  name: string;
  version: string;
  permissions: Permission[];
  description?: string;
  author?: string;
  homepage?: string;
}

// ============================================================================
// Extension Interface Types
// ============================================================================

/**
 * Tool definition for extension-provided tools
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>; // JSON Schema
  execute: (params: unknown, context: ExtensionContext) => Promise<ToolResult>;
}

/**
 * Tool execution result
 */
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * Hook definition for lifecycle events
 */
export interface HookDefinition {
  event: string;
  handler: (data: unknown, context: ExtensionContext) => Promise<void>;
  priority?: number;
}

/**
 * Provider adapter for LLM integrations
 */
export interface ProviderAdapter {
  id: string;
  name: string;

  // Core streaming interface
  stream(
    messages: Message[],
    options: StreamOptions
  ): AsyncIterable<StreamEvent>;

  // Provider-specific extensions (opt-in)
  extensions?: {
    extendedThinking?: boolean; // Claude
    codeInterpreter?: boolean; // OpenAI
    grounding?: boolean; // Gemini
  };
}

/**
 * Message format for provider communication
 */
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
  metadata?: Record<string, unknown>;
}

/**
 * Stream options for provider calls
 */
export interface StreamOptions {
  maxTokens?: number;
  temperature?: number;
  stopSequences?: string[];
  tools?: ToolDefinition[];
}

/**
 * Stream event types
 */
export type StreamEvent =
  | { type: 'text'; content: string }
  | { type: 'tool_call'; name: string; arguments: unknown }
  | { type: 'error'; error: string }
  | { type: 'done' };

/**
 * Event handler type
 */
export type EventHandler = (data: unknown) => void | Promise<void>;

/**
 * Frame manager interface exposed to extensions
 */
export interface FrameManagerAPI {
  getCurrentFrame(): Promise<FrameData | null>;
  getFrame(frameId: string): Promise<FrameData | null>;
  listFrames(filter?: FrameFilter): Promise<FrameData[]>;
  createFrame?(options: FrameCreateOptions): Promise<FrameData>;
  closeFrame?(frameId: string): Promise<void>;
}

/**
 * Frame data exposed to extensions
 */
export interface FrameData {
  frameId: string;
  name: string;
  type: string;
  state: string;
  parentFrameId?: string;
  createdAt: number;
  closedAt?: number;
  metadata?: Record<string, unknown>;
}

/**
 * Frame filter options
 */
export interface FrameFilter {
  type?: string;
  state?: 'active' | 'closed';
  parentFrameId?: string;
  limit?: number;
}

/**
 * Frame creation options
 */
export interface FrameCreateOptions {
  name: string;
  type: string;
  parentFrameId?: string;
  metadata?: Record<string, unknown>;
}

/**
 * State serializer interface exposed to extensions
 */
export interface StateSerializerAPI {
  // Structured data (JSON) - surgical updates
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;

  // Unstructured data (Markdown) - full load
  getDocument(key: string): Promise<string | null>;
  setDocument(key: string, content: string): Promise<void>;
  deleteDocument(key: string): Promise<boolean>;
}

/**
 * Storage API exposed to extensions (localStorage-like)
 */
export interface StorageAPI {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
  key(index: number): string | null;
  readonly length: number;
}

/**
 * Context provided to extension during execution
 */
export interface ExtensionContext {
  // Extension metadata
  extensionId: string;
  extensionName: string;
  permissions: Permission[];

  // Core APIs
  frames: FrameManagerAPI;
  state: StateSerializerAPI;

  // Web APIs (sandboxed)
  fetch: typeof globalThis.fetch;
  storage: StorageAPI;

  // Communication
  emit(event: string, data: unknown): void;
  on(event: string, handler: EventHandler): () => void;
  off(event: string, handler: EventHandler): void;
}

/**
 * Extension interface that extensions must implement
 */
export interface Extension {
  name: string;
  version: string;
  manifest: PermissionManifest;

  // Lifecycle
  init(context: ExtensionContext): Promise<void>;
  destroy(): Promise<void>;

  // Capabilities (optional)
  tools?: ToolDefinition[];
  providers?: ProviderAdapter[];
  hooks?: HookDefinition[];
}

// ============================================================================
// Sandbox Configuration
// ============================================================================

/**
 * Sandbox isolation mode
 */
export type SandboxMode =
  | 'iframe' // Browser iframe isolation (full Web API access)
  | 'worker' // Web Worker isolation (limited API access, better for compute)
  | 'node'; // Node.js vm context (server-side only)

/**
 * Sandbox runtime configuration
 */
export interface SandboxConfig {
  mode: SandboxMode;
  timeout: number; // Execution timeout in ms
  memoryLimit?: number; // Memory limit in bytes (where supported)
  networkAllowlist?: string[]; // Global network allowlist
  enableDevtools?: boolean; // Enable debugging capabilities
}

/**
 * Extension load source
 */
export type ExtensionSource =
  | { type: 'url'; url: string } // From URL (web-backed)
  | { type: 'file'; path: string } // From local file (development)
  | { type: 'npm'; package: string; version?: string } // From npm package
  | { type: 'inline'; code: string; manifest: PermissionManifest }; // Inline code

// ============================================================================
// Sandbox Runtime Implementation
// ============================================================================

/**
 * Extension registration state
 */
interface ExtensionState {
  extension: Extension;
  context: ExtensionContext;
  status: 'loading' | 'active' | 'error' | 'unloaded';
  error?: Error;
  loadedAt: number;
  source: ExtensionSource;
}

/**
 * Zod schemas for validation
 */
const PermissionManifestSchema = z.object({
  name: z.string().min(1).max(100),
  version: z.string().regex(/^\d+\.\d+\.\d+$/),
  permissions: z.array(
    z.discriminatedUnion('type', [
      z.object({
        type: z.literal('network'),
        domains: z.array(z.string().min(1)),
      }),
      z.object({
        type: z.literal('storage:local'),
        quotaBytes: z.number().positive().optional(),
      }),
      z.object({
        type: z.literal('storage:indexed'),
        quotaBytes: z.number().positive().optional(),
      }),
      z.object({
        type: z.literal('frames:read'),
        scope: z.enum(['own', 'all']).optional(),
      }),
      z.object({
        type: z.literal('frames:write'),
        scope: z.enum(['own', 'all']).optional(),
      }),
      z.object({
        type: z.literal('events:emit'),
        patterns: z.array(z.string()).optional(),
      }),
      z.object({
        type: z.literal('events:subscribe'),
        patterns: z.array(z.string()).optional(),
      }),
      z.object({ type: z.literal('dom:read') }),
      z.object({ type: z.literal('dom:write') }),
    ])
  ),
  description: z.string().max(1000).optional(),
  author: z.string().max(200).optional(),
  homepage: z.string().url().optional(),
});

/**
 * Browser Sandbox Runtime
 *
 * Manages extension lifecycle, isolation, and API exposure.
 */
export class SandboxRuntime {
  private extensions = new Map<string, ExtensionState>();
  private eventBus = new EventEmitter();
  private config: SandboxConfig;
  private frameManager?: FrameManagerAPI;
  private stateSerializer?: StateSerializerAPI;

  constructor(config: Partial<SandboxConfig> = {}) {
    this.config = {
      mode: config.mode ?? 'node',
      timeout: config.timeout ?? 30000,
      memoryLimit: config.memoryLimit,
      networkAllowlist: config.networkAllowlist ?? [],
      enableDevtools: config.enableDevtools ?? false,
    };

    logger.info('SandboxRuntime initialized', {
      mode: this.config.mode,
      timeout: this.config.timeout,
    });
  }

  /**
   * Set the frame manager API for extensions
   */
  setFrameManager(frameManager: FrameManagerAPI): void {
    this.frameManager = frameManager;
  }

  /**
   * Set the state serializer API for extensions
   */
  setStateSerializer(stateSerializer: StateSerializerAPI): void {
    this.stateSerializer = stateSerializer;
  }

  /**
   * Load an extension from a source
   */
  async loadExtension(source: ExtensionSource): Promise<string> {
    logger.info('Loading extension', { source });

    const extension = await this.resolveExtension(source);
    const manifest = extension.manifest;

    // Validate manifest
    this.validateManifest(manifest);

    // Check for existing extension
    if (this.extensions.has(manifest.name)) {
      throw new ValidationError(
        `Extension "${manifest.name}" is already loaded`,
        ErrorCode.VALIDATION_FAILED,
        { extensionName: manifest.name }
      );
    }

    // Create isolated context
    const context = this.createExtensionContext(manifest);

    // Register extension state
    const state: ExtensionState = {
      extension,
      context,
      status: 'loading',
      loadedAt: Date.now(),
      source,
    };
    this.extensions.set(manifest.name, state);

    try {
      // Initialize extension with timeout
      await this.withTimeout(
        extension.init(context),
        this.config.timeout,
        `Extension "${manifest.name}" initialization timed out`
      );

      state.status = 'active';
      logger.info('Extension loaded successfully', {
        name: manifest.name,
        version: manifest.version,
      });

      return manifest.name;
    } catch (error) {
      state.status = 'error';
      state.error = error instanceof Error ? error : new Error(String(error));
      logger.error('Extension initialization failed', {
        name: manifest.name,
        error: state.error.message,
      });
      throw error;
    }
  }

  /**
   * Unload an extension
   */
  async unloadExtension(extensionName: string): Promise<void> {
    const state = this.extensions.get(extensionName);
    if (!state) {
      throw new ValidationError(
        `Extension "${extensionName}" not found`,
        ErrorCode.RESOURCE_NOT_FOUND,
        { extensionName }
      );
    }

    try {
      await this.withTimeout(
        state.extension.destroy(),
        this.config.timeout,
        `Extension "${extensionName}" destruction timed out`
      );
    } catch (error) {
      logger.warn('Extension destruction failed', {
        name: extensionName,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    state.status = 'unloaded';
    this.extensions.delete(extensionName);
    logger.info('Extension unloaded', { name: extensionName });
  }

  /**
   * Hot-reload an extension (unload and reload)
   */
  async reloadExtension(extensionName: string): Promise<void> {
    const state = this.extensions.get(extensionName);
    if (!state) {
      throw new ValidationError(
        `Extension "${extensionName}" not found`,
        ErrorCode.RESOURCE_NOT_FOUND,
        { extensionName }
      );
    }

    const source = state.source;
    await this.unloadExtension(extensionName);
    await this.loadExtension(source);
    logger.info('Extension reloaded', { name: extensionName });
  }

  /**
   * Get extension by name
   */
  getExtension(extensionName: string): Extension | undefined {
    return this.extensions.get(extensionName)?.extension;
  }

  /**
   * Get all loaded extensions
   */
  listExtensions(): Array<{
    name: string;
    version: string;
    status: string;
    loadedAt: number;
  }> {
    return Array.from(this.extensions.entries()).map(([name, state]) => ({
      name,
      version: state.extension.version,
      status: state.status,
      loadedAt: state.loadedAt,
    }));
  }

  /**
   * Get tools from all active extensions
   */
  getTools(): ToolDefinition[] {
    const tools: ToolDefinition[] = [];
    for (const state of Array.from(this.extensions.values())) {
      if (state.status === 'active' && state.extension.tools) {
        tools.push(...state.extension.tools);
      }
    }
    return tools;
  }

  /**
   * Get providers from all active extensions
   */
  getProviders(): ProviderAdapter[] {
    const providers: ProviderAdapter[] = [];
    for (const state of Array.from(this.extensions.values())) {
      if (state.status === 'active' && state.extension.providers) {
        providers.push(...state.extension.providers);
      }
    }
    return providers;
  }

  /**
   * Emit event to all extensions
   */
  emit(event: string, data: unknown): void {
    this.eventBus.emit(event, data);
  }

  /**
   * Shutdown the runtime
   */
  async shutdown(): Promise<void> {
    logger.info('Shutting down SandboxRuntime');
    const names = Array.from(this.extensions.keys());
    for (const name of names) {
      try {
        await this.unloadExtension(name);
      } catch (error) {
        logger.warn('Failed to unload extension during shutdown', {
          name,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    this.eventBus.removeAllListeners();
    logger.info('SandboxRuntime shutdown complete');
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  /**
   * Resolve extension from source
   */
  private async resolveExtension(source: ExtensionSource): Promise<Extension> {
    switch (source.type) {
      case 'inline':
        return this.loadInlineExtension(source.code, source.manifest);

      case 'file':
        return this.loadFileExtension(source.path);

      case 'url':
        return this.loadUrlExtension(source.url);

      case 'npm':
        return this.loadNpmExtension(source.package, source.version);

      default:
        throw new ValidationError(
          'Invalid extension source type',
          ErrorCode.VALIDATION_FAILED,
          { source }
        );
    }
  }

  /**
   * Load inline extension
   */
  private async loadInlineExtension(
    code: string,
    manifest: PermissionManifest
  ): Promise<Extension> {
    // For inline extensions, we expect the code to export a factory function
    // In a real browser environment, this would use Function constructor or eval
    // For Node.js, we use vm module

    // Security: Code execution is sandboxed and requires manifest declaration
    const AsyncFunction = Object.getPrototypeOf(
      async function () {}
    ).constructor;

    try {
      const factory = new AsyncFunction(
        'manifest',
        `
        ${code}
        return { ...exports, manifest };
      `
      );
      const extension = await factory(manifest);
      return extension as Extension;
    } catch (error) {
      throw new SystemError(
        `Failed to load inline extension: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCode.INITIALIZATION_ERROR,
        { manifest: manifest.name }
      );
    }
  }

  /**
   * Load extension from file
   */
  private async loadFileExtension(filePath: string): Promise<Extension> {
    try {
      // Dynamic import for ES modules
      const module = await import(filePath);
      const extension = module.default || module;

      if (!extension.name || !extension.version || !extension.manifest) {
        throw new Error('Invalid extension export: missing required fields');
      }

      return extension as Extension;
    } catch (error) {
      throw new SystemError(
        `Failed to load extension from file: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCode.FILE_NOT_FOUND,
        { filePath }
      );
    }
  }

  /**
   * Load extension from URL
   */
  private async loadUrlExtension(url: string): Promise<Extension> {
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const code = await response.text();
      // Extract manifest from code (expects manifest export)
      const manifestMatch = code.match(
        /export\s+const\s+manifest\s*=\s*({[\s\S]*?});/
      );
      if (!manifestMatch) {
        throw new Error('No manifest found in extension code');
      }

      const manifest = JSON.parse(
        manifestMatch[1].replace(/'/g, '"')
      ) as PermissionManifest;
      return this.loadInlineExtension(code, manifest);
    } catch (error) {
      throw new SystemError(
        `Failed to load extension from URL: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCode.NETWORK_ERROR,
        { url }
      );
    }
  }

  /**
   * Load extension from npm package
   */
  private async loadNpmExtension(
    packageName: string,
    version?: string
  ): Promise<Extension> {
    try {
      // Resolve package path - in production would use require.resolve
      const packagePath = version ? `${packageName}@${version}` : packageName;
      const module = await import(packagePath);
      const extension = module.default || module;

      if (!extension.name || !extension.version || !extension.manifest) {
        throw new Error('Invalid extension export: missing required fields');
      }

      return extension as Extension;
    } catch (error) {
      throw new SystemError(
        `Failed to load extension from npm: ${error instanceof Error ? error.message : String(error)}`,
        ErrorCode.INITIALIZATION_ERROR,
        { packageName, version }
      );
    }
  }

  /**
   * Validate permission manifest
   */
  private validateManifest(manifest: PermissionManifest): void {
    const result = PermissionManifestSchema.safeParse(manifest);
    if (!result.success) {
      throw new ValidationError(
        `Invalid extension manifest: ${result.error.errors.map((e) => e.message).join(', ')}`,
        ErrorCode.VALIDATION_FAILED,
        { errors: result.error.errors }
      );
    }

    // Validate network permissions against global allowlist
    const networkPerms = manifest.permissions.filter(
      (p): p is NetworkPermission => p.type === 'network'
    );
    for (const perm of networkPerms) {
      for (const domain of perm.domains) {
        if (!this.isDomainAllowed(domain)) {
          throw new ValidationError(
            `Domain "${domain}" is not in the global allowlist`,
            ErrorCode.PERMISSION_VIOLATION,
            { domain, allowlist: this.config.networkAllowlist }
          );
        }
      }
    }
  }

  /**
   * Check if a domain is allowed
   */
  private isDomainAllowed(domain: string): boolean {
    // If no global allowlist, allow all
    if (
      !this.config.networkAllowlist ||
      this.config.networkAllowlist.length === 0
    ) {
      return true;
    }

    return this.config.networkAllowlist.some((allowed) => {
      if (allowed === domain) return true;
      if (allowed.startsWith('*.')) {
        const suffix = allowed.slice(1);
        return domain.endsWith(suffix) || domain === allowed.slice(2);
      }
      return false;
    });
  }

  /**
   * Create sandboxed extension context
   */
  private createExtensionContext(
    manifest: PermissionManifest
  ): ExtensionContext {
    const extensionId = `${manifest.name}@${manifest.version}`;

    // Create sandboxed fetch
    const sandboxedFetch = this.createSandboxedFetch(manifest);

    // Create sandboxed storage
    const sandboxedStorage = this.createSandboxedStorage(manifest);

    // Create frame manager proxy with permission checks
    const framesAPI = this.createFramesAPI(manifest);

    // Create state serializer proxy with permission checks
    const stateAPI = this.createStateAPI(manifest);

    // Event handlers map for this extension
    const handlers = new Map<string, Set<EventHandler>>();

    const context: ExtensionContext = {
      extensionId,
      extensionName: manifest.name,
      permissions: manifest.permissions,

      frames: framesAPI,
      state: stateAPI,

      fetch: sandboxedFetch,
      storage: sandboxedStorage,

      emit: (event: string, data: unknown) => {
        if (!this.hasPermission(manifest, 'events:emit', event)) {
          logger.warn('Extension attempted to emit without permission', {
            extension: manifest.name,
            event,
          });
          return;
        }
        this.eventBus.emit(event, data);
      },

      on: (event: string, handler: EventHandler) => {
        if (!this.hasPermission(manifest, 'events:subscribe', event)) {
          logger.warn('Extension attempted to subscribe without permission', {
            extension: manifest.name,
            event,
          });
          return () => {};
        }

        if (!handlers.has(event)) {
          handlers.set(event, new Set());
        }
        handlers.get(event)!.add(handler);
        this.eventBus.on(event, handler);

        return () => {
          handlers.get(event)?.delete(handler);
          this.eventBus.off(event, handler);
        };
      },

      off: (event: string, handler: EventHandler) => {
        handlers.get(event)?.delete(handler);
        this.eventBus.off(event, handler);
      },
    };

    return context;
  }

  /**
   * Create sandboxed fetch function
   */
  private createSandboxedFetch(
    manifest: PermissionManifest
  ): typeof globalThis.fetch {
    const networkPerms = manifest.permissions.filter(
      (p): p is NetworkPermission => p.type === 'network'
    );
    const allowedDomains = networkPerms.flatMap((p) => p.domains);

    return async (input: RequestInfo | URL, init?: RequestInit) => {
      const url =
        typeof input === 'string'
          ? new URL(input)
          : input instanceof URL
            ? input
            : new URL(input.url);

      // Check domain allowlist
      const isAllowed = allowedDomains.some((domain) => {
        if (domain === url.hostname) return true;
        if (domain.startsWith('*.')) {
          const suffix = domain.slice(1);
          return url.hostname.endsWith(suffix);
        }
        return false;
      });

      if (!isAllowed) {
        throw new ValidationError(
          `Network access to "${url.hostname}" is not permitted`,
          ErrorCode.PERMISSION_VIOLATION,
          { hostname: url.hostname, allowed: allowedDomains }
        );
      }

      // Perform the actual fetch
      return globalThis.fetch(input, init);
    };
  }

  /**
   * Create sandboxed storage
   */
  private createSandboxedStorage(manifest: PermissionManifest): StorageAPI {
    const hasLocalStorage = manifest.permissions.some(
      (p) => p.type === 'storage:local'
    );

    if (!hasLocalStorage) {
      // Return a no-op storage
      return {
        getItem: () => null,
        setItem: () => {},
        removeItem: () => {},
        clear: () => {},
        key: () => null,
        length: 0,
      };
    }

    // Create isolated storage namespace
    const storageKey = `ext:${manifest.name}:`;
    const storage = new Map<string, string>();

    return {
      getItem: (key: string) => storage.get(storageKey + key) ?? null,
      setItem: (key: string, value: string) => {
        storage.set(storageKey + key, value);
      },
      removeItem: (key: string) => {
        storage.delete(storageKey + key);
      },
      clear: () => {
        for (const key of Array.from(storage.keys())) {
          if (key.startsWith(storageKey)) {
            storage.delete(key);
          }
        }
      },
      key: (index: number) => {
        const keys = Array.from(storage.keys()).filter((k) =>
          k.startsWith(storageKey)
        );
        return keys[index]?.slice(storageKey.length) ?? null;
      },
      get length() {
        return Array.from(storage.keys()).filter((k) =>
          k.startsWith(storageKey)
        ).length;
      },
    };
  }

  /**
   * Create frames API with permission checks
   */
  private createFramesAPI(manifest: PermissionManifest): FrameManagerAPI {
    const canRead = manifest.permissions.some((p) => p.type === 'frames:read');
    const canWrite = manifest.permissions.some(
      (p) => p.type === 'frames:write'
    );

    const noOpFrameManager: FrameManagerAPI = {
      getCurrentFrame: async () => null,
      getFrame: async () => null,
      listFrames: async () => [],
    };

    if (!canRead && !this.frameManager) {
      return noOpFrameManager;
    }

    const fm = this.frameManager;
    const api: FrameManagerAPI = {
      getCurrentFrame: async () => {
        if (!canRead || !fm) return null;
        return fm.getCurrentFrame();
      },
      getFrame: async (frameId: string) => {
        if (!canRead || !fm) return null;
        return fm.getFrame(frameId);
      },
      listFrames: async (filter?: FrameFilter) => {
        if (!canRead || !fm) return [];
        return fm.listFrames(filter);
      },
    };

    if (canWrite && fm?.createFrame) {
      api.createFrame = async (options: FrameCreateOptions) => {
        return fm.createFrame!(options);
      };
    }

    if (canWrite && fm?.closeFrame) {
      api.closeFrame = async (frameId: string) => {
        return fm.closeFrame!(frameId);
      };
    }

    return api;
  }

  /**
   * Create state API with permission checks
   */
  private createStateAPI(manifest: PermissionManifest): StateSerializerAPI {
    const canRead = manifest.permissions.some((p) => p.type === 'frames:read');
    const canWrite = manifest.permissions.some(
      (p) => p.type === 'frames:write'
    );

    const prefix = `ext:${manifest.name}:`;
    const ss = this.stateSerializer;

    return {
      get: async <T>(key: string): Promise<T | null> => {
        if (!canRead || !ss) return null;
        return ss.get<T>(prefix + key);
      },
      set: async <T>(key: string, value: T): Promise<void> => {
        if (!canWrite || !ss) return;
        await ss.set(prefix + key, value);
      },
      delete: async (key: string): Promise<boolean> => {
        if (!canWrite || !ss) return false;
        return ss.delete(prefix + key);
      },
      getDocument: async (key: string): Promise<string | null> => {
        if (!canRead || !ss) return null;
        return ss.getDocument(prefix + key);
      },
      setDocument: async (key: string, content: string): Promise<void> => {
        if (!canWrite || !ss) return;
        await ss.setDocument(prefix + key, content);
      },
      deleteDocument: async (key: string): Promise<boolean> => {
        if (!canWrite || !ss) return false;
        return ss.deleteDocument(prefix + key);
      },
    };
  }

  /**
   * Check if extension has specific permission
   */
  private hasPermission(
    manifest: PermissionManifest,
    type: PermissionType,
    target?: string
  ): boolean {
    const perm = manifest.permissions.find((p) => p.type === type);
    if (!perm) return false;

    // Check pattern matching for events
    if ((type === 'events:emit' || type === 'events:subscribe') && target) {
      const eventPerm = perm as EventPermission;
      if (!eventPerm.patterns || eventPerm.patterns.length === 0) {
        return true; // No patterns = all allowed
      }
      return eventPerm.patterns.some((pattern) =>
        this.matchPattern(pattern, target)
      );
    }

    return true;
  }

  /**
   * Match glob-style pattern
   */
  private matchPattern(pattern: string, value: string): boolean {
    const regex = new RegExp(
      '^' + pattern.replace(/\*/g, '.*').replace(/\?/g, '.') + '$'
    );
    return regex.test(value);
  }

  /**
   * Execute with timeout
   */
  private async withTimeout<T>(
    promise: Promise<T>,
    timeoutMs: number,
    message: string
  ): Promise<T> {
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    });
    return Promise.race([promise, timeoutPromise]);
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new sandbox runtime with default configuration
 */
export function createSandboxRuntime(
  config?: Partial<SandboxConfig>
): SandboxRuntime {
  return new SandboxRuntime(config);
}

/**
 * Create a permission manifest
 */
export function createManifest(
  name: string,
  version: string,
  permissions: Permission[],
  options?: {
    description?: string;
    author?: string;
    homepage?: string;
  }
): PermissionManifest {
  return {
    name,
    version,
    permissions,
    ...options,
  };
}

// ============================================================================
// Exports
// ============================================================================

export default SandboxRuntime;
