#!/bin/bash

# Start StackMemory TUI Dashboard
# This script launches the interactive monitoring interface

set -e

SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
PROJECT_ROOT="$( cd "$SCRIPT_DIR/.." && pwd )"

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

echo -e "${GREEN}🚀 Starting StackMemory TUI Dashboard${NC}"

# Load environment from .env if present (so TUI sees LINEAR_API_KEY, etc.)
if [ -f "$PROJECT_ROOT/.env" ]; then
    # export all variables loaded from the file
    set -a
    # shellcheck disable=SC1091
    . "$PROJECT_ROOT/.env"
    set +a
    echo -e "${GREEN}ℹ Loaded environment from $PROJECT_ROOT/.env${NC}"
fi

# Check if built files exist
if [ ! -f "$PROJECT_ROOT/dist/features/tui/index.js" ]; then
    echo -e "${YELLOW}Building TUI...${NC}"
    cd "$PROJECT_ROOT"
    npm run build
fi

# Check for environment variables (after loading .env)
if [ -z "$LINEAR_API_KEY" ]; then
    echo -e "${YELLOW}⚠️  Warning: LINEAR_API_KEY not set. Linear integration will be disabled.${NC}"
fi

if [ -z "$GITHUB_TOKEN" ]; then
    echo -e "${YELLOW}⚠️  Warning: GITHUB_TOKEN not set. GitHub integration will be limited.${NC}"
fi

# Set default WebSocket URL if not provided
export STACKMEMORY_WS_URL="${STACKMEMORY_WS_URL:-ws://localhost:8080}"

# Terminal compatibility for ghostty
if [[ "$TERM_PROGRAM" == "ghostty" ]] || [[ "$TERM" == *"ghostty"* ]]; then
    echo -e "${YELLOW}⚠️  Ghostty terminal detected - using compatibility mode${NC}"
    export TERM=xterm
    export FORCE_TUI=1
fi

# Launch TUI
echo -e "${GREEN}Launching TUI interface...${NC}"
echo "Press 'q' to quit, 'r' to refresh, Tab to navigate"
echo ""

cd "$PROJECT_ROOT"
node dist/features/tui/index.js

# Cleanup
if [ ! -z "$WS_PID" ]; then
    echo -e "${YELLOW}Stopping WebSocket server...${NC}"
    kill $WS_PID 2>/dev/null || true
fi

echo -e "${GREEN}✅ TUI Dashboard closed${NC}"
