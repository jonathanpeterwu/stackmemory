# Specish API Access & SQLite Query Patterns

## Part 1: Specish - OpenAPI-Based CLI Tool Access

### Concept
Expose external APIs to Claude via OpenAPI specs without custom code. Inspired by [Restish](https://rest.sh/).

### Goals
- Zero-code API integration via OpenAPI/Swagger specs
- Shell-composable output (JSON, pipe-friendly)
- Secure credential handling via keychain/env

### Architecture

```
┌─────────────────┐     ┌──────────────┐     ┌─────────────┐
│  OpenAPI Spec   │────▶│   Specish    │────▶│  API Call   │
│  (yaml/json)    │     │   Runtime    │     │  + Response │
└─────────────────┘     └──────────────┘     └─────────────┘
                              │
                              ▼
                        ┌──────────────┐
                        │  Credential  │
                        │   Manager    │
                        └──────────────┘
```

### CLI Interface

```bash
# Register an API from OpenAPI spec
stackmemory api add linear --spec https://api.linear.app/openapi.json

# List available operations
stackmemory api list linear
stackmemory api describe linear issues.list

# Execute operations
stackmemory api exec linear issues.list --state=started --limit=10
stackmemory api exec linear issues.create --title="Bug fix" --teamId=TEAM123

# Pipe-friendly output
stackmemory api exec linear issues.list | jq '.issues[].title'
```

### Credential Management

```bash
# Store credentials (uses system keychain)
stackmemory api auth linear --token="$LINEAR_API_KEY"

# OAuth flow support
stackmemory api auth github --oauth --scopes=repo,user
```

### Implementation Tasks

- [ ] **Phase 1: Core Parser**
  - [ ] OpenAPI 3.0/3.1 spec parser
  - [ ] Operation discovery and mapping
  - [ ] Parameter validation from spec

- [ ] **Phase 2: Runtime**
  - [ ] HTTP client with spec-driven requests
  - [ ] Response parsing and formatting
  - [ ] Error handling with spec-defined codes

- [ ] **Phase 3: Auth**
  - [ ] API key injection (header/query)
  - [ ] OAuth2 flow via oauth2c or native
  - [ ] Keychain integration (macOS)

- [ ] **Phase 4: MCP Bridge**
  - [ ] Expose registered APIs as MCP tools
  - [ ] Auto-generate tool descriptions from spec
  - [ ] Stream large responses

### File Structure

```
src/
  api/
    spec-parser.ts      # OpenAPI parser
    runtime.ts          # Request executor
    auth.ts             # Credential manager
    registry.ts         # Registered API store
  cli/commands/
    api.ts              # CLI commands
```

---

## Part 2: SQLite Query Patterns

### Key Insight from SQLite Documentation

> "SQLite is not client/server. Queries do not involve message round-trips, only function calls. The N+1 query pattern is NOT an anti-pattern for SQLite."

### Implications for StackMemory

| Pattern | Client/Server DB | SQLite |
|---------|------------------|--------|
| N+1 Queries | Anti-pattern | Acceptable |
| Complex JOINs | Preferred | Optional |
| Query Count | Minimize | Doesn't matter |

### Recommended Approach

**Optimize for code clarity, not query count.**

#### Current Pattern (Already Good)
```typescript
// frame-manager.ts - Simple queries are fine
async getRecentFrames(limit: number): Promise<Frame[]> {
  const frames = await this.db.query('SELECT * FROM frames ORDER BY timestamp DESC LIMIT ?', [limit]);

  // N+1 for related data is OK in SQLite
  for (const frame of frames) {
    frame.context = await this.db.query('SELECT * FROM context WHERE frame_id = ?', [frame.id]);
  }
  return frames;
}
```

#### When to Use JOINs
- Cross-table filtering (WHERE on joined table)
- Aggregations across tables
- When query logic is naturally unified

#### When to Use N+1
- Different object types need different queries
- Conditional fetching (only load if needed)
- Cleaner separation of concerns
- Lazy loading patterns

### Performance Guidelines

```typescript
// GOOD: Simple, maintainable
const frames = await getFrames();
const contexts = await Promise.all(frames.map(f => getContext(f.id)));

// ALSO GOOD: Single query when natural
const framesWithContext = await db.query(`
  SELECT f.*, c.data
  FROM frames f
  LEFT JOIN context c ON c.frame_id = f.id
`);

// AVOID: Over-optimization that hurts readability
const megaQuery = `
  SELECT ... 20 tables joined ...
  WITH 5 CTEs ...
  -- Hard to maintain, marginal benefit in SQLite
`;
```

### Action Items

- [ ] Audit existing queries for unnecessary complexity
- [ ] Simplify any over-optimized JOINs that hurt readability
- [ ] Add query timing logs in development mode
- [ ] Document query patterns in DEVELOPMENT.md

### Benchmarking

```typescript
// Add to sqlite-adapter.ts for dev mode
if (process.env.NODE_ENV === 'development') {
  const start = performance.now();
  const result = await this.db.run(sql, params);
  const duration = performance.now() - start;
  if (duration > 10) {
    console.warn(`Slow query (${duration.toFixed(1)}ms): ${sql.slice(0, 100)}`);
  }
}
```

---

---

## Part 3: Long-Running Agent Harness Patterns

Reference: [Anthropic Engineering - Effective Harnesses](https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents)

### Core Problem

Long-running agents lose context between sessions. Each new context window starts fresh with no memory.

### Two-Agent Architecture

```
┌─────────────────┐     ┌─────────────────┐
│  Initializer    │────▶│  Coding Agent   │
│  Agent          │     │  (subsequent)   │
└─────────────────┘     └─────────────────┘
        │                       │
        ▼                       ▼
┌─────────────────┐     ┌─────────────────┐
│  init.sh        │     │  progress.txt   │
│  baseline.git   │     │  git history    │
└─────────────────┘     └─────────────────┘
```

### StackMemory Implementation

#### 1. Progress Tracking File
```typescript
// Already exists: stackmemory.json
// Enhance with agent-specific fields
interface AgentProgress {
  session_id: string;
  started_at: string;
  features_completed: string[];
  features_remaining: string[];
  last_checkpoint: string;
  notes: string;
}
```

#### 2. Session Initialization Hook
```typescript
// src/hooks/session-init.ts
export async function initializeSession() {
  // 1. Read progress file
  const progress = await readProgress();

  // 2. Review git history
  const recentCommits = await getRecentCommits(10);

  // 3. Run sanity checks
  await runBuild();
  await runTests();

  // 4. Resume from checkpoint
  return { progress, commits, status: 'ready' };
}
```

#### 3. Feature List (JSON, not Markdown)
```json
{
  "features": [
    { "id": "sweep-hooks", "status": "complete", "passes": true },
    { "id": "specish-api", "status": "pending", "passes": false },
    { "id": "browser-mcp", "status": "pending", "passes": false }
  ]
}
```

#### 4. Incremental Commits
- Commit after each feature
- Descriptive messages for next agent
- Enable rollback on failure

### Anti-Patterns to Avoid

| Anti-Pattern | Solution |
|--------------|----------|
| One-shotting everything | Incremental features |
| Premature completion | E2E testing required |
| Undocumented progress | Progress file + git |
| Manual discovery | Explicit init scripts |

### Implementation Tasks

- [ ] Add `agent-progress.json` schema
- [ ] Create session init hook for Claude Code
- [ ] Add E2E test requirement before feature completion
- [ ] Integrate with existing stackmemory.json

---

## Part 4: BrowserOS MCP Integration

Reference: [BrowserOS](https://github.com/browseros-ai/BrowserOS)

### Concept

BrowserOS runs as an MCP server, enabling browser automation from Claude Code.

### Integration Architecture

```
┌─────────────────┐     ┌─────────────────┐     ┌─────────────────┐
│  Claude Code    │────▶│  StackMemory    │────▶│  BrowserOS      │
│  (agent)        │     │  MCP Server     │     │  MCP Server     │
└─────────────────┘     └─────────────────┘     └─────────────────┘
                              │                       │
                              ▼                       ▼
                        ┌──────────────┐     ┌──────────────┐
                        │  Context DB  │     │  Browser     │
                        │  (SQLite)    │     │  Automation  │
                        └──────────────┘     └──────────────┘
```

### Use Cases

1. **E2E Testing**: Agent uses browser to verify UI changes
2. **Web Research**: Fetch and parse dynamic content
3. **Form Automation**: Fill and submit web forms
4. **Screenshot Capture**: Visual verification

### MCP Tool Exposure

```typescript
// src/integrations/mcp/browser-bridge.ts
export const browserTools = {
  navigate: {
    description: 'Navigate browser to URL',
    params: { url: 'string' },
    handler: async ({ url }) => browserOS.navigate(url)
  },
  screenshot: {
    description: 'Capture current page screenshot',
    handler: async () => browserOS.screenshot()
  },
  click: {
    description: 'Click element by selector',
    params: { selector: 'string' },
    handler: async ({ selector }) => browserOS.click(selector)
  }
};
```

### Implementation Tasks

- [ ] Add BrowserOS as optional MCP dependency
- [ ] Create browser-bridge.ts for tool exposure
- [ ] Add E2E test helpers using browser automation
- [ ] Document browser integration in MCP.md

---

## Summary

| Component | Approach |
|-----------|----------|
| Specish API | OpenAPI-driven, zero-code integration |
| SQLite Queries | Favor clarity over query count |
| Auth | Keychain + env vars, no hardcoded secrets |
| MCP Bridge | Auto-expose registered APIs as tools |
| Agent Harness | Progress files + incremental commits |
| Browser Integration | BrowserOS MCP for E2E and automation |
| Work Clusters | Parallel feature development with merge |

---

## Part 5: Work Clusters (WorkForest Pattern)

Reference: [WorkForest](https://www.workforest.space/)

### Concept

Organize parallel AI-assisted development using folder-based isolation and planning docs.

### Folder Structure

```
~/projects/
  stackmemory/              # Base repo
  stackmemory-specish/      # Feature: Specish API
  stackmemory-browser/      # Feature: Browser integration
  stackmemory-harness/      # Feature: Agent harness
```

### Planning Doc Pattern

```markdown
# 001-specish-api.md

## Status: in-progress

## Goal
Implement OpenAPI-based CLI tool access

## Tasks
- [x] Parse OpenAPI specs
- [ ] Runtime executor
- [ ] Auth manager

## Notes
- Using restish as reference
- OAuth2 via oauth2c
```

### StackMemory Integration

#### 1. Cluster Registry
```typescript
// src/core/clusters/registry.ts
interface WorkCluster {
  id: string;
  name: string;
  base_branch: string;
  feature_branch: string;
  folder_path: string;
  planning_doc: string;
  status: 'active' | 'paused' | 'complete';
}
```

#### 2. CLI Commands
```bash
# Create new work cluster
stackmemory cluster create specish-api --base=main

# List active clusters
stackmemory cluster list

# Switch context to cluster
stackmemory cluster switch specish-api

# Merge cluster back
stackmemory cluster merge specish-api --squash
```

#### 3. Parallel Agent Spawning
```typescript
// Spawn multiple agents for different clusters
await Promise.all([
  spawnAgent('specish-api', 'Implement OpenAPI parser'),
  spawnAgent('browser-mcp', 'Add browser integration'),
  spawnAgent('harness', 'Create session init hook')
]);
```

### Benefits

| Pattern | Benefit |
|---------|---------|
| Folder isolation | No branch conflicts during work |
| Planning docs | Context survives session resets |
| Stacked PRs | Clean review process |
| Parallel work | 3x throughput potential |

### Trade-offs

- Integration complexity at merge time
- Potential duplicate work across clusters
- Requires manual task splitting decisions

### Implementation Tasks

- [ ] Add cluster registry to SQLite
- [ ] Create cluster CLI commands
- [ ] Integrate with existing stackmemory.json
- [ ] Add merge conflict detection
