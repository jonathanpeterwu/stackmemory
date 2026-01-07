#!/bin/bash

# Install ChromaDB hooks for Claude Code
# These hooks automatically preserve and retrieve context using ChromaDB

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
CLAUDE_DIR="$HOME/.claude"
HOOKS_DIR="$CLAUDE_DIR/hooks"

echo "🚀 Installing ChromaDB Hooks for Claude"
echo "======================================="
echo ""

# Create necessary directories
mkdir -p "$HOOKS_DIR"
mkdir -p "$HOME/.stackmemory/logs"

# Check for ChromaDB configuration
if [ -z "$CHROMADB_API_KEY" ]; then
    if [ -f "$PROJECT_DIR/.env" ]; then
        source "$PROJECT_DIR/.env"
    fi
fi

if [ -z "$CHROMADB_API_KEY" ]; then
    echo "⚠️  ChromaDB not configured"
    echo "Please set CHROMADB_API_KEY in .env file"
    echo ""
fi

# Create main hook wrapper
cat > "$HOOKS_DIR/chromadb-wrapper" << 'EOF'
#!/bin/bash
# ChromaDB Hook Wrapper - Routes Claude events to ChromaDB

HOOK_TYPE="$1"
HOOK_DATA="$2"
PROJECT_DIR="$(pwd)"

# Find StackMemory installation
if [ -d "$PROJECT_DIR/scripts" ] && [ -f "$PROJECT_DIR/scripts/claude-chromadb-hook.js" ]; then
    HOOK_SCRIPT="$PROJECT_DIR/scripts/claude-chromadb-hook.js"
elif [ -f "$HOME/.stackmemory/bin/chromadb-hook.js" ]; then
    HOOK_SCRIPT="$HOME/.stackmemory/bin/chromadb-hook.js"
else
    # Skip if ChromaDB hook not found
    exit 0
fi

# Execute ChromaDB hook in background to not block Claude
nohup node "$HOOK_SCRIPT" "$HOOK_TYPE" "$HOOK_DATA" >> "$HOME/.stackmemory/logs/chromadb-hook.log" 2>&1 &

exit 0
EOF

chmod +x "$HOOKS_DIR/chromadb-wrapper"

# Create on-save hook
cat > "$HOOKS_DIR/on-save" << 'EOF'
#!/bin/bash
# Save context to ChromaDB when Claude saves

# Get context from Claude
CONTEXT_DATA="{\"content\": \"$(cat)\", \"files\": []}"

# Call ChromaDB wrapper
"$HOME/.claude/hooks/chromadb-wrapper" "on-save" "$CONTEXT_DATA" &

# Pass through to other hooks
exit 0
EOF

chmod +x "$HOOKS_DIR/on-save"

# Create on-clear hook
cat > "$HOOKS_DIR/on-clear" << 'EOF'
#!/bin/bash
# Preserve context before clear

# Save current context to ChromaDB
if command -v stackmemory &> /dev/null; then
    stackmemory context add observation "Claude session cleared - preserving context" 2>/dev/null
fi

# Get current context and save to ChromaDB
CONTEXT_DATA="{\"reason\": \"clear\", \"preserved\": true}"
"$HOME/.claude/hooks/chromadb-wrapper" "on-clear" "$CONTEXT_DATA" &

exit 0
EOF

chmod +x "$HOOKS_DIR/on-clear"

# Create on-query hook
cat > "$HOOKS_DIR/on-query" << 'EOF'
#!/bin/bash
# Semantic search when Claude queries

QUERY="$1"
if [ -z "$QUERY" ]; then
    QUERY="$(cat)"
fi

QUERY_DATA="{\"query\": \"$QUERY\"}"
"$HOME/.claude/hooks/chromadb-wrapper" "on-query" "$QUERY_DATA"

exit 0
EOF

chmod +x "$HOOKS_DIR/on-query"

# Create periodic checkpoint hook
cat > "$HOOKS_DIR/on-checkpoint" << 'EOF'
#!/bin/bash
# Periodic context checkpoint (called by cron)

CHECKPOINT_DATA="{\"automatic\": true, \"interval\": 900000}"
"$HOME/.claude/hooks/chromadb-wrapper" "periodic" "$CHECKPOINT_DATA" &

# Also trigger context load to get latest from ChromaDB
if [ -f "$HOME/Dev/stackmemory/scripts/chromadb-context-loader.js" ]; then
    cd "$HOME/Dev/stackmemory"
    node scripts/chromadb-context-loader.js load 1 > /dev/null 2>&1 &
fi

exit 0
EOF

chmod +x "$HOOKS_DIR/on-checkpoint"

# Create important context detection hook
cat > "$HOOKS_DIR/on-important" << 'EOF'
#!/bin/bash
# Capture important context automatically

CONTEXT="$1"
IMPORTANCE="$2"

# Auto-detect importance if not specified
if [ -z "$IMPORTANCE" ]; then
    if echo "$CONTEXT" | grep -qiE "decision|error|critical|breaking|major|completed|deployed|bug|TODO|FIXME"; then
        IMPORTANCE="high"
    else
        IMPORTANCE="normal"
    fi
