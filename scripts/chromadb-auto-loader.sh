#!/bin/bash

# ChromaDB Auto-Loader for Claude
# Automatically loads context from ChromaDB every 15 minutes
# and when Claude starts a new session

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
LOG_DIR="$HOME/.stackmemory/logs"
PID_FILE="$HOME/.stackmemory/chromadb-loader.pid"

# Create log directory
mkdir -p "$LOG_DIR"

# Function to load context
load_context() {
    echo "[$(date)] Loading context from ChromaDB..."
    
    # Load recent context
    cd "$PROJECT_DIR"
    node scripts/chromadb-context-loader.js load 1 >> "$LOG_DIR/chromadb-loader.log" 2>&1
    
    # Track changes
    node scripts/chromadb-context-loader.js changes >> "$LOG_DIR/chromadb-loader.log" 2>&1
    
    # Sync with StackMemory
    node scripts/chromadb-context-loader.js sync >> "$LOG_DIR/chromadb-loader.log" 2>&1
    
    echo "[$(date)] Context loaded successfully"
}

# Function to start the loader daemon
start_daemon() {
    # Check if already running
    if [ -f "$PID_FILE" ]; then
        OLD_PID=$(cat "$PID_FILE")
        if kill -0 "$OLD_PID" 2>/dev/null; then
            echo "ChromaDB loader already running (PID: $OLD_PID)"
            exit 0
        fi
    fi
    
    echo "Starting ChromaDB auto-loader daemon..."
    
    # Initial load
    load_context
    
    # Start background loop
    (
        while true; do
            # Wait 15 minutes
            sleep 900
            
            # Load context
            load_context
        done
    ) &
    
    # Save PID
    echo $! > "$PID_FILE"
    echo "ChromaDB auto-loader started (PID: $!)"
}

# Function to stop the daemon
stop_daemon() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill "$PID" 2>/dev/null; then
            echo "ChromaDB auto-loader stopped"
            rm -f "$PID_FILE"
        else
            echo "ChromaDB auto-loader not running"
            rm -f "$PID_FILE"
        fi
    else
        echo "ChromaDB auto-loader not running"
    fi
}

# Function to check status
check_status() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            echo "✅ ChromaDB auto-loader running (PID: $PID)"
            echo ""
            echo "Recent activity:"
            tail -5 "$LOG_DIR/chromadb-loader.log" 2>/dev/null
        else
            echo "❌ ChromaDB auto-loader not running (stale PID file)"
            rm -f "$PID_FILE"
        fi
    else
        echo "❌ ChromaDB auto-loader not running"
    fi
}

# Handle commands
case "$1" in
    start)
        start_daemon
        ;;
    stop)
        stop_daemon
        ;;
    status)
        check_status
        ;;
    load)
        # Manual load
        load_context
        ;;
    restart)
        stop_daemon
        sleep 1
        start_daemon
        ;;
    *)
        echo "Usage: $0 {start|stop|status|load|restart}"
        echo ""
        echo "  start   - Start auto-loader daemon (loads every 15 min)"
        echo "  stop    - Stop auto-loader daemon"
        echo "  status  - Check daemon status"
        echo "  load    - Manually load context now"
        echo "  restart - Restart daemon"
        exit 1
        ;;
esac