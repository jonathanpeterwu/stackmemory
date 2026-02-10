# StackMemory

[![Test Shared Context](https://github.com/stackmemoryai/stackmemory/actions/workflows/test-shared-context.yml/badge.svg?branch=main)](https://github.com/stackmemoryai/stackmemory/actions/workflows/test-shared-context.yml)
[![Publish to NPM](https://github.com/stackmemoryai/stackmemory/actions/workflows/npm-publish.yml/badge.svg?branch=main)](https://github.com/stackmemoryai/stackmemory/actions/workflows/npm-publish.yml)
[![Coverage](https://codecov.io/gh/stackmemoryai/stackmemory/branch/main/graph/badge.svg)](https://codecov.io/gh/stackmemoryai/stackmemory)
[![npm version](https://img.shields.io/npm/v/@stackmemoryai/stackmemory)](https://www.npmjs.com/package/@stackmemoryai/stackmemory)

Lossless, project-scoped memory for AI tools

StackMemory is a **production-ready memory runtime** for AI coding tools that preserves full project context across sessions:

- **Zero-config setup** - `stackmemory init` just works, no questions asked
- **26 MCP tools** for Claude Code integration
- **Full Linear integration** with bidirectional sync
- **Context persistence** that survives /clear operations
- **Hierarchical frame organization** (nested call stack model)
- **Skills system** with `/spec` and `/linear-run` for Claude Code
- **Automatic hooks** for task tracking, Linear sync, and spec progress
- **Memory monitor daemon** with automatic capture/clear on RAM pressure
- **650+ tests passing** with comprehensive coverage

Instead of a linear chat log, StackMemory organizes memory as a **call stack** of scoped work (frames), with intelligent LLM-driven retrieval and team collaboration features.

> **Memory is storage. Context is a compiled view.**

---

## Why StackMemory exists

Tools forget decisions and constraints between sessions. StackMemory makes context durable and actionable.

- Records: events, tool calls, decisions, and anchors
- Retrieves: high-signal context tailored to the current task
- Organizes: nested frames with importance scoring and shared stacks

---

## Features (at a glance)

- **MCP tools** for Claude Code: 26+ tools; context on every request
- **Skills**: `/spec` (iterative spec generation), `/linear-run` (task execution via RLM)
- **Hooks**: automatic context save, task tracking, Linear sync, PROMPT_PLAN updates
- **Prompt Forge**: watches AGENTS.md and CLAUDE.md for prompt optimization (GEPA)
- **Safe branches**: worktree isolation with `--worktree` or `-w`
- **Persistent context**: frames, anchors, decisions, retrieval
- **Integrations**: Linear, DiffMem, Browser MCP

---

## Quick Start

Requirements: Node >= 20

```bash
# Install globally
npm install -g @stackmemoryai/stackmemory

# Initialize in your project (zero-config, just works)
cd your-project
stackmemory init

# Configure Claude Code integration
stackmemory setup-mcp

# Minimal usage
stackmemory init && stackmemory setup-mcp && stackmemory doctor
```

Restart Claude Code and StackMemory MCP tools will be available.

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

- Hosted: cloud-backed, fast retrieval, durable, team features — works out of the box.
- OSS local: SQLite, offline, inspectable — intentionally behind; no sync/org features.

---

## How it integrates

Runs as an MCP server. Editors (e.g., Claude Code) call StackMemory on each interaction to fetch a compiled context bundle; editors don’t store memory themselves.

### MCP Quick Usage

Use these JSON snippets with Claude Code’s MCP “tools/call”. Responses are returned as a single text item containing JSON.

- Plan only (no code):
  ```json
  {"method":"tools/call","params":{"name":"plan_only","arguments":{"task":"Refactor config loader","plannerModel":"claude-sonnet-4-20250514"}}}
  ```

- Approval‑gated plan (phase 1):
  ```json
  {"method":"tools/call","params":{"name":"plan_gate","arguments":{"task":"Refactor config loader","compact":true}}}
  ```

- Approve + execute (phase 2):
  ```json
  {"method":"tools/call","params":{"name":"approve_plan","arguments":{"approvalId":"<copy from plan_gate>","implementer":"codex","execute":true,"recordFrame":true,"compact":true}}}
  ```

- Manage approvals:
  ```json
  {"method":"tools/call","params":{"name":"pending_list","arguments":{}}}
  {"method":"tools/call","params":{"name":"pending_show","arguments":{"approvalId":"<id>","compact":true}}}
  {"method":"tools/call","params":{"name":"pending_clear","arguments":{"approvalId":"<id>"}}}
  ```

Env defaults (optional):
- `STACKMEMORY_MM_PLANNER_MODEL` (e.g., `claude-sonnet-4-20250514`)
- `STACKMEMORY_MM_REVIEWER_MODEL` (defaults to planner if unset)
- `STACKMEMORY_MM_IMPLEMENTER` (`codex` or `claude`)
- `STACKMEMORY_MM_MAX_ITERS` (e.g., `2`)

---

## Skills System

StackMemory ships Claude Code skills that integrate directly into your workflow. Skills are invoked via `/skill-name` in Claude Code or `stackmemory skills <name>` from the CLI.

### Spec Generator (`/spec`)

Generates iterative spec documents following a 4-doc progressive chain. Each document reads previous ones from disk for context.

```
ONE_PAGER.md  →  DEV_SPEC.md  →  PROMPT_PLAN.md  →  AGENTS.md
(standalone)     (reads 1)       (reads 1+2)        (reads 1+2+3)
```

```bash
# Generate specs in order
/spec one-pager "My App"          # Problem, audience, core flow, MVP
/spec dev-spec                    # Architecture, tech stack, APIs
/spec prompt-plan                 # TDD stages A-G with checkboxes
/spec agents                      # Agent guardrails and responsibilities

# Manage progress
/spec list                        # Show existing specs
/spec update prompt-plan "auth"   # Check off matching items
/spec validate prompt-plan        # Check completion status

# CLI equivalent
stackmemory skills spec one-pager "My App"
```

Output goes to `docs/specs/`. Use `--force` to regenerate an existing spec.

### Linear Task Runner (`/linear-run`)

Pulls tasks from Linear, executes them via the RLM orchestrator (8 subagent types), and syncs results back.

```bash
/linear-run next                  # Execute next todo task
/linear-run next --priority high  # Filter by priority
/linear-run all                   # Execute all pending tasks
/linear-run all --dry-run         # Preview without executing
/linear-run task STA-123          # Run a specific task
/linear-run preview               # Show execution plan

# CLI equivalent
stackmemory ralph linear next
```

On task completion:
1. Marks the Linear task as `done`
2. Auto-checks matching PROMPT_PLAN items
3. Syncs metrics (tokens, cost, tests) back to Linear

Options: `--priority <level>`, `--tag <tag>`, `--dry-run`, `--maxConcurrent <n>`

---

## Hooks (Automatic)

StackMemory installs Claude Code hooks that run automatically during your session. Hooks are non-blocking and fail silently to never interrupt your workflow.

### Installed Hooks

| Hook | Trigger | What it does |
|------|---------|-------------|
| `on-task-complete` | Task marked done | Saves context, syncs Linear (STA-* tasks), auto-checks PROMPT_PLAN items |
| `on-startup` | Session start | Loads StackMemory context, initializes frame |
| `on-clear` | `/clear` command | Persists context before clearing |
| `skill-eval` | User prompt | Scores prompt against 28 skill patterns, recommends relevant skills |
| `tool-use-trace` | Tool invocation | Logs tool usage for context tracking |

### Skill Evaluation

When you type a prompt, the `skill-eval` hook scores it against `skill-rules.json` (28 mapped skills with keyword, pattern, intent, and directory matching). Skills scoring above the threshold (default: 3) are recommended.

```json
// Example: user types "generate a spec for the auth system"
// skill-eval recommends:
{
  "recommendedSkills": [
    { "skillName": "spec-generator", "score": 8 },
    { "skillName": "frame-management", "score": 5 }
  ]
}
```

### Hook Installation

Hooks install automatically during `npm install` (with user consent). To install or reinstall manually:

```bash
# Automatic (prompted during npm install)
npm install -g @stackmemoryai/stackmemory

# Manual install
stackmemory hooks install

# Skip hooks (CI/non-interactive)
STACKMEMORY_AUTO_HOOKS=true npm install -g @stackmemoryai/stackmemory
```

Hooks are stored in `~/.claude/hooks/` and configured via `~/.claude/hooks.json`.

### PROMPT_PLAN Auto-Progress

When a task completes (via hook or `/linear-run`), StackMemory fuzzy-matches the task title against unchecked `- [ ]` items in `docs/specs/PROMPT_PLAN.md` and checks them off automatically. One item per task completion, best-effort.

---

## Memory Monitor Daemon (v0.8.0)

Automatically monitors system RAM and Node.js heap usage, triggering capture/clear cycles when memory pressure exceeds thresholds. Prevents long-running sessions from degrading performance.

### How it works

1. Daemon checks RAM and heap usage every 30 seconds
2. If either exceeds 90%, it captures context (`stackmemory capture --no-commit --basic`)
3. Clears context (`stackmemory clear --save`)
4. Writes a signal file (`.stackmemory/.memory-clear-signal`)
5. On next prompt, a Claude Code hook reads the signal and alerts you to run `/clear`

### Configuration

Configured via `stackmemory daemon` with these defaults:

| Option | Default | Description |
|--------|---------|-------------|
| `ramThreshold` | 0.9 (90%) | System RAM usage trigger |
| `heapThreshold` | 0.9 (90%) | Node.js heap usage trigger |
| `cooldownMinutes` | 10 | Minimum time between triggers |
| `interval` | 0.5 (30s) | Check frequency in minutes |

### CLI

```bash
stackmemory daemon start      # Start daemon (includes memory monitor)
stackmemory daemon status      # Show memory stats, trigger count, thresholds
stackmemory daemon stop        # Stop daemon
```

### Hook

The memory guard hook (`.claude/hooks/memory-guard.sh`) is registered as a `user-prompt-submit` hook. When the daemon writes a signal file, the hook alerts you on the next prompt to run `/clear` and restore.

---

## Prompt Forge (GEPA)

When launching via `claude-sm`, StackMemory watches `CLAUDE.md`, `AGENT.md`, and `AGENTS.md` for changes. On file modification, the GEPA optimizer analyzes content and suggests improvements for prompt clarity and structure. Runs as a detached background process.

```bash
# Launch with Prompt Forge active
claude-sm

# Status shown in terminal:
# Prompt Forge: watching CLAUDE.md, AGENTS.md for optimization
```

---

### Install

```bash
npm install -g @stackmemoryai/stackmemory@latest
```

During install, you'll be asked if you want to install Claude Code hooks (optional but recommended).

### Initialize Project

```bash
cd your-project
stackmemory init
```

This creates `.stackmemory/` with SQLite storage. No questions asked.

For interactive setup with more options:
```bash
stackmemory init --interactive
```

### Configure Claude Code

```bash
stackmemory setup-mcp
```

This automatically:
- Creates `~/.claude/stackmemory-mcp.json` MCP configuration
- Updates `~/.claude/config.json` with StackMemory integration
- Validates the configuration

### Diagnose Issues

```bash
stackmemory doctor
```

Checks project initialization, database integrity, MCP config, and suggests fixes.

See [docs/setup.md](https://github.com/stackmemoryai/stackmemory/blob/main/docs/setup.md) for advanced options (hosted mode, ChromaDB, manual MCP config).

---

## Open-Source Local Mode

### Step 1: Clone & Build

```bash
git clone https://github.com/stackmemoryai/stackmemory
cd stackmemory
npm install
npm run build
```

### Step 2: Run local MCP server

```bash
npm run mcp:start
# or for development
npm run mcp:dev
```

This creates `.stackmemory/` with SQLite storage.

### Step 3: Point your editor to local MCP

```json
{
  "mcpServers": {
    "stackmemory": {
      "command": "node",
      "args": ["dist/src/integrations/mcp/server.js"]
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

StackMemory integrates with Claude Code via MCP tools, skills, and hooks. See the [Hooks](#hooks-automatic) and [Skills](#skills-system) sections above.

```bash
# Full setup (one-time)
npm install -g @stackmemoryai/stackmemory   # installs hooks automatically
cd your-project && stackmemory init          # init project
stackmemory setup-mcp                        # configure MCP
stackmemory doctor                           # verify everything works
```

Additional integration methods: shell wrapper (`claude-sm`), Linear auto-sync daemon, background daemon, git hooks. See [docs/setup.md](https://github.com/stackmemoryai/stackmemory/blob/main/docs/setup.md).

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

See https://github.com/stackmemoryai/stackmemory/blob/main/docs/cli.md for the full command reference and examples.

---

## Status

See https://github.com/stackmemoryai/stackmemory/blob/main/docs/status.md for current status.

---

## Changelog

See https://github.com/stackmemoryai/stackmemory/blob/main/docs/changelog.md for detailed release notes.

---

## Roadmap

See https://github.com/stackmemoryai/stackmemory/blob/main/docs/roadmap.md for our current roadmap.

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
- [Vision](./vision.md) - Product vision, principles, roadmap, metrics
- [Product Requirements](./PRD.md) - Detailed product specifications
- [Technical Architecture](./TECHNICAL_ARCHITECTURE.md) - System design and database schemas
- [Beads Integration](./BEADS_INTEGRATION.md) - Git-native memory patterns from Beads ecosystem
 - [MCP: plan_and_code](https://github.com/stackmemoryai/stackmemory/blob/main/docs/mcp.md) - Trigger planning + coding via MCP with JSON results

---