fi

# Store important context
IMPORTANT_DATA="{\"content\": \"$CONTEXT\", \"importance\": \"$IMPORTANCE\", \"auto_detected\": true}"
"$HOME/.claude/hooks/chromadb-wrapper" "on-important" "$IMPORTANT_DATA" &

exit 0
EOF

chmod +x "$HOOKS_DIR/on-important"

# Create task complete hook
cat > "$HOOKS_DIR/on-task-complete" << 'EOF'
#!/bin/bash
# Save task completion context

TASK_DATA="$1"
if [ -z "$TASK_DATA" ]; then
    TASK_DATA="{\"task\": \"unknown\"}"
fi

"$HOME/.claude/hooks/chromadb-wrapper" "on-task-complete" "$TASK_DATA" &

exit 0
EOF

chmod +x "$HOOKS_DIR/on-task-complete"

# Create error hook
cat > "$HOOKS_DIR/on-error" << 'EOF'
#!/bin/bash
# Log errors to ChromaDB

ERROR_MSG="$1"
ERROR_DATA="{\"error\": \"$ERROR_MSG\", \"severity\": \"error\"}"

"$HOME/.claude/hooks/chromadb-wrapper" "on-error" "$ERROR_DATA" &

exit 0
EOF

chmod +x "$HOOKS_DIR/on-error"

# Create file change hook
cat > "$HOOKS_DIR/on-file-change" << 'EOF'
#!/bin/bash
# Track file changes in ChromaDB

FILE_PATH="$1"
CHANGE_TYPE="${2:-modify}"

FILE_DATA="{\"file\": \"$FILE_PATH\", \"type\": \"$CHANGE_TYPE\"}"
"$HOME/.claude/hooks/chromadb-wrapper" "on-file-change" "$FILE_DATA" &

exit 0
EOF

chmod +x "$HOOKS_DIR/on-file-change"

# Copy the main ChromaDB hook script
if [ -f "$PROJECT_DIR/scripts/claude-chromadb-hook.js" ]; then
    cp "$PROJECT_DIR/scripts/claude-chromadb-hook.js" "$HOME/.stackmemory/bin/chromadb-hook.js"
    chmod +x "$HOME/.stackmemory/bin/chromadb-hook.js"
fi

# Set up periodic checkpoint (every 15 minutes)
CRON_ENTRY="*/15 * * * * $HOOKS_DIR/on-checkpoint"

# Add to crontab if not already present
if ! crontab -l 2>/dev/null | grep -q "on-checkpoint"; then
    (crontab -l 2>/dev/null; echo "$CRON_ENTRY") | crontab -
    echo "✅ Added periodic checkpoint to crontab"
fi

# Create test script
cat > "$PROJECT_DIR/test-chromadb-hooks.sh" << 'EOF'
#!/bin/bash

echo "🧪 Testing ChromaDB Hooks"
echo "========================"
echo ""

# Test save hook
echo "1. Testing save hook..."
echo "Test content" | $HOME/.claude/hooks/on-save
sleep 1

# Test query hook
echo "2. Testing query hook..."
echo "test query" | $HOME/.claude/hooks/on-query
sleep 1

# Test checkpoint hook
echo "3. Testing checkpoint hook..."
$HOME/.claude/hooks/on-checkpoint
sleep 1

# Check logs
echo ""
echo "📄 Recent hook activity:"
tail -10 "$HOME/.stackmemory/logs/chromadb-hook.log" 2>/dev/null || echo "No logs yet"

echo ""
echo "✅ Hook test complete"
EOF

chmod +x "$PROJECT_DIR/test-chromadb-hooks.sh"

echo ""
echo "✅ ChromaDB Hooks Installed!"
echo ""
echo "📋 Installed hooks:"
echo "  • on-save       - Preserves context on saves"
echo "  • on-clear      - Preserves context before clear"
echo "  • on-query      - Semantic search in context"
echo "  • on-checkpoint - Periodic context save (15 min)"
echo "  • on-task-complete - Save task completions"
echo "  • on-error      - Log errors to context"
echo "  • on-file-change - Track file modifications"
echo ""
echo "🔧 ChromaDB will automatically:"
echo "  • Store all context saves"
echo "  • Preserve context on clear"
echo "  • Enable semantic search"
echo "  • Create periodic checkpoints"
echo "  • Track errors and changes"
echo ""
echo "📊 View stored contexts:"
echo "  stackmemory chromadb recent"
echo "  stackmemory chromadb stats"
echo ""
echo "🧪 Test hooks:"
echo "  ./test-chromadb-hooks.sh"
echo ""

# Test connection
if [ -n "$CHROMADB_API_KEY" ]; then
    echo "Testing ChromaDB connection..."
    cd "$PROJECT_DIR"
    node -e "
        import('$PROJECT_DIR/scripts/claude-chromadb-hook.js').then(() => {
            console.log('✅ ChromaDB hook script verified');
        }).catch(err => {
            console.log('⚠️  ChromaDB hook needs configuration');
        });
    " 2>/dev/null || echo "⚠️  Node modules may need updating"
fi