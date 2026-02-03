# Changelog

## v0.5.51 (2026-01-28)
- Interactive feature setup: `claude-sm config setup` wizard to toggle features and install deps on demand
  - Checkbox prompt for all features (Sweep, Greptile, Model Routing, Worktree, WhatsApp, Tracing)
  - Auto-installs `node-pty` when Sweep is enabled
  - Prompts for `GREPTILE_API_KEY` and registers MCP server when Greptile is enabled
- Sweep next-edit predictions: PTY wrapper displays predicted edits as a status bar in Claude Code sessions. Tab to accept, Esc to dismiss.
  - `claude-sm --sweep` (default: on) or `stackmemory sweep wrap`
  - `node-pty` installed on demand via setup (no longer in optionalDependencies)
- Greptile AI code review: Auto-registers Greptile MCP server for codebase-aware code review.
  - `claude-sm --greptile` (default: on)
  - Requires `GREPTILE_API_KEY` in `.env`
  - Tools: `index_repository`, `query_repository`, `get_repository_info`
- Feature flags: Added `greptile` feature flag to `feature-flags.ts`

## v0.5.47 (2026-01-27)
- Graceful database failures: Handles native module version mismatches
- Suppress dotenv logs: Cleaner terminal output
- TTY preservation: Fixes interactive mode for claude-sm/claude-smd
- Silent Linear auth: No spam when API key not configured

## v0.5.40 (2026-01-27)
- Zero-config onboarding: `stackmemory init` now works without any prompts
- New `setup-mcp` command: Auto-configures Claude Code MCP integration
- New `doctor` command: Diagnoses issues and suggests fixes
- Interactive postinstall: Asks for consent before modifying ~/.claude
- Better error messages: Shows reason + fix + next step

## v0.5.39 (2026-01-27)
- AsyncMutex: Thread-safe Linear sync with stale lock detection
- Action timeout: 60s timeout for SMS action execution
- Persistent rate limiting: Survives server restarts
- Atomic file writes: Prevents corruption on crash

## v0.5.30 (2026-01-26)
- Standardized error handling with `IntegrationError`, `DatabaseError`, `ValidationError`
- Adopted error classes across Linear integration (12 files)
- Adopted error classes across database layer (6 files)
- WhatsApp notifications with session ID and interactive options

## v0.5.28 (2026-01-25)
- WhatsApp flag for claude-sm automatic notifications
- Incoming request queue for WhatsApp triggers
- SMS webhook /send endpoint for outgoing notifications

## v0.5.26 (2026-01-24)
- OpenCode wrapper (opencode-sm) with context integration
- Discovery CLI and MCP tools
- Real LLM provider and retrieval audit system
- Linear issue management and task picker

## v0.5.21 (2026-01-23)
- Claude-sm remote mode and configurable defaults
- Context loading command improvements
- Session summary features

## v0.3.16 (2026-01-15)
- Fixed critical error handling - getFrame() returns undefined instead of throwing
- Improved test coverage and fixed StackMemoryError constructor usage
- Removed dangerous secret-cleaning scripts from repository
- All tests passing, lint clean, build successful

## v0.3.15 (2026-01-14)
- Two-tier storage system implementation complete
- Smart compression with LZ4/ZSTD support
- Background migration with configurable triggers
- Improved Linear integration with bidirectional sync

