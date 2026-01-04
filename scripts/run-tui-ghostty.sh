#!/bin/bash

# Optimized TUI launcher specifically for Ghostty terminal
# This script provides the best compatibility settings for Ghostty

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

echo "🚀 StackMemory TUI - Ghostty Mode"
echo "================================"
echo ""

# Build if needed
if [ ! -f "$PROJECT_ROOT/dist/features/tui/index.js" ]; then
    echo "📦 Building project..."
    cd "$PROJECT_ROOT"
    npm run build
    echo ""
fi

# Force ghostty compatibility settings
export TERM=xterm
export FORCE_TUI=1
export NODE_NO_WARNINGS=1

# Disable some blessed features that cause issues in ghostty
export BLESSED_SKIP_CSR=1
export BLESSED_SKIP_SGR=1

echo "✅ Ghostty compatibility mode enabled"
echo ""
echo "Controls:"
echo "  • Press 'q' to quit"
echo "  • Press 'r' to refresh"
echo "  • Press Tab to navigate between panels"
echo "  • Press 1-6 to jump to specific views"
echo ""

# Launch TUI
cd "$PROJECT_ROOT"
exec node dist/features/tui/index.js "$@"