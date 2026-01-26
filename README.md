# StackMemory

**Lossless, project-scoped memory for AI tools** • v0.5.30

StackMemory is a **production-ready memory runtime** for AI coding tools that preserves full project context across sessions. With **Phases 1-4 complete**, it delivers:

- **89-98% faster** task operations than manual tracking
- **10,000+ frame depth** support with hierarchical organization
- **Full Linear integration** with bidirectional sync
- **20+ MCP tools** for Claude Code
- **Context persistence** that survives /clear operations
- **Two-tier storage system** with local tiers and infinite remote storage
- **Smart compression** (LZ4/ZSTD) with 2.5-3.5x ratios
- **Background migration** with configurable triggers
- **396 tests passing** with standardized error handling
- **npm v0.5.30** published with WhatsApp notifications and improved integrations

Instead of a linear chat log, StackMemory organizes memory as a **call stack** of scoped work (frames), with intelligent LLM-driven retrieval and team collaboration features.

> **Memory is storage. Context is a compiled view.**

---

## Why StackMemory exists

Development tools lose context between sessions:

- Previous decisions aren't tracked
- Constraints get forgotten
- Changes lack history
- Tool execution isn't recorded

StackMemory solves this by:

- Storing all events, tool calls, and decisions
- Smart retrieval of relevant context
- Call stack organization (10,000+ frame depth)
- Configurable importance scoring
- Team collaboration through shared stacks

---

## Core concepts (quick mental model)

| Concept        | Meaning                                           |
| -------------- | ------------------------------------------------- |
| **Project**    | One GitHub repo (initial scope)                   |
| **Frame**      | A scoped unit of work (like a function call)      |
| **Call Stack** | Nested frames; only the active path is "hot"      |
| **Event**      | Append-only record (message, tool call, decision) |
| **Digest**     | Structured return value when a frame closes       |
| **Anchor**     | Pinned fact (DECISION, CONSTRAINT, INTERFACE)     |

Frames can span:

- multiple chat turns
- multiple tool calls
- multiple sessions

---

## Hosted vs Open Source

### Hosted (default)

- Cloud-backed memory runtime
- Fast indexing + retrieval
- Durable storage
- Per-project pricing
- Works out-of-the-box

### Open-source local mirror

- SQLite-based
- Fully inspectable
- Offline / air-gapped
- Intentionally **N versions behind**
- No sync, no org features

> OSS is for trust and inspection.
> Hosted is for scale, performance, and teams.

---

## How it integrates

StackMemory integrates as an **MCP tool** and is invoked on **every interaction** in:

- Claude Code
- compatible editors
- future MCP-enabled tools

The editor never manages memory directly; it asks StackMemory for the **context bundle**.

---

## Product Health Metrics

### Current Status (v0.5.30)

| Metric | Current | Target | Status |
|--------|---------|--------|--------|
| **Test Coverage** | 85% | 90% | In Progress |
| **Performance (p50)** | TBD | <50ms | Pending |
| **Documentation** | 70% | 100% | In Progress |
| **Active Issues** | 5 high | 0 high | In Progress |
| **Code Quality** | 396 tests | 400+ | Done |
| **npm Downloads** | Growing | 1K+/week | On Track |

### Quality Score: 78/100

**Formula:** (Test Coverage × 0.3) + (Performance × 0.3) + (Documentation × 0.2) + (Issues Resolution × 0.2)

### Next Sprint Priorities

1. **[STA-289] Performance Optimization** - Achieve SLA targets
2. **[STA-291] Code Cleanup** - Zero TODOs, 90% coverage

---

# QuickStart

## 1. Hosted (Recommended)

### Step 1: Create a project

```bash
stackmemory projects create \
  --repo https://github.com/org/repo
```

This creates a **project-scoped memory space** tied to the repo.

---

### Step 2: Install StackMemory

```bash
npm install -g @stackmemoryai/stackmemory@0.5.30
# or latest
npm install -g @stackmemoryai/stackmemory@latest
```

---

### Step 3: Setup Claude Code Integration (Automated)

```bash
# Automatic setup - configures MCP and session hooks
npm run claude:setup
```

This automatically:

- Creates `~/.claude/stackmemory-mcp.json` MCP configuration
- Sets up session initialization hooks
- Updates `~/.claude/config.json` with StackMemory integration

**Manual setup alternative:**

<details>
<summary>Click to expand manual setup steps</summary>

Create MCP configuration:

```bash
mkdir -p ~/.claude
cat > ~/.claude/stackmemory-mcp.json << 'EOF'
{
  "mcpServers": {
    "stackmemory": {
      "command": "stackmemory",
      "args": ["mcp-server"],
      "env": { "NODE_ENV": "production" }
    }
  }
}
EOF
```

Update Claude config:

```json
{
  "mcp": {
    "configFiles": ["~/.claude/stackmemory-mcp.json"]
  }
}
```

</details>


