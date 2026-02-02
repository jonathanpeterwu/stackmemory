/**
 * Extension System Module Exports
 * Provides extension loading, management, and type definitions
 */

// Core loader
export {
  ExtensionLoader,
  getExtensionLoader,
  loadExtension,
  unloadExtension,
} from './loader.js';

// Sandbox runtime (browser isolation)
export {
  SandboxRuntime,
  createSandboxRuntime,
  createManifest,
} from './sandbox-runtime.js';

// Custom Tools Framework
export {
  ToolRegistry,
  createToolRegistry,
  defineTool,
  type ToolExecutionOptions,
  type ExtensionStorage,
  type JSONSchemaProperty,
} from './custom-tools.js';

// Sandbox types
export type {
  // Permission system
  Permission,
  PermissionType,
  NetworkPermission,
  StoragePermission,
  FramePermission,
  EventPermission,
  DomPermission,
  PermissionManifest,
  // Sandbox configuration
  SandboxConfig,
  SandboxMode,
  ExtensionSource,
  // Sandbox APIs
  FrameManagerAPI,
  FrameData,
  FrameFilter,
  FrameCreateOptions,
  StateSerializerAPI,
  StorageAPI,
} from './sandbox-runtime.js';

// Types
export type {
  Extension,
  ExtensionContext,
  ExtensionLoadOptions,
  ExtensionLoadResult,
  ExtensionManifest,
  ExtensionPermission,
  ExtensionSourceType,
  ExtensionState,
  ExtensionValidationResult,
  EventHandler,
  ToolDefinition,
  ToolResult,
  JSONSchema,
  HookDefinition,
  ProviderAdapter,
  Message,
  StreamOptions,
  StreamEvent,
  IntegrationPlugin as BaseIntegrationPlugin,
  ActionHandler as BaseActionHandler,
} from './types.js';

// Integration Plugin System
export {
  // Core types
  type ContextFrame,
  type ActionHandler,
  type PluginState,
  type PluginPermission,
  type IntegrationPlugin,
  type PluginContext,
  type PluginFrameAccess,
  type PluginStorage,
  type PluginLogger,
  type PluginEvents,
  type EventBus,
  type PluginRegistration,

  // Implementations
  SimpleEventBus,
  PluginRegistry,
  InMemoryPluginStorage,

  // Linear-specific types
  type LinearPluginConfig,
  type LinearContextFrame,
  type LinearPluginActions,

  // Factory functions
  createPluginRegistry,
  createLinearPluginConfig,
  createLinearPlugin,
  createMockFrameAccess,

  // Aliases for convenience
  Plugin,
  Registry,
  EventBusImpl,
} from './plugin-system.js';
