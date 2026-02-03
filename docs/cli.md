# CLI Commands

```bash
# Setup & Diagnostics
stackmemory init                          # Initialize project (zero-config)
stackmemory init --interactive            # Interactive setup with options
stackmemory setup-mcp                     # Configure Claude Code MCP
stackmemory doctor                        # Diagnose issues and suggest fixes

# Status
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

**Codex Wrappers**
- `codex-sm`: Codex with StackMemory context and optional worktree isolation.
- `codex-smd`: Shorthand for dangerous mode; prepends `--dangerously-skip-permissions`.
- Examples:
  - `codex-smd -p "refactor this module" --model gpt-4o-mini`
  - `codex-sm --dangerously-skip-permissions -p "upgrade deps"`
- Note: The dangerous flag takes effect if supported by your Codex CLI.

