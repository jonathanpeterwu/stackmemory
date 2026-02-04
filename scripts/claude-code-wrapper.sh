#!/bin/bash

# Claude Code wrapper with StackMemory integration
# Usage: Add alias to ~/.zshrc: alias claude='~/Dev/stackmemory/scripts/claude-code-wrapper.sh'

# Check for auto-sync flag and filter wrapper-specific args
AUTO_SYNC=false
SYNC_INTERVAL=5
CLAUDE_ARGS=()

for arg in "$@"; do
    case $arg in
        --auto-sync)
            AUTO_SYNC=true
            ;;
        --sync-interval=*)
            SYNC_INTERVAL="${arg#*=}"
            ;;
        *)
            CLAUDE_ARGS+=("$arg")
            ;;
    esac
done

# Start Linear auto-sync in background if requested (survives exec)
if [ "$AUTO_SYNC" = true ] && [ -n "$LINEAR_API_KEY" ]; then
    echo "🔄 Starting Linear auto-sync (${SYNC_INTERVAL}min intervals)..."
    nohup bash -c "
        while true; do
            sleep $((SYNC_INTERVAL * 60))
            if [ -d \"$PWD/.stackmemory\" ]; then
                stackmemory linear sync --quiet 2>/dev/null || true
            fi
        done
    " > /dev/null 2>&1 &
    disown
fi

# Note: Cleanup is now handled by Claude hooks instead of this wrapper
# See: stackmemory setup-hooks --cleanup

# Run Claude Code with exec for full TTY control (interactive mode)
# This replaces the shell process, ensuring stdin works properly
# Note: cleanup trap won't run with exec - use Claude hooks for session cleanup instead

if command -v claude-code &> /dev/null; then
    exec claude-code "${CLAUDE_ARGS[@]}"
elif command -v claude &> /dev/null; then
    exec claude "${CLAUDE_ARGS[@]}"
else
    echo "❌ Claude Code not found. Please install it first."
    echo "   Visit: https://github.com/anthropics/claude-code"
    exit 1
fi