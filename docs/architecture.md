# StackMemory Extension Architecture

## Design Philosophy

**Standardize the intersection; expose the union.**

- Portable core API with shared semantics across providers
- Provider-specific features available through explicit opt-in
- Extensions run in browser sandbox for security and capability

## Why This Approach

### 1. Browser Sandbox = Extension Runtime
Web-backed extensions get:
- Security isolation (process boundary)
- Web platform APIs (fetch, DOM, storage)
- Hot-reload without restart
- Cross-platform compatibility

### 2. Memory is Inherently Extensible
Different contexts need different capabilities:
- Code context needs AST parsing
- Linear context needs issue sync
- Slack context needs thread threading
- Custom contexts need custom tools

### 3. Provider Features Matter
LLM capabilities differ significantly:
- Claude: Extended thinking, XML-structured output
- GPT: Code interpreter, DALL-E, browsing
- Gemini: Grounding, multimodal native

Ignoring these limits what agents can do. The union approach exposes them when available while maintaining portability.

## Architecture Overview

```
┌─────────────────────────────────────────────────────────┐
│                    StackMemory Core                      │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────┐  │
│  │   Frames    │  │    State    │  │  Query Router   │  │
│  │  Manager    │  │ Serializer  │  │                 │  │
│  └─────────────┘  └─────────────┘  └─────────────────┘  │
└───────────────────────────┬─────────────────────────────┘
                            │
              ┌─────────────┴─────────────┐
              │     Extension Runtime     │
              │    (Browser Sandbox)      │
              └─────────────┬─────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        │                   │                   │
┌───────┴───────┐  ┌───────┴───────┐  ┌───────┴───────┐
│   Provider    │  │  Integration  │  │    Custom     │
│   Adapters    │  │   Plugins     │  │    Tools      │
│               │  │               │  │               │
│ Claude, GPT,  │  │ Linear, GH,   │  │ User-defined  │
│ Gemini, etc.  │  │ Slack, etc.   │  │ extensions    │
└───────────────┘  └───────────────┘  └───────────────┘
```

## Core Components

### Frame Manager
- Context window management
- Compaction handling
- State checkpointing

### State Serializer
- JSON for structured data (surgical updates via jq)
- Markdown for unstructured data (full context load)
- Enables fresh context resume

### Query Router
- Routes requests to appropriate handlers
- Manages tool dispatch
- Handles provider negotiation

## Extension Runtime

Extensions execute in a **browser sandbox** providing:

| Capability | Description |
|------------|-------------|
| Isolation | Security boundary between extensions |
| Web APIs | fetch, DOM, localStorage, IndexedDB |
| Hot reload | Update extensions without restart |
| Cross-platform | Runs anywhere with a browser engine |

### Extension Interface

```typescript
interface Extension {
  name: string;
  version: string;

  // Lifecycle
  init(context: ExtensionContext): Promise<void>;
  destroy(): Promise<void>;

  // Capabilities
  tools?: ToolDefinition[];
  providers?: ProviderAdapter[];
  hooks?: HookDefinition[];
}

interface ExtensionContext {
  // Core access
  frames: FrameManager;
  state: StateSerializer;

  // Sandbox APIs
  fetch: typeof fetch;
  storage: Storage;

  // Communication
  emit(event: string, data: unknown): void;
  on(event: string, handler: Handler): void;
}
```

## Extension Types

### Provider Adapters

Wrap LLM providers with standardized interface + optional extensions.

```typescript
interface ProviderAdapter {
  id: string;

  // Portable core
  stream(messages: Message[], options: StreamOptions): AsyncIterable<Event>;

  // Provider-specific (opt-in)
  extensions?: {
    extendedThinking?: boolean;  // Claude
    codeInterpreter?: boolean;   // OpenAI
    grounding?: boolean;         // Gemini
  };
}
```

### Integration Plugins

Connect external services to memory context.

```typescript
interface IntegrationPlugin {
  id: string;
  service: 'linear' | 'github' | 'slack' | string;

  // Sync operations
  sync(): Promise<ContextFrame[]>;
  watch?(callback: (frame: ContextFrame) => void): void;

  // Actions
  actions?: Record<string, ActionHandler>;
}
```

