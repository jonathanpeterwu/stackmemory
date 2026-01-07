#!/bin/bash

# Install ChromaDB hooks for Claude
# This script sets up automatic context saving and loading

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(dirname "$SCRIPT_DIR")"
CLAUDE_DIR="$PROJECT_ROOT/.claude"
HOOKS_DIR="$CLAUDE_DIR/hooks"
LOG_DIR="$HOME/.stackmemory/logs"

echo "🔧 Installing ChromaDB hooks for Claude..."

# Create directories
mkdir -p "$HOOKS_DIR"
mkdir -p "$LOG_DIR"

# Make hooks executable
chmod +x "$HOOKS_DIR"/*.js 2>/dev/null || true

# Check for ChromaDB API key
if [ -z "$CHROMADB_API_KEY" ]; then
    echo "⚠️  CHROMADB_API_KEY not found in environment"
    echo "   Add to .env: CHROMADB_API_KEY=your_key_here"
else
    echo "✅ ChromaDB API key found"
fi

# Test ChromaDB connection
echo "🔄 Testing ChromaDB connection..."
if node -e "
const { ChromaDBAdapter } = require('$PROJECT_ROOT/dist/core/storage/chromadb-adapter.js');
const adapter = new ChromaDBAdapter({
  apiKey: process.env.CHROMADB_API_KEY,
  apiUrl: process.env.CHROMADB_API_URL || 'http://localhost:8000',
  collectionName: 'claude_context',
  userId: process.env.USER || 'default'
});
adapter.initialize().then(() => {
  console.log('✅ ChromaDB connection successful');
  process.exit(0);
}).catch(err => {
  console.error('❌ ChromaDB connection failed:', err.message);
  process.exit(1);
});
" 2>/dev/null; then
    echo "✅ ChromaDB is accessible"
else
    echo "⚠️  ChromaDB connection failed - hooks will be installed but may not work"
fi

# Create a launcher script
cat > "$PROJECT_ROOT/claude-with-chromadb.sh" << 'EOF'
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

# Start periodic save in background
(
    while true; do
        sleep 900  # 15 minutes
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
EOF

chmod +x "$PROJECT_ROOT/claude-with-chromadb.sh"

# Summary
echo ""
echo "✅ ChromaDB hooks installed successfully!"
echo ""
echo "📋 Installed hooks:"
echo "   - on-startup.js: Loads context on Claude startup"
echo "   - on-code-change.js: Saves when code is modified"
echo "   - on-task-complete.js: Saves and updates Linear on task completion"
echo "   - periodic-save.js: Auto-saves every 15 minutes"
echo "   - chromadb-save-hook.js: Core context saving logic"
echo "   - linear-update-hook.js: Auto-updates Linear tasks"
echo ""
echo "🚀 To use:"
echo "   1. Ensure CHROMADB_API_KEY is in .env"
echo "   2. Run: ./claude-with-chromadb.sh"
echo "   3. Or hooks will activate automatically in Claude"
echo ""
echo "📊 ChromaDB will save context on:"
echo "   - Session start (loads last 24h)"
echo "   - Every 15 minutes"
echo "   - Task completions"
echo "   - Code changes"
echo "   - Git commits"
echo "   - Session end"