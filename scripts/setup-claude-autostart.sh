#!/bin/bash

# Setup script for Claude Auto-Start Integration
# Installs hooks and configures auto-start daemons for Claude Code

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CLAUDE_DIR="$HOME/.claude"
HOOKS_DIR="$CLAUDE_DIR/hooks"
STACKMEMORY_DIR="$HOME/.stackmemory"

echo "🚀 Claude StackMemory Auto-Start Setup"
echo "======================================="
echo ""

# Create necessary directories
echo "📁 Creating directories..."
mkdir -p "$CLAUDE_DIR"
mkdir -p "$HOOKS_DIR"
mkdir -p "$STACKMEMORY_DIR/logs"
mkdir -p "$STACKMEMORY_DIR/daemons"

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is required but not installed"
    exit 1
fi

echo "✅ Node.js found: $(node --version)"

# Install dependencies if needed
echo ""
echo "📦 Checking dependencies..."
cd "$PROJECT_DIR"
if [ ! -d "node_modules/chokidar" ]; then
    echo "Installing required dependencies..."
    npm install chokidar dotenv express ioredis --save-dev
fi

# Create Claude hook for project load
echo ""
echo "🪝 Setting up Claude hooks..."

# Create the on-project-open hook
cat > "$HOOKS_DIR/on-project-open" << 'EOF'
#!/bin/bash
# Claude hook: Auto-start StackMemory daemons when project opens

PROJECT_PATH="$1"
PROJECT_NAME="$(basename "$PROJECT_PATH")"

# Check if this is the stackmemory project
if [[ "$PROJECT_NAME" == "stackmemory" ]] || [[ -f "$PROJECT_PATH/package.json" && $(grep -q '"name".*"stackmemory"' "$PROJECT_PATH/package.json"; echo $?) -eq 0 ]]; then
    echo "🚀 StackMemory project detected - starting daemons..."
    
    # Check if daemons are already running
    PID_FILE="$HOME/.stackmemory/claude-daemons.pid"
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            echo "✅ Daemons already running (PID: $PID)"
            exit 0
        fi
    fi
    
    # Start the auto-start manager
    cd "$PROJECT_PATH"
    nohup node scripts/claude-sm-autostart.js > "$HOME/.stackmemory/logs/autostart.log" 2>&1 &
    echo $! > "$PID_FILE"
    echo "✅ Claude daemons started (PID: $!)"
    
    # Also start the background sync manager if configured
    if [ -f "$PROJECT_PATH/.env" ] && grep -q "ENABLE_BACKGROUND_SYNC=true" "$PROJECT_PATH/.env"; then
        nohup node scripts/background-sync-manager.js > "$HOME/.stackmemory/logs/sync-manager.log" 2>&1 &
        echo "✅ Background sync manager started"
    fi
    
    # Initialize ChromaDB hooks if configured
    if [ -f "$PROJECT_PATH/.env" ] && grep -q "CHROMADB_API_KEY" "$PROJECT_PATH/.env"; then
        echo "🔗 Initializing ChromaDB context preservation..."
        # Trigger initial context save
        "$HOME/.claude/hooks/on-checkpoint" 2>/dev/null &
        echo "✅ ChromaDB hooks activated"
    fi
fi
EOF

chmod +x "$HOOKS_DIR/on-project-open"

# Create the on-project-close hook
cat > "$HOOKS_DIR/on-project-close" << 'EOF'
#!/bin/bash
# Claude hook: Stop StackMemory daemons when project closes

PROJECT_PATH="$1"
PROJECT_NAME="$(basename "$PROJECT_PATH")"

if [[ "$PROJECT_NAME" == "stackmemory" ]] || [[ -f "$PROJECT_PATH/package.json" && $(grep -q '"name".*"stackmemory"' "$PROJECT_PATH/package.json"; echo $?) -eq 0 ]]; then
    echo "👋 Stopping StackMemory daemons..."
    
    PID_FILE="$HOME/.stackmemory/claude-daemons.pid"
    if [ -f "$PID_FILE" ]; then
        PID=$(cat "$PID_FILE")
        if kill -0 "$PID" 2>/dev/null; then
            kill "$PID"
            echo "✅ Daemons stopped"
        fi
        rm -f "$PID_FILE"
    fi
fi
EOF

chmod +x "$HOOKS_DIR/on-project-close"

# Create on-clear hook to preserve context
cat > "$HOOKS_DIR/on-clear" << 'EOF'
#!/bin/bash
# Claude hook: Save context before clear

# Save to StackMemory
if command -v stackmemory &> /dev/null; then
    stackmemory context add observation "Claude session cleared - preserving context" 2>/dev/null
fi

# Save to ChromaDB if configured
if [ -f "$HOME/.claude/hooks/chromadb-wrapper" ]; then
    CONTEXT_DATA='{"reason": "clear", "preserved": true}'
    "$HOME/.claude/hooks/chromadb-wrapper" "on-clear" "$CONTEXT_DATA" 2>/dev/null &
fi
EOF

chmod +x "$HOOKS_DIR/on-clear"

# Create wrapper script for easy daemon management
cat > "$STACKMEMORY_DIR/bin/claude-daemons" << 'EOF'
#!/bin/bash
# Claude daemons management script

COMMAND="$1"
PID_FILE="$HOME/.stackmemory/claude-daemons.pid"