### Custom Tools

User-defined tools that extend agent capabilities.

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;

  execute(params: unknown, context: ExtensionContext): Promise<ToolResult>;
}
```

## State Management

Extensions persist state through the core serializer:

```typescript
// Structured data (JSON) - surgical updates
await state.set('extension.config', { theme: 'dark' });
const config = await state.get('extension.config');

// Unstructured data (Markdown) - full load
await state.setDocument('extension.notes', '# Session Notes\n...');
const notes = await state.getDocument('extension.notes');
```

## Security Model

| Layer | Protection |
|-------|------------|
| Sandbox | Process isolation, no filesystem access |
| Permissions | Explicit capability grants per extension |
| Network | Allowlist for external requests |
| Secrets | Never exposed to extensions directly |

### Permission Manifest

```json
{
  "name": "linear-sync",
  "permissions": [
    "network:api.linear.app",
    "storage:local",
    "frames:read",
    "frames:write"
  ]
}
```

## Loading Extensions

```typescript
// From URL (web-backed)
await stackmemory.loadExtension('https://extensions.example.com/linear-sync.js');

// From local file (development)
await stackmemory.loadExtension('file:///path/to/extension.js');

// From npm package
await stackmemory.loadExtension('npm:@stackmemory/linear-plugin');
```

## Communication

Extensions communicate via event bus:

```typescript
// Extension A emits
context.emit('context:updated', { frameId: '123' });

// Extension B listens
context.on('context:updated', ({ frameId }) => {
  console.log(`Frame ${frameId} updated`);
});
```

## Parallel Agent Coordination (Maestro Pattern)

Inspired by [Claude Maestro](https://github.com/its-maestro-baby/maestro), agents coordinate via file-based state:

```
/tmp/stackmemory/agents/{projectHash}/{agentId}.json
```

### Agent State Protocol

```typescript
interface AgentState {
  agentId: string;
  state: 'idle' | 'working' | 'needs_input' | 'finished' | 'error';
  message: string;
  timestamp: string;
  needsInputPrompt?: string;
}
```

### State Monitor

A filesystem watcher monitors agent state files:

```typescript
class AgentStateMonitor {
  constructor(projectHash: string) {
    this.stateDir = `/tmp/stackmemory/agents/${projectHash}`;
  }

  watch(callback: (states: Map<string, AgentState>) => void): void {
    // FSEvents / inotify watcher on stateDir
  }

  getAgentState(agentId: string): AgentState | undefined {
    const path = `${this.stateDir}/${agentId}.json`;
    return JSON.parse(fs.readFileSync(path, 'utf-8'));
  }
}
```

### Git Worktree Isolation

Parallel agents use isolated worktrees (per Maestro):

```
~/.stackmemory/worktrees/{repoHash}/{branch}/
```

- Each agent gets its own worktree
- No merge conflicts during parallel work
- Worktrees pruned when agent session ends

## Marketplace (Maestro Pattern)

Plugin marketplace follows Maestro's model:

### Directory Structure

```
~/.stackmemory/plugins/
├── marketplaces/           # Cloned marketplace repos
│   └── {source-name}/
│       ├── plugins/        # In-repo plugins
│       └── external_cloned/ # External URL plugins
├── {plugin-name}/          # Symlinks to active plugins
└── ...
```

### Marketplace Manifest

```json
{
  "name": "stackmemory-plugins",
  "plugins": [
    {
      "name": "linear-sync",
      "description": "Sync Linear issues to memory context",
      "version": "1.0.0",
      "types": ["integration"],
      "downloadURL": "./plugins/linear-sync"
    }
  ]
}
```

### Plugin Discovery

1. Clone marketplace repos to `~/.stackmemory/plugins/marketplaces/`
2. Parse `marketplace.json` for available plugins
3. Install creates symlink in `~/.stackmemory/plugins/`
4. Skills/commands discovered via directory scan

## Future Considerations

- **WASM extensions** - For compute-intensive operations
- **Shared workers** - Extension coordination across tabs
- **Remote extensions** - Execute in cloud sandbox
- **Extension marketplace** - Discovery and distribution
