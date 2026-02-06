# StackMemory — Development Specification

> Generated from ONE_PAGER.md

## Architecture

```
┌──────────────────────────────────────────────────┐
│  CLI (commander)              MCP Server (SSE)   │
├──────────────────────────────────────────────────┤
│  Skills Layer                                    │
│  ├─ SpecGeneratorSkill    (4-doc chain)          │
│  ├─ LinearTaskRunner      (task → RLM → Linear)  │
│  ├─ ClaudeSkillsManager   (skill router)         │
│  └─ UnifiedRLMOrchestrator (RLM + skills)        │
├──────────────────────────────────────────────────┤
│  Core                                            │
│  ├─ FrameManager          (push/pop/query)       │
│  ├─ DualStackManager      (hot + cold stacks)    │
│  ├─ ContextRetriever      (semantic search)      │
│  ├─ RecursiveAgentOrchestrator (8 subagents)     │
│  └─ ParallelExecutor      (concurrent tasks)     │
├──────────────────────────────────────────────────┤
│  Storage                                         │
│  ├─ SQLiteAdapter         (local, better-sqlite3)│
│  └─ ParadeDB adapter      (hosted, optional)     │
├──────────────────────────────────────────────────┤
│  Integrations                                    │
│  ├─ Linear                (OAuth + webhook)      │
│  ├─ Claude Code           (agent bridge + hooks) │
│  └─ Ralph                 (swarm coordinator)    │
└──────────────────────────────────────────────────┘
```

## Tech Stack
- **Language**: TypeScript (strict mode, ESM with .js extensions)
- **Runtime**: Node.js 20+
- **Build**: esbuild (fast, single-pass)
- **Test**: Vitest (498 tests, ~17s)
- **Lint**: ESLint + Prettier
- **Database**: better-sqlite3 (local), ParadeDB (hosted)
- **CLI**: Commander.js
- **MCP**: Custom SSE server (@modelcontextprotocol/sdk)

## API Contracts

### MCP Tools
- `stackmemory_push_frame` — Push context frame onto stack
- `stackmemory_pop_frame` — Pop and return top frame
- `stackmemory_query` — Semantic search across frames
- `stackmemory_capture` — Snapshot current state for handoff
- `stackmemory_restore` — Rehydrate from captured state

### CLI Commands
- `stackmemory capture` / `restore` — Session handoff
- `stackmemory skills spec <cmd>` — Spec document generation
- `stackmemory skills linear-run <cmd>` — Linear task execution
- `stackmemory ralph linear <cmd>` — Ralph-Linear bridge

### Internal Interfaces
- `SkillContext` — Shared context passed to all skills
- `SkillResult` — Uniform { success, message, data?, action? } return
- `SubagentConfig` — Model, tokens, temperature, systemPrompt, capabilities
- `TaskNode` — Recursive task tree with dependencies and status

## Data Models

### Frame
```typescript
{ id, projectId, type, topic, summary, content, metadata,
  parentId, status, score, createdAt, updatedAt }
```

### LinearTask (synced)
```typescript
{ id, identifier, title, description, status, priority,
  labels[], team, assignee, url }
```

## Auth
- Local: no auth (single-user SQLite)
- Hosted: JWT via `stackmemory login`
- Linear: OAuth2 flow or `LINEAR_API_KEY` env var
- Claude: `ANTHROPIC_API_KEY` env var

## Error Handling
- Return `undefined` over throwing (per CLAUDE.md convention)
- Log + continue over crash
- Skills return `{ success: false, message }` on failure
- Hooks silently fail to not block Claude

## Deploy
- npm package: `@stackmemoryai/stackmemory`
- Binary: `stackmemory` (global install)
- Feature flags: `STACKMEMORY_SKILLS`, `STACKMEMORY_RALPH`, etc.
- Auto-update check on CLI startup