Claude Code sessions automatically capture tool calls, maintain context across sessions, and sync with Linear when configured.

Available MCP tools in Claude Code:

| Tool                 | Description                                |
| -------------------- | ------------------------------------------ |
| `get_context`        | Retrieve relevant context for current work |
| `add_decision`       | Record a decision with rationale           |
| `start_frame`        | Begin a new context frame                  |
| `close_frame`        | Close current frame with summary           |
| `create_task`        | Create a new task                          |
| `update_task_status` | Update task status                         |
| `get_active_tasks`   | List active tasks (with filters)           |
| `get_task_metrics`   | Get task analytics                         |
| `linear_sync`        | Sync with Linear                           |
| `linear_update_task` | Update Linear issue                        |
| `linear_get_tasks`   | Get tasks from Linear                      |


---

## 2. Open-Source Local Mode

### Step 1: Clone

```bash
git clone https://github.com/stackmemory/stackmemory
cd stackmemory
```

### Step 2: Run local MCP server

```bash
cargo run --bin stackmemory-mcp
# or
npm run dev
```

This creates:

```
.memory/
  └── memory.db   # SQLite
```

All project memory lives locally.

---

### Step 3: Point your editor to local MCP

```json
{
  "tools": {
    "stackmemory": {
      "command": "stackmemory-mcp",
      "args": ["--local"]
    }
  }
}
```

## How it works

Each interaction: ingests events → updates indices → retrieves relevant context → returns sized bundle.

---

## Example MCP response (simplified)

```json
{
  "hot_stack": [
    { "frame": "Debug auth redirect", "constraints": [...] }
  ],
  "anchors": [
    { "type": "DECISION", "text": "Use SameSite=Lax cookies" }
  ],
  "relevant_digests": [
    { "frame": "Initial auth refactor", "summary": "..." }
  ],
  "pointers": [
    "s3://logs/auth-test-0421"
  ]
}
```

---

## Storage & limits

### Two-Tier Storage System (v0.3.15+)

StackMemory implements an intelligent two-tier storage architecture:

#### Local Storage Tiers
- **Young (<24h)**: Uncompressed, complete retention in memory/Redis
- **Mature (1-7d)**: LZ4 compression (~2.5x), selective retention
- **Old (7-30d)**: ZSTD compression (~3.5x), critical data only

#### Remote Storage
- **Archive (>30d)**: Infinite retention in S3 + TimeSeries DB
- **Migration**: Automatic background migration based on age, size, and importance
- **Offline Queue**: Persistent retry logic for failed uploads

### Free tier (hosted)

- 1 project
- Up to **2GB local storage**
- Up to **100GB retrieval egress / month**

### Paid tiers

- Per-project pricing
- Unlimited storage + retrieval
- Team sharing
- Org controls
- Custom retention policies

**No seat-based pricing.**

---

## Claude Code Integration

StackMemory can automatically save context when using Claude Code, so your AI assistant has access to previous context and decisions.

### Quick Setup

```bash
# Add alias
echo 'alias claude="~/Dev/stackmemory/scripts/claude-code-wrapper.sh"' >> ~/.zshrc
source ~/.zshrc

# Use: claude (saves context on exit)
```

### Integration Methods

```bash
# 1. Shell wrapper (recommended)
claude [--auto-sync] [--sync-interval=10]

# 2. Linear auto-sync daemon
./scripts/linear-auto-sync.sh start [interval]

# 3. Background daemon
./scripts/stackmemory-daemon.sh [interval] &

# 4. Git hooks
./scripts/setup-git-hooks.sh
```

**Features:** Auto-save on exit, Linear sync, runs only in StackMemory projects, configurable sync intervals.

## RLM (Recursive Language Model) Orchestration

StackMemory includes an advanced RLM system that enables handling arbitrarily complex tasks through recursive decomposition and parallel execution using Claude Code's Task tool.

### Key Features

- **Recursive Task Decomposition**: Breaks complex tasks into manageable subtasks
- **Parallel Subagent Execution**: Run multiple specialized agents concurrently
- **8 Specialized Agent Types**: Planning, Code, Testing, Linting, Review, Improve, Context, Publish
- **Multi-Stage Review**: Iterative improvement cycles with quality scoring (0-1 scale)
- **Automatic Test Generation**: Unit, integration, and E2E test creation
- **Full Transparency**: Complete execution tree visualization

### Usage

```bash
# Basic usage
stackmemory skills rlm "Your complex task description"

# With options
stackmemory skills rlm "Refactor authentication system" \
  --max-parallel 8 \
  --review-stages 5 \
  --quality-threshold 0.9 \
  --test-mode all

# Examples
stackmemory skills rlm "Generate comprehensive tests for API endpoints"
stackmemory skills rlm "Refactor the entire authentication system to use JWT"
stackmemory skills rlm "Build, test, and publish version 2.0.0"
```

### Configuration Options

