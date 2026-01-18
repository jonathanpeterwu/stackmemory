# StackMemory Integration for Codex CLI (codex-sm)

The `codex-sm` wrapper lets you run Codex CLI while automatically loading and saving StackMemory context. It mirrors the `opencode-sm` and `claude-sm` workflows for a consistent experience.

## Public Install (recommended)

Install via npm to get real binaries on your PATH. This is the preferred path for end users and CI.

```bash
# Install globally
npm i -g @stackmemoryai/stackmemory

# Verify
codex-sm --help
```

Notes:
- Uses the package `bin` entry (`codex-sm`) with a `#!/usr/bin/env node` shebang for portability.
- No shell aliasing required. Uninstall with `npm rm -g @stackmemoryai/stackmemory`.

## Local Dev (repo checkout)

If you are developing from a local clone, you can expose the CLI without publishing:

```bash
# Build and link locally
npm run build
npm link

# Or create a small shim (zsh shown) in ~/.stackmemory/bin
mkdir -p ~/.stackmemory/bin
cat > ~/.stackmemory/bin/codex-sm <<'EOF'
#!/usr/bin/env zsh
exec zsh "$HOME/Dev/stackmemory/scripts/codex-wrapper.sh" "$@"
EOF
chmod +x ~/.stackmemory/bin/codex-sm

# Ensure ~/.stackmemory/bin is on PATH (your ~/.zshrc)
export PATH="$HOME/.stackmemory/bin:$PATH"
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
