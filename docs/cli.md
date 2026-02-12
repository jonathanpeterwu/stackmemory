# CLI Reference

## Setup & Diagnostics

```bash
stackmemory init                          # Initialize project (zero-config)
stackmemory init --interactive            # Interactive setup with options
stackmemory setup-mcp                     # Configure Claude Code MCP integration
stackmemory doctor                        # Diagnose issues and suggest fixes
stackmemory onboard                       # Guided onboarding flow
stackmemory hooks install                 # Install Claude Code hooks
stackmemory hooks uninstall               # Remove hooks
stackmemory hooks list                    # List installed hooks
stackmemory hooks test                    # Test hook configuration
stackmemory hooks validate                # Validate hook setup
```

## Context Management

```bash
stackmemory context show                  # Show current context (alias: status)
stackmemory context show --verbose        # Detailed context view
stackmemory context push "name" --type task  # Push a new frame onto the stack
stackmemory context pop                   # Pop the current frame
stackmemory context pop --all             # Pop all frames
stackmemory context add decision "text"   # Add a decision anchor
stackmemory context add constraint "text" # Add a constraint anchor
stackmemory context rehydrate             # Rebuild context from stored frames
stackmemory decision add "text"           # Record a decision (alias)
stackmemory decision list                 # List all decisions
stackmemory decision search "query"       # Search decisions
stackmemory decision pin <id>             # Pin a decision
stackmemory decision export               # Export decisions
```

## Tasks

```bash
stackmemory tasks list                    # List all tasks
stackmemory tasks list --status pending   # Filter by status
stackmemory tasks add "title"             # Create a new task
stackmemory tasks add "title" --priority high  # With priority
stackmemory tasks start <taskId>          # Mark task as in-progress
stackmemory tasks done <taskId>           # Mark task as done
stackmemory tasks show <taskId>           # Show task details
```

## Search & Logs

```bash
stackmemory search "query"               # Search frames, decisions, and context
stackmemory search "query" --tasks        # Search tasks only
stackmemory search "query" --context      # Search context only
stackmemory log                           # Show recent activity log
stackmemory log --follow                  # Follow log in real-time
stackmemory log --type task               # Filter by event type
```

## Linear Integration

```bash
stackmemory linear auth                   # OAuth authorization flow
stackmemory linear status                 # Show sync status
stackmemory linear sync                   # Sync with Linear
stackmemory linear sync --direction from_linear  # Pull from Linear only
stackmemory linear tasks                  # List Linear tasks
stackmemory linear update <issueId> --status done  # Update issue status
stackmemory linear config                 # Show/update Linear configuration
```

## Daemon

```bash
stackmemory daemon start                  # Start background daemon
stackmemory daemon stop                   # Stop daemon
stackmemory daemon restart                # Restart daemon
stackmemory daemon status                 # Show daemon status and memory stats
stackmemory daemon logs                   # View daemon logs
stackmemory daemon config                 # Show/update daemon configuration
```

## Sessions & Handoff

```bash
stackmemory session list                  # List all sessions
stackmemory session current               # Show current session
stackmemory session switch <sessionId>    # Switch to a different session
stackmemory session suspend               # Suspend current session
stackmemory session resume <sessionId>    # Resume a suspended session
stackmemory session merge <src> <target>  # Merge two sessions
stackmemory session cleanup               # Clean up stale sessions
stackmemory handoff capture               # Capture session state for handoff
stackmemory handoff restore               # Restore from captured state
```

## Skills

```bash
stackmemory skills list                   # List available skills
stackmemory skills spec one-pager "App"   # Generate ONE_PAGER.md
stackmemory skills spec dev-spec          # Generate DEV_SPEC.md
stackmemory skills spec prompt-plan       # Generate PROMPT_PLAN.md
stackmemory skills spec agents            # Generate AGENTS.md
stackmemory skills rlm "task"             # Run RLM orchestrator
stackmemory skills dashboard              # Open skills dashboard
stackmemory ralph linear next             # Execute next Linear task via RLM
stackmemory ralph linear all              # Execute all pending Linear tasks
```

## Config

```bash
stackmemory config show                   # Show current configuration
stackmemory config validate               # Validate configuration
stackmemory config set <key> <value>      # Set a config value
stackmemory config get <key>              # Get a config value
stackmemory config list                   # List all config keys
stackmemory config export                 # Export configuration
stackmemory config import <file>          # Import configuration
stackmemory config profile                # Manage config profiles
```

## Retrieval & Discovery

```bash
stackmemory retrieval status              # Show retrieval system status
stackmemory retrieval audit               # Audit retrieval quality
stackmemory retrieval stats               # Show retrieval statistics
stackmemory retrieval reasoning <id>      # Show reasoning for a retrieval
```

## Advanced

```bash
stackmemory worktree create <branch>      # Create isolated worktree
stackmemory worktree list                 # List worktrees
stackmemory worktree switch <name>        # Switch to worktree
stackmemory worktree delete <name>        # Delete worktree
stackmemory worktree sync                 # Sync worktree state
stackmemory sweep status                  # Show sweep status
stackmemory sweep configure               # Configure sweep rules
stackmemory cleanup-processes             # Clean up orphaned processes
stackmemory migrate status                # Show migration status
stackmemory migrate up                    # Run pending migrations
stackmemory shell open                    # Open interactive shell
stackmemory shell run "command"           # Run a shell command
stackmemory api list                      # List API endpoints
stackmemory model list                    # List available models
stackmemory model set <model>             # Set default model
stackmemory status                        # Show project status
stackmemory progress                      # Show recent progress
stackmemory clear                         # Clear current context (with save)
stackmemory ping                          # Health check
```

## Wrapper Scripts

These wrapper scripts launch your coding tool with StackMemory context pre-loaded and Prompt Forge active:

```bash
claude-sm                                 # Claude Code + StackMemory
claude-smd                                # Claude Code + StackMemory (danger mode)
codex-sm                                  # Codex + StackMemory
codex-smd                                 # Codex + StackMemory (danger mode)
opencode-sm                               # OpenCode + StackMemory
```

### Codex Wrapper Options

```bash
codex-sm -p "prompt"                      # Run with prompt
codex-sm -p "prompt" --model gpt-4o-mini  # Specify model
codex-smd -p "refactor this module"       # Danger mode (skips permissions)
```

### Claude Wrapper Options

```bash
claude-sm                                 # Interactive session with Prompt Forge
claude-smd                                # Danger mode (skips permissions)
```
