#!/bin/bash

# Safe TUI launcher with terminal compatibility settings

echo "🚀 Launching StackMemory TUI Dashboard..."
echo ""

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

# Build if needed
if [ ! -f "$PROJECT_ROOT/dist/features/tui/index.js" ]; then
    echo "Building project..."
    cd "$PROJECT_ROOT"
    npm run build
fi

# Detect terminal type
if [[ "$TERM_PROGRAM" == "ghostty" ]] || [[ "$TERM" == *"ghostty"* ]]; then
    echo "⚠️  Ghostty terminal detected - using compatibility mode"
    export TERM=xterm
    export FORCE_TUI=1
elif [[ -n "$TMUX" ]]; then
    echo "📦 Running inside tmux - using screen-256color"
    export TERM=screen-256color
elif [[ "$TERM_PROGRAM" == "iTerm.app" ]]; then
    echo "✅ iTerm2 detected - optimal compatibility"
    export TERM=xterm-256color
elif [[ "$TERM_PROGRAM" == "Apple_Terminal" ]]; then
    echo "✅ Terminal.app detected"
    export TERM=xterm-256color
else
    echo "ℹ️  Terminal: $TERM"
    # Use default or set to xterm-256color if not set
    if [[ -z "$TERM" ]] || [[ "$TERM" == "dumb" ]]; then
        export TERM=xterm-256color
    fi
fi

echo ""
echo "If you encounter display issues, try:"
echo "  1. Use a different terminal (Terminal.app, iTerm2, etc.)"
echo "  2. Use the simpler dashboard: stackmemory dashboard --watch"
echo "  3. Set TUI_DEBUG=1 to see terminal capabilities"
echo ""
echo "Press Ctrl+C to exit"
echo ""

# Set terminal compatibility
export NODE_NO_WARNINGS=1

# Optional debug mode
if [[ -n "$TUI_DEBUG" ]]; then
    echo "Debug mode enabled - showing terminal capabilities"
    export DEBUG=1
fi

# Launch TUI from project root
cd "$PROJECT_ROOT"
exec node dist/features/tui/index.js