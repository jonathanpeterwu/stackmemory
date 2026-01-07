#!/bin/bash

# Linear Sync Daemon Launcher
# Starts the Linear sync daemon in the background

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
PID_FILE="$PROJECT_DIR/.stackmemory/linear-sync.pid"
LOG_FILE="$PROJECT_DIR/.stackmemory/linear-sync.log"

# Function to check if daemon is running
is_running() {
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if ps -p $PID > /dev/null 2>&1; then
            return 0
        fi
    fi
    return 1
}

# Function to start the daemon
start_daemon() {
    if is_running; then
        echo "⚠️  Linear sync daemon is already running (PID: $(cat "$PID_FILE"))"
        return 1
    fi
    
    echo "🚀 Starting Linear sync daemon..."
    
    # Start the Node.js daemon in background
    cd "$PROJECT_DIR"
    nohup node scripts/linear-sync-daemon.js >> "$LOG_FILE" 2>&1 &
    PID=$!
    
    # Save PID
    echo $PID > "$PID_FILE"
    
    # Wait a moment and check if it started successfully
    sleep 2
    if is_running; then
        echo "✅ Linear sync daemon started successfully (PID: $PID)"
        echo "📄 Log file: $LOG_FILE"
        echo "⏰ Syncing every hour in the background"
        return 0
    else
        echo "❌ Failed to start Linear sync daemon"
        rm -f "$PID_FILE"
        return 1
    fi
}

# Function to stop the daemon
stop_daemon() {
    if ! is_running; then
        echo "⚠️  Linear sync daemon is not running"
        return 1
    fi
    
    PID=$(cat "$PID_FILE")
    echo "🛑 Stopping Linear sync daemon (PID: $PID)..."
    
    kill $PID 2>/dev/null
    
    # Wait for process to stop
    for i in {1..10}; do
        if ! ps -p $PID > /dev/null 2>&1; then
            break
        fi
        sleep 1
    done
    
    # Force kill if still running
    if ps -p $PID > /dev/null 2>&1; then
        echo "⚠️  Process didn't stop gracefully, forcing..."
        kill -9 $PID 2>/dev/null
    fi
    
    rm -f "$PID_FILE"
    echo "✅ Linear sync daemon stopped"
}

# Function to check daemon status
status_daemon() {
    if is_running; then
        PID=$(cat "$PID_FILE")
        echo "✅ Linear sync daemon is running (PID: $PID)"
        
        # Show last few log lines
        if [ -f "$LOG_FILE" ]; then
            echo ""
            echo "📄 Recent activity:"
            tail -n 5 "$LOG_FILE"
        fi
    else
        echo "❌ Linear sync daemon is not running"
    fi
}

# Function to show logs
show_logs() {
    if [ -f "$LOG_FILE" ]; then
        tail -f "$LOG_FILE"
    else
        echo "❌ Log file not found: $LOG_FILE"
    fi
}

# Parse command
case "$1" in
    start)
        start_daemon
        ;;
    stop)
        stop_daemon
        ;;
    restart)
        stop_daemon
        sleep 2
        start_daemon
        ;;
    status)
        status_daemon
        ;;
    logs)
        show_logs
        ;;
    *)
        echo "Linear Sync Daemon Manager"
        echo ""
        echo "Usage: $0 {start|stop|restart|status|logs}"
        echo ""
        echo "Commands:"
        echo "  start    - Start the sync daemon"
        echo "  stop     - Stop the sync daemon"
        echo "  restart  - Restart the sync daemon"
        echo "  status   - Check daemon status"
        echo "  logs     - Show and follow logs"
        exit 1
        ;;
esac