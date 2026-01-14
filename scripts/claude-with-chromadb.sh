#!/bin/bash

# Launch Claude with ChromaDB hooks enabled
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

# Load environment
if [ -f "$PROJECT_ROOT/.env" ]; then
    export $(grep -v '^#' "$PROJECT_ROOT/.env" | xargs)
fi

# Run startup hook to load context
echo "Loading context from ChromaDB..."
node "$PROJECT_ROOT/.claude/hooks/on-startup.js"

# Start adaptive periodic save in background  
(
    while true; do
        # Check if Claude is active to determine interval
        ACTIVITY_FILE="$HOME/.stackmemory/.claude-activity"
        if [[ -f "$ACTIVITY_FILE" ]]; then
            # Get last activity time
            LAST_ACTIVITY=$(cat "$ACTIVITY_FILE" 2>/dev/null || echo "1970-01-01T00:00:00Z")
            LAST_TIMESTAMP=$(date -j -f "%Y-%m-%dT%H:%M:%S" "${LAST_ACTIVITY%.*}" "+%s" 2>/dev/null || echo "0")
            NOW=$(date "+%s")
            TIME_DIFF=$((NOW - LAST_TIMESTAMP))
            
            # Use 1 minute if active in last 10 minutes, 5 minutes otherwise
            if [[ $TIME_DIFF -lt 600 ]]; then
                SLEEP_TIME=60  # 1 minute for active sessions
            else
                SLEEP_TIME=300  # 5 minutes when idle
            fi
        else
            SLEEP_TIME=300  # 5 minutes default
        fi
        
        sleep $SLEEP_TIME
        node "$PROJECT_ROOT/.claude/hooks/periodic-save.js" 2>/dev/null
    done
) &
PERIODIC_PID=$!

# Cleanup function
cleanup() {
    echo "Saving final context..."
    node "$PROJECT_ROOT/.claude/hooks/chromadb-save-hook.js" << JSON
{
  "event": "session_end",
  "data": {
    "summary": "Claude session ended",
    "duration": "$SECONDS seconds"
  }
}
JSON
    kill $PERIODIC_PID 2>/dev/null
    exit
}

trap cleanup EXIT INT TERM

echo "✨ Claude with ChromaDB hooks is ready!"
echo "   - Context loaded from last 24 hours"
echo "   - Periodic saves every 15 minutes"
echo "   - Linear task updates enabled"
echo ""
echo "Press Ctrl+C to exit and save context"

# Keep running
wait
