#!/bin/bash

echo "🔍 StackMemory TUI Status Check"
echo "================================"
echo ""

# Check if blessed is installed
echo "1. Checking blessed installation..."
if node -e "require('blessed')" 2>/dev/null; then
  echo "   ✅ blessed is installed"
else
  echo "   ❌ blessed is not installed"
  echo "   Run: npm install blessed blessed-contrib"
  exit 1
fi

# Check terminal compatibility
echo ""
echo "2. Checking terminal compatibility..."
echo "   Terminal: $TERM"
echo "   Terminal Program: ${TERM_PROGRAM:-not set}"
echo "   Inside tmux: ${TMUX:+yes}${TMUX:-no}"

# Check if TUI can start
echo ""
echo "3. Testing TUI startup..."
(
  node dist/features/tui/index.js &
  PID=$!
  sleep 1
  if kill -0 $PID 2>/dev/null; then
    echo "   ✅ TUI started successfully"
    kill $PID 2>/dev/null
  else
    echo "   ⚠️  TUI exited quickly"
  fi
  wait $PID 2>/dev/null
) 2>/dev/null

# Check WebSocket server
echo ""
echo "4. WebSocket server status..."
if nc -z localhost 8080 2>/dev/null; then
  echo "   ✅ WebSocket server is running on port 8080"
else
  echo "   ℹ️  WebSocket server not running (TUI will use offline mode)"
fi

# Show launch commands
echo ""
echo "5. Launch commands:"
echo "   • Full TUI:     ./scripts/launch-tui-safe.sh"
echo "   • Debug mode:   TUI_DEBUG=1 ./scripts/launch-tui-safe.sh"
echo "   • Simple dash:  stackmemory dashboard --watch"
echo ""
echo "Status check complete!"