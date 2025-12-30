# StackMemory Integration for Codex CLI (codex-sm)

The `codex-sm` wrapper lets you run Codex CLI while automatically loading and saving StackMemory context. It mirrors the `opencode-sm` and `claude-sm` workflows for a consistent experience.

## Quick Setup

```bash
# Option A: Use npm-installed binary (recommended)
npm run build
npm link   # or install from npm when published
codex-sm   # now available on PATH

# Option B: Add the codex-sm alias to your shell
node scripts/setup/configure-codex-alias.js
source ~/.zshrc  # or ~/.bashrc
codex-sm
```

## What codex-sm Does

- Auto-initializes StackMemory in git repos without `.stackmemory`
- Loads recent context on startup
- Saves context on exit
- Optional Linear auto-sync with `--auto-sync` and `--sync-interval=<minutes>`

## Usage

```bash
# Start Codex with StackMemory context
codex-sm

# With Linear auto-sync (syncs every 5 minutes)
codex-sm --auto-sync

# Custom sync interval (10 minutes)
codex-sm --auto-sync --sync-interval=10
```

## Optional: MCP Server

If Codex supports MCP tooling in your setup, you can expose StackMemory tools similarly to OpenCode by running the StackMemory MCP server:

```bash
stackmemory mcp-server
```

This provides tools like `get_context`, `add_decision`, `start_frame`, `close_frame`, and Linear sync helpers.

## Notes

- The wrapper looks for `codex` or `codex-cli` in your `PATH`.
- Linear auto-sync requires `LINEAR_API_KEY` to be set in the environment.
- For a richer integration (worktree isolation and tracing), a TypeScript-based wrapper like `claude-sm` can be added; ask if you want me to scaffold it.