| Option | Description | Default |
|--------|-------------|---------|
| `--max-parallel` | Maximum concurrent subagents | 5 |
| `--max-recursion` | Maximum recursion depth | 4 |
| `--review-stages` | Number of review iterations | 3 |
| `--quality-threshold` | Target quality score (0-1) | 0.85 |
| `--test-mode` | Test generation mode (unit/integration/e2e/all) | all |
| `--verbose` | Show all recursive operations | false |

### How It Works

1. **Task Decomposition**: Planning agent analyzes the task and creates a dependency graph
2. **Parallel Execution**: Independent subtasks run concurrently up to the parallel limit
3. **Review Cycle**: Review agents assess quality, improve agents implement fixes
4. **Test Generation**: Testing agents create comprehensive test suites
5. **Result Aggregation**: All outputs are combined into a final deliverable

**Note**: RLM requires Claude Code Max plan for unlimited subagent execution. In development mode, it uses mock responses for testing.

## Guarantees & Non-goals

**Guarantees:** Lossless storage, project isolation, survives session/model switches, inspectable local mirror.

**Non-goals:** Chat UI, vector DB replacement, tool runtime, prompt framework.


## CLI Commands

```bash
# Core
stackmemory init                          # Initialize project
stackmemory status                        # Current status
stackmemory progress                      # Recent activity

# Tasks
stackmemory tasks list [--status pending] # List tasks
stackmemory task add "title" --priority high
stackmemory task done <id>

# Search & Logs
stackmemory search "query" [--tasks|--context]
stackmemory log [--follow] [--type task]
```

```bash
# Context
stackmemory context show [--verbose]
stackmemory context push "name" --type task
stackmemory context add decision "text"
stackmemory context pop [--all]

# Linear Integration
stackmemory linear setup                  # OAuth setup
stackmemory linear sync [--direction from_linear]
stackmemory linear auto-sync --start
stackmemory linear update ENG-123 --status done

# Storage Management
stackmemory storage status               # Show tier distribution
stackmemory storage migrate [--tier young] # Trigger migration
stackmemory storage cleanup --force      # Clean old data
stackmemory storage config --show        # Show configuration

# Analytics & Server
stackmemory analytics [--view|--port 3000]
stackmemory mcp-server [--port 3001]
```

---

## Status

- Hosted: **Private beta**
- OSS mirror: **Production ready**
- MCP integration: **Stable**
- CLI: **v0.5.30** - Full task, context, Linear, and storage management
- Two-tier storage: **Complete**
- Test Suite: **396 tests passing**

---

## Changelog

### v0.5.30 (2026-01-26)
- Standardized error handling with `IntegrationError`, `DatabaseError`, `ValidationError`
- Adopted error classes across Linear integration (12 files)
- Adopted error classes across database layer (6 files)
- WhatsApp notifications with session ID and interactive options
- 396 tests passing with improved code quality

### v0.5.28 (2026-01-25)
- WhatsApp flag for claude-sm automatic notifications
- Incoming request queue for WhatsApp triggers
- SMS webhook /send endpoint for outgoing notifications

### v0.5.26 (2026-01-24)
- OpenCode wrapper (opencode-sm) with context integration
- Discovery CLI and MCP tools
- Real LLM provider and retrieval audit system
- Linear issue management and task picker

### v0.5.21 (2026-01-23)
- Claude-sm remote mode and configurable defaults
- Context loading command improvements
- Session summary features

### v0.3.16 (2026-01-15)
- Fixed critical error handling - getFrame() returns undefined instead of throwing
- Improved test coverage and fixed StackMemoryError constructor usage
- Removed dangerous secret-cleaning scripts from repository
- All tests passing, lint clean, build successful

### v0.3.15 (2026-01-14)
- Two-tier storage system implementation complete
- Smart compression with LZ4/ZSTD support
- Background migration with configurable triggers
- Improved Linear integration with bidirectional sync

---

## Roadmap

**Phase 4 (Completed):** Two-tier storage system with local tiers and infinite remote storage
**Phase 5 (Next):** PostgreSQL production adapter, enhanced team collaboration, advanced analytics  
**Phase 3:** Team collaboration, shared stacks, frame handoff  
**Phase 4:** Two-tier storage, enterprise features, cost optimization

---

## License

- Hosted service: Proprietary
- Open-source mirror: Apache 2.0 / MIT (TBD)

---

## Additional Resources

### ML System Design

- [ML System Insights](./ML_SYSTEM_INSIGHTS.md) - Analysis of 300+ production ML systems
- [Agent Instructions](./AGENTS.md) - Specific guidance for AI agents working with ML systems

### Documentation

- [Product Requirements](./PRD.md) - Detailed product specifications
- [Technical Architecture](./TECHNICAL_ARCHITECTURE.md) - System design and database schemas
- [Beads Integration](./BEADS_INTEGRATION.md) - Git-native memory patterns from Beads ecosystem

---