case "$COMMAND" in
    start)
        if [ -f "$PID_FILE" ]; then
            PID=$(cat "$PID_FILE")
            if kill -0 "$PID" 2>/dev/null; then
                echo "✅ Daemons already running (PID: $PID)"
                exit 0
            fi
        fi
        cd "$(dirname "$(dirname "$(readlink -f "$0")")")"
        nohup node scripts/claude-sm-autostart.js > "$HOME/.stackmemory/logs/autostart.log" 2>&1 &
        echo $! > "$PID_FILE"
        echo "✅ Claude daemons started (PID: $!)"
        ;;
    stop)
        if [ -f "$PID_FILE" ]; then
            PID=$(cat "$PID_FILE")
            if kill "$PID" 2>/dev/null; then
                echo "✅ Daemons stopped"
            fi
            rm -f "$PID_FILE"
        else
            echo "❌ No daemons running"
        fi
        ;;
    status)
        if [ -f "$PID_FILE" ]; then
            PID=$(cat "$PID_FILE")
            if kill -0 "$PID" 2>/dev/null; then
                echo "✅ Daemons running (PID: $PID)"
                echo ""
                echo "Recent activity:"
                tail -5 "$HOME/.stackmemory/logs/claude-autostart.log" 2>/dev/null
            else
                echo "❌ Daemons not running (stale PID file)"
                rm -f "$PID_FILE"
            fi
        else
            echo "❌ No daemons running"
        fi
        ;;
    restart)
        "$0" stop
        sleep 1
        "$0" start
        ;;
    logs)
        tail -f "$HOME/.stackmemory/logs/claude-autostart.log"
        ;;
    *)
        echo "Usage: claude-daemons {start|stop|status|restart|logs}"
        exit 1
        ;;
esac
EOF

chmod +x "$STACKMEMORY_DIR/bin/claude-daemons"

# Update .env with daemon settings
echo ""
echo "📝 Updating environment settings..."

if [ -f "$PROJECT_DIR/.env" ]; then
    # Check if settings already exist
    if ! grep -q "ENABLE_BACKGROUND_SYNC" "$PROJECT_DIR/.env"; then
        echo "" >> "$PROJECT_DIR/.env"
        echo "# Claude Auto-Start Settings" >> "$PROJECT_DIR/.env"
        echo "ENABLE_BACKGROUND_SYNC=true" >> "$PROJECT_DIR/.env"
        echo "ENABLE_WEBHOOKS=false" >> "$PROJECT_DIR/.env"
        echo "ENABLE_QUALITY_GATES=true" >> "$PROJECT_DIR/.env"
        echo "WEBHOOK_PORT=3456" >> "$PROJECT_DIR/.env"
    fi
fi

# Create test script
cat > "$PROJECT_DIR/test-claude-autostart.sh" << 'EOF'
#!/bin/bash
# Test Claude auto-start integration

echo "🧪 Testing Claude Auto-Start Integration"
echo "========================================"
echo ""

# Test daemon start
echo "1. Testing daemon startup..."
node scripts/claude-sm-autostart.js status
if [ $? -eq 0 ]; then
    echo "✅ Daemon check passed"
else
    echo "❌ Daemon check failed"
fi

echo ""
echo "2. Testing hooks..."
for hook in on-project-open on-project-close on-clear; do
    if [ -x "$HOME/.claude/hooks/$hook" ]; then
        echo "✅ $hook hook installed"
    else
        echo "❌ $hook hook missing"
    fi
done

echo ""
echo "3. Testing environment..."
if [ -f ".env" ] && grep -q "ENABLE_BACKGROUND_SYNC=true" ".env"; then
    echo "✅ Environment configured"
else
    echo "❌ Environment not configured"
fi

echo ""
echo "4. Testing daemon management..."
if [ -x "$HOME/.stackmemory/bin/claude-daemons" ]; then
    echo "✅ Management script installed"
    $HOME/.stackmemory/bin/claude-daemons status
else
    echo "❌ Management script missing"
fi

echo ""
echo "Test complete!"
EOF

chmod +x "$PROJECT_DIR/test-claude-autostart.sh"

# Display summary
echo ""
echo "✅ Claude Auto-Start Setup Complete!"
echo ""
echo "📋 Installed components:"
echo "  • Claude hooks (on-project-open, on-project-close, on-clear)"
echo "  • Daemon management script (claude-daemons)"
echo "  • Environment configuration"
echo "  • Test script"
echo ""
echo "🎯 Active daemons when Claude loads:"
echo "  1. Context Monitor - Saves context every 15 min"
echo "  2. Linear Sync - Syncs tasks hourly"
echo "  3. File Watcher - Auto-syncs on file changes"
echo "  4. Error Monitor - Tracks and logs errors"
echo "  5. Quality Gates - Post-task validation"
echo "  6. Auto-handoff - Session transition helper"
echo ""
echo "📌 Useful commands:"
echo "  claude-daemons start   - Start daemons manually"
echo "  claude-daemons stop    - Stop daemons"
echo "  claude-daemons status  - Check daemon status"
echo "  claude-daemons logs    - View daemon logs"
echo ""
echo "  ./test-claude-autostart.sh - Test the integration"
echo ""
echo "🔧 Configuration:"
echo "  Edit .env to enable/disable features:"
echo "  - ENABLE_BACKGROUND_SYNC (true/false)"
echo "  - ENABLE_WEBHOOKS (true/false)"
echo "  - ENABLE_QUALITY_GATES (true/false)"
echo ""

# Ask to test
read -p "Would you like to test the integration now? (y/n) " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
    ./test-claude-autostart.sh
fi