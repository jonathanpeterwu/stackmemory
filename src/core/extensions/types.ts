/**
 * Extension System Type Definitions
 * Core types for the extension loading and management system
 */

import type { Frame, FrameContext } from '../context/frame-types.js';

/**
 * Extension source types for loading
 */
export type ExtensionSourceType = 'url' | 'file' | 'npm';

/**
 * Permission types that extensions can request
 */
export type ExtensionPermission =
  | `network:${string}` // Network access to specific domain
  | 'storage:local' // Local storage access
  | 'storage:session' // Session storage access
  | 'frames:read' // Read frame data
  | 'frames:write' // Write frame data
  | 'events:emit' // Emit events
  | 'events:listen'; // Listen to events

/**
 * Extension manifest defines metadata and permissions
 */
export interface ExtensionManifest {
  name: string;
  version: string;
  description?: string;
  author?: string;
  homepage?: string;
  permissions: ExtensionPermission[];
  entrypoint?: string;
}

/**
 * Extension context provided to extensions during initialization
 */
export interface ExtensionContext {
  // Core access (permission-gated)
  frames?: {
    get(frameId: string): Promise<Frame | undefined>;
    list(): Promise<Frame[]>;
    create?(options: Record<string, unknown>): Promise<Frame>;
    update?(frameId: string, data: Partial<Frame>): Promise<Frame>;
  };

  // State management
  state: {
    get<T>(key: string): Promise<T | undefined>;
    set<T>(key: string, value: T): Promise<void>;
    delete(key: string): Promise<void>;
  };

  // Sandbox APIs (always available)
  fetch: typeof fetch;

  // Storage (permission-gated)
  storage?: Storage;

  // Event communication
  emit(event: string, data: unknown): void;
  on(event: string, handler: EventHandler): () => void;
  off(event: string, handler: EventHandler): void;

  // Extension metadata
  extensionId: string;
  permissions: ExtensionPermission[];
}

/**
 * Event handler type
 */
export type EventHandler = (data: unknown) => void | Promise<void>;

/**
 * Tool definition for extensions
 */
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
  execute(params: unknown, context: ExtensionContext): Promise<ToolResult>;
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
 * JSON Schema for tool parameters
 */
export interface JSONSchema {
  type: 'object' | 'array' | 'string' | 'number' | 'boolean';
  properties?: Record<string, JSONSchema>;
  required?: string[];
  items?: JSONSchema;
  description?: string;
  enum?: unknown[];
  default?: unknown;
}

/**
 * Hook definition for lifecycle events
 */
export interface HookDefinition {
  event: string;
  handler: EventHandler;
  priority?: number;
}

/**
 * Provider adapter interface for LLM providers
 */
export interface ProviderAdapter {
  id: string;
  name: string;

  // Portable core streaming
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
 * Message for provider streaming
 */
export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

/**
 * Stream options for provider
 */
export interface StreamOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
}

/**
 * Stream event from provider
 */
export interface StreamEvent {
  type: 'text' | 'tool_call' | 'error' | 'done';
  content?: string;
  toolCall?: {
    name: string;
    parameters: unknown;
  };
  error?: string;
}

/**
 * Integration plugin interface for external services
 */
export interface IntegrationPlugin {
  id: string;
  service: string;

  // Sync operations
  sync(): Promise<FrameContext[]>;
  watch?(callback: (frame: FrameContext) => void): () => void;

  // Actions
  actions?: Record<string, ActionHandler>;
}

/**
 * Action handler for integration plugins
 */
export type ActionHandler = (
  params: unknown,
  context: ExtensionContext
) => Promise<unknown>;

/**
 * Main extension interface
 */
export interface Extension {
  name: string;
  version: string;
  manifest?: ExtensionManifest;

  // Lifecycle
  init(context: ExtensionContext): Promise<void>;
  destroy(): Promise<void>;

  // Capabilities (optional)
  tools?: ToolDefinition[];
  providers?: ProviderAdapter[];
  hooks?: HookDefinition[];
  integrations?: IntegrationPlugin[];
}

/**
 * Extension load options
 */
export interface ExtensionLoadOptions {
  /** Source URI (url:, file:, npm:) */
  source: string;

  /** Override manifest permissions (for development) */
  permissions?: ExtensionPermission[];

  /** Skip permission verification (dangerous, development only) */
  skipPermissionCheck?: boolean;

  /** Timeout for loading in milliseconds */
  timeout?: number;
}

/**
 * Extension load result
 */
export interface ExtensionLoadResult {
  success: boolean;
  extension?: Extension;
  extensionId?: string;
  error?: string;
  warnings?: string[];
}

/**
 * Extension validation result
 */
export interface ExtensionValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Extension state for tracking loaded extensions
 */
export interface ExtensionState {
  id: string;
  name: string;
  version: string;
  source: string;
  sourceType: ExtensionSourceType;
  permissions: ExtensionPermission[];
  loadedAt: number;
  status: 'loading' | 'active' | 'error' | 'disabled';
  error?: string;
}
