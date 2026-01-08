#!/bin/bash

# Development script for TUI with auto-rebuild
# This script watches for changes and rebuilds + restarts the TUI

echo "🚀 StackMemory TUI Development Mode"
echo "====================================="
echo "This will:"
echo "1. Build the project"
echo "2. Copy tasks to global location"
echo "3. Launch the TUI"
echo "4. Watch for changes and rebuild automatically"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to build the project
build_project() {
    echo -e "${BLUE}[BUILD]${NC} Building project..."
    npm run build
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}[BUILD]${NC} Build successful!"
        return 0
    else
        echo -e "${RED}[BUILD]${NC} Build failed!"
        return 1
    fi
}

# Function to sync tasks
sync_tasks() {
    echo -e "${BLUE}[SYNC]${NC} Syncing tasks..."
    # Copy tasks file to global location if it exists
    if [ -f ".stackmemory/tasks.jsonl" ]; then
        mkdir -p ~/.stackmemory
        cp .stackmemory/tasks.jsonl ~/.stackmemory/
        echo -e "${GREEN}[SYNC]${NC} Tasks synced to global location"
    else
        echo -e "${YELLOW}[SYNC]${NC} No tasks file found, running Linear sync..."
        npm run linear:sync
    fi
}

# Function to launch TUI
launch_tui() {
    echo -e "${BLUE}[TUI]${NC} Launching TUI..."
    # Kill any existing TUI process
    pkill -f "node.*tui/index.js" 2>/dev/null
    
    # Launch TUI in background
    node dist/features/tui/index.js &
    TUI_PID=$!
    echo -e "${GREEN}[TUI]${NC} TUI launched (PID: $TUI_PID)"
    return $TUI_PID
}

# Function to watch for changes
watch_changes() {
    echo -e "${BLUE}[WATCH]${NC} Watching for changes in src/features/tui/..."
    
    # Use fswatch if available, otherwise fall back to simple polling
    if command -v fswatch &> /dev/null; then
        fswatch -o src/features/tui/ src/cli/ src/skills/ | while read f; do
            echo -e "${YELLOW}[WATCH]${NC} Changes detected, rebuilding..."
            build_project
            if [ $? -eq 0 ]; then
                echo -e "${YELLOW}[TUI]${NC} Restarting TUI..."
                pkill -f "node.*tui/index.js" 2>/dev/null
                launch_tui
            fi
        done
    else
        echo -e "${YELLOW}[WATCH]${NC} fswatch not found, using polling mode..."
        while true; do
            sleep 2
            if find src/features/tui/ src/cli/ src/skills/ -newer .last_build 2>/dev/null | grep -q .; then
                echo -e "${YELLOW}[WATCH]${NC} Changes detected, rebuilding..."
                build_project
                if [ $? -eq 0 ]; then
                    touch .last_build
                    echo -e "${YELLOW}[TUI]${NC} Restarting TUI..."
                    pkill -f "node.*tui/index.js" 2>/dev/null
                    launch_tui
                fi
            fi
        done
    fi
}

# Main execution
main() {
    # Initial build
    build_project || exit 1
    
    # Create timestamp for change detection
    touch .last_build
    
    # Sync tasks
    sync_tasks
    
    # Launch TUI
    launch_tui
    
    echo ""
    echo -e "${GREEN}[READY]${NC} TUI is running in development mode!"
    echo -e "${GREEN}[INFO]${NC} Make changes to files and they will auto-rebuild"
    echo -e "${GREEN}[INFO]${NC} Press Ctrl+C to stop"
    echo ""
    
    # Start watching for changes
    trap "pkill -f 'node.*tui/index.js'; exit" INT TERM
    watch_changes
}

# Run main function
main